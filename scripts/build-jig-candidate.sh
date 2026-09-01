#!/bin/sh

# Build one Jig archive from a clean checkout of the current commit, then run
# every packed direct-alpha gate against those exact bytes.

set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: scripts/build-jig-candidate.sh <output-directory>" >&2
  exit 2
fi

repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
if [ -n "$(git -C "$repository" status --porcelain --untracked-files=no)" ]; then
  echo "the tracked working tree must be clean before building a release candidate" >&2
  exit 1
fi

mkdir -p -- "$1"
output=$(CDPATH= cd -- "$1" && pwd -P)
temporary=$(mktemp -d "${TMPDIR:-/tmp}/jig-candidate.XXXXXX")
trap 'rm -rf -- "$temporary"' EXIT HUP INT TERM

mkdir -p -- "$temporary/source" "$temporary/artifacts" "$temporary/cache"
git -C "$repository" archive --format=tar HEAD | tar -xf - -C "$temporary/source"

package="$temporary/source/packages/jig"
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
archive="$output/$filename"
if [ -e "$archive" ] || [ -e "$archive.sha256" ] || [ -e "$archive.files" ]; then
  echo "the candidate output already exists: $archive" >&2
  exit 1
fi
cp -- "$1" "$archive"
(cd "$output" && sha256sum "$filename" > "$filename.sha256")
tar -tzf "$archive" | LC_ALL=C sort > "$archive.files"

JIG_PACKAGE_ARCHIVE="$archive" bun "$repository/packages/jig/test/package-smoke.ts"
JIG_PACKAGE_ARCHIVE="$archive" bun "$repository/scripts/test-operational-baseline.ts"

printf '%s\n' "$archive"
