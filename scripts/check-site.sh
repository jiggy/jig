#!/bin/sh

set -eu

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: scripts/check-site.sh <flow|jig> [base-url]" >&2
  exit 2
fi

site_name=$1
case $site_name in
  flow)
    default_base=https://flow.jig.md
    home_title='<title>FLOW</title>'
    guide_title='<title>FLOW specifications - FLOW</title>'
    json_map='docs/flow/spec/machine/capability-contract-1.schema.json|schemas/capability-contract-1.schema.json
docs/flow/spec/machine/channel-contract-1.schema.json|schemas/channel-contract-1.schema.json
docs/flow/spec/machine/run-1-errors.json|schemas/run-1-errors.json
docs/flow/spec/machine/run-1.schema.json|schemas/run-1.json
docs/flow/spec/machine/schema-1.json|schemas/schema-1.json'
    ;;
  jig)
    default_base=https://jig.md
    home_title='<title>Jig</title>'
    guide_title='<title>Get started with Jig - Jig</title>'
    json_map='docs/jig/spec/machine/jig-lock-1.schema.json|schemas/jig-lock-1.schema.json
docs/jig/spec/machine/project-authoring-1.schema.json|schemas/project-authoring-1.schema.json
docs/jig/spec/contracts/agent-run.capability.json|contracts/agent-run.capability.json
docs/jig/spec/contracts/acp-public-updates.json|contracts/acp-public-updates.json
docs/jig/spec/contracts/project-command.capability.json|contracts/project-command.capability.json
docs/jig/spec/contracts/run-checkpoint.capability.json|contracts/run-checkpoint.capability.json'
    ;;
  *)
    echo "the site must be flow or jig" >&2
    exit 2
    ;;
esac

base=${2:-$default_base}
case $base in
  https://*) ;;
  *)
    echo "the site base URL must use https" >&2
    exit 2
    ;;
esac
base=${base%/}

javascript=$(command -v node || command -v bun) || {
  echo "Node or Bun is required to check a site artifact" >&2
  exit 2
}

repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
temporary=$(mktemp -d "${TMPDIR:-/tmp}/jig-site-check.XXXXXX")
cleanup() {
  rm -rf -- "$temporary"
}
trap cleanup EXIT HUP INT TERM

curl --fail --location --silent --show-error "$base/" > "$temporary/index.html"
curl --fail --location --silent --show-error "$base/guide/" > "$temporary/guide.html"
grep -Fq "$home_title" "$temporary/index.html"
grep -Fq "$guide_title" "$temporary/guide.html"

if [ "$site_name" = jig ]; then
  for contract in agent-run project-command run-checkpoint acp-public-updates; do
    case $contract in
      agent-run) title='<title>Agent Run contract - Jig</title>' ;;
      project-command) title='<title>Project Command contract - Jig</title>' ;;
      run-checkpoint) title='<title>Run Checkpoint contract - Jig</title>' ;;
      acp-public-updates) title='<title>ACP public updates contract - Jig</title>' ;;
    esac
    curl --fail --location --silent --show-error \
      "$base/contracts/$contract" > "$temporary/contract.html"
    grep -Fq "$title" "$temporary/contract.html"
  done
fi

printf '%s\n' "$json_map" |
while IFS='|' read -r source route
do
  curl --fail --location --silent --show-error \
    --dump-header "$temporary/headers" \
    "$base/$route" > "$temporary/document.json"
  if ! grep -Eiq '^content-type:[[:space:]]*application/json([;[:space:]]|$)' \
    "$temporary/headers"; then
    echo "$base/$route was not served as application/json" >&2
    exit 1
  fi
  "$javascript" - "$repository/$source" "$temporary/document.json" <<'NODE'
const { readFileSync } = require("node:fs");
const [source, downloaded] = process.argv.slice(2);
if (!readFileSync(source).equals(readFileSync(downloaded))) {
  throw new Error(`${downloaded} does not contain the exact source bytes`);
}
NODE
done

echo "$site_name site and canonical JSON checks passed"
