# Private project Run-target marker checkpoint

**Status:** private authoring checkpoint closed on 2026-08-29. The marker is
not part of Project Authoring SDK/1 and is not usable by ordinary projects yet.

## 1. Smallest selected value

The changing Run-universe experiment selected one explicit per-slot marker.
Its private normalized value is now exactly:

```json
{ "kind": "project-run-targets" }
```

No query language, named view, generic candidate-source taxonomy, filter,
limit, retrieval hint, or semantic policy is encoded in the marker. A future
second source earns its own union member rather than being anticipated here.

The private helper is conceptually:

```ts
definePrivateProjectRunTargetsBinding({
  package: "./flows/dispatcher",
  slots: {
    work: projectRunTargets(),
  },
})
```

The existing Binding snapshot, closed-object validation, path checks, slot
ordering, and deep freezing are reused. The marker cannot occur inside
`candidates([...])`: one changing source cannot hide inside another source.

## 2. Isolation

This checkpoint deliberately leaves all public surfaces unchanged:

- `projectRunTargets` is absent from the `@jigging/jig` package root;
- public `SlotRef`, `defineBinding`, and canonical normalization reject it;
- Project Authoring SDK/1's machine schema rejects it; and
- no evaluator, linker, lock, planner, or runtime consumes it.

A separate private Schema/1 document fixes the candidate value for focused
testing. It is not copied into the package build because no admitted evaluator
profile consumes it yet.

## 3. Evidence

Focused tests prove:

- exact value shape, snapshotting, deep freezing, and canonical idempotence;
- private standalone-slot acceptance;
- public helper, normalizer, schema, and package-root rejection;
- rejection of unknown members and the rejected speculative
  `{ kind: "candidate-source", source: "project-run-targets" }` form; and
- rejection when nested inside `candidates`.

The relevant public/private authoring and schema tests pass, and the Jig
package builds without adding the private schema to its artifact.

## 4. Next boundary

The next pure checkpoint derives the complete structural Run-target catalogue
from an already authenticated linked project. It includes direct eligible Run
Flows and configured Run Bindings, excludes Services and Journal publishers,
does not consult runtime readiness, and adds no universe-specific cap.

Only after both pure values pass should the sealed evaluator admit the helper,
the linker expand the marker once, and the private lock retain both source kind
and exact sorted expansion. Child dispatch, Semantic Choice, public authoring,
and runtime integration remain later checkpoints.
