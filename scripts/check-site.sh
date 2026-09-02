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
    schema_map='docs/flow/spec/machine/capability-contract-1.schema.json|capability-contract-1.schema.json
docs/flow/spec/machine/run-1-errors.json|run-1-errors.json
docs/flow/spec/machine/run-1.schema.json|run-1.json
docs/flow/spec/machine/schema-1.json|schema-1.json'
    ;;
  jig)
    default_base=https://jig.md
    home_title='<title>Jig</title>'
    guide_title='<title>Jig direct alpha - Jig</title>'
    schema_map='docs/jig/spec/machine/jig-lock-1.schema.json|jig-lock-1.schema.json
docs/jig/spec/machine/project-authoring-1.schema.json|project-authoring-1.schema.json'
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

printf '%s\n' "$schema_map" |
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
  "$javascript" - "$repository/$source" "$temporary/$route" <<'NODE'
const { readFileSync } = require("node:fs");
const [source, downloaded] = process.argv.slice(2);
if (!readFileSync(source).equals(readFileSync(downloaded))) {
  throw new Error(`${downloaded} does not contain the exact source bytes`);
}
NODE
done

echo "$site_name site and canonical schema checks passed"
