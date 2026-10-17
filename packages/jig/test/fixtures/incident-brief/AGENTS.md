# Conversation handoff fixture

## Purpose

Private application for bounded conversation handoff and sibling settlement.
This is host-test infrastructure, not a public example or a model-quality claim.

## Ownership

- `flows/`, `bindings/`, `grants/`, and `input.json` retain the ordinary
  public-interface application exercised by `../../host/installed-incident-brief.test.ts`.
- `test/` owns pure context and offline contract checks.
- `test/agent-task.ts.txt` supplies an ordinary bounded conversation task for the
  installed consumer. It does not replace a native adapter or mint session receipts.

## Local Contracts

- Preserve bounded turns, actual predecessor settlement before successor
  dispatch, increasing revisions, and independent sibling results.
- Keep public SDK dependencies and complete copied offline contracts. No
  host-private imports.
- Both Flows publish optional views through `withReporting`/`Reporter` from
  `@jigging/reporting`, with the complete current `jig:reporting` descriptor and
  license under `contracts/reporting`. Contract identity comes from that public
  package, never a handwritten digest.
- Operator grants remain explicit. Test peers do not establish native model
  quality.

## Verification

- `bun test packages/jig/test/fixtures/incident-brief/test`
- Offline checks compare both reporting descriptor/license copies with the public
  package and validate bounded views.
- `bun test packages/jig/test/host/installed-incident-brief.test.ts` requires the
  qualified host prerequisites. Pure cases do not prove dispatch races, native
  session restoration or cleanup.

## Child DOX Index

- None.
