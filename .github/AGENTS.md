# Repository automation

## Purpose

Owns CI, host-conformance, package publication, and public-site workflows.

## Ownership

- `workflows/` owns automation triggers, permissions, jobs, and retained
  artifacts.
- Checked-in scripts own reusable build and test logic.

## Local Contracts

- Pin third-party actions by full commit.
- Grant each job only the authority it needs; build jobs must not inherit
  publication or Git-write authority.
- Build, test, publish, and tag the exact triggering source and retained
  candidate bytes. Never rebuild a release during publication.
- Publish only after CI and the complete Linux Host Conformance workflow have
  both succeeded for the exact triggering source revision.
- Keep path filters synchronized with every real workflow input.
- Keep FLOW and Jig site publication independent.

## Work Guidance

- Put substantial shell or TypeScript logic in `scripts/` and call it here.
- Preserve zero-residue checks around provisioned Jig host tests.

## Verification

- Validate the called script locally where possible and inspect the complete
  workflow permission and artifact flow after any automation change.

## Child DOX Index

- None.
