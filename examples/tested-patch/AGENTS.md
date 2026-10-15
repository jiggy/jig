# Tested project patch

## Purpose

Teach one primary lesson: an Agent's proposed source change becomes a patch only
after executed checks and independent acceptance.

## Ownership

- `flows/project/` owns the short coordinator and typed Patch review page.
- `flows/read-project/` owns bounded source capture and reviewed check-set data.
- `flows/check-repair/` validates evidence identities and recomputes acceptance.
- `flows/export-patch/` formats supplied accepted review data and writes
  patches in its own output folder, imported at `deliverables/review`.
  Independent export treats supplied verdicts as caller claims. It never
  establishes acceptance.
- `flows/repair/` owns proposal validation, at most two Agent calls, reviewed
  command execution, and independent checks of collected output.
- `bindings/` selects the repair leaf and fixed Bun test/CLI commands.
- `fixtures/log-report/` contains an intentionally defective CLI and its tests.
- `test/` owns deterministic application checks. The public guide owns the
  walkthrough.

- `bindings/agent.ts` owns the inline ACP client/model/turn/session policy.
  `jig.ts` supplies that ordinary Agent through the contract-keyed default.

## Local Contracts

- `jig.ts` owns the complete default invocation:
  `binding:repair --input @issue.json --attach source=fixtures/log-report --timeout 5m`.
  Ordinary `jig run` uses reviewed defaults and receives a fresh temporary
  packet for its writable deliverables. The README and guide explain temporary
  cleanup and optional retained `--out` destinations without overwrite behavior.
  Explicit targets bypass defaults. Display choices remain operator options.

- Complexity cap: one issue, one specialist, one final patch/evidence result.
  Batch scheduling, resident monitoring, recording, and checkpoints are outside
  this example. A separate example must justify its own lesson before adding them.
- The root maps read-only source to `read-project` and writable output to
  `export-patch`. Neither the specialist nor checker receives attachments.
  Accept 16 UTF-8 files totaling 64 KiB and at most eight existing editable
  JS/TS source paths.
- The leaf takes JSON files and fixed cases. Its `agent` slot calls an ordinary
  Agent Flow. `tests` and `cli` use independently reviewed command grants.
  Operator selection belongs in `bindings/agent.ts`. `jig.ts` supplies that
  contract-matched default. The leaf receives no attachments.
- Optional `restoreCorrections` requests Run-scoped native retention for one
  correction after checks, never overlapping Agent and command execution.
  Retention needs a separate grant. Unavailability blocks a needed correction,
  never triggers replay or a fresh-call fallback. Evidence receipts are not
  cross-Run continuation handles.
- The reusable leaf can publish optional phase records. The root forwards an
  explicitly requested progress writer to it without interpreting progress as
  acceptance, retaining messages, or publishing partial patches. The leaf
  explicitly closes that writer on normal completion. Batch and observation
  checks live in Jig's private repair fixture.
- Reproduce an independent baseline mismatch before an Agent call. The reviewed
  `maxProposals` setting is 1 or 2 (default 2). 1 stops after its first checked
  proposal, while 2 permits one correction. Both use identical acceptance rules.
  Every proposal and evaluation uses the original files and cases.
- Require every stat-sized attachment file to be read completely, and reject
  wholly empty captured projects before dispatch.
- Repository tests can be interfered with by candidate code. Independent assertions
  compare collected CLI output and exit without importing code or trusting pass flags.
- `check-repair` validates base/candidate and command identities before
  `export-patch` constructs patches from replacement text. Compare decoded
  JSON evidence by content, independently of object prototypes. Only accepted
  evidence earns `review.patch`. Failed proposals remain inspectable. Do not
  apply or merge anything.
- Cancellation, deadlines, uncertainty, unavailable support, and cleanup
  failures propagate without retries. Final file delivery does not promise
  interruption recovery. Repair failure details keep method attempts alongside
  any supplied underlying `operationDetails`. Neither establishes a successful
  check.

- The coordinator’s `dashboard.ts` projects a small typed state into one Patch
  review page with issue, scope, independently validated comparison and files
  through `updates`. Extracted methods offer independent views through
  `progress`. The repair specialist keeps provisional Repair and Checks views
  through `updates`. FLOW entrypoints own scoped publishers, activity and
  failure notices.

  Pure methods retain their exact results and policy. The existing reporting
  profile serves terminal and web without display code. Tests validate
  complete escaped items, provisional meanings and evidence links.
- The exporter writes complete `goal.txt` only after the coordinator receives
  accepted evidence. The root comparison uses recomputed checker verdicts.
  Worker Checks remain provisional and may reference only their own calls. The
  private `progress` phase protocol remains separate from the optional
  `updates` dashboard channel.

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
  responses. They do not establish live model quality.

## Child DOX Index

- None.
