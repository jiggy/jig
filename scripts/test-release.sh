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

# Test authored applications against this SDK candidate, including before
# its new immutable version is in the registry. Only the disposable copy's
# development dependency changes; Flow source and repository manifests do not.
mkdir -p "$release_tmp/artifacts"
bun pm pack --cwd packages/flow-sdk --ignore-scripts --destination "$release_tmp/artifacts"
set -- "$release_tmp"/artifacts/*.tgz
test "$#" -eq 1 && test -f "$1"
sdk_archive=$1
just build-examples "$sdk_archive" "$release_tmp/prepared-examples"
set --
for application in tested-patch live-agent dataset-analysis; do
  application_copy="$release_tmp/$application"
  mkdir -p "$application_copy"
  cp "examples/$application/package.json" "$application_copy/"
  for member in flows test fixtures issue.json input.json batch.json; do
    if [ -e "examples/$application/$member" ]; then
      cp -R "examples/$application/$member" "$application_copy/"
    fi
  done
  bun -e '
    const path = Bun.argv[1];
    const manifest = await Bun.file(path).json();
    manifest.devDependencies["@jigging/flow"] = `file:${Bun.argv[2]}`;
    await Bun.write(path, JSON.stringify(manifest));
  ' "$application_copy/package.json" "$sdk_archive"
  (cd "$application_copy" && bun --no-env-file install --ignore-scripts --config=/dev/null)
  set -- "$@" "$application_copy/test"
done
FLOW_SDK_PACKAGE_ARCHIVE="$sdk_archive" bun test packages/flow-sdk packages/jig conformance/run-1 examples/proposal-workshop/test scripts/build-examples.test.ts scripts/release-example-assets.test.ts "$@"
bun packages/flow-sdk/test/package-smoke.ts
bun packages/jig/test/package-smoke.ts

PYTHONDONTWRITEBYTECODE=1 \
PYTHONPATH=packages/jiggy-flow/src \
  "$python_bin" -m unittest discover \
    -s packages/jiggy-flow/tests -p 'test_*.py' -v

PYTHONDONTWRITEBYTECODE=1 \
  "$python_bin" -m unittest discover \
    -s conformance/run-1/python-peer -p 'test_*.py' -v

# Both installed Python distributions run the SDK suite and typed consumer.
"$python_bin" scripts/build-python-sdk.py "$release_tmp/python-dist"
"$python_bin" -m unittest discover -s scripts -p 'test_pypi_release.py' -v
