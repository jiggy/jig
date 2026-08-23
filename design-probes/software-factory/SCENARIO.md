# Scenario: one ticket through a software factory

This is a tabletop story, not an invocation guide.

## Admitted starting point

One reviewed project generation contains:

- a mounted Deno `inbox-watcher` Service with read-only inbox access and one
  exact Journal dependency;
- a mounted single-writer `kanban` Service with a read-write board attachment;
- one Hook revision from the watcher's Event to the `triage` Run Binding;
- one Spindle triage package with two fixed outgoing strategy Flows;
- distinct Agent Run Bindings for attachment-free analysis, writable factory
  work, and staging-only repair;
- one exact Semantic Choice provider selected both through triage's local
  `choice` slot and through the project's optional `semanticChoice` ranker;
- two approved research Flow Bindings in one frozen candidate set; and
- an operator-started repair Flow with only a staging workspace.

The missing `jig.lock` is allowed only for this fresh unlocked probe. The first
real plan would propose a complete lock and admission generation together.

## File to Event to Run

1. Jig eagerly mounts both ready Service Bindings for the admitted generation.
   The watcher opens the filesystem watch before declaring readiness, then
   scans existing immediate `*.md` files so the scan/watch boundary has no
   silent gap.
2. A person writes `inbox/TICKET-001.md`. After one settle interval with the
   same size, modification time, and bytes, the watcher derives a submission ID
   from the item name and content.
3. The watcher calls its exact Journal slot. The Journal atomically commits the
   Event, effect result, matching Hook selection, and derived-Run outbox entry.
   Filesystem notifications are at least once across Mount restart, so the
   stable submission ID—not an exactly-once watcher claim—is the domain
   idempotency key.
4. The Hook-derived `triage` Run receives the exact immutable Event. The Hook
   does not execute a callback, read the file, or map its payload; its complete
   connection is the admitted `(watcher source, Event type) -> triage Binding`
   tuple.
5. Triage calls `kanban.ensure`. Identical duplicate watcher Events converge on
   `card-<submissionId>` in stage `triage`; different content under one ID is a
   conflict. A later duplicate that finds the card beyond `triage` returns the
   declared `duplicate` outcome before routing. Card state is an ordinary JSON
   file under `kanban/cards/`.

## Triage and processing

1. Spindle presents only the Router's actual `gauntlet` and `majority-vote`
   edges to the exact `choice` capability. That local choice contributes no
   parameters, package discovery, or authority.
2. The selected branch moves the card by revision-checked compare-and-set
   before starting each material phase:

   ```text
   Gauntlet       triage -> research -> implementation -> review
                          -> revision -> verification -> done

   Majority Vote  triage -> voting -> implementation -> verification -> done
   ```

   Every domain-blocked edge first moves the same card to `blocked`. Two Runs
   that concurrently observe `triage` may both route, but only one can win the
   first revision comparison; the other performs no Agent work.
3. Gauntlet's research Node calls the `reference-research` Flow slot. Jig
   deterministically filters its two approved candidate Bindings, then uses the
   project `semanticChoice` Binding only because both remain eligible. The
   selected instruction-only child runs with its own package and Agent context;
   triage validates the returned JSON/1 `Reference` shape itself.
4. Removing `semanticChoice: "semantic-choice"` would not affect the Spindle
   Router because it still has the explicit `choice` slot. It would make this
   two-candidate research call terminate `BINDING_AMBIGUOUS`. With only one
   eligible research candidate, removing it would change nothing.
5. Agent calls select role context explicitly. Voters receive only
   `solution-design`; build/revision/synthesis receive only `focused-coding`;
   review and verification receive only `focused-validation`. Omission means
   no Flow-local skill. Selection projects context but does not prove Agent
   compliance.
6. Spindle threads one immutable state record containing the Event, Kanban
   card revision, and deliberate results. Parallel voters receive the same
   pre-fork state, return ordered results, and an explicit join constructs the
   next state. Jig never maps graph values or reads the board as graph memory.
7. The terminal Flow result includes the card ID. Success can commit only after
   child Flow, Agent, Kanban effect, projection, process, and sandbox owners
   quiesce or are fenced and the complete result passes its schema.

## Distinct missing-repair path

If deterministic research filtering leaves zero candidates, `flow/call` and
the triage Run terminate `BINDING_MISSING`; this is not the domain `blocked`
outcome and does not silently invoke repair. An operator may start
`create-missing-flow` with the durable diagnostic. Its Agent writes only to
`repair-staging/`. Normal capture, plan, review, and apply are required before
a later Event or deliberate new root attempt can use the proposal.

## What the scenario does not claim

The Kanban Service safely serializes board mutations, but all ticket builders
still share one writable `workspace/`. This probe therefore processes only one
active ticket at a time; a concurrent factory needs an allocator, isolated
workspaces, or enforced serialization. It also does not define a Kanban GUI,
Git/worktree policy, exactly-once filesystem observation, final SDK spelling,
or automatic repair.
