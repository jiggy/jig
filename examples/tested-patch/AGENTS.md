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
  Batch scheduling, monitoring, broadcasts, recording, and checkpoints are outside
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
- The reusable leaf can publish optional phase records for other consumers.
  This introductory root connects no monitoring channels. Batch and observation
  checks live in Jig's private repair fixture; they reuse this leaf and evidence
  helpers without making the public walkthrough a batch application.
- Reproduce an independent baseline mismatch before an Agent call. Permit at most
  one correction; every proposal and evaluation uses the original files and cases.
- Read attachment files from explicit offsets, require every stat-sized file to
  be read completely, and reject wholly empty captured projects before dispatch.
- Repository tests can be interfered with by candidate code. Independent assertions
  compare collected CLI output and exit without importing code or trusting pass flags.
- Validate base/candidate and command identities before constructing patches from
  replacement text. Only accepted evidence earns `review.patch`; failed proposals
  remain inspectable. Do not apply or merge anything.
- Cancellation, deadlines, uncertainty, unavailable support, and cleanup failures
  propagate without retries. Final file delivery does not promise interruption recovery.

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
