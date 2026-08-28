#!/bin/sh

# Unprivileged source and packed-artifact gate only. This does not run the
# Linux proof-host security suite or establish publication readiness.

set -eu

case ${FLOW_NODE:-} in
  /*) ;;
  *)
    echo "The @flowmd/sdk compatibility gate requires an absolute Node executable; set FLOW_NODE." >&2
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

bun test packages/flow-sdk packages/jig conformance/run-1 conformance/service-1
bun run --cwd packages/flow-sdk test:package
bun run --cwd packages/jig test:package

PYTHONDONTWRITEBYTECODE=1 \
PYTHONPATH=packages/flowmd-sdk/src \
  "$python_bin" -m unittest discover \
    -s packages/flowmd-sdk/tests -p 'test_*.py' -v

PYTHONDONTWRITEBYTECODE=1 \
  "$python_bin" -m unittest discover \
    -s conformance/run-1/python-peer -p 'test_*.py' -v

release_tmp=$(mktemp -d "${TMPDIR:-/tmp}/jig-release.XXXXXX")
trap 'rm -rf -- "$release_tmp"' EXIT HUP INT TERM
cp -R packages/flowmd-sdk "$release_tmp/source"

if ! "$python_bin" -m build --help >/dev/null 2>&1; then
  echo "Python package smoke requires the 'build' module in the release environment." >&2
  exit 1
fi

"$python_bin" -m build --outdir "$release_tmp/dist" "$release_tmp/source"
set -- "$release_tmp"/dist/*.whl
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Python build did not produce exactly one wheel." >&2
  exit 1
fi
wheel=$1
set -- "$release_tmp"/dist/*.tar.gz
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Python build did not produce exactly one source distribution." >&2
  exit 1
fi
sdist=$1
"$python_bin" packages/flowmd-sdk/tests/package_smoke.py "$wheel" "$sdist"
