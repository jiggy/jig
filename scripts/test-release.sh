#!/bin/bash
# Whole-file source stages. Host qualification and release readiness remain separate.
set -eu

source_targets=source-portable,source-protocol,source-applications,source-python
source_profile=${JIG_CI_SOURCE_PROFILE:-}
report_directory=${JIG_CI_SOURCE_REPORT_DIRECTORY:-}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --targets) source_targets=${2:?Missing source targets}; shift 2 ;;
    --profile) source_profile=${2:?Missing source profile}; shift 2 ;;
    --report-directory) report_directory=${2:?Missing report directory}; shift 2 ;;
    *) echo "Unknown source-stage option: $1" >&2; exit 1 ;;
  esac
done
if [ -z "$source_profile" ]; then
  case $(uname -s) in Linux) source_profile=portable-linux ;; *) source_profile=portable ;; esac
fi
case "$source_profile" in portable|portable-linux) ;; *) echo "Invalid source profile" >&2; exit 1 ;; esac
case "$source_targets" in ''|,*|*,|*,,*) echo "Incomplete source targets" >&2; exit 1 ;; esac
has_stage() { case ,$source_targets, in *,"$1",*) return 0 ;; *) return 1 ;; esac; }
previous_stage=
old_ifs=$IFS
IFS=,
for stage in $source_targets; do
  case "$stage" in source-portable|source-protocol|source-applications|source-python) ;; *) echo "Unknown source target" >&2; exit 1 ;; esac
  case ,$previous_stage, in *,"$stage",*) echo "Repeated source target" >&2; exit 1 ;; esac
  previous_stage=$previous_stage,$stage
done
IFS=$old_ifs

