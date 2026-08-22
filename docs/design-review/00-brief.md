# Jig + FLOW architecture review brief

This is a review input, not a proposed architecture. It freezes the problem so
that later criticism cannot silently change the goalposts.

## Product thesis

FLOW should let a person publish an agent-readable procedure with the least
possible ceremony and, when needed, add an exact executable or a long-lived
service implementation. Jig should host those packages safely, resolve missing
pieces, and let projects own their policy without imposing one application
model or one runner.

## Required qualities

1. **Minimal author surface.** A simple Flow must remain close to a skill: one
   obvious document, ordinary files, and no mandatory contract or graph DSL.
2. **No privileged runner.** Caskada, Cordis, imperative programs, and other
   runtimes cross the same portable boundary.
3. **Dynamic yet inspectable composition.** A Flow may request work by intent;
   deterministic filtering, explicit bindings, and recorded selections prevent
   semantic routing from becoming hidden control.
4. **Useful in incomplete environments.** Missing dependencies become explicit,
   diagnosable, repairable states. Semantic reasoning may help, but the host must
   behave correctly without an Agent.
5. **Deep extensibility.** Long-lived, stateful, multi-operation integrations
   must be possible without forcing their machinery on ordinary one-shot Flows.
6. **Lifecycle correctness.** Processes, child runs, listeners, registrations,
   sessions, and files have owners and deterministic cleanup.
7. **Honest security.** Untrusted executable code is denied by default; every
   claimed restriction reports whether it is enforced, mediated, advisory, or
   unavailable.
8. **Open portability.** Git, npm, OCI, local folders, and indexes may distribute
   packages. No mandatory central registry or ownerless global namespace.
9. **User ownership.** Installed source is visible and directly editable.
   Updates preserve local intent without a persistent runtime patch overlay.
10. **General purpose.** Task, Kanban, Git, worktree, GUI, and software-factory
    semantics belong to projects or starters, not the kernel.
11. **Agent-native, not Agent-dependent.** Agents enhance selection, repair, and
    execution; deterministic checks and exact execution work without one.
12. **Files are an authoring medium, not Jig's ontology.** Jig may host GUI,
    network, and service applications; it is not limited to inbox workflows.

## Explicit non-goals for the portable core

- A universal graph representation or mirrored runner state.
- Transparent import of arbitrary in-process objects across language/process
  boundaries.
- Exactly-once distributed execution.
- Silent replay of an operation whose completion is unknown.
- Implicit mid-run provider rebinding.
- A YAML expression, mapping, policy, or workflow language.
- Universal crash-resumption of arbitrary runner internals in the first stable
  release.
- A sandbox promise that a backend cannot actually enforce.

## Decisions that must be earned, not assumed

- Package entrypoint and runtime selection, including what a shebang can
  normatively mean (POSIX does not itself standardize `#!`).
- The smallest one-shot protocol and whether events, traces, and host effects
  are core operations or profiles.
- Whether long-lived Services ship beside Run/1, and exactly how their versions
  and conformance claims relate.
- Which lifecycle concepts are public, SDK-only, protocol-visible, or internal.
- The permission/grant vocabulary and executable sandbox backend contract.
- The semantics of facts, events, traces, hooks, effects, environmental inputs,
  retries, idempotency, cancellation, and scheduler deadlocks.
- Project-local configuration and reusable configured instances of a Flow.
- Flow discovery, binding, selection caching, missing-dependency repair, and
  lock/provenance records.
- Mutable source, immutable active revisions, reconciliation, updates, and
  rollback.
- The minimum viable Jig kernel versus optional official components/starters.

## Evaluation criteria

Every proposal must be scored against these criteria and state its failure
conditions:

1. Semantic and conceptual economy.
2. Independent implementability and conformance testing.
3. Deterministic behavior under retries, crashes, cancellation, and concurrency.
4. Least-authority security and truthful portability.
5. Fault tolerance without invisible self-modification.
6. Ecosystem adoption and source-level ergonomics.
7. Scale to many packages, concurrent runs, long-lived providers, and multiple
   hosts.
8. Ability to evolve without freezing premature abstractions.

## Required adversarial scenarios

The final design must give a concrete outcome for at least these cases:

1. A `FLOW.md`-only package is invoked on a host with no Agent configured.
2. A `flow.ts` uses Deno-only imports while the host has only Bun.
3. A child request has two semantically plausible installed providers.
4. No matching child Flow exists; an Agent is and is not configured.
5. An effect succeeds externally, then the component or host crashes before it
   receives the response.
6. Cancellation arrives while child Runs and subprocesses are active.
7. Two mutually dependent long-lived providers synchronously call each other.
8. A mounted provider crashes while consumers hold pinned bindings.
9. An untrusted Flow directly opens the network or filesystem instead of using
   host effects.
10. A host cannot enforce a requested permission restriction.
11. A durable fact triggers a hook twice after restart.
12. A progress message is dropped.
13. Local source and upstream both edit the same behavior during an update.
14. An upstream update is textually mergeable but semantically invalidates a
   local customization.
15. A project wants two differently configured uses of one Flow package.
16. A Flow's implementation requires `MAX_RETRIES`, but no project value exists.
17. A Cordis realm exports one serializable service while retaining many local,
   non-serializable services.
18. A minimal third-party host implements Run but not Services, sandboxing, a
   durable event store, or semantic routing.

## Review rule

No decision is mature merely because it sounds elegant. A decision survives
only if its invariants, costs, failure behavior, versioning boundary, and
conformance test can all be stated precisely.
