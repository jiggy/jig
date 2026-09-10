# FLOW contract authoring

## Purpose

Make reusable contracts practical to edit without requiring a source compiler
in FLOW consumers. This package owns the bounded TypeSpec mapping prototype;
it does not implement host-managed publication or change package discovery.

## Ownership

- Source, tests and fixtures qualify optional TypeSpec-to-Schema/1 compilation.
- The package README owns its supported authoring profile and limitations.
- FLOW specifications continue to own native descriptor semantics.

## Local Contracts

- Compilation consumes explicit source and returns artifacts as data. It never
  edits a project, admits execution, fetches imports or runs package extensions.
- Preserve requiredness, constraints and complete outcome/output correlation.
  Reject unsupported source and Agent projections rather than weakening them.
- Generated types are editor assistance, not validation or authority.
- Keep the complete drafter fixture and honest compilerless consumption checks.

## Work Guidance

- Qualify the mapping before adding publication, watchers or Jig integration.
- Use only the pinned compiler and bundled authoring definitions.

## Verification

- `just authoring::test` builds the package and runs its Node mapping/lifecycle
  tests and generated-type fixtures.

## Child DOX Index
