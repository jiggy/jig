# TypeScript FLOW SDK

## Purpose

Implements the dependency-free `@jigging/flow` TypeScript projection of Run
SDK/1 and Run/0.

## Ownership

- `src/` owns public types and the JSON/0, protocol, session, channel, and
  transport implementation.
- `test/` owns unit, subprocess, race, and packed-package evidence.
- `justfile` owns build and package tasks. `package.json`, `README.md`, and
  `LICENSE` own the release envelope. Bun generates the ignored root workspace
  lock. `dist/` is generated.

## Local Contracts

- `src/index.ts` is the package-root public surface.
- Importing the package performs no protocol I/O or global mutation.
- `handle()` owns exactly one root Run over newline-framed protocol standard
  input and output. Application diagnostics go to standard error.
- Preserve strict JSON/0 validation, exact messages, full-duplex calls,
  cancellation, terminal ordering, and bounded request behavior. Validate and
  snapshot the complete root result envelope before cleanup. Envelope overhead
  counts toward JSON/0 bounds and overflow is `INVALID_RESULT`.
- `run.call()` sends one exact `FlowCall` through `flow/call`, requiring
  `operationId`, `slot`, and `input`, with optional `intent`, `channels` and
  `attachments`. It returns `CallResult`. Domain outcomes remain
  ordinary data. Snapshot own enumerable data fields before validation and wire
  emission. Accessors, hidden fields, and symbols are not request or channel-map
  data. Inherited fields do not become supplied values or endpoint authority.

  `OperationError` represents operational failure. The host-supplied `flow/run` entrypoint and
  authority ownership are unchanged.
- Finite artifact refs project to genuine per-Run opaque `Artifact` objects.
  Call attachments serialize held reads or `create:true`. Terminal
  `artifactResults` explicitly selects held immutable trees. Domain schemas
  remain `{outcome, output}` and host `artifacts` are a separate envelope.
  The host validates rights and exact duplicate replay before new-read rights.
  Serialization never manufactures grants or resurrects released refs.

  Optional early release retains cancellation settlement. Ordinary root cleanup
  is host-owned and automatic, including late cancelled call replies.
- Direct and broadcast channel endpoints carry only host-granted information
  rights. Channel creation accepts a package-local agreement path or a closed
  `{slot, channel}` reference to the caller's declared dependency contract.
  Resolution does not invoke the slot or confer endpoint rights. Preserve normal
  catch-based recovery, retained cancellation responses, first-exposure disposal
  errors, and active-receiver completion checks. The host commits endpoint
  transfers and implicit writer sealing. Never infer transfer from a call's
  final outcome or seal before completion eligibility.

  Reserve settlement capacity inside the existing wire limits.
- Writer `close({error:'LAGGED'})` uses the ordinary close operation to declare
  incomplete output, including while sends are pending. Snapshot its closed
  options and retain cancellation settlement. Never rewrite an earlier clean
  seal or confuse producer-declared stream failure with execution authority.
- Broadcast subscription authority stays at the creating Run. It is not an
  endpoint or transferable data. Register subscription grants before exposing
  them, preserve suffix start identities, and dispose late cancelled
  allocations. Allocation itself activates a subscription's completion
  obligation. Failed allocation cleanup cannot become success.
- Runtime code remains dependency-free and works in the documented Bun and Node
  environments.

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
