# Tabletop failure walkthroughs

These are expected architectural outcomes, not executed tests.

## Producer input or attachment failure

- Malformed or out-of-bounds JSON/1 creates no Run. A valid value with a
  missing or invalid `item` allocates the idempotent root Run, then terminates
  `INVALID_INPUT` before launch.
- A path escape, symlink, special file, or missing item cannot widen the
  read-only inbox view. The Run fails visibly; no Journal append occurs.
- Reusing the root submission key with changed input fails
  `SUBMISSION_CONFLICT`; identical input returns the original Run.

## Journal authority and crash boundaries

- Publishing any type outside the one admitted URI is denied before append.
  The Flow cannot forge `source`, position, ID, commit time, Run, or
  correlation metadata.
- Cancellation or crash before append commit produces no Event. After the
  atomic transaction commits, the Event and Hook selection remain facts even
  if the producer response is lost or the producer Run later fails.
- Retrying the same append operation and request digest returns the same Event;
  a different operation ID intentionally creates another Event.

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
  decision, but v1 does not recover a crashed Spindle continuation to create
  one.

## Agent and skill failure

- If the exact Agent provider generation pinned for an operation is unavailable,
  that operation fails without selecting another provider or ambient default.
- Triage Agent operations receive only the triage package's exact admitted
  `skills/` tree, read-only and owner-scoped. `worker` additionally has its
  fixed workspace; parallel `analyst` voters have no attachment or tools. The
  Spindle caller has no overlapping workspace view. Research child Flows do
  not inherit either and use `analysis-agent`; repair gets only its staging
  Agent and direct instruction-Run attachment. Collision-free projection
  failure prevents provider work rather than copying into native skill roots.
- Verification and synthesis explicitly request `focused-validation`, but Jig
  records only projection. Agent selection or compliance is not a safety fact.
- Cancellation closes Agent admission and revokes host-native projections and
  write leases. An already dispatched external action may be terminal or
  `UNCERTAIN`; it is never silently replayed.

## Open `flow/call`: one, many, zero, and uncertainty

- Deterministic filtering happens before semantic ranking. One eligible
  approved candidate selects directly without Agent use.
- Several eligible candidates use the one activation-pinned project Semantic
  Choice Binding or terminate `BINDING_AMBIGUOUS` when none is configured. The
  local Spindle route is never consulted.
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

## Spindle crash, cancellation, and cleanup

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
- Two simultaneous tickets are outside this probe. They must not share the
  writable workspace without a future explicit allocator, isolated Bindings,
  or serialization policy; this tree proves none of those.
