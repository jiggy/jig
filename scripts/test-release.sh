#!/bin/sh

set -eu

python_bin=${PYTHON:-python3}
if ! "$python_bin" --version >/dev/null 2>&1; then
  echo "Run/1 release tests require Python 3; set PYTHON to its executable." >&2
  exit 1
fi

bun test packages/flow-sdk packages/jig conformance/run-1
bun run --cwd packages/flow-sdk test:package

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
