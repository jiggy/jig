# ---------------------------------------------------------------------------- #
#                                   MODULES                                    #
# ---------------------------------------------------------------------------- #

mod flow "packages/flow-sdk/justfile"
mod jig "packages/jig/justfile"
mod site "site/justfile"

# ---------------------------------------------------------------------------- #
#                                   COMMANDS                                   #
# ---------------------------------------------------------------------------- #

# Show repository and package tasks (Just 1.43.1 or newer)
@default:
    just --list --list-submodules

# Build both TypeScript packages
build: flow::build jig::build

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

# Run ordinary SDK, Jig, and Run/1 tests
[positional-arguments]
@test *args:
    bun test packages/flow-sdk packages/jig conformance/run-1 "$@"

# Run the portable Run/1 corpus
[positional-arguments]
@test-run-1 *args:
    bun test conformance/run-1 "$@"

# Run the installed operational baseline with its documented host prerequisites
@test-baseline:
    bun scripts/test-operational-baseline.ts

# Run development-shell, worktree, and task-runner tests
@test-tooling:
    bun test scripts/development-shell.test.ts scripts/new-worktree.test.ts scripts/justfile.test.ts

# Run the unprivileged release gate; requires FLOW_NODE and Python
@test-release:
    sh scripts/test-release.sh
