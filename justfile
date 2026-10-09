# ---------------------------------------------------------------------------- #
#                                   MODULES                                    #
# ---------------------------------------------------------------------------- #

mod flow "packages/flow-sdk/justfile"
mod agent "packages/agent-method/justfile"
mod acp "packages/agent-acp/justfile"
mod authoring "packages/flow-authoring/justfile"
mod python "packages/jiggy-flow/justfile"
mod updates "packages/user-updates/justfile"
mod python_updates "packages/jiggy-user-updates/justfile"
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
build: flow::build jig::build authoring::build

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

# Run ordinary method, SDK, Jig, and Run/0 tests
[positional-arguments]
@test *args:
    bun test packages/agent-method packages/agent-acp packages/flow-sdk packages/user-updates packages/display-model packages/display-web packages/display-tui packages/jig conformance/run-0 "$@"

# Run the portable Run/0 corpus
[positional-arguments]
@test-run-0 *args:
    bun test conformance/run-0 "$@"

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
