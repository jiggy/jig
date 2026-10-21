# Support case handling

## Purpose

Show useful Agent interpretation inside an application whose code owns credit
eligibility and customer-facing claims.

## Ownership

- `flows/assess/` owns one bounded interpretation and its closed proposal contract.
- `flows/check-credit/` owns account consistency checks, fixed
  duplicate-credit policy and deterministic replies. It receives account facts
  and a proposal only.
- `flows/resolve/` coordinates assessment and eligibility checks, rejects conflicting
  account identities before paid work, and owns the typed Support case page.
  `bindings/support.ts` selects both focused methods.
- `bindings/agent.ts` and the declared ACP dependency supply the assessor's
  ordinary Agent implementation through `jig.ts`'s contract-keyed default. The
  explicit client is editable operator configuration, not a Jig default.
- `fixtures/` contains synthetic account records and customer requests.
- `test/` owns pure policy and view checks. The public walkthrough belongs
  in `docs/jig/guide/support-case.md`.

- `bindings/agent.ts` owns the inline ACP client/model/turn/session policy.
  The assessor keeps its small private response schema beside its Agent call.
  Complete proposal validation and the credit checker’s policy remain
  independent.

## Local Contracts

- `jig.ts` owns the complete default invocation:
  `binding:support --input @fixtures/duplicate.json --timeout 2m`. Ordinary
  `jig run` uses reviewed defaults and returns its result on stdout without a
  packet. The README and guide offer optional `--out` to save the record in a
  new retained destination. They never promise an automatic `result.json`.
  Explicit targets bypass defaults. Display choices remain operator options.

- Account facts come from the authenticated application caller, never customer
  text. Charges have unique IDs, are chronological, and use USD cents.
- Only a later settled charge matching an earlier settled invoice and amount can
  qualify. The requested amount must equal that charge and be at most 5000
  cents.
- Model text cannot change policy or supply the customer-facing reply.
- Return eligibility only. No payment, message, credential, network fetch, or
  repository-specific integration belongs in the example. Any downstream action
  owns current-state checks, authorization, and idempotency.
- `done` includes an eligible, ineligible, or manual-review decision. Assessment
  inability remains `blocked` or `limit`. Errors and cancellation never replay.
- Each Flow is self-contained. `FLOW.contract.json` describes the shared
  boundary. Code owns relational checks and semantic policy, not Jig.

- The coordinator’s `dashboard.ts` projects a small typed state into one
  Support case page with request, relevant charges, provisional
  interpretation, checked decision and draft reply. Its bounded charge excerpt
  always includes the proposed charge and a matching earlier payment. Child
  views remain independently useful through the optional canonical `progress`
  channel. FLOW entrypoints own scoped publishers, activity and failure
  notices.

  Pure methods retain their exact results and policy. The existing reporting
  profile serves terminal and web without display code. Tests validate
  complete escaped items, provisional meanings and evidence links.

## Work Guidance

- Scope cap: one request, one assessment and one fixed eligibility policy.
  Flow count is not capped. Keep supplied records and final results. Live
  billing, duplicate delivery, transaction recovery, and interactive update
  intake need their own teaching case.
- Keep the composed methods small, orthogonal and readable. Add complexity only for a useful consumer task.
- Do not equate an eligible charge with correct interpretation of customer intent,
  or deterministic adversarial tests with model injection resistance.

## Verification

- `bun test examples/support-case/test` checks pure policy and views.
- The release gate repeats these tests against the freshly packed SDK.
- `bun test packages/jig/test/host/installed-support-case.test.ts` checks ordinary
  installed composition with a deterministic assessment task. Native qualification,
  live Agent judgment and untested fault windows remain separate.

## Child DOX Index

- None.
