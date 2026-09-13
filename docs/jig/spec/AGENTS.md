# Jig specifications

## Purpose

Owns the current Jig host contracts, machine schemas, and exact capability
descriptors.

## Ownership

- `cli-experience.md` owns task presentation, progress, color/plain behavior, actionable failures, section boundaries, secondary emphasis, and CLI acceptance requirements.

- Prose files own Jig-specific admission, project, execution, SDK, and Agent
  capability behavior.
- `machine/` and `contracts/` contain their assigned published companions.
- FLOW specifications continue to own portable package and Run semantics.
- `channels.md` owns Jig's direct/broadcast channel support, local limits, native update
  projection and installed NDJSON output. `contracts/acp-public-updates.json`
  defines the exact optional Agent update meaning, not raw ACP access.

## Local Contracts

- Do not place roadmap features, candidate orchestration patterns, or research
  hypotheses in specifications.
- Keep prose, machine schemas, exact descriptors, implementation, fixtures,
  and tests synchronized.
- A descriptor-byte change must reconcile its documented digest, host
  allowlist, fixtures, lock constants, and published exact bytes.
- Current exclusions must match the implementation and guide claims.

## Work Guidance

- CLI syntax themes and shell selection belong in `cli-experience.md`; keep
  token styling separate from exact review policy and machine output. Field
  diffs must explain execution-only changes without exposing private identities.
  Terminal Run presentation and `--json` selection must stay synchronized with
  channel output, project policy, help, and the results guide.

- Specify observable guarantees and explicit limits; keep private mechanisms
  private unless users must rely on them.

## Verification

- Run the relevant `packages/jig` tests.
- Build the Jig site into a fresh directory with `scripts/build-site.sh`.

## Child DOX Index

- None.
