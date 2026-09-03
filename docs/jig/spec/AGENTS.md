# Jig specifications

## Purpose

Owns the current Jig host contracts, machine schemas, and exact capability
descriptors.

## Ownership

- Prose files own Jig-specific admission, project, execution, SDK, and Agent
  capability behavior.
- `machine/` and `contracts/` contain their assigned published companions.
- FLOW specifications continue to own portable package and Run semantics.

## Local Contracts

- Do not place roadmap features, candidate orchestration patterns, or research
  hypotheses in specifications.
- Keep prose, machine schemas, exact descriptors, implementation, fixtures,
  and tests synchronized.
- A descriptor-byte change must reconcile its documented digest, host
  allowlist, fixtures, lock constants, and published exact bytes.
- Current exclusions must match the implementation and guide claims.

## Work Guidance

- Specify observable guarantees and explicit limits; keep private mechanisms
  private unless users must rely on them.

## Verification

- Run the relevant `packages/jig` tests.
- Build the Jig site into a fresh directory with `scripts/build-site.sh`.

## Child DOX Index

- None.
