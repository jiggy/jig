# TypeScript FLOW SDK

## Purpose

Implements the dependency-free `@jigging/flow` TypeScript projection of Run
SDK/1 and Run/1.

## Ownership

- `src/` owns public types and the JSON/1, protocol, session, channel, and transport
  implementation.
- `test/` owns unit, subprocess, race, and packed-package evidence.
- `justfile` owns build and package tasks; `package.json`, `README.md`, and
  `LICENSE` own the release envelope.
  Bun generates the ignored root workspace lock. `dist/` is generated.

## Local Contracts

- `src/index.ts` is the package-root public surface.
- Importing the package performs no protocol I/O or global mutation.
- `handle()` owns exactly one root Run over newline-framed protocol standard
  input and output; application diagnostics go to standard error.
- Preserve strict JSON/1 validation, exact messages, full-duplex calls,
  cancellation, terminal ordering, and bounded request behavior.
  Validate and snapshot the complete root result envelope before cleanup;
  envelope overhead counts toward JSON/1 bounds and overflow is `INVALID_RESULT`.
- `run.call()` sends one exact `FlowCall` through `flow/call`, requiring
  `operationId`, `slot`, and `input`, with only optional `intent` and `channels`.
  It returns the complete `RunResult`; domain outcomes remain ordinary data.
  Snapshot own enumerable data fields before validation and wire emission;
  accessors, hidden fields, and symbols are not request or channel-map data.
  Inherited fields do not become supplied values or endpoint authority.
  `OperationError` represents operational failure. The host-supplied `flow/run`
  entrypoint and authority ownership are unchanged.
- Direct and broadcast channel endpoints carry only host-granted information rights.
  Preserve normal catch-based recovery, retained cancellation responses,
  first-exposure disposal errors, and active-receiver completion checks.
  The host commits endpoint transfers and implicit writer sealing; never infer
  transfer from a call's final outcome or seal before completion eligibility.
  Reserve settlement capacity inside the existing wire limits.
- Writer `close({error:'LAGGED'})` uses the ordinary close operation to declare
  incomplete output, including while sends are pending. Snapshot its closed
  options and retain cancellation settlement. Never rewrite an earlier clean
  seal or confuse producer-declared stream failure with execution authority.
- Broadcast subscription authority stays at the creating Run; it is not an
  endpoint or transferable data. Register subscription grants before exposing
  them, preserve suffix start identities, and dispose late cancelled allocations.
  Allocation itself activates a subscription's completion obligation; failed
  allocation cleanup cannot become success.
- Runtime code remains dependency-free and works in the documented Bun and
  Node environments.

## Work Guidance

- Change public types, runtime validation, README behavior, and tests together.
- Keep NodeNext relative imports suffixed with `.js`.
- Test malformed frames, cancellation, channel loss, detached calls, and write
  races as well as successful Runs.

## Verification

- `bun test packages/flow-sdk`
- `just flow::build`
- `FLOW_NODE="$(command -v node)" just flow::test-package`

## Child DOX Index

- None.
