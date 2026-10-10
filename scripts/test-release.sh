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
  echo "Run/0 release tests require Python 3; set PYTHON to its executable." >&2
  exit 1
fi

if ! "$python_bin" -c 'import build, twine, mypy' >/dev/null 2>&1; then
  echo "Install release test tools for $python_bin: build==1.3.0 twine==6.2.0 mypy==1.18.2" >&2
  exit 1
fi
if ! (cd conformance/run-0 && bun --no-env-file -e '
  import.meta.resolve("ajv/dist/2020.js");
  import.meta.resolve("@jigging/sley");
') >/dev/null 2>&1; then
  echo "Install protocol fixture dependencies: bun install --cwd conformance/run-0 --frozen-lockfile" >&2
  exit 1
fi

archive_digests() {
  "$FLOW_NODE" --input-type=module -e '
    import { createHash } from "node:crypto";
    import { readFile } from "node:fs/promises";
    for (const path of process.argv.slice(1)) {
      const digest = createHash("sha256").update(await readFile(path)).digest("hex");
      console.log(`${digest} ${JSON.stringify(path)}`);
    }
  ' "$@"
}

just flow::build
just authoring::test
just jig::build

# CI supplies the candidate bytes that installed matrices and publication use.
# Source workspace builds remain independent ordinary declared dependencies.
if [ -n "${CI_CANDIDATE_BUNDLE:-}" ]; then
  "$FLOW_NODE" scripts/ci/candidate-provenance.mjs verify "$CI_CANDIDATE_BUNDLE" \
    --source "$(git rev-parse HEAD)" >/dev/null
fi

# Installed artifact checks require canonical archive paths, including Mac's
# temporary-directory aliases.
temporary_parent=$(CDPATH= cd -- "${TMPDIR:-/tmp}" && pwd -P)
release_tmp=$(mktemp -d "$temporary_parent/jig-release.XXXXXX")
trap 'rm -rf -- "$release_tmp"' EXIT HUP INT TERM

# Test authored applications against the exact local package candidates, including
# before their versions reach the registry. Only disposable copies' declared
# dependencies change; Flow source and repository manifests do not.
mkdir -p "$release_tmp/artifacts/flow-sdk" "$release_tmp/artifacts/user-updates" "$release_tmp/artifacts/agent-method" "$release_tmp/artifacts/agent-acp" "$release_tmp/artifacts/display-model" "$release_tmp/artifacts/display-web" "$release_tmp/artifacts/display-tui" "$release_tmp/artifacts/jig"
if [ -n "${CI_CANDIDATE_BUNDLE:-}" ]; then
  for package in flow-sdk user-updates agent-method agent-acp display-model display-web display-tui jig; do
    cp "$CI_CANDIDATE_BUNDLE/$package/"*.tgz "$release_tmp/artifacts/$package/"
  done
else
  bun pm pack --cwd packages/flow-sdk --ignore-scripts --destination "$release_tmp/artifacts/flow-sdk"
  bun pm pack --cwd packages/user-updates --ignore-scripts --destination "$release_tmp/artifacts/user-updates"
  bun pm --cwd packages/agent-method pack --ignore-scripts --destination "$release_tmp/artifacts/agent-method"
  bun pm --cwd packages/agent-acp pack --ignore-scripts --destination "$release_tmp/artifacts/agent-acp"
  for display_package in display-model display-web display-tui; do
    bun pm pack --cwd "packages/$display_package" --ignore-scripts --destination "$release_tmp/artifacts/$display_package"
  done
  bun packages/jig/scripts/pack.ts --destination "$release_tmp/artifacts/jig"
fi
set -- "$release_tmp"/artifacts/flow-sdk/*.tgz
test "$#" -eq 1 && test -f "$1"
sdk_archive=$1
FLOW_SDK_PACKAGE_ARCHIVE=$sdk_archive
export FLOW_SDK_PACKAGE_ARCHIVE
set -- "$release_tmp"/artifacts/user-updates/*.tgz
test "$#" -eq 1 && test -f "$1"
USER_UPDATES_PACKAGE_ARCHIVE=$1
export USER_UPDATES_PACKAGE_ARCHIVE
for display_package in display-model display-web display-tui; do
  set -- "$release_tmp/artifacts/$display_package/"*.tgz
  test "$#" -eq 1 && test -f "$1"
  case "$display_package" in
    display-model) DISPLAY_MODEL_PACKAGE_ARCHIVE=$1; export DISPLAY_MODEL_PACKAGE_ARCHIVE ;;
    display-web) DISPLAY_WEB_PACKAGE_ARCHIVE=$1; export DISPLAY_WEB_PACKAGE_ARCHIVE ;;
    display-tui) DISPLAY_TUI_PACKAGE_ARCHIVE=$1; export DISPLAY_TUI_PACKAGE_ARCHIVE ;;
  esac
done
set -- "$release_tmp"/artifacts/agent-method/*.tgz
test "$#" -eq 1 && test -f "$1"
AGENT_METHOD_PACKAGE_ARCHIVE=$1
export AGENT_METHOD_PACKAGE_ARCHIVE
set -- "$release_tmp"/artifacts/agent-acp/*.tgz
test "$#" -eq 1 && test -f "$1"
AGENT_ACP_PACKAGE_ARCHIVE=$1
set -- "$release_tmp"/artifacts/jig/*.tgz
test "$#" -eq 1 && test -f "$1"
JIG_PACKAGE_ARCHIVE=$1
export AGENT_ACP_PACKAGE_ARCHIVE JIG_PACKAGE_ARCHIVE
archive_digests "$FLOW_SDK_PACKAGE_ARCHIVE" "$USER_UPDATES_PACKAGE_ARCHIVE" "$AGENT_METHOD_PACKAGE_ARCHIVE" "$AGENT_ACP_PACKAGE_ARCHIVE" "$DISPLAY_MODEL_PACKAGE_ARCHIVE" "$DISPLAY_WEB_PACKAGE_ARCHIVE" "$DISPLAY_TUI_PACKAGE_ARCHIVE" "$JIG_PACKAGE_ARCHIVE" > "$release_tmp/archive-digests"
set --
for application in tested-patch software-factory request-triage support-case contact-import incident-brief; do
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
  if [ "$application" = software-factory ]; then
    mkdir -p "$application_copy/methods"
    cp -R examples/tested-patch/flows/project "$application_copy/methods/project"
    cp -R examples/tested-patch/flows/repair "$application_copy/methods/repair"
  fi
  bun -e '
    import { readdir, stat } from "node:fs/promises";
    import { dirname, join } from "node:path";
    const path = Bun.argv[1];
    const candidates = {
      "@jigging/flow": Bun.argv[2],
      "@jigging/agent-method": Bun.argv[3],
      "@jigging/agent-acp": Bun.argv[4],
      "@jigging/user-updates": Bun.argv[5],
    };
    const manifests = [path];
    for (const directory of ["flows", "methods"]) {
      const members = join(dirname(path), directory);
      const memberInfo = await stat(members).catch(() => undefined);
      if (!memberInfo?.isDirectory()) continue;
      for (const entry of await readdir(members, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const child = join(members, entry.name, "package.json");
        if (await Bun.file(child).exists()) manifests.push(child);
      }
    }
    const local = new Set();
    for (const current of manifests) {
      const manifest = await Bun.file(current).json();
      if (typeof manifest.name === "string") local.add(manifest.name);
    }
    for (const current of manifests) {
      const manifest = await Bun.file(current).json();
      // Preserve the application plus Flow-member relationship from the source
      // repository workspace. Resolve each owning declaration, not ambient deps.
      if (current === path)
        manifest.workspaces = manifests.some(current => current.includes("/methods/"))
          ? ["flows/*", "methods/*"] : ["flows/*"];
      for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
        for (const [name, version] of Object.entries(manifest[section] ?? {})) {
          if (candidates[name]) manifest[section][name] = `file:${candidates[name]}`;
          else if (typeof version === "string" && version.startsWith("workspace:") && !local.has(name))
            throw new Error(`No frozen candidate for declared workspace dependency ${name}`);
        }
      }
      await Bun.write(current, JSON.stringify(manifest));
    }
  ' "$application_copy/package.json" "$sdk_archive" "$AGENT_METHOD_PACKAGE_ARCHIVE" "$AGENT_ACP_PACKAGE_ARCHIVE" "$USER_UPDATES_PACKAGE_ARCHIVE"
  (cd "$application_copy" && bun --no-env-file install --ignore-scripts --config=/dev/null)
  set -- "$@" "$application_copy/test"
done
if [ -n "${JIG_CI_SOURCE_JUNIT:-}" ]; then
  set -- "$@" --reporter=junit "--reporter-outfile=$JIG_CI_SOURCE_JUNIT"
fi
bun test packages/agent-method packages/agent-acp packages/flow-sdk packages/user-updates packages/display-model packages/display-web packages/display-tui packages/jig conformance/run-0 "$@"
if [ -z "${CI_CANDIDATE_BUNDLE:-}" ]; then
  bun packages/flow-sdk/test/package-smoke.ts
  bun packages/jig/test/package-smoke.ts
fi
bun packages/user-updates/test/package-smoke.ts
bun packages/display-model/test/package-smoke.ts
bun packages/display-web/test/package-smoke.ts
bun packages/display-tui/test/package-smoke.ts

PYTHONDONTWRITEBYTECODE=1 \
PYTHONPATH=packages/jiggy-flow/src \
  "$python_bin" -m unittest discover \
    -s packages/jiggy-flow/tests -p 'test_*.py' -v

PYTHONDONTWRITEBYTECODE=1 \
  "$python_bin" -m unittest discover \
    -s conformance/run-0/python-peer -p 'test_*.py' -v

# Both installed Python distributions run the SDK suite and typed consumer.
python_dist=${CI_PYTHON_DISTRIBUTIONS:-"$release_tmp/python-dist"}
python_updates_dist=${CI_PYTHON_UPDATES_DISTRIBUTIONS:-"$release_tmp/python-updates-dist"}
if [ -z "${CI_PYTHON_DISTRIBUTIONS:-}" ]; then
  "$python_bin" scripts/build-python-sdk.py "$python_dist"
fi
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=packages/jiggy-flow/src:packages/jiggy-user-updates/src \
  "$python_bin" -m unittest discover -s packages/jiggy-user-updates/tests -p 'test_*.py' -v
PYTHONPATH=packages/jiggy-flow/src:packages/jiggy-user-updates/src \
  "$python_bin" -m mypy --strict packages/jiggy-user-updates/src/jiggy/user_updates
if [ -z "${CI_PYTHON_UPDATES_DISTRIBUTIONS:-}" ]; then
  "$python_bin" -m build --outdir "$python_updates_dist" packages/jiggy-user-updates
  "$python_bin" -m twine check --strict "$python_updates_dist"/*
  "$python_bin" packages/jiggy-user-updates/tests/package_smoke.py \
    "$python_updates_dist"/*.whl "$python_updates_dist"/*.tar.gz "$python_dist"/*.whl
fi
"$python_bin" -m unittest discover -s scripts -p 'test_pypi_release.py' -v

archive_digests "$FLOW_SDK_PACKAGE_ARCHIVE" "$USER_UPDATES_PACKAGE_ARCHIVE" "$AGENT_METHOD_PACKAGE_ARCHIVE" "$AGENT_ACP_PACKAGE_ARCHIVE" "$DISPLAY_MODEL_PACKAGE_ARCHIVE" "$DISPLAY_WEB_PACKAGE_ARCHIVE" "$DISPLAY_TUI_PACKAGE_ARCHIVE" "$JIG_PACKAGE_ARCHIVE" > "$release_tmp/verified-digests"
cmp "$release_tmp/archive-digests" "$release_tmp/verified-digests" || {
  echo "release tests changed the frozen package archives" >&2
  exit 1
}
