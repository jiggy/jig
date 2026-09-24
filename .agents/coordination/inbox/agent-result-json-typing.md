# Forward validated Agent results without type casts

Status: deferred until after the first public launch; explicit result
construction remains available.

## Problem

The public `AgentResult` interface is not naturally assignable to FLOW's JSON
index-signature type in every ordinary handler. Consumers reconstruct valid
results or reach for casts despite already having a validated value.

## Proposed scope

- Reproduce the friction in a minimal external TypeScript consumer using only
  public package exports.
- Prefer an accurate structural result type; use an ordinary conversion helper
  only when a genuine transformation is necessary.
- Keep unknown errors and observation failures explicitly projected into
  bounded application JSON rather than pretending arbitrary exceptions are JSON.

## Completion

Returning a validated Agent result through a public FLOW handler typechecks
without casts. Functions, undefined values and arbitrary Error objects remain
rejected. Runtime validation and result/settlement semantics are unchanged.

## Exclusions

No second result envelope, weakened JSON types, host convenience API or general
serialization framework.

Owners: `packages/agent-method/src/`, `packages/flow-sdk/src/types.ts` and their
public-consumer type checks.
