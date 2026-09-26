#!/bin/bash
# Rootless qualification on the exact candidate host; no host provisioning.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != x86_64 || "$(uname -r)" != 23.4.0 || "$(sw_vers -buildVersion)" != 23E224 || "$EUID" == 0 ]]; then
  echo 'Qualification requires unprivileged Intel macOS 14.4.1 build 23E224 (Darwin 23.4.0).' >&2
  exit 2
fi
bun -e 'if (Bun.version !== "1.4.2" || Bun.revision !== "744846f844374847c902b5e7fd59b4342a51ef99") throw new Error("exact qualified Bun 1.4.2 is required")'
node_path="${JIG_AUTHORING_NODE_PATH:-${FLOW_NODE:-$(command -v node || true)}}"
if [[ "$node_path" != /* || ! -x "$node_path" ]]; then
  echo 'Configure an absolute Node 22+ compiler executable before qualification.' >&2
  exit 2
fi
# Obtain the real executable so an operator version-manager shim cannot enter an empty environment.
JIG_AUTHORING_NODE_PATH=$(/usr/bin/env -i "$node_path" -p 'if (Number(process.versions.node.split(".")[0]) < 22) throw Error("Node 22+ required"); process.execPath')
export JIG_AUTHORING_NODE_PATH
export FLOW_NODE="$JIG_AUTHORING_NODE_PATH"
for name in JIG_CODEX_STARTUP_PATH JIG_CLAUDE_STARTUP_PATH JIG_PI_STARTUP_PATH; do
  value="${!name:-}"
  if [[ "$value" != /* || ! -x "$value" ]]; then
    echo "Configure $name with an executable native client before qualification." >&2
    exit 2
  fi
done
if [[ $# -eq 1 && "${1:-}" == --preflight ]]; then exit 0; fi
if [[ $# -ne 0 ]]; then echo "Unexpected qualification arguments" >&2; exit 2; fi
# Host qualification has no live API phase.
unset OPENAI_API_KEY ANTHROPIC_API_KEY OPENROUTER_API_KEY PI_API_KEY
unset JIG_CODEX_PROOF_PATH JIG_CLAUDE_PROOF_PATH JIG_PI_PROOF_PATH
scratch=$(mktemp -d "${TMPDIR:-/tmp}/jig-macos-conformance.XXXXXX")
scratch=$(bun -e 'console.log(require("node:fs").realpathSync(process.argv[1]))' "$scratch")
snapshot() {
  {
    launchctl list | awk 'NR > 1 && $3 ~ /^org\.jig\./ {print "job " $3}'
    mount | awk '/jig-/ {print "mount " $0}'
    ps -axo pid=,command= | awk '/macos-native-supervisor|macos-exec|\/jig-guardian-/ && !/awk/ {print "process " $0}'
  } | LC_ALL=C sort
}
snapshot > "$scratch/before"
finish() {
  status=$?
  if [[ -f "$scratch/SHA256SUMS" ]] && ! shasum -a 256 --check "$scratch/SHA256SUMS"; then status=1; fi
  snapshot > "$scratch/after"
  if ! diff -u "$scratch/before" "$scratch/after"; then
    echo 'Mac qualification changed host ownership residue; preserve evidence and investigate.' >&2
    status=1
  fi
  if [[ "$status" == 0 ]]; then
    rm -rf "$scratch"
  else
    echo "Qualification evidence retained at $scratch" >&2
  fi
  exit "$status"
}
trap finish EXIT
# Freeze all package inputs once; each consumer must use these same bytes.
for package in flow-sdk agent-method agent-acp; do
  mkdir "$scratch/$package"
  bun pm pack --cwd "packages/$package" --ignore-scripts --destination "$scratch/$package"
done
mkdir "$scratch/jig"
(cd packages/jig && bun scripts/pack.ts --destination "$scratch/jig")
for package in flow-sdk agent-method agent-acp jig; do
  archives=("$scratch/$package/"*.tgz)
  if [[ ${#archives[@]} -ne 1 || ! -f "${archives[0]}" ]]; then
    echo "Expected one frozen $package archive" >&2
    exit 1
  fi
  case "$package" in
    flow-sdk) export FLOW_SDK_PACKAGE_ARCHIVE="${archives[0]}" ;;
    agent-method) export AGENT_METHOD_PACKAGE_ARCHIVE="${archives[0]}" ;;
    agent-acp) export AGENT_ACP_PACKAGE_ARCHIVE="${archives[0]}" ;;
    jig) export JIG_PACKAGE_ARCHIVE="${archives[0]}" ;;
  esac
done
shasum -a 256 "$scratch"/*/*.tgz > "$scratch/SHA256SUMS"
cat "$scratch/SHA256SUMS"
export JIG_MACOS_PROCESS_TEST=1
# Keep resource ownership tests sequential; every enabled native case must run.
bun test packages/jig/test --timeout 420000
JIG_NATIVE_AGENT_STARTUP=1 bun test packages/jig/test/native-agent-startup.test.ts --timeout 120000
# Pack and install the result in a separate ordinary consumer, then use its CLI.
bun packages/jig/test/package-smoke.ts
