# TypeScript FLOW SDK

## Purpose

Implements the dependency-free `@jigging/flow` TypeScript projection of Run
SDK/1 and Run/1.

## Ownership

- `src/` owns public types and the JSON/1, protocol, session, and transport
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
- Preserve the documented distinction between operation and effect errors.
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
