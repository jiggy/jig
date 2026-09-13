# Support case handling

## Purpose

Show useful Agent interpretation inside an application whose code owns
credit eligibility and customer-facing claims.

## Ownership

- `flows/assess/` owns one bounded interpretation and its closed proposal contract.
- `flows/resolve/` owns account consistency checks, fixed duplicate-credit
  policy, and deterministic replies. `bindings/support.ts` selects its assessor.
- `fixtures/` contains synthetic account records and customer requests.
- `test/` owns deterministic application checks; the public walkthrough belongs
  in `docs/jig/guide/support-case.md`.

## Local Contracts

- Account facts come from the authenticated application caller, never customer
  text. Charges have unique IDs, are chronological, and use USD cents.
- Only a later settled charge matching an earlier settled invoice and amount
  can qualify; the requested amount must equal that charge and be at most 5000 cents.
- Model text cannot change policy or supply the customer-facing reply.
- Return eligibility only. No payment, message, credential, network fetch,
  or repository-specific integration belongs in the example. Any downstream
  action owns current-state checks, authorization, and idempotency.
- `done` includes an eligible, ineligible, or manual-review decision; assessment
  inability remains `blocked` or `limit`. Errors and cancellation never replay.
- Each Flow is self-contained. Input/result schemas describe the shared boundary;
  code owns relational checks and semantic policy, not Jig.

## Work Guidance

- Keep the two-method path readable. Add complexity only for a useful consumer task.
- Do not equate an eligible charge with correct interpretation of customer intent,
  or deterministic adversarial tests with model injection resistance.

## Verification

- `bun test examples/support-case/test` checks policy and execution decisions.
- The release gate repeats these tests against the freshly packed SDK.
- Retain admitted installed-run evidence separately from Agent-substitute tests.

## Child DOX Index

- None.
