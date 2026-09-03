# FLOW specifications

## Purpose

Owns the normative portable contracts and their assigned machine-readable
companions.

## Ownership

- Prose specifications own portable meaning.
- `machine/`, `examples/`, and `contracts/` have only the authority assigned
  by their companion specification.
- SDKs and `conformance/` implement and test these contracts; they do not
  redefine them.

## Local Contracts

- Change prose, machine schemas, examples, SDK projections, error registries,
  and conformance fixtures together when shared behavior changes.
- Examples are illustrative unless a specification explicitly says otherwise.
- Published `$id` values, routes, and exact bytes are coupled to site assembly
  and inventories.
- New, renamed, or removed public machine files require corresponding map,
  index, inventory, and test changes.

## Work Guidance

- State requirements in observable terms and avoid prescribing an internal
  framework or graph model.

## Verification

- Run the relevant `packages/flow-sdk` and `conformance/run-1` tests.
- Build the FLOW site into a fresh directory with `scripts/build-site.sh`.
- Use `scripts/test-release.sh` for release-coupled changes.

## Child DOX Index

- None.
