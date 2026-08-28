# Changing project Run universe disposition

**Status:** design selected on 2026-08-28 after two frozen-interface clean-room
consumers and an independent adjudication. No public SDK or runtime execution
path is implemented by this checkpoint. The uncommitted probe remains under
`design-probes/dynamic-candidate-universe-v2/`.

## 1. Selected authoring model

The future authoring helper is one explicit per-slot marker:

```ts
defineBinding({
  package: "./flows/dispatcher",
  slots: {
    work: projectRunTargets(),
  },
})
```

It means: expand this Flow-call slot to every structurally valid Run target in
the immutable project candidate currently being planned. The catalogue
includes direct-eligible Run Flows and Run-capable package Bindings, including
ones whose operational disposition is unavailable. It excludes Services,
Journal publishers, host capabilities, and invalid declarations.

The marker is explicit. An unmapped slot never acquires catalogue authority.
It is also inert: discovery may propose a changed expansion, but only ordinary
plan, review, and apply can publish another admitted generation.

## 2. Why named views lost

The competing model added a top-level `candidateViews` namespace and a
`candidateViewRef("project-runs")` string reference. Its consumer found the
model readable and potentially useful for reuse, but it required two linked
declarations, dangling-reference and namespace rules, and pressure toward
composition, filters, tags, and query syntax.

The known use case needs one broad project Run source. A TypeScript constant
can reuse the inert marker without adding Jig ontology. Named views remain an
upgrade only after at least two real consumers demonstrate materially
different or repeatedly reused changing universes.

## 3. Expansion and admission semantics

Expansion is deterministic and two-phase:

1. capture, evaluate, and link the complete immutable project candidate while
   retaining the marker;
2. enumerate its complete Run-target catalogue once and replace each marker's
   execution set with exact target identities in canonical order.

No fixed point or live lookup is involved. The normalized slot retains its
source kind beside the exact sorted expansion. The existing project work and
activation-target limits apply; exceeding them invalidates the complete
candidate. There is no universe-specific cap and no truncation, sampling,
retrieval, or batching.

The implementation must project both the source marker and exact expansion
into the existing retained capture, lock, and aggregate candidate identity
layers. Once it does, those layers commit author intent, package and Binding
meaning, target request, operational disposition, and recipe/unavailability
evidence. The current lock does not yet make that claim. A new standalone
universe digest would duplicate the completed authorities. Future runtime
selection should derive one decision-local survivor digest, not invent another
project identity layer.

Plan inspection must expose, per affected slot:

- source introduction or removal;
- target additions and removals;
- same-identity target meaning or disposition revisions; and
- transitive authority changes.

Apply pins the exact expansion. Existing Runs and pending operations never
re-expand against later source.

## 4. Self-membership and runtime filtering

The catalogue expansion includes the Binding which contains the marker when
that Binding is itself a valid Run target. Planning does not depend on the
eventual caller or ancestor stack. Runtime deterministic filtering operates
only over the pinned expansion and removes every candidate whose exact
`RunTargetIdentity` already occurs in the active owner chain, including the
caller itself. It then applies actual input, readiness, authority, resource,
liveness, and wait-graph checks. V1 therefore has no recursive cross-Flow call;
loops belong inside a runner such as Sley until an explicit bounded recursive
composition model is separately justified.

This preserves one stable meaning for `projectRunTargets()` while preventing a
semantic chooser from creating a non-runnable cycle. Zero survivors is
`BINDING_MISSING`; one selects directly; several are
`BINDING_AMBIGUOUS` unless an admitted chooser is available.

Semantic Choice sees at most its portable 256-candidate operation bound after
filtering. More survivors makes the chooser inapplicable; it never reduces the
set to fit.

## 5. Probe result and remaining gate

Both consumers independently proved exact two-generation expansion,
addition/removal/revision deltas, old-generation pinning, zero/one/many
classification, excluded non-Run components, and atomic oversize failure.
Both had to invent planner records because no planning API was supplied. That
was expected and prevented the probe from silently defining Jig.

Implementation remains gated on a private project-authoring overlay, linked
slot representation, lock projection, Plan delta, and deterministic filtering
test. It should reuse current candidate/admission machinery and must not widen
the root child-Flow controller until the pure expansion and review evidence
pass.
