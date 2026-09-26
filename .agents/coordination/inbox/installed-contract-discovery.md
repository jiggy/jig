# Import installed contracts without knowing installation layout

Status: postponed follow-up awaiting triage; not a developer-alpha launch gate.
Explicit file import remains the supported path.

## Problem

Users must locate an installed descriptor under root or member-local
`node_modules` before calling `jig import-contract`. Correct package layout
should not require private knowledge of the installer.

## Proposed scope

- Extend the existing importer to resolve an explicitly selected installed
  package relative to its consumer using ordinary package-resolution rules,
  without assuming a root or member-local `node_modules` layout.
- Freeze the smallest source-reference syntax before implementation.
- Keep direct-file import for independently supplied contracts.
- Preserve complete offline-closure validation and no-replace publication.
- Explain that the imported bundle is a visible, project-owned snapshot;
  upgrading a dependency does not silently replace reviewed contract meaning.

## Completion

The same documented workflow imports a complete contract from root-installed
and member-local dependencies without manually specifying their physical
installation paths. Verify it in ordinary consumer projects, not only this
repository's workspace. Missing packages, unavailable descriptors and destination
conflicts are actionable; invalid offline closures still reject without replacing
the destination.

The [conversation and handoff adoption follow-up](conversation-handoff-adoption.md)
then applies the delivered interface to public authoring guidance.

## Exclusions

No implicit installation, registry requests, package-code execution, runtime
resolution, automatic updates or extra grants.

Owners: `packages/jig/src/internal/contract-import.ts`,
`packages/jig/src/cli.ts`, `docs/jig/guide/conversations.md`.
