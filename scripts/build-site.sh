#!/bin/sh

set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: scripts/build-site.sh <flow|jig> <output-directory>" >&2
  exit 2
fi

site_name=$1
case $site_name in
  flow|jig) ;;
  *)
    echo "the site must be flow or jig" >&2
    exit 2
    ;;
esac

javascript=$(command -v node || command -v bun) || {
  echo "Node or Bun is required to build a site artifact" >&2
  exit 2
}
bun=$(command -v bun) || {
  echo "Bun is required to build a site artifact" >&2
  exit 2
}

repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
output_argument=$2
output_parent_argument=$(dirname -- "$output_argument")
output_name=$(basename -- "$output_argument")
mkdir -p -- "$output_parent_argument"
output_parent=$(CDPATH= cd -- "$output_parent_argument" && pwd -P)
output="$output_parent/$output_name"

if [ -e "$output" ]; then
  echo "the site output already exists: $output" >&2
  exit 1
fi

staging=$(mktemp -d "$output_parent/.jig-site.XXXXXX")
cleanup() {
  if [ -n "${staging:-}" ]; then rm -rf -- "$staging"; fi
}
trap cleanup EXIT HUP INT TERM

PUBLIC_SITE_OUTPUT="$staging" \
  just --justfile "$repository/site/justfile" "build-$site_name"
cp -R -- "$repository/site/$site_name/public/." "$staging/"
mkdir -p -- "$staging/schemas"

actual=$(
  find \
    "$repository/docs/flow/spec/machine" \
    "$repository/docs/jig/spec/machine" \
    -maxdepth 1 -type f -name '*.json' -printf '%p\n' |
    sed "s|^$repository/||" |
    LC_ALL=C sort
)
expected='docs/flow/spec/machine/capability-contract-1.schema.json
docs/flow/spec/machine/run-1-errors.json
docs/flow/spec/machine/run-1.schema.json
docs/flow/spec/machine/schema-1.json
docs/jig/spec/machine/jig-lock-1.schema.json
docs/jig/spec/machine/project-authoring-1.schema.json'
if [ "$actual" != "$expected" ]; then
  echo "the public machine-file inventory changed; review build-site.sh" >&2
  exit 1
fi

case $site_name in
  flow)
    schema_map='docs/flow/spec/machine/capability-contract-1.schema.json|capability-contract-1.schema.json|https://flow.jig.md/schemas/capability-contract-1.schema.json
docs/flow/spec/machine/run-1-errors.json|run-1-errors.json|-
docs/flow/spec/machine/run-1.schema.json|run-1.json|https://flow.jig.md/schemas/run-1.json
docs/flow/spec/machine/schema-1.json|schema-1.json|https://flow.jig.md/schemas/schema-1.json'
    forbidden_page='spec/project-policy.html'
    ;;
  jig)
    schema_map='docs/jig/spec/machine/jig-lock-1.schema.json|jig-lock-1.schema.json|-
docs/jig/spec/machine/project-authoring-1.schema.json|project-authoring-1.schema.json|-'
    forbidden_page='spec/package-format.html'
    mkdir -p -- "$staging/contracts"
    cp -- \
      "$repository/docs/jig/spec/contracts/agent-run.capability.json" \
      "$staging/contracts/agent-run.capability.json"
    ;;
esac

printf '%s\n' "$schema_map" |
while IFS='|' read -r source route identifier
do
  cp -- "$repository/$source" "$staging/schemas/$route"
  "$javascript" - "$repository/$source" "$staging/schemas/$route" \
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
done

if [ -e "$staging/$forbidden_page" ]; then
  echo "$site_name site contains a page owned by the other site" >&2
  exit 1
fi

mv -T --no-clobber -- "$staging" "$output"
if [ -e "$staging" ]; then
  echo "the site output appeared while it was being built: $output" >&2
  exit 1
fi
staging=

printf '%s\n' "$output"
