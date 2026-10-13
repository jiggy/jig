# Semantic terminal displays

## Purpose

Make supplied observations understandable while keeping authority with their
producer. This package renders independently supplied display-model snapshots
and portable reporting data without a Jig host or execution owner.

## Ownership

- `src/index.ts` owns the public opaque preparation and inspector lifecycle.
- `src/presentation/viewer-model.ts` owns private snapshot hydration and local selection,
  filtering, sorting, disclosure, tree state and immutable preview intent.
- `src/input.ts` decodes supplied bytes and owns bounded key/escape state.
- `src/native.ts` owns private OpenTUI layout, memory cells and bounded encoding.
- `src/presentation/projection.ts` owns hierarchy, detail and compact/inline projection.
  Inline is a purpose/actual-branches/activity projection rather than recursively
  dumping interactive sections and row details. Retain unassociated activities,
  deterministic root-view fallback, attention-first bounds and visible overflow;
  handoff retains brief selected context/filter without a second workspace.
- `src/inline.ts`, `src/presentation/text.ts` and `src/presentation/style.ts` own non-native public exports.
- `src/inline-owner.ts` owns private viewer transfer and inline lifetime.
- `test/presentation/` owns whole projection, workbench and inline regressions.
- Package tests own renderer/navigation/input/preview regressions. Jig owns its
  admission, real stdin/signals/restoration, output writer and Run lifetime tests.

## Local Contracts

- Captured text uses shared format detection and lexical token roles; CSV/TSV
  columns have repeating colours without changing raw whitespace or search.
- Depend only on declared display-model, reporting and native support exports;
  never import Jig, another renderer, sibling source or generated output paths.
- Hydrate owned validated snapshots atomically. Do not replay host admission,
  infer source ancestry from labels or identify recorded roles by authored names.
- Preserve each workspace fact's provenance and clipping. Only complete
  host-observed status facts receive verdict styling; application outcomes stay
  literal and recorded claims stay attributed. Full facts remain reachable with
  the existing attention control and in inline output.
- Keep raw semantic IDs for joins and tag all navigation/record identities by
  their domain. Supplied IDs may equal built-in names or resemble any private tag.
- Render omitted-parent calls at the root while retaining unavailable ancestry.
  Reserve stale disclosure independently of sticky causes in every layout.
- Read no real streams, signals, environment or filesystem. Native Core receives
  inert streams and memory output; public frame methods return bounded data only.
- Native support loads only through explicit `prepareTui`. Inline/text/style
  imports perform no native allocation. Public declarations expose no Core types.
- Snapshot replacement preserves local stable identities and repairs removed rows
  against the previous ordering, including views not currently selected.
- Preview requests use opaque inventory and capture-generation identities.
  Retain one active excerpt of at most 64 KiB or a bounded model image. Fence
  selection/capture/disposal; reuse text for expansion and literal search.
- ImageRenderable receives decoded captured PNG/JPEG bytes only, using blocks
  within the existing frame ceiling. Colour-free/compact output retains image
  metadata; images have no excerpt-search action. No paths, URLs, overlays or graphics escapes.
  Destroying the selected subtree releases its retained native image.
- Exit confirmation is viewer-local, defaults to Stay and survives observation
  replacement. q requests it; Escape dismisses panels/returns without closing
  at the top level. Live interrupt and caller-driven disposal stay immediate.
- Serialize native frames and fence output/callbacks after disposal. Close and
  interrupt are intents; the caller owns execution and authoritative phase checks.
- `handoffInline` ends native/input/preview/callback effects once and transfers
  only private viewer state to its inline owner. No handoff follows disposal.
- Keep model snapshot/reserve bounds and the 32 KiB encoded terminal frame bound.
  Unknown importance, stale observation, clipping and unavailable capture stay visible.
- Escape supplied inline titles and warning markers before measuring their
  single physical row. Wrap any shortened warning's reason into context.
- Root license/pricing texts are canonical; build copies them without a new fee
  or license promise. Just owns build/check/packing; manifests contain no scripts.

## Work Guidance

- Preserve useful context, dense rows, full causes, visible action feedback,
  reference return, sole-artifact peek, narrow exits and color-free distinctions.
- Fixtures construct semantic observations in tests; production code never
  exposes `acceptView`, `observeCall`, execution policy or host receipt accounting.

## Verification

- `just build` then `just test` on the qualified Bun profile.
- `just test-package` with frozen package archives exercises an ordinary consumer
  through declared exports with no Jig package. Installed Jig proof is separate.
- Native evidence requires an available supported native platform; skipped native
  tests do not qualify it or another operating system.

## Child DOX Index

- [src/presentation/AGENTS.md](src/presentation/AGENTS.md) — Semantic projection,
  private viewer state and text/style without native or input ownership.
