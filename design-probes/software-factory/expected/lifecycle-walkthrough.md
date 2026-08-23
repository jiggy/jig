# Tabletop lifecycle walkthrough

This is ordering for review, not a proposed trace or protocol serialization.

## Project admission

1. Jig privately captures `jig.ts`, the configured shallow source memberships,
   declarations, package trees, schemas, and static import closure.
2. It validates the exact package metadata, complete Hook tuple, Binding
   references, settings, attachment ceilings, contract triples, and source
   confinement without running Flow or Agent code.
3. It resolves each host-capability export and each package revision exactly.
   It freezes the ordered `reference-research` candidate Binding revisions and
   pins one project Semantic Resolver Binding.
4. Against one host-policy snapshot it derives one complete implementation
   recipe or exact unavailable reason for every Binding. Spindle and Deno are
   host Adapter selector tokens, never commands stored in this project.
5. It presents one semantic and authority delta. In unlocked mode it also
   proposes the initial complete `jig.lock`.
6. A digest-bound compare-and-set apply publishes one immutable generation and
   opens the Hook revision at one exact Journal position. Merely adding any
   file above did not activate it.

## Producer Run and atomic Event handoff

1. A frontend starts `inbox-producer` with a new project-local submission key.
   Jig validates JSON/1, pins the exact Binding/generation, allocates one Run,
   then validates `input.schema.json`.
2. The exact Deno recipe performs its independently fenced preparation and
   final launch lifecycles. The implementation receives only its read-only
   `inbox` view and exact Journal effect slot.
3. It reads the named item and calls `journal.append` under one stable owned
   effect operation. The request contains only type, data, and subject.
4. One Jig transaction commits the authenticated Event, append terminal
   result, matching Hook selection, and derived-Run outbox record. While the
   same owner lifetime remains live, a duplicate request with the same
   operation ID and digest returns the same Event. If channel or process loss
   loses that owner, v1 cannot resume it to retry; the committed Event and Hook
   selection nevertheless remain facts.
5. The producer's terminal response is buffered, child admission closes, and
   all owned effects/resources quiesce or are fenced before Run success may
   commit. Event commitment is not rolled back by later producer failure.

## Hook-derived Spindle Run

1. The outbox allocates or returns exactly one triage Run for
   `(Hook revision digest, Event ID)`, using the Hook's already-pinned target
   and generation. The complete Event becomes immutable Run input.
2. Jig validates that Event against the triage package schema. A later project
   generation cannot retarget this selected pair.
3. The exact Spindle recipe prepares and launches under the same two-owner
   Backend discipline as every code-backed package; Jig never imports the
   graph in-process.
4. On the root Router visit, Spindle freezes its two actual edges in order and
   calls the exact `choice` effect. Semantic Choice may return only
   `gauntlet`, `majority-vote`, or abstain. Spindle maps the selected local ID
   to the already connected Flow; abstain maps deterministically to `blocked`.

## Local Gauntlet and distinct Jig Resolver

1. If `gauntlet` wins, its first `FlowCall` asks Jig to resolve the
   `reference-research` slot. The actual Event and call intent are fixed by
   that operation; the project does not rewrite them.
2. Jig freezes the owner generation's two approved exact candidate revisions,
   then filters input schema, readiness, authority, budget, recursion, trust,
   and liveness. It never gives raw catalogue packages to the ranker.
3. With two remaining candidates, Jig starts one journaled child Semantic
   Choice operation using its project-pinned Resolver. The returned ID is
   validated, committed, and compare-and-set into the still-empty resolution
   field once. The selected child Run is allocated atomically before dispatch.
4. The child gets only its own Binding, instruction recipe, input, and package
   skill tree. It does not inherit triage's workspace or focused-validation
   skill; its instruction recipe uses the attachment- and tool-free
   `analysis-agent`.
   Its completion returns to the Spindle `FlowCall` node.
5. The mock does not yet define how Spindle retains both immutable root input
   and the returned research value for the build node. The same unresolved
   dataflow seam applies to collecting three vote results for synthesis. These
   nodes cannot be called a composable implementation until Spindle provides a
   minimal runner-local value/state rule.
6. Gauntlet's Agent nodes then invoke the exact `agent` slot. The Spindle owner
   has no workspace attachment. For each owned operation Jig projects only the
   workspace fixed by `work-agent` plus this triage package's skills, without
   modifying provider-native directories, and revokes both with that Agent
   owner.
7. Subject to that unresolved Spindle seam, the fixed build, review, revision,
   and verification nodes finish. The
   Majority-Vote branch follows the same ownership rules but never invokes the
   research slot.

## Root completion order

For either branch, a complete Spindle terminal response is only provisional:

1. buffer the response;
2. close new child admission;
3. drive all Agent, child Flow, effect, process, skill projection, and sandbox
   owners to terminal or fenced state within fixed bounds;
4. validate the complete normal result when a result schema exists; and
5. only then commit Run success.

Outstanding or unprovable cleanup prevents success even if the graph returned
`done`.

## Deliberate new attempt after repair

When research resolution failed missing, an operator may start
`create-missing-flow` with a new submission key. Its exact instruction recipe
pins `repair-agent`, and Run admission acquires that exact provider generation
or fails without rebinding. The Flow may write only `repair-staging/`.

After normal review copies or recreates the desired proposal in project source,
a new plan/apply may publish a later generation. A newly submitted ticket or
deliberate new root attempt may use it. The old Event, Hook-derived Run, and
failed resolution remain unchanged.
