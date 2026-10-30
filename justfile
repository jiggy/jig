# ---------------------------------------------------------------------------- #
#                                   MODULES                                    #
# ---------------------------------------------------------------------------- #

mod agent "packages/agent-method/justfile"
mod acp "packages/agent-acp/justfile"
mod reporting "packages/reporting/justfile"
mod python_reporting "packages/jiggy-reporting/justfile"
mod display_model "packages/display-model/justfile"
mod display_web "packages/display-web/justfile"
mod display_tui "packages/display-tui/justfile"
mod jig "packages/jig/justfile"
mod site "site/justfile"

# ---------------------------------------------------------------------------- #
#                                   COMMANDS                                   #
# ---------------------------------------------------------------------------- #

# Show repository and package tasks (Just 1.43.1 or newer)
@default:
    just --list --list-submodules

# Build the TypeScript packages
build: jig::build

# Format only the requested paths, or the repository when omitted
[positional-arguments]
@format *paths:
    bun x --no-install biome format --write --files-ignore-unknown=true --no-errors-on-unmatched "$@"

# Record package release intent without editing numeric versions
[positional-arguments]
@changeset *args:
    node node_modules/@changesets/cli/bin.js "$@"

# Preview pending package versions and their dependency closure
@release-plan:
    node scripts/release/cli.mjs plan

# Generate versions, changelogs and derived pins for the maintained release PR
@release-version:
    node scripts/release/cli.mjs version

# ---------------------------------------------------------------------------- #
#                                    CHECKS                                    #
# ---------------------------------------------------------------------------- #

# Check formatting, lint, and imports without writing
[positional-arguments]
@biome-check *paths:
    bun x --no-install biome check --files-ignore-unknown=true --no-errors-on-unmatched "$@"

# Lint without writing
[positional-arguments]
@lint *paths:
    bun x --no-install biome lint --files-ignore-unknown=true --no-errors-on-unmatched "$@"

# Validate release coverage against an explicit Git baseline
[positional-arguments]
@release-check base:
    node scripts/release/cli.mjs check --base "$1"

# Run Jig, flavored method, and application source tests
[positional-arguments]
@test *args:
    #!/usr/bin/env bash
    set -euo pipefail
    flow_node=${FLOW_NODE:-$(command -v node)}
    "$flow_node" -e 'if(process.release?.name!=="node"||process.versions?.bun!==undefined||Number(process.versions.node.split(".")[0])<22)process.exit(70)'
    profile=portable
    if [[ "$(uname -s)" == Linux ]]; then profile=portable-linux; fi
    portable=$("$flow_node" scripts/ci/suite-inventory.mjs --target source-portable --profile "$profile")
    protocol=$("$flow_node" scripts/ci/suite-inventory.mjs --target source-protocol --profile "$profile")
    files=()
    node_files=()
    while IFS= read -r file; do
        case "$file" in
            *.node.mjs) node_files+=("./$file") ;;
            *) files+=("./$file") ;;
        esac
    done <<< "$(printf '%s\n%s\n' "$portable" "$protocol")"
    bun test "${files[@]}" "$@"
    if (( ${#node_files[@]} )); then
        "$flow_node" --test "${node_files[@]}"
    fi

# Check every example against the current frozen package archives
@test-examples:
    FLOW_NODE="${FLOW_NODE:-$(node -p process.execPath)}" sh scripts/test-release.sh --targets source-applications

# Run the installed operational baseline with its documented host prerequisites
@test-baseline:
    bun scripts/test-operational-baseline.ts

# Run quick development, host-coverage, and release-automation checks
@test-tooling:
    node --test scripts/ci/*.test.mjs
    bun test scripts/development-shell.test.ts scripts/new-worktree.test.ts scripts/justfile.test.ts scripts/preflight.test.ts scripts/example-dependency-versions.test.ts scripts/check-example-project.test.ts scripts/agent-candidate.test.ts scripts/npm-publish.test.ts scripts/operational-baseline-checks.test.ts scripts/test-release-applications.test.ts

# Build and check locally, including native regression tests on supported Macs
@preflight:
    bun scripts/preflight.ts

# Run selected complete CI source stages with resolved local tools and no native host allocation
[positional-arguments]
@test-source *args:
    bun scripts/preflight.ts source "$@"

# Run the unprivileged release gate; requires FLOW_NODE and Python
@test-release:
    sh scripts/test-release.sh

# Freeze and qualify an ordinary Agent package from clean Git source
[positional-arguments]
@agent-candidate kind destination:
    bun scripts/build-agent-candidate.ts "$1" "$2"
