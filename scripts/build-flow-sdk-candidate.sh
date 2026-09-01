#!/bin/sh

# Build one @jigging/flow archive from an archived checkout of the current
# commit, then test those exact bytes without rebuilding them.

set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: scripts/build-flow-sdk-candidate.sh <output-directory>" >&2
  exit 2
fi

case ${FLOW_NODE:-} in
  /*) ;;
  *)
    echo "set FLOW_NODE to the absolute Node executable used for the candidate gate" >&2
    exit 2
    ;;
esac
case ${FLOW_NPM:-} in
  /*) ;;
  *)
    echo "set FLOW_NPM to the absolute npm executable used for the candidate gate" >&2
    exit 2
    ;;
esac
for executable in "$FLOW_NODE" "$FLOW_NPM"
do
  case $executable in
    *[!A-Za-z0-9_./:+-]*)
      echo "release tool paths contain unsupported characters" >&2
      exit 2
      ;;
  esac
  if [ ! -f "$executable" ] || [ ! -x "$executable" ]; then
    echo "release tools must name executable files" >&2
    exit 2
  fi
done

bun_command=$(command -v bun) || {
  echo "Bun is required to build the TypeScript SDK candidate" >&2
  exit 2
}
bun_bin=$(realpath "$bun_command")
case $bun_bin in
  /*) ;;
  *)
    echo "Bun did not resolve to an absolute executable" >&2
    exit 2
    ;;
esac
case $bun_bin in
  *[!A-Za-z0-9_./:+-]*)
    echo "the Bun executable path contains unsupported characters" >&2
    exit 2
    ;;
esac
if [ ! -f "$bun_bin" ] || [ ! -x "$bun_bin" ]; then
  echo "Bun did not resolve to an executable file" >&2
  exit 2
fi

node_identity=$(
  "$FLOW_NODE" -e \
    'if (process.release?.name !== "node" || process.versions?.bun !== undefined) process.exit(70); process.stdout.write("FLOW_NODE_OK\n")'
) || {
  echo "FLOW_NODE did not pass the independent Node identity probe" >&2
  exit 2
}
if [ "$node_identity" != FLOW_NODE_OK ]; then
  echo "FLOW_NODE returned the wrong identity sentinel" >&2
  exit 2
fi

bun_version=$("$bun_bin" --version)
bun_revision=$("$bun_bin" --revision)
node_version=$("$FLOW_NODE" --version)
npm_version=$("$FLOW_NPM" --version)
for identity in "$bun_version" "$bun_revision" "$node_version" "$npm_version"
do
  case $identity in
    ""|*[!0-9A-Za-z.+-]*)
      echo "a release tool returned an invalid identity" >&2
      exit 2
      ;;
  esac
done

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

temporary=$(mktemp -d "${TMPDIR:-/tmp}/flow-sdk-candidate.XXXXXX")
staging=$(mktemp -d "$output_parent/.flow-sdk-candidate-output.XXXXXX")
cleanup() {
  if [ -n "${temporary:-}" ]; then rm -rf -- "$temporary"; fi
  if [ -n "${staging:-}" ]; then rm -rf -- "$staging"; fi
}
trap cleanup EXIT HUP INT TERM

mkdir -p -- \
  "$temporary/source" \
  "$temporary/artifacts" \
  "$temporary/cache" \
  "$temporary/npm-consumer"
git -C "$repository" archive --format=tar HEAD > "$temporary/source.tar"
tar -xf "$temporary/source.tar" -C "$temporary/source"

package="$temporary/source/packages/flow-sdk"
release_path=$(dirname -- "$bun_bin")
PATH="$release_path:${PATH:-/usr/bin:/bin}" \
  "$bun_bin" install \
    --cwd "$package" \
    --frozen-lockfile \
    --ignore-scripts \
    --config=/dev/null \
    --cache-dir "$temporary/cache" \
    --backend=copyfile \
    --no-progress \
    --no-summary
PATH="$release_path:${PATH:-/usr/bin:/bin}" \
  "$bun_bin" run --cwd "$package" build
PATH="$release_path:${PATH:-/usr/bin:/bin}" \
  "$bun_bin" pm pack \
    --cwd "$package" \
    --ignore-scripts \
    --destination "$temporary/artifacts"

set -- "$temporary"/artifacts/*.tgz
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "the clean build did not produce exactly one @jigging/flow archive" >&2
  exit 1
fi

filename=$(basename -- "$1")
case $filename in
  ""|*[!A-Za-z0-9._+-]*)
    echo "the generated SDK archive has an invalid filename" >&2
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

FLOW_NODE="$FLOW_NODE" \
FLOW_SDK_PACKAGE_ARCHIVE="$archive" \
PATH="$release_path:${PATH:-/usr/bin:/bin}" \
  "$bun_bin" "$package/test/package-smoke.ts"

"$FLOW_NPM" install \
  --prefix "$temporary/npm-consumer" \
  --ignore-scripts \
  --no-package-lock \
  --no-audit \
  --no-fund \
  "$archive"
(
  cd "$temporary/npm-consumer"
  "$FLOW_NODE" --input-type=module -e \
    'const sdk = await import("@jigging/flow"); if (typeof sdk.serve !== "function" || typeof sdk.OperationError !== "function" || typeof sdk.EffectError !== "function") process.exit(70)'
)

verified_hash_line=$(cd "$staging" && sha256sum "$filename")
if [ "$verified_hash_line" != "$hash_line" ]; then
  echo "the SDK candidate archive changed while its gates were running" >&2
  exit 1
fi

commit=$(git -C "$repository" rev-parse HEAD)
{
  printf '{\n'
  printf '  "archive": "%s",\n' "$filename"
  printf '  "bunExecutable": "%s",\n' "$bun_bin"
  printf '  "bunRevision": "%s",\n' "$bun_revision"
  printf '  "bunVersion": "%s",\n' "$bun_version"
  printf '  "commit": "%s",\n' "$commit"
  printf '  "gates": ["package-smoke", "npm-install-import"],\n'
  printf '  "nodeExecutable": "%s",\n' "$FLOW_NODE"
  printf '  "nodeVersion": "%s",\n' "$node_version"
  printf '  "npmExecutable": "%s",\n' "$FLOW_NPM"
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
