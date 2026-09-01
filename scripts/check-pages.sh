#!/bin/sh

set -eu

if [ "$#" -gt 1 ]; then
  echo "usage: scripts/check-pages.sh [base-url]" >&2
  exit 2
fi

base=${1:-https://flow.jig.md}
case $base in
  https://*) ;;
  *)
    echo "the Pages base URL must use https" >&2
    exit 2
    ;;
esac
base=${base%/}

javascript=$(command -v node || command -v bun) || {
  echo "Node or Bun is required to check the Pages artifact" >&2
  exit 2
}

repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
temporary=$(mktemp -d "${TMPDIR:-/tmp}/jig-pages-check.XXXXXX")
cleanup() {
  rm -rf -- "$temporary"
}
trap cleanup EXIT HUP INT TERM

curl --fail --location --silent --show-error "$base/" > "$temporary/index.html"
curl --fail --location --silent --show-error "$base/guide/" > "$temporary/docs.html"
grep -Fq '<title>Jig and FLOW</title>' "$temporary/index.html"
grep -Fq '<title>Jig and FLOW specifications - Jig + FLOW</title>' "$temporary/docs.html"

while IFS='|' read -r source route
do
  curl --fail --location --silent --show-error \
    --dump-header "$temporary/headers" \
    "$base/schemas/$route" > "$temporary/$route"
  if ! grep -Eiq '^content-type:[[:space:]]*application/json([;[:space:]]|$)' \
    "$temporary/headers"; then
    echo "$base/schemas/$route was not served as application/json" >&2
    exit 1
  fi
  "$javascript" - "$repository/docs/spec/machine/$source" "$temporary/$route" <<'NODE'
const { readFileSync } = require("node:fs");
const [source, downloaded] = process.argv.slice(2);
if (!readFileSync(source).equals(readFileSync(downloaded))) {
  throw new Error(`${downloaded} does not contain the exact source bytes`);
}
NODE
done <<'SCHEMAS'
capability-contract-1.schema.json|capability-contract-1.schema.json
jig-lock-1.schema.json|jig-lock-1.schema.json
project-authoring-1.schema.json|project-authoring-1.schema.json
run-1-errors.json|run-1-errors.json
run-1.schema.json|run-1.json
schema-1.json|schema-1.json
SCHEMAS

echo "Pages and canonical schema checks passed"
