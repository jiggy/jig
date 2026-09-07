#!/bin/sh

# Unprivileged source and packed-artifact gate only. This does not run the
# Linux proof-host security suite or establish publication readiness.

set -eu

case ${FLOW_NODE:-} in
  /*) ;;
  *)
    echo "The @jigging/flow compatibility gate requires an absolute Node executable; set FLOW_NODE." >&2
    exit 1
    ;;
esac
node_identity=$(
  "$FLOW_NODE" -e \
    'if (process.release?.name !== "node" || process.versions?.bun !== undefined) process.exit(70); process.stdout.write("FLOW_NODE_OK\n")'
) || {
  echo "FLOW_NODE did not pass the independent Node identity probe." >&2
  exit 1
}
if [ "$node_identity" != FLOW_NODE_OK ]; then
  echo "FLOW_NODE returned the wrong identity sentinel." >&2
  exit 1
fi

python_bin=${PYTHON:-python3}
if ! "$python_bin" --version >/dev/null 2>&1; then
  echo "Run/1 release tests require Python 3; set PYTHON to its executable." >&2
  exit 1
fi

just flow::build
just jig::build

release_tmp=$(mktemp -d "${TMPDIR:-/tmp}/jig-release.XXXXXX")
trap 'rm -rf -- "$release_tmp"' EXIT HUP INT TERM

# Test the authored application against this SDK candidate, including before
# its new immutable version is in the registry. Only the disposable copy's
# development dependency changes; Flow source and repository manifests do not.
mkdir -p "$release_tmp/artifacts" "$release_tmp/tested-patch"
bun pm pack --cwd packages/flow-sdk --ignore-scripts --destination "$release_tmp/artifacts"
set -- "$release_tmp"/artifacts/*.tgz
test "$#" -eq 1 && test -f "$1"
sdk_archive=$1
cp -R examples/tested-patch/flows examples/tested-patch/test \
  examples/tested-patch/fixtures examples/tested-patch/issue.json \
  examples/tested-patch/package.json "$release_tmp/tested-patch/"
bun -e '
  const path = Bun.argv[1];
  const manifest = await Bun.file(path).json();
  manifest.devDependencies["@jigging/flow"] = `file:${Bun.argv[2]}`;
  await Bun.write(path, JSON.stringify(manifest));
' "$release_tmp/tested-patch/package.json" "$sdk_archive"
(cd "$release_tmp/tested-patch" && bun install --ignore-scripts)
bun test packages/flow-sdk packages/jig conformance/run-1 examples/proposal-workshop/test "$release_tmp/tested-patch/test"
bun packages/flow-sdk/test/package-smoke.ts
bun packages/jig/test/package-smoke.ts

PYTHONDONTWRITEBYTECODE=1 \
PYTHONPATH=packages/flowmd-sdk/src \
  "$python_bin" -m unittest discover \
    -s packages/flowmd-sdk/tests -p 'test_*.py' -v

PYTHONDONTWRITEBYTECODE=1 \
  "$python_bin" -m unittest discover \
    -s conformance/run-1/python-peer -p 'test_*.py' -v

# Both installed Python distributions run the SDK suite and typed consumer.
"$python_bin" scripts/build-python-sdk.py "$release_tmp/python-dist"
"$python_bin" -m unittest discover -s scripts -p 'test_pypi_release.py' -v
