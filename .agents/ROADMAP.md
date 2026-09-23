# Roadmap — capability compounding under control

Make useful methods easier to inherit and combine, and give their consumers
more power under meaningful direction. This roadmap orders outcomes beneath
the [product compass](product-compass.md), not subsystems or release dates.

## Guiding principles

The order serves three commitments throughout development.

- **Deliver useful work at every step.** Each outcome needs a compelling
  example that an independent consumer can reproduce from public artifacts.
- **Keep the promises intact.** FLOW independence, operator-held authority,
  understandable control, and honest failure apply from the first outcome.
- **Earn the next increment.** Prefer making existing power easier to adopt
  and compose, with less configuration and lifecycle knowledge, before adding
  another abstraction. Build on verified work; add only what the next
  demonstrated need requires. Architectural purity is not an outcome, and the
  roadmap does not authorize every mechanism that might support one.

## Outcome order

These outcomes grow from individual use toward capability shared across
applications. Existing evidence determines where work begins; completed
foundations do not need to be rebuilt.

1. **Make useful work easy to adopt.** A new user can obtain, understand,
   authorize, and run a useful Flow, inspect its result, and stop owned work.
   Authoring and modifying it should be practical without private knowledge.

2. **Combine and reuse capable specialists.** Independent authors demonstrate
   useful gains through composition and reuse across applications. Prove that
   a portable Flow works outside Jig through an independent implementation.
   Keep explicit composition excellent; dynamic choice must earn its place.

3. **Deliver a useful software factory.** An authorized issue becomes an
   inspectable patch with tests and independent evidence; people retain merge
   and release authority. Demonstrate a material advantage over one capable
   coding Agent with repository access, CI, and human review on the dimensions
   claimed. Keep software-development concepts in the application.

4. **Let others build further capability.** Independent builders adapt and
   share methods in useful applications beyond the factory. Turn proven
   application structures into user-owned Starters—ready-to-adapt examples.
   Let their actual needs determine further host and ecosystem capabilities.

## Next milestones

The current foundation includes exact Flow composition, contained project
commands, channels, root file delivery, checkpoints, ordinary HTTP and ACP Agent
Flows, continuing conversations, optional native restoration, and an
application-owned handoff. These are available paths with different levels of
qualification, not milestones to rebuild.

### 1. Deliver a coherent installed alpha

Bring the published FLOW, Jig, and ordinary Agent packages into alignment with
their current source and public guidance. Use the existing candidate, release,
and host-conformance gates; qualify each advertised native-client behavior with
installed artifacts rather than protocol fixtures alone.

Finish when a new installation can follow the public quickstart, admit an
ordinary Agent package, run a useful Flow, inspect its evidence, and cancel it.
Published package identities and claims must match the tested artifacts. A
source-only demonstration is not completion.

### 2. Make project repair independently usable

Give a fresh builder the published artifacts and public instructions to adapt
the existing repair method to a different small Bun project. Keep selected
source and acceptance checks explicit, candidate commands contained, and the
original project unchanged.

Finish when they obtain a reviewable patch with executed tests and independent
acceptance evidence, understand a deliberately failed check, and cancel work
without private instructions or platform edits. Correct friction at its owning
product or application layer. This tests adoption and reuse, not a claim that
the method outperforms every coding Agent.

### 3. Deliver a small software factory

Compose the proven repair and checking methods for several authorized issues.
Keep bounded attempts, inspectable patches, honest unsuccessful outcomes, and a
human merge gate. Let a second builder adapt the application through its
intended configuration.

Finish with a useful application and a bounded comparison against one capable
coding Agent plus tests and human review. Select the claimed advantage and
metric beforehand; a tied or unfavorable result limits the claim, not further
useful product work.

## Work alongside the milestones

Preserve outside-Jig interoperability as a separate FLOW proof: an independent
implementation runs an unchanged package through public contracts. Fix
concrete release, CLI, authority, and cleanup defects as found. Keep native
workspace tools, general schedulers, public locks, provider frameworks,
workspace services, event buses, automatic ticket intake, and Kanban outside
the critical path until an application earns them.

A blocker in one authorized outcome does not stop independent work. Commit
stable slices and record owner-actionable blockers in `.tmp/current-blockers`.

## Advancing

Use the doctrine's [decision test](doctrine/design-judgment.md#the-decision-test)
before expanding scope. Revisit this order when evidence supports a simpler path.
Deferred product tasks live in [`management/inbox`](../management/inbox/).
Current execution plans, status, evidence and blockers belong in `.tmp/`.
