# Conversation handoff fixture

## Purpose

Private synthetic evidence for bounded conversation handoff and sibling settlement.
This is host-test infrastructure, not a public example or a model-quality claim.

## Ownership

- `flows/`, `bindings/`, `grants/`, and `input.json` retain the ordinary public-interface application exercised by `../incident-brief-consumer.ts`.
- `test/` owns deterministic method checks for turn budgets, revision races, context preservation, and failure isolation.

## Local Contracts

- Preserve bounded turns, actual predecessor settlement before successor dispatch, increasing revisions, and independent sibling results.
- Keep public SDK dependencies and complete copied offline contracts; no host-private imports.
- Both Flows publish optional views through `withReporting`/`Reporter` from
  `@jigging/reporting`, with the complete current `jig:reporting` descriptor and
  license under `contracts/reporting`. Contract identity comes from that public
  package, never a handwritten digest.
- Operator grants remain explicit. Test peers do not establish native model quality.

## Verification

- `bun test packages/jig/test/fixtures/incident-brief/test`
- Dashboard checks compare both offline reporting descriptor/license copies
  with the installed public package in addition to validating bounded views.
- Installed lifecycle evidence belongs to `finite-acp-lifecycle.test.ts` and requires its qualified host prerequisites.

## Child DOX Index

- None.
