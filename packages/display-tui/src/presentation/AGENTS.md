# Semantic presentation

## Purpose

Turn supplied observations into bounded terminal data while execution, real
input, native allocation and output remain with their existing owners.

## Ownership

- `projection.ts` owns frame, hierarchy, detail and inline data projection.
- `viewer-model.ts` owns validated snapshots, selection and bounded preview
  intent.
- `text.ts` owns escaped text, grapheme wrapping and qualified Bun cell width.
- `style.ts` owns supplied-theme color values.
- The parent package owns public exports, native rendering, input and lifecycle.

## Local Contracts

- Import runtime values only from this source group and declared display-model
  exports. Reporting and parent `types.ts` are type-only dependencies. Their
  publisher or parent runtime entrypoints never belong to this group.
- Read no real streams, environment, filesystem or network, load no native
  support and dispatch no execution. Preview uses the caller-supplied service.
  Qualified `globalThis.Bun.stringWidth(text)` is the sole ambient value access.
- Preserve supplied provenance, clipping, unavailable relationships, escaped
  text, bounded frames and cancellation of obsolete preview intent.
- Native, input and lifecycle responsibilities stay with the parent package.

## Work Guidance

- Application projection composes full block content in authored section
  order. Dense inspection lists and optional collection/evidence context
  remain separate.
- Keep semantic presentation separate from actual I/O and execution authority.

## Verification

- Existing package `just build`, `just test` and frozen ordinary `test-package`.
- Whole presentation tests run in source and full host inventories.

## Child DOX Index

- None.
