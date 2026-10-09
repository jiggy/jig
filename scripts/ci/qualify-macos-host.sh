#!/bin/bash
# Rootless qualification on the exact candidate host; no host provisioning.
set -euo pipefail
cd "$(dirname "$0")/../.."
mode=full
shard=-1
case "$#" in
  0) ;;
  1)
    if [[ "$1" == --preflight ]]; then mode=preflight
    else echo 'Unexpected qualification arguments' >&2; exit 2
    fi
    ;;
  2)
    if [[ "$1" == --shard && "$2" =~ ^[0-2]$ ]]; then mode=shard; shard=$2
    else echo 'Expected --shard followed by a selected architecture shard' >&2; exit 2
    fi
    ;;
  *) echo 'Unexpected qualification arguments' >&2; exit 2 ;;
esac
case "$(uname -s):$(uname -m):$(uname -r):$(sw_vers -buildVersion)" in
  Darwin:x86_64:23.4.0:23E224) codex_startup_expectation=startup ;;
  Darwin:x86_64:24.6.0:24G830|Darwin:arm64:24.6.0:24G830) codex_startup_expectation=unsupported ;;
  *) echo 'Qualification requires an exact selected native Mac candidate.' >&2; exit 2 ;;
esac
if [[ "$EUID" == 0 ]]; then
  echo 'Qualification requires an unprivileged operator.' >&2
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
architecture=$(bun -e 'console.log(process.arch)')
shard_count=$(node scripts/ci/macos-host-test-shards.mjs count "$architecture")
installed_shard=$((shard_count - 1))
if [[ "$mode" == shard && "$shard" -ge "$shard_count" ]]; then
  echo 'Shard is outside the selected architecture plan.' >&2
  exit 2
