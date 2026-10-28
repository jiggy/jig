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
  Retained application views have no invented execution or activity destinations.
- Snapshot replacement is atomic. Validation returns an owned immutable value,
  rejects malformed/oversized data and does not claim to authenticate evidence.
- IDs are bounded opaque values. Display labels and authored paths do not join
  publishers, grant file access or certify results. Recorded roles are explicit.
- `displayDestinations` consumes original semantic IDs and tags view
  destination keys with `displayViewKey`. Supplied root/publisher identities
  place root views before host and child inspection destinations. Labels never
  establish ancestry. Built-in keys stay disjoint. Never replace snapshot or
  reference IDs with those renderer destination keys.
- Pure observation intervals never infer execution durations or domain verdicts.

## Work Guidance

- Preserve distinctions among host observations, application reports and
  recorded claims. Add shared meaning only when independent renderers actually
  need it.
- Keep exact display behavior in its specification/renderer owner. General
  engineering principles remain in the maintainer guide.

## Verification

- `just check` builds and runs public model tests for immutable replacement,
  malformed data, identity, omissions and observation intervals.
- `just test-package` uses supplied exact model/reporting/FLOW archives in an
  external script-disabled consumer with no Jig or renderer dependency.
  The harness matches the installed version to this package's source manifest.

## Child DOX Index

- None.
