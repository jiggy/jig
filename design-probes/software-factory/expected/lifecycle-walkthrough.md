# Tabletop lifecycle walkthrough

This is ordering for review, not a protocol serialization.

## Project admission and Service activation

1. Jig captures `jig.ts`, shallow source membership, declarations, package
   trees, schemas, descriptors, and static import closure.
2. It resolves each host capability and package revision, freezes the
   `reference-research` candidate set, and pins `semantic-choice` as the
   optional project ambiguity ranker.
3. It derives an exact Run or Service recipe—or exact unavailability—for every
   Binding and displays one semantic/authority delta. The initial unlocked plan
   also proposes `jig.lock`.
4. Aggregate apply publishes one immutable generation and Hook interval. It
   eagerly mounts ready `kanban` and `inbox-watcher` Service Bindings.
5. Kanban acquires the only board write lease, registers its exact export, and
   reports ready. The watcher acquires only a read-only inbox view, creates its
   watch, reports an empty export snapshot ready, and scans existing files.

## Stable file and atomic Event handoff

1. A new immediate Markdown file produces one or more filesystem observations.
   The watcher accepts only a regular bounded file whose stat and bytes remain
   unchanged across its settle interval.
2. It derives `submissionId = SHA-256(item || NUL || request)` and calls
   `journal.append` under an operation ID derived from that submission.
3. One Jig transaction commits the authenticated Event, append terminal result,
   matching Hook selection, and derived-Run outbox record.
4. Filesystem observation is at least once across watcher Mount generations.
   A repeat may create another Event, but it carries the same submission ID;
   the downstream Kanban `ensure` operation supplies domain idempotency.

## Hook-derived Spindle Run and card creation

1. The outbox allocates one triage Run for `(Hook revision, Event ID)` using the
   Hook's pinned source/target generation. The complete Event is immutable Run
   input and is validated against triage's schema.
2. Spindle launches externally through Run/1; Jig never imports its graph.
3. `OpenCard` calls the exact Kanban export. The Service serializes access and
   either creates revision 1 in `triage` or returns the identical existing card.
4. If that existing card is already beyond `triage`, the Run returns the
   declared `duplicate` outcome and never invokes the Router.
5. The root Router freezes its two actual edges and calls triage's explicit
   `choice` slot. Abstention advances the card to `blocked` and returns the
   declared blocked result.

## Gauntlet and the distinct Jig Resolver

1. The branch compare-and-sets `triage -> research` with strategy `gauntlet`.
2. Research calls `context.flows.call()` through the frozen
   `reference-research` candidate set. With two eligible revisions, Jig invokes
   the activation-pinned project Semantic Choice Binding once. Without the
   project `semanticChoice` field this exact call is `BINDING_AMBIGUOUS`; the
   local Router remains unaffected.
3. The chosen instruction-only child receives its own package resources and
   attachment-free Agent Binding. It does not inherit triage skills or the
   workspace. Triage validates the returned JSON/1 shape.
4. Each later phase first compare-and-sets the card revision, then calls the
   worker with only the relevant selected context:

   ```text
   implementation  focused-coding
   review          focused-validation
   revision        focused-coding
   verification    focused-validation
   ```

5. Agent provider projections contain only those named skill subtrees plus the
   Binding's fixed workspace/tool ceiling. The Spindle process has no matching
   workspace view. Every new Card returned by Kanban becomes explicit immutable
   graph state.
6. Verification completion advances `verification -> done`, then the Outcome
   returns card ID, strategy, and evidence.

## Majority Vote

1. The branch compare-and-sets `triage -> voting` with strategy
   `majority-vote`.
2. Three attachment-free analysts each select only `solution-design`. Parallel
   returns ordered results; an explicit join constructs the next state.
3. The card advances to `implementation`; one writable worker selects
   `focused-coding` and implements the synthesis.
4. The card advances to `verification`; a second worker selects only
   `focused-validation`. Completion advances the card to `done`.

Any domain-blocked Agent/child result takes the branch's explicit block Node,
which compare-and-sets the current card to `blocked` before returning the Flow
outcome. A later duplicate returns `duplicate` before routing. Simultaneous
Runs can both observe `triage`, but only one wins the first Kanban
compare-and-set and the loser cannot start Agent work.

## Root completion and update

A complete Spindle response is provisional until Jig closes child admission,
drives Agent, child Flow, Service invocation, projection, process, and sandbox
owners terminal or fenced, validates the result, and commits Run success.

Kanban rollout cannot shadow-activate two writers against the same board. The
old Mount drains and releases its write lease before the replacement mounts.
The watcher may overlap only if both generations remain read-only, but Hook
intervals and submission IDs still make duplicate behavior visible.

## Deliberate repair

Missing research resolution leaves the original operation and Run terminal.
An operator-started `create-missing-flow` uses its pinned repair Agent and may
write only inert staging files. A later reviewed generation and new submission
are required; neither the old Event nor old Run is healed or replayed.
