# Bound authoring by referenced channel agreements

Status: deferred until after the first public launch; not a merge gate.

## Problem

Managed contract generation sends every eligible captured JSON filename to the
TypeSpec compiler. Its 4,096-name / 128 KiB inventory limit can reject a package
because of unrelated fixtures, even when its contract has no channels.

## Proposed scope

- Discover required local agreements from the generated invocation descriptor.
- Resolve only that exact closure from captured package bytes before publication.
- Remove the whole-package inventory parameter rather than increasing its limit.
- Preserve bounded validation, borrowed-input freshness, publication recovery
  and the distinction between user-owned inputs and generated outputs.
- Synchronize the authoring library, host, owning specification and tests.

## Completion

A channel-free contract and a contract borrowing one agreement generate with
more than 4,096 unrelated JSON fixtures. Missing, invalid or conflicting
referenced agreements still prevent publication. Borrowed files are never
overwritten or deleted by generation.

## Exclusions

No remote imports, compiler plugins, automatic runtime compilation or larger
resource allowances merely to accommodate the old inventory.

Owners: `packages/flow-authoring/src/`,
`packages/jig/src/internal/contract-generation.ts`,
`docs/jig/spec/contract-authoring.md`.
