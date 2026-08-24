# Tabletop failure walkthroughs

These are expected architectural outcomes, not executed tests.

## Owned Hook source input or activation failure

- Nested, escaping, symlinked, special, oversized, empty, or unstable files do
  not become submissions and cannot widen the read-only inbox view.
- The registered source creates its watch before readiness and initial scan. A
  file changed during the scan is still queued for observation; a concurrent
  delete simply leaves no submission.
- Read authority, source preparation, or readiness failure prevents the Hook
  revision from activating. Source loss closes new publication admission;
  restart may scan stable files again under the same source occurrence keys.

## Journal authority and crash boundaries

- Publishing any type outside the source registration is denied before commit.
  The source cannot forge another identity, position, ID, commit time, Run, or
  correlation metadata.
- Cancellation or crash before Journal commit produces no Event. After the
  atomic transaction commits, the Event and Hook selection remain facts even
  if the source acknowledgement is lost or its lifetime later fails.
- Retrying the same source revision and path/content fingerprint returns the
  same Event. A later Hook revision may create another authenticated Event for
  the same file; both fingerprints converge at Kanban.

## Kanban idempotency and conflicts

- `ensure` maps one submission ID to one deterministic card. Reusing it with
  different title/request data is `submission-conflict`.
- A later duplicate that finds the identical card beyond `triage` returns the
  declared `duplicate` outcome without routing.
- Every transition requires the exact current revision and one permitted next
  stage. Simultaneous triage Runs may both observe `triage`, but one loses the
  first transition with `revision-conflict` before it can perform Agent work.
- Kanban serializes one Mount's writes and atomically renames complete card
  files. Jig denies concurrent writable Mounts over the same board; update
  drains the old writer before replacement.

## Hook duplicate, invalid input, and revocation race

- Duplicate delivery of one `(Hook revision, Event ID)` returns the same
  derived triage Run; it never starts a second graph.
- The Hook passes the complete Event unchanged. If that value fails triage's
  schema, the already allocated derived Run terminates `INVALID_INPUT` and the
  Hook does not map, filter, or reselect it.
- A pair selected before revocation still gets its unique Run. If revocation
  closes dispatch first, that Run is terminal and non-dispatchable. Events
  after the Hook interval closes do not select it, and there is no replay.

## Local Router failure

- Semantic Choice sees only the two real edge IDs and their descriptions. A
  duplicate candidate input or unknown result fails the choice operation; it
  cannot become a graph edge by string coincidence.
- `abstain` follows the code-declared `blocked` edge. Confidence, route
  arguments, executable plans, installation, or permission decisions do not
  exist in the contract.
- If choice dispatch occurred but the result cannot be proven, the operation
  and owning Run become uncertain or fail according to exact effect rules. The
  same Router visit never asks again. A later graph visit would be a distinct
  decision, but v1 does not recover a crashed Sley continuation to create
  one.

## Agent and skill failure

- If the exact Agent provider generation pinned for an operation is unavailable,
  that operation fails without selecting another provider or ambient default.
- Triage Agent operations receive only their explicitly selected package-local
  skill subtrees, read-only and owner-scoped; omission means none. `worker`
  additionally has its fixed workspace; parallel `analyst` voters have no
  attachment or tools. The
  Sley caller has no overlapping workspace view. Research child Flows do
  not inherit either and use `analysis-agent`; repair gets only its staging
  Agent and direct instruction-Run attachment. Collision-free projection
  failure prevents provider work rather than copying into native skill roots.
- Voters select `solution-design`; implementation calls select
  `focused-coding`; review and verification select `focused-validation`. The
  instructions request the same skill, but Agent compliance is not a safety
  fact.
- Cancellation closes Agent admission and revokes host-native projections and
  write leases. An already dispatched external action may be terminal or
  `UNCERTAIN`; it is never silently replayed.

## Open `flow/call`: one, many, zero, and uncertainty

- Deterministic filtering happens before semantic ranking. One eligible
  approved candidate selects directly without Agent use.
- Several eligible candidates use the one activation-pinned project Semantic
  Choice Binding or terminate `BINDING_AMBIGUOUS` when none is configured. The
  local Sley route is never consulted.
- Zero eligible candidates terminates the `flow/call` and owning Run with
  `BINDING_MISSING`. It is not converted into the Flow's domain `blocked`
  outcome and does not sleep, reroute, or invoke repair automatically.
- An unknown Semantic Choice candidate ID fails. A committed selection is
  reused. Unprovable ranker dispatch makes the parent operation uncertain and
  never reranks. Provider loss after selection fails against that pin rather
  than substituting the other candidate.

## Missing-Flow repair is not recovery of the old Run

1. The durable missing diagnostic names the slot, actual intent, owner, frozen
   candidate evidence, and reasons.
2. An operator deliberately starts `create-missing-flow`. It is not a child of
   the failed operation and receives no capability to fill its resolution.
3. Its Agent may create and test only an inert proposal under
   `repair-staging/`. Direct edits to active source, `jig.lock`, host policy, or
   `.jig` are outside its projection.
4. Normal capture, plan, review, and compare-and-set apply are required before
   a proposed Flow can become an approved candidate.
5. The prior Hook occurrence and triage Run stay terminal. The operator starts
   a new root attempt or commits a new Event deliberately; Jig never heals or
   replays the old work.

The probe intentionally excludes `WAITING_BINDING`: operation-scoped delayed
first binding across admission generations is deferred from v1. Maintenance
repairs desired state and a deliberate new attempt uses it.

## Sley crash, cancellation, and cleanup

- EOF before a complete root response loses the Run. Jig does not infer an
  outcome, restore the graph frame, reroute, or switch to instructions.
- Cancelling the host-originated live `flow/run` request on its current channel
  closes triage's child admission and drives child Flows, Agent effects,
  processes, projections, and sandboxes child-first to terminal or fenced state
  within fixed bounds. A public cancellation operation by durable Run ID is not
  specified.
- A syntactically valid `done` received while owned work remains live cannot
  commit success. Uncooperative cleanup makes the owner failed or lost.
- After coordinator crash, stale sandboxes are enumerated by durable container
  identity and killed, fenced, or quarantined before admission reopens. The
  project never chooses a weaker Backend.

## Project change, readiness, and concurrency boundaries

- Adding a Flow, Binding, Hook, skill byte, or candidate changes only pending
  desired state until aggregate plan/apply. Existing Runs retain their pinned
  generation.
- A missing/ambiguous Adapter, unsatisfied native constraint, or unenforceable
  Backend admits an otherwise structurally valid Binding as unavailable. It
  cannot run or enter Resolver candidates, and later host repair requires a
  reviewed generation.
- Missing `jig.lock` works only in unlocked bootstrap; locked mode rejects it.
- The board can hold concurrent cards, but two builders must not share the
  writable workspace without an allocator, isolated Bindings, or enforced
  serialization; this probe processes only one active ticket.
