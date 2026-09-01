#!/bin/sh

set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: scripts/build-pages.sh <output-directory>" >&2
  exit 2
fi

javascript=$(command -v node || command -v bun) || {
  echo "Node or Bun is required to validate the Pages artifact" >&2
  exit 2
}

repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
output_argument=$1
output_parent_argument=$(dirname -- "$output_argument")
output_name=$(basename -- "$output_argument")
mkdir -p -- "$output_parent_argument"
output_parent=$(CDPATH= cd -- "$output_parent_argument" && pwd -P)
output="$output_parent/$output_name"

if [ -e "$output" ]; then
  echo "the Pages output already exists: $output" >&2
  exit 1
fi

staging=$(mktemp -d "$output_parent/.jig-pages.XXXXXX")
cleanup() {
  if [ -n "${staging:-}" ]; then rm -rf -- "$staging"; fi
}
trap cleanup EXIT HUP INT TERM

cp -R -- "$repository/site/." "$staging/"
mkdir -p -- "$staging/schemas"

actual=$(
  find "$repository/docs/spec/machine" -maxdepth 1 -type f -name '*.json' \
    -printf '%f\n' | LC_ALL=C sort
)
expected='capability-contract-1.schema.json
jig-lock-1.schema.json
project-authoring-1.schema.json
run-1-errors.json
run-1.schema.json
schema-1.json'
if [ "$actual" != "$expected" ]; then
  echo "the public machine-file inventory changed; review build-pages.sh" >&2
  exit 1
fi

while IFS='|' read -r source route identifier
do
  cp -- "$repository/docs/spec/machine/$source" "$staging/schemas/$route"
  "$javascript" - \
    "$repository/docs/spec/machine/$source" \
    "$staging/schemas/$route" \
    "$identifier" <<'NODE'
const { readFileSync } = require("node:fs");
const [source, output, identifier] = process.argv.slice(2);
const sourceBytes = readFileSync(source);
const document = JSON.parse(sourceBytes.toString("utf8"));
if (identifier !== "-" && document.$id !== identifier) {
  throw new Error(`${source} has unexpected $id ${JSON.stringify(document.$id)}`);
}
if (!sourceBytes.equals(readFileSync(output))) {
  throw new Error(`${output} does not contain the exact source bytes`);
}
NODE
done <<'SCHEMAS'
capability-contract-1.schema.json|capability-contract-1.schema.json|https://flow.jig.md/schemas/capability-contract-1.schema.json
jig-lock-1.schema.json|jig-lock-1.schema.json|-
project-authoring-1.schema.json|project-authoring-1.schema.json|-
run-1-errors.json|run-1-errors.json|-
run-1.schema.json|run-1.json|https://flow.jig.md/schemas/run-1.json
schema-1.json|schema-1.json|https://flow.jig.md/schemas/schema-1.json
SCHEMAS

mv -T --no-clobber -- "$staging" "$output"
if [ -e "$staging" ]; then
  echo "the Pages output appeared while it was being built: $output" >&2
  exit 1
fi
staging=

printf '%s\n' "$output"