fi
if [[ "$mode" != shard || "$shard" == "$installed_shard" ]]; then
  for name in JIG_CODEX_STARTUP_PATH JIG_CLAUDE_STARTUP_PATH JIG_PI_STARTUP_PATH; do
    value="${!name:-}"
    if [[ "$value" != /* || ! -x "$value" ]]; then
      echo "Configure $name with an executable native client before qualification." >&2
      exit 2
    fi
  done
fi
source_revision=$(git rev-parse HEAD)
candidate_receipt=''
if [[ -n "${JIG_CI_CANDIDATE_DIRECTORY:-}" ]]; then
  if [[ "$JIG_CI_CANDIDATE_DIRECTORY" != /* || ! -d "$JIG_CI_CANDIDATE_DIRECTORY" ]]; then
    echo 'Configure an absolute canonical candidate directory before qualification.' >&2
    exit 2
  fi
  candidate_receipt=$("$JIG_AUTHORING_NODE_PATH" scripts/ci/candidate-provenance.mjs verify \
    "$JIG_CI_CANDIDATE_DIRECTORY" --source "$source_revision")
fi
if [[ "$mode" == preflight ]]; then exit 0; fi
# Host qualification has no live API phase.
unset OPENAI_API_KEY ANTHROPIC_API_KEY OPENROUTER_API_KEY PI_API_KEY
unset JIG_CODEX_PROOF_PATH JIG_CLAUDE_PROOF_PATH JIG_PI_PROOF_PATH
scratch=$(mktemp -d "${TMPDIR:-/tmp}/jig-macos-conformance.XXXXXX")
scratch=$(bun -e 'console.log(require("node:fs").realpathSync(process.argv[1]))' "$scratch")
snapshot() {
  {
    launchctl list | awk 'NR > 1 && $3 ~ /^org\.jig\./ {print "job " $3}'
    mount | awk '/jig-/ {print "mount " $0}'
    ps -axo pid=,command= | awk '/macos-native-supervisor|macos-exec|macos-codex-preferences|\/jig-guardian-/ && !/awk/ {print "process " $0}'
  } | LC_ALL=C sort
}
snapshot > "$scratch/before"
finish() {
  status=$?
  if [[ -f "$scratch/SHA256SUMS" ]] && ! shasum -a 256 --check "$scratch/SHA256SUMS"; then status=1; fi
  if [[ -n "$candidate_receipt" ]]; then
    current_receipt=''
    if ! current_receipt=$("$JIG_AUTHORING_NODE_PATH" scripts/ci/candidate-provenance.mjs verify \
      "$JIG_CI_CANDIDATE_DIRECTORY" --source "$source_revision") || [[ "$current_receipt" != "$candidate_receipt" ]]; then
      echo 'The canonical candidate changed during Mac qualification.' >&2
      status=1
    fi
  fi
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
# Hosted qualification receives the canonical publication bytes. The standalone
# full-host entrypoint still freezes its own selected source once.
if [[ -n "$candidate_receipt" ]]; then
  for package in flow-sdk user-updates agent-method agent-acp jig; do
    archives=("$JIG_CI_CANDIDATE_DIRECTORY/$package/"*.tgz)
    if [[ ${#archives[@]} -ne 1 || ! -f "${archives[0]}" || -L "${archives[0]}" ]]; then
      echo "Expected one canonical $package archive" >&2
      exit 1
    fi
    mkdir "$scratch/$package"
    cp "${archives[0]}" "$scratch/$package/"
  done
else
  for package in flow-sdk user-updates agent-method agent-acp; do
    mkdir "$scratch/$package"
    bun pm pack --cwd "packages/$package" --ignore-scripts --destination "$scratch/$package"
  done
  mkdir "$scratch/jig"
  (cd packages/jig && bun scripts/pack.ts --destination "$scratch/jig")
fi
for package in flow-sdk user-updates agent-method agent-acp jig; do
  archives=("$scratch/$package/"*.tgz)
  if [[ ${#archives[@]} -ne 1 || ! -f "${archives[0]}" ]]; then
    echo "Expected one frozen $package archive" >&2
    exit 1
  fi
  case "$package" in
    flow-sdk) export FLOW_SDK_PACKAGE_ARCHIVE="${archives[0]}" ;;
    user-updates) export USER_UPDATES_PACKAGE_ARCHIVE="${archives[0]}" ;;
    agent-method) export AGENT_METHOD_PACKAGE_ARCHIVE="${archives[0]}" ;;
    agent-acp) export AGENT_ACP_PACKAGE_ARCHIVE="${archives[0]}" ;;
    jig) export JIG_PACKAGE_ARCHIVE="${archives[0]}" ;;
  esac
done
shasum -a 256 "$scratch"/*/*.tgz > "$scratch/SHA256SUMS"
cat "$scratch/SHA256SUMS"
if [[ "$mode" == full || "$shard" == "$installed_shard" ]]; then
  # npm must accept the frozen package on this native architecture and install
  # its matching optional Bun runtime through an ordinary consumer manifest.
  mkdir "$scratch/npm-consumer"
  npm install --prefix "$scratch/npm-consumer" --ignore-scripts --no-audit --no-fund "$JIG_PACKAGE_ARCHIVE"
  "$scratch/npm-consumer/node_modules/.bin/jig" --version
fi
export JIG_MACOS_PROCESS_TEST=1
# Keep resource ownership tests sequential within each disposable host. The
# hosted matrix distributes every file and all root lifecycle cases across
# independent machines; the self-hosted qualification still runs them all.
if [[ "$mode" == shard ]]; then
  node scripts/ci/macos-host-test-shards.mjs run "$architecture" "$shard"
else
  bun test packages/jig/test --timeout 420000
fi
if [[ "$mode" == full || "$shard" == "$installed_shard" ]]; then
  startup_options=(--timeout 120000)
  if [[ -n "${JIG_MACOS_TEST_TIMINGS_DIRECTORY:-}" ]]; then
    startup_options+=(--reporter=junit "--reporter-outfile=$JIG_MACOS_TEST_TIMINGS_DIRECTORY/installed-startup.xml")
  fi
  # The genuine Codex path must start only on its qualified preference profile;
  # other selected Mac hosts must prove explicit refusal, never skip the case.
  JIG_NATIVE_AGENT_STARTUP=1 JIG_CODEX_MACOS_STARTUP_EXPECTATION="$codex_startup_expectation" \
    bun test packages/jig/test/native-agent-startup.test.ts "${startup_options[@]}"
  # Pack and install the result in a separate ordinary consumer, then use its CLI.
  bun packages/jig/test/package-smoke.ts
fi
if [[ -n "${JIG_STARTUP_PROFILE_DIRECTORY:-}" && "$shard" == "$installed_shard" ]]; then
  JIG_CI_BUN=$(bun -e 'console.log(process.execPath)') \
    bun scripts/profile-installed-startup.ts ||
    echo 'Optional installed startup profile failed; retained records may explain the failure.' >&2
fi
