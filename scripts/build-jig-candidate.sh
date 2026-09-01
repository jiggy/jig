#!/bin/sh

# Build one Jig archive from a clean checkout of the current commit, then run
# every packed direct-alpha gate against those exact bytes.

set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: scripts/build-jig-candidate.sh <output-directory>" >&2
  exit 2
fi

case ${JIG_NPM:-} in
  /*) ;;
  *)
    echo "set JIG_NPM to the absolute npm executable used for the candidate gate" >&2
    exit 2
    ;;
esac
case $JIG_NPM in
  *[!A-Za-z0-9_./:+-]*)
    echo "JIG_NPM contains characters unsupported by the candidate record" >&2
    exit 2
    ;;
esac
if [ ! -f "$JIG_NPM" ] || [ ! -x "$JIG_NPM" ]; then
  echo "JIG_NPM must name an executable file" >&2
  exit 2
fi
npm_version=$("$JIG_NPM" --version)
case $npm_version in
  ""|*[!0-9A-Za-z.+-]*)
    echo "JIG_NPM returned an invalid version" >&2
    exit 2
    ;;
esac

repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
tracked_status=$(git -C "$repository" status --porcelain --untracked-files=no)
if [ -n "$tracked_status" ]; then
  echo "the tracked working tree must be clean before building a release candidate" >&2
  exit 1
fi

output_argument=$1
output_parent_argument=$(dirname -- "$output_argument")
output_name=$(basename -- "$output_argument")
mkdir -p -- "$output_parent_argument"
output_parent=$(CDPATH= cd -- "$output_parent_argument" && pwd -P)
output="$output_parent/$output_name"
if [ -e "$output" ]; then
  echo "the candidate output already exists: $output" >&2
  exit 1
fi

temporary=$(mktemp -d "${TMPDIR:-/tmp}/jig-candidate.XXXXXX")
staging=$(mktemp -d "$output_parent/.jig-candidate-output.XXXXXX")
cleanup() {
  if [ -n "${temporary:-}" ]; then rm -rf -- "$temporary"; fi
  if [ -n "${staging:-}" ]; then rm -rf -- "$staging"; fi
}
trap cleanup EXIT HUP INT TERM

mkdir -p -- "$temporary/source" "$temporary/artifacts" "$temporary/cache"
git -C "$repository" archive --format=tar HEAD > "$temporary/source.tar"
tar -xf "$temporary/source.tar" -C "$temporary/source"

package="$temporary/source/packages/jig"
bun run --cwd "$package" verify:build-bun
bun install \
  --cwd "$package" \
  --frozen-lockfile \
  --ignore-scripts \
  --config=/dev/null \
  --cache-dir "$temporary/cache" \
  --backend=copyfile \
  --no-progress \
  --no-summary
bun run --cwd "$package" build
bun pm pack --cwd "$package" --ignore-scripts --destination "$temporary/artifacts"

set -- "$temporary"/artifacts/*.tgz
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "the clean build did not produce exactly one Jig archive" >&2
  exit 1
fi

filename=$(basename -- "$1")
case $filename in
  ""|*[!A-Za-z0-9._+-]*)
    echo "the generated Jig archive has an invalid filename" >&2
    exit 1
    ;;
esac
archive="$staging/$filename"
cp -- "$1" "$archive"
hash_line=$(cd "$staging" && sha256sum "$filename")
archive_sha256=${hash_line%% *}
printf '%s\n' "$hash_line" > "$archive.sha256"
tar -tzf "$archive" > "$temporary/inventory"
LC_ALL=C sort "$temporary/inventory" > "$archive.files"

JIG_PACKAGE_ARCHIVE="$archive" bun "$repository/packages/jig/test/package-smoke.ts"
JIG_PACKAGE_ARCHIVE="$archive" bun "$repository/scripts/test-operational-baseline.ts"

mkdir -p -- "$temporary/npm-consumer"
"$JIG_NPM" install \
  --prefix "$temporary/npm-consumer" \
  --ignore-scripts \
  --no-package-lock \
  --no-audit \
  --no-fund \
  "$archive"
npm_jig="$temporary/npm-consumer/node_modules/.bin/jig"
if [ ! -x "$npm_jig" ]; then
  echo "npm did not install the Jig executable" >&2
  exit 1
fi
"$npm_jig" --help > "$temporary/npm-help"
for expected in \
  "  jig init --bare <directory>" \
  "  jig check [project] [--yes]" \
  "  jig run <flow:path|binding:id> [--input JSON]"
do
  if ! grep -F -x "$expected" "$temporary/npm-help" >/dev/null; then
    echo "the npm-installed Jig executable exposed the wrong command surface" >&2
    exit 1
  fi
done

verified_hash_line=$(cd "$staging" && sha256sum "$filename")
if [ "$verified_hash_line" != "$hash_line" ]; then
  echo "the candidate archive changed while its gates were running" >&2
  exit 1
fi

commit=$(git -C "$repository" rev-parse HEAD)
{
  printf '{\n'
  printf '  "archive": "%s",\n' "$filename"
  printf '  "commit": "%s",\n' "$commit"
  printf '  "gates": ["package-smoke", "operational-baseline-1", "npm-install-help"],\n'
  printf '  "npmExecutable": "%s",\n' "$JIG_NPM"
  printf '  "npmVersion": "%s",\n' "$npm_version"
  printf '  "sha256": "%s"\n' "$archive_sha256"
  printf '}\n'
} > "$staging/SUCCESS.json"

chmod 755 "$staging"
mv -T --no-clobber -- "$staging" "$output"
if [ -e "$staging" ]; then
  echo "the candidate output appeared while its gates were running: $output" >&2
  exit 1
fi
staging=

printf '%s\n' "$output/$filename"
