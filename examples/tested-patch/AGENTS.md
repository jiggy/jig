# Tested project patch

## Purpose

Teach one primary lesson: an Agent's proposed source change becomes a patch
only after executed checks and independent acceptance.

## Ownership

- `flows/project/` captures one small project, invokes one repair specialist,
  checks returned evidence, and writes final deliverables.
- `flows/repair/` owns proposal validation, at most two Agent calls, reviewed
  command execution, and independent checks of collected output.
- `bindings/` selects the repair leaf and fixed Bun test/CLI commands.
- `fixtures/log-report/` contains an intentionally defective CLI and its tests.
- `test/` owns deterministic application checks. The public guide owns the walkthrough.

## Local Contracts

- Complexity cap: one issue, one specialist, one final patch/evidence result.
  Batch scheduling, resident monitoring, recording, and checkpoints are outside
  this example. A separate example must justify its own lesson before adding them.
- The root alone receives read-only source and writable deliverables. Accept
  16 UTF-8 files totaling 64 KiB and at most eight existing editable JS/TS source paths.
- The leaf takes JSON files and fixed cases. Its `agent` slot calls an ordinary
  Agent Flow; `tests` and `cli` use independently reviewed command grants.
  Operator selection belongs in `bindings/agent.ts`; `jig.ts` supplies that
  contract-matched default. It receives no attachments.
- Optional `restoreCorrections` requests Run-scoped native retention for one
  correction after checks, never overlapping Agent and command execution.
  Retention needs a separate grant; unavailability blocks a needed correction,
  never triggers replay or a fresh-call fallback. Evidence receipts are not
  cross-Run continuation handles.
- The reusable leaf can publish optional phase records. The root forwards an
  explicitly requested progress writer to it without interpreting progress as
  acceptance, retaining messages, or publishing partial patches. The leaf
  explicitly closes that writer on normal completion. Batch and
  observation checks live in Jig's private repair fixture.
- Reproduce an independent baseline mismatch before an Agent call. The reviewed
  `maxProposals` setting is 1 or 2 (default 2); 1 stops after its first checked
  proposal, while 2 permits one correction. Both use identical acceptance rules;
  every proposal and evaluation uses the original files and cases.
- Require every stat-sized attachment file to be read completely, and reject
  wholly empty captured projects before dispatch.
- Repository tests can be interfered with by candidate code. Independent assertions
  compare collected CLI output and exit without importing code or trusting pass flags.
- Validate base/candidate and command identities before constructing patches from
  replacement text. Compare decoded JSON evidence by content, independently of
  object prototypes. Only accepted evidence earns `review.patch`; failed proposals
  remain inspectable. Do not apply or merge anything.
- Cancellation, deadlines, uncertainty, unavailable support, and cleanup failures
  propagate without retries. Final file delivery does not promise interruption recovery.
  Repair failure details keep method attempts alongside any supplied underlying
  `operationDetails`; neither establishes a successful check.

- Package-local `dashboard.ts` projections offer Repair, Checks and root Evidence through the
  optional canonical `updates` channel. FLOW entrypoints own scoped publishers,
  activity and failure notices; pure methods retain their exact results and policy.
  The existing user-updates profile serves terminal and web without display code.
  Tests validate complete escaped items, provisional meanings and evidence links.
- The root writes complete `goal.txt` only after returned evidence validates.
  Its Checks verdicts are independent; worker Checks remain provisional and may
  reference only their own calls. The private `progress` phase protocol remains
  separate from the optional `updates` dashboard channel.

## Work Guidance

- Keep project-specific policy here and operator choices on the host.
- Preserve evidence checks and source bounds when simplifying the teaching path.
- Use ordinary public SDK calls and self-contained Flows. Keep application-local
  Flow dependencies as workspace references within a downloaded copy.

## Verification

- `bun test examples/tested-patch/test` checks bounded proposals, independent
  evidence, file capture, final publication, and failure propagation.
- The release gate repeats application tests against the freshly packed SDK.
- Installed host tests exercise real contained commands with synthetic Agent
  responses; they do not establish live model quality.

## Child DOX Index

- None.
