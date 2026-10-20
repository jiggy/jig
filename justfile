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

# Run Jig, flavored method, and application source tests
[positional-arguments]
@test *args:
    #!/usr/bin/env bash
    set -euo pipefail
    profile=portable
    if [[ "$(uname -s)" == Linux ]]; then profile=portable-linux; fi
    portable=$(node scripts/ci/suite-inventory.mjs --target source-portable --profile "$profile")
    protocol=$(node scripts/ci/suite-inventory.mjs --target source-protocol --profile "$profile")
    files=()
    node_files=()
    while IFS= read -r file; do files+=("./$file"); done <<< "$portable"
    while IFS= read -r file; do
        case "$file" in
            *.node.mjs) node_files+=("./$file") ;;
            *) files+=("./$file") ;;
        esac
    done <<< "$protocol"
    bun test "${files[@]}" "$@"
    if (( ${#node_files[@]} )); then
        "${FLOW_NODE:-node}" --test "${node_files[@]}"
    fi

# Run the installed operational baseline with its documented host prerequisites
@test-baseline:
    bun scripts/test-operational-baseline.ts

# Run quick development, host-coverage, and release-automation checks
@test-tooling:
    node --test scripts/ci/*.test.mjs
    bun test scripts/development-shell.test.ts scripts/new-worktree.test.ts scripts/justfile.test.ts scripts/preflight.test.ts scripts/example-dependency-versions.test.ts scripts/agent-candidate.test.ts scripts/npm-publish.test.ts scripts/operational-baseline-checks.test.ts

# Build and check locally, including native regression tests on supported Macs
@preflight:
    bun scripts/preflight.ts

# Run the unprivileged release gate; requires FLOW_NODE and Python
@test-release:
    sh scripts/test-release.sh

# Freeze and qualify an ordinary Agent package from clean Git source
[positional-arguments]
@agent-candidate kind destination:
    bun scripts/build-agent-candidate.ts "$1" "$2"
