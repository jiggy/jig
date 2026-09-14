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

# The host compiler tests use the same explicitly qualified Node as the SDK gate.
# Preserve a separately selected operator path when supplied.
JIG_AUTHORING_NODE_PATH=${JIG_AUTHORING_NODE_PATH:-"$FLOW_NODE"}
export JIG_AUTHORING_NODE_PATH

python_bin=${PYTHON:-python3}
if ! "$python_bin" --version >/dev/null 2>&1; then
  echo "Run/1 release tests require Python 3; set PYTHON to its executable." >&2
  exit 1
fi

just flow::build
just authoring::test
just jig::build

release_tmp=$(mktemp -d "${TMPDIR:-/tmp}/jig-release.XXXXXX")
trap 'rm -rf -- "$release_tmp"' EXIT HUP INT TERM

# Test authored applications against the exact local package candidates, including
# before their versions reach the registry. Only disposable copies' declared
# dependencies change; Flow source and repository manifests do not.
mkdir -p "$release_tmp/artifacts/flow-sdk" "$release_tmp/artifacts/agent-method" "$release_tmp/artifacts/agent-acp" "$release_tmp/artifacts/jig"
bun pm pack --cwd packages/flow-sdk --ignore-scripts --destination "$release_tmp/artifacts/flow-sdk"
set -- "$release_tmp"/artifacts/flow-sdk/*.tgz
test "$#" -eq 1 && test -f "$1"
sdk_archive=$1
FLOW_SDK_PACKAGE_ARCHIVE=$sdk_archive
export FLOW_SDK_PACKAGE_ARCHIVE
bun pm --cwd packages/agent-method pack --ignore-scripts --destination "$release_tmp/artifacts/agent-method"
set -- "$release_tmp"/artifacts/agent-method/*.tgz
test "$#" -eq 1 && test -f "$1"
AGENT_METHOD_PACKAGE_ARCHIVE=$1
export AGENT_METHOD_PACKAGE_ARCHIVE
bun pm --cwd packages/agent-acp pack --ignore-scripts --destination "$release_tmp/artifacts/agent-acp"
set -- "$release_tmp"/artifacts/agent-acp/*.tgz
test "$#" -eq 1 && test -f "$1"
AGENT_ACP_PACKAGE_ARCHIVE=$1
bun packages/jig/scripts/pack.ts --destination "$release_tmp/artifacts/jig"
set -- "$release_tmp"/artifacts/jig/*.tgz
test "$#" -eq 1 && test -f "$1"
JIG_PACKAGE_ARCHIVE=$1
export AGENT_ACP_PACKAGE_ARCHIVE JIG_PACKAGE_ARCHIVE
sha256sum "$FLOW_SDK_PACKAGE_ARCHIVE" "$AGENT_METHOD_PACKAGE_ARCHIVE" "$AGENT_ACP_PACKAGE_ARCHIVE" "$JIG_PACKAGE_ARCHIVE" > "$release_tmp/archive-digests"
set --
for application in tested-patch request-triage support-case; do
  application_copy="$release_tmp/$application"
  mkdir -p "$application_copy"
  cp "examples/$application/package.json" "$application_copy/"
  for member in flows test fixtures issue.json input.json batch.json; do
    if [ -e "examples/$application/$member" ]; then
      bun --no-env-file -e '
        import { cp } from "node:fs/promises";
        import { basename } from "node:path";
        await cp(Bun.argv[1], Bun.argv[2], {
          recursive: true, filter: path => basename(path) !== "node_modules",
        });
      ' "examples/$application/$member" "$application_copy/$member"
    fi
  done
  bun -e '
    const path = Bun.argv[1];
    const manifest = await Bun.file(path).json();
    const candidates = {
      "@jigging/flow": Bun.argv[2],
      "@jigging/agent-method": Bun.argv[3],
      "@jigging/agent-acp": Bun.argv[4],
    };
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, version] of Object.entries(manifest[section] ?? {})) {
        if (candidates[name]) manifest[section][name] = `file:${candidates[name]}`;
        else if (typeof version === "string" && version.startsWith("workspace:"))
          throw new Error(`No frozen candidate for declared workspace dependency ${name}`);
      }
    }
    await Bun.write(path, JSON.stringify(manifest));
  ' "$application_copy/package.json" "$sdk_archive" "$AGENT_METHOD_PACKAGE_ARCHIVE" "$AGENT_ACP_PACKAGE_ARCHIVE"
  (cd "$application_copy" && bun --no-env-file install --ignore-scripts --config=/dev/null)
  set -- "$@" "$application_copy/test"
done
bun test packages/agent-method packages/agent-acp packages/flow-sdk packages/jig conformance/run-1 "$@"
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

sha256sum --check "$release_tmp/archive-digests"
