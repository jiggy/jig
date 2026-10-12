# Semantic presentation

## Purpose

Turn supplied observations into bounded terminal data while execution, real
input, native allocation and output remain with their existing owners.

## Ownership

- `projection.ts` owns frame, hierarchy, detail and inline data projection.
- `viewer-model.ts` owns validated snapshots, selection and bounded preview intent.
- `text.ts` owns escaped text, grapheme wrapping and qualified Bun cell width.
- `style.ts` owns supplied-theme color values.
- The parent package owns public exports, native rendering, input and lifecycle.

## Local Contracts

- Import runtime values only from this source group and declared display-model
  exports. Reporting and parent `types.ts` are type-only dependencies; their
  publisher or parent runtime entrypoints never belong to this group.
- Read no real streams, environment, filesystem or network, load no native
  support and dispatch no execution. Preview uses the caller-supplied service.
  Qualified `globalThis.Bun.stringWidth(text)` is the sole ambient value access.
- Preserve supplied provenance, clipping, unavailable relationships, escaped
  text, bounded frames and cancellation of obsolete preview intent.
- The package-owned boundary test is a dependency regression check, not a
  sandbox or proof that arbitrary JavaScript is pure. New native, input or
  lifecycle responsibility belongs outside this group and qualifies full CI.

## Work Guidance

- Keep semantic presentation separate from actual I/O and execution authority.

## Verification

- Existing package `just build`, `just test` and frozen ordinary `test-package`.
- Whole presentation tests and the boundary regression run in source/full-host
  inventories; compact installed witnesses never create full host receipts.

## Child DOX Index

- None.