case ${FLOW_NODE:-} in /*) ;; *) echo "Source checks require the absolute qualified FLOW_NODE executable." >&2; exit 1 ;; esac
node_identity=$("$FLOW_NODE" -e 'if(process.release?.name!=="node"||process.versions?.bun!==undefined)process.exit(70);process.stdout.write("FLOW_NODE_OK\n")')
[ "$node_identity" = FLOW_NODE_OK ] || { echo "FLOW_NODE identity mismatch" >&2; exit 1; }
JIG_AUTHORING_NODE_PATH=${JIG_AUTHORING_NODE_PATH:-"$FLOW_NODE"}
export JIG_AUTHORING_NODE_PATH
python_bin=${PYTHON:-python3}
if [ -n "$source_targets" ]; then
  "$python_bin" --version >/dev/null 2>&1 || { echo "Selected source stages require Python 3; set PYTHON." >&2; exit 1; }
fi
if has_stage source-python; then
  "$python_bin" -c 'import build,twine,mypy' >/dev/null 2>&1 || { echo "Install Python release tools: build==1.3.0 twine==6.2.0 mypy==1.18.2" >&2; exit 1; }
fi

temporary_parent=$(CDPATH= cd -- "${TMPDIR:-/tmp}" && pwd -P)
release_tmp=$(mktemp -d "$temporary_parent/jig-release.XXXXXX")
trap 'rm -rf -- "$release_tmp"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
if [ -z "$report_directory" ]; then report_directory=$release_tmp/reports; fi
mkdir -p "$report_directory"
for stage in source-portable source-protocol source-applications source-python; do
  if has_stage "$stage" && { [ -e "$report_directory/$stage.xml" ] || [ -e "$report_directory/$stage.txt" ]; }; then
    echo "Source evidence destination must be fresh" >&2; exit 1
  fi
done
archive_packages=
if has_stage source-portable; then
  just jig::build
  archive_packages="flow-sdk reporting agent-method agent-acp display-model display-web display-tui jig"
elif has_stage source-protocol || has_stage source-applications; then
  just reporting::build
  just agent::build
  just acp::build
  archive_packages="flow-sdk reporting agent-method agent-acp"
fi
if [ -n "${CI_CANDIDATE_BUNDLE:-}" ]; then
  "$FLOW_NODE" scripts/ci/candidate-provenance.mjs verify "$CI_CANDIDATE_BUNDLE" --source "$(git rev-parse HEAD)" >/dev/null
fi
archive_digests() {
  "$FLOW_NODE" --input-type=module -e 'import{createHash}from"node:crypto";import{readFile}from"node:fs/promises";for(const path of process.argv.slice(1))console.log(`${createHash("sha256").update(await readFile(path)).digest("hex")} ${JSON.stringify(path)}`)' "$@"
}
for package in $archive_packages; do
  mkdir -p "$release_tmp/artifacts/$package"
  if [ -n "${CI_CANDIDATE_BUNDLE:-}" ]; then
    cp "$CI_CANDIDATE_BUNDLE/$package/"*.tgz "$release_tmp/artifacts/$package/"
  elif [ "$package" = flow-sdk ]; then
    sdk_version=$("$FLOW_NODE" -p 'JSON.parse(require("fs").readFileSync("packages/jig/package.json","utf8")).devDependencies["@jigging/flow"]')
    npm pack "@jigging/flow@$sdk_version" --ignore-scripts --pack-destination "$release_tmp/artifacts/flow-sdk"
  elif [ "$package" = jig ]; then
    bun packages/jig/scripts/pack.ts --destination "$release_tmp/artifacts/jig"
  else
    bun pm pack --cwd "packages/$package" --ignore-scripts --destination "$release_tmp/artifacts/$package"
  fi
  set -- "$release_tmp/artifacts/$package/"*.tgz
  [ "$#" -eq 1 ] && [ -f "$1" ] || { echo "Incomplete frozen source archive" >&2; exit 1; }
  case "$package" in
    flow-sdk) FLOW_SDK_PACKAGE_ARCHIVE=$1; sdk_archive=$1; export FLOW_SDK_PACKAGE_ARCHIVE ;;
    reporting) REPORTING_PACKAGE_ARCHIVE=$1; export REPORTING_PACKAGE_ARCHIVE ;;
    agent-method) AGENT_METHOD_PACKAGE_ARCHIVE=$1; export AGENT_METHOD_PACKAGE_ARCHIVE ;;
    agent-acp) AGENT_ACP_PACKAGE_ARCHIVE=$1; export AGENT_ACP_PACKAGE_ARCHIVE ;;
    display-model) DISPLAY_MODEL_PACKAGE_ARCHIVE=$1; export DISPLAY_MODEL_PACKAGE_ARCHIVE ;;
    display-web) DISPLAY_WEB_PACKAGE_ARCHIVE=$1; export DISPLAY_WEB_PACKAGE_ARCHIVE ;;
    display-tui) DISPLAY_TUI_PACKAGE_ARCHIVE=$1; export DISPLAY_TUI_PACKAGE_ARCHIVE ;;
    jig) JIG_PACKAGE_ARCHIVE=$1; export JIG_PACKAGE_ARCHIVE ;;
  esac
done
set --
for package in $archive_packages; do for archive in "$release_tmp/artifacts/$package/"*.tgz; do set -- "$@" "$archive"; done; done
archive_digests "$@" > "$release_tmp/archive-digests"

run_bun_stage() {
  stage_id=$1
  set -- --target "$stage_id" --profile "$source_profile"
  if [ "${GITHUB_ACTIONS:-}" = true ]; then set -- "$@" --revision "${GITHUB_SHA:?Missing tested source}"; fi
  "$FLOW_NODE" scripts/ci/suite-inventory.mjs "$@" > "$release_tmp/$stage_id.files"
  set --
  : > "$release_tmp/$stage_id.bun.files"
  while IFS= read -r test_file; do
    case "$test_file" in *.node.mjs) ;; *) set -- "$@" "./$test_file"; printf '%s\n' "$test_file" >> "$release_tmp/$stage_id.bun.files" ;; esac
  done < "$release_tmp/$stage_id.files"
  [ "$#" -gt 0 ] || { echo "Selected Bun source stage is empty" >&2; exit 1; }
  bun test "$@" --reporter=junit "--reporter-outfile=$report_directory/$stage_id.xml"
  "$python_bin" scripts/ci/merge-source-junit.py "$release_tmp/validated-$stage_id.xml" "$report_directory/$stage_id.xml" --files "$release_tmp/$stage_id.bun.files"
}
source_portable_stage() {
  run_bun_stage source-portable
  if [ -z "${CI_CANDIDATE_BUNDLE:-}" ]; then
    bun packages/jig/test/package-smoke.ts
    bun packages/display-model/test/package-smoke.ts
    bun packages/display-web/test/package-smoke.ts
    bun packages/display-tui/test/package-smoke.ts
  fi
}
source_protocol_stage() {
  run_bun_stage source-protocol
  bun scripts/test-flow-dependency.ts
  bun packages/reporting/test/package-smoke.ts
}
source_applications_stage() {
for application in photo-organiser tested-patch software-factory support-case contact-import incident-brief; do
  application_source="examples/$application"
  if [ "$application" = incident-brief ]; then
    application_source="packages/jig/test/fixtures/incident-brief"
  fi
  application_copy="$release_tmp/$application"
  mkdir -p "$application_copy"
  cp "$application_source/package.json" "$application_copy/"
  for member in flows test fixtures grants issue.json input.json batch.json; do
    if [ -e "$application_source/$member" ]; then
      bun --no-env-file -e '
        import { cp } from "node:fs/promises";
        import { basename } from "node:path";
        await cp(Bun.argv[1], Bun.argv[2], {
          recursive: true, filter: path => basename(path) !== "node_modules",
        });
      ' "$application_source/$member" "$application_copy/$member"
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
      "@jigging/reporting": Bun.argv[5],
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
  ' "$application_copy/package.json" "$sdk_archive" "$AGENT_METHOD_PACKAGE_ARCHIVE" "$AGENT_ACP_PACKAGE_ARCHIVE" "$REPORTING_PACKAGE_ARCHIVE"
  (cd "$application_copy" && bun --no-env-file install --ignore-scripts --config=/dev/null)
done

  set -- --target source-applications --profile "$source_profile"
  if [ "${GITHUB_ACTIONS:-}" = true ]; then set -- "$@" --revision "${GITHUB_SHA:?Missing tested source}"; fi
  "$FLOW_NODE" scripts/ci/suite-inventory.mjs "$@" > "$release_tmp/source-applications.files"
  "$FLOW_NODE" --input-type=module -e 'import{readFileSync,writeFileSync}from"node:fs";import{resolve}from"node:path";const files=readFileSync(process.argv[1],"utf8").trim().split("\n");writeFileSync(process.argv[3],JSON.stringify(files.map(source=>({source,copy:resolve(process.argv[2],source.replace(/^(?:examples\/|packages\/jig\/test\/fixtures\/)/,""))}))));' "$release_tmp/source-applications.files" "$release_tmp" "$release_tmp/application-map.json"
  set --
  while IFS= read -r test_file; do
    case "$test_file" in
      examples/*) copied_file=${test_file#examples/} ;;
      packages/jig/test/fixtures/incident-brief/*) copied_file=${test_file#packages/jig/test/fixtures/} ;;
      *) echo "Unknown application source" >&2; exit 1 ;;
    esac
    set -- "$@" "$release_tmp/$copied_file"
  done < "$release_tmp/source-applications.files"
  bun test "$@" --reporter=junit "--reporter-outfile=$report_directory/source-applications.xml"
  set -- --report "$report_directory/source-applications.xml" --mapping "$release_tmp/application-map.json" --repository "$PWD"
  if [ "${GITHUB_ACTIONS:-}" = true ]; then set -- "$@" --revision "$GITHUB_SHA"; fi
  "$python_bin" scripts/ci/normalize-source-junit.py "$@"
}
source_python_stage() {
  : > "$report_directory/source-python.txt"
  python_run() {
    set +e
    "$@" > "$release_tmp/python-command.txt" 2>&1
    python_status=$?
    set -e
    cat "$release_tmp/python-command.txt"
    cat "$release_tmp/python-command.txt" >> "$report_directory/source-python.txt"
    [ "$python_status" -eq 0 ] || exit "$python_status"
  }
  set -- --target source-python --profile "$source_profile"
  if [ "${GITHUB_ACTIONS:-}" = true ]; then set -- "$@" --revision "${GITHUB_SHA:?Missing tested source}"; fi
  "$FLOW_NODE" scripts/ci/suite-inventory.mjs "$@" > "$release_tmp/source-python.files"
# Reporting consumes the independently published Python FLOW SDK.
python_dist=${CI_PYTHON_DISTRIBUTIONS:-"$release_tmp/python-dist"}
python_reporting_dist=${CI_PYTHON_REPORTING_DISTRIBUTIONS:-"$release_tmp/python-reporting-dist"}
if [ -z "${CI_PYTHON_DISTRIBUTIONS:-}" ]; then
  mkdir -p "$python_dist"
  "$python_bin" -m pip download --no-deps jiggy-flow==0.1.0a7 --dest "$python_dist"
fi
python_run env PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=packages/jiggy-reporting/src "$python_bin" scripts/ci/run-source-python.py --files "$release_tmp/source-python.files" --group packages/jiggy-reporting
PYTHONPATH=packages/jiggy-reporting/src \
  "$python_bin" -m mypy --strict packages/jiggy-reporting/src/jiggy/reporting
if [ -z "${CI_PYTHON_REPORTING_DISTRIBUTIONS:-}" ]; then
  "$python_bin" -m build --outdir "$python_reporting_dist" packages/jiggy-reporting
  "$python_bin" -m twine check --strict "$python_reporting_dist"/*
  "$python_bin" packages/jiggy-reporting/tests/package_smoke.py \
    "$python_reporting_dist"/*.whl "$python_reporting_dist"/*.tar.gz "$python_dist"/*.whl
fi

}
if has_stage source-portable; then source_portable_stage; fi
if has_stage source-protocol; then source_protocol_stage; fi
if has_stage source-applications; then source_applications_stage; fi
if has_stage source-python; then source_python_stage; fi

set --
for package in $archive_packages; do for archive in "$release_tmp/artifacts/$package/"*.tgz; do set -- "$@" "$archive"; done; done
archive_digests "$@" > "$release_tmp/verified-digests"
cmp "$release_tmp/archive-digests" "$release_tmp/verified-digests" || { echo "Source tests changed frozen package archives" >&2; exit 1; }
