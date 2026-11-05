# Semantic display model

## Purpose

Keep presentation independently reusable while observations and authority remain
with their producer. This package owns readonly display data and pure meaning.

## Ownership

- `src/types.ts` owns snapshots, attribution, captured preview replies and fixed
  asset value types. `src/validate.ts` owns bounded inert-data validation.
- `src/image.ts` validates bounded PNG/JPEG payloads and matching encoded
  dimensions. It owns no decoder, IO or authenticity claim.
- `src/semantics.ts` owns destination vocabulary, observation intervals and
  typed reference helpers. `src/index.ts` declares the public surface.
- `src/composition.ts` matches retained invocation requests to supplied admitted
  composition. It owns no graph discovery, admission, execution, or layout.
- Package metadata, README, notices, justfile and tests own this release unit.
  Root licensing/pricing text is canonical and copied only during the build.

## Local Contracts

- `src/text.ts` owns shared bounded filename/content detection, lexical token
  roles and strict CSV/TSV table parsing. Hints never validate content or grant
  access.

- Import only ordinary declared dependencies. Never import Jig or a renderer.
- No execution state, host clock, navigation, native initialization, filesystem
  or network operations belong in model source.
- Input captures retain `captured-input` provenance separately from delivered outputs.
  Each retained file may bind its exact source and attachment.
  Delivered files can retain multiple verified source/attachment/relative-path bindings independently of their packet path.
  Retained application views have no invented execution or activity destinations.
- Snapshot replacement is atomic. Validation returns an owned immutable value,
  rejects malformed/oversized data and does not claim to authenticate evidence.
- IDs are bounded opaque values. Display labels and authored paths do not join
  publishers, grant file access or certify results. Recorded roles are explicit.
- A complete live snapshot may include the finite Run's admitted composition.
  Other producers may lack that evidence. Saved projections do not acquire it
  through labels or retained reports.
  Composition is complete or explicitly unavailable. Nodes expose opaque
  identities, labels, target kinds and native resource kinds only.
  They omit settings, policies, selectors and private paths.
- Composition bounds have one canonical owner in `src/types.ts`.
  Validation enforces node, edge and encoded UTF-8 byte capacities.
  Valid configuration does not guarantee executability or observed execution.
- Match configured routes through the root publisher, exact caller identities,
  slot names and supplied child publisher relationships. Preserve repeated
  requests and separate Binding identities. Missing or conflicting relationships
  stay unmatched. Match results do not infer order, skipped work, duration,
  condition values, outputs or external effects.
- `displayDestinations` consumes original semantic IDs and tags view
  destination keys with `displayViewKey`. Supplied root/publisher identities
  place root views before host and child inspection destinations. Labels never
  establish ancestry. Built-in keys stay disjoint. Never replace snapshot or
  reference IDs with those renderer destination keys.
- Pure observation intervals never infer execution durations or domain verdicts.
  Unknown observation clocks preserve their supplied material and produce no interval.
  Workspace elapsed time remains finite and nonnegative.

## Work Guidance

- Preserve distinctions among host observations, application reports and
  recorded claims. Add shared meaning only when independent renderers actually
  need it.
- Keep exact display behavior in its specification/renderer owner. General
  engineering principles remain in the maintainer guide.

## Verification

- `just check` builds and runs public model tests for immutable replacement,
  malformed data, identity, omissions, composition bounds and observation intervals.
  Composition tests cover exact joins, conflicting ancestry and repeated requests.
- `just test-package` uses supplied exact model/reporting/FLOW archives in an
  external script-disabled consumer with no Jig or renderer dependency.
  The harness matches the installed version to this package's source manifest.

## Child DOX Index

- None.
