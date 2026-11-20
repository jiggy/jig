# Shared Binding wiring consumer

## Purpose

Exercise a publishing application's shared producer and an offer-only configuration edit through installed Jig.

## Ownership

- `project/` owns the baseline Flow packages, Binding declarations, and reviewer contract.
- `wiring.mjs` owns the isolated scenario, ordinary review, and public Run assertions.
- The [host suite](../../host/installed-shared-binding-wiring.test.ts) selects the Jig archive and checks native prerequisites and residue.

## Local Contracts

- Flow packages use the published FLOW SDK and perform deterministic review work.
- The test uses the installed Jig CLI, public attempt client, and ordinary Node libraries.
- Keep approvals, prepared tickets, and result packets in private temporary directories.
- Assert the wrong-scope edit against the same preserved book expectation as the correct edit.

## Work Guidance

Use [the standalone consumer commands](README.md) to reproduce a selected edit.

## Verification

Run `node --test wiring.mjs` after installation on a supported Jig host.
