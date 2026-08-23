# Jig architecture probes

These directories are disposable, pre-implementation design fixtures. They
exercise authoring ergonomics and trace complete user journeys before Jig,
FLOW SDKs, or Spindle exist.

They are **not** public Starters, reference implementations, conformance
evidence, or compatibility promises. A pleasant hypothetical API proves
nothing about protocol behavior, confinement, crash recovery, or
interoperability.

## Probe index

- [`minimal-portable/`](minimal-portable/) — two independent exact Run
  packages, two runtime ecosystems, no Agent or dynamic routing.

## Authority order

When artifacts disagree:

1. the normative documents under [`../docs/`](../docs/) win;
2. a probe may expose a specification gap, recorded in its API ledger;
3. the specification is reviewed and changed first;
4. the probe is then rewritten, not preserved for backward compatibility.

## Probe rules

- Complete means complete for the stated scenario, never a feature inventory.
- Every invented API maps to a stable specification concept or an explicit
  open question.
- Type-only stubs may make authoring files checkable; they contain no behavior.
- Expected plans and walkthroughs are review fixtures, not claims that a
  runtime produced them.
- Include missing, ambiguous, invalid, cancelled, crashed, and revoked paths
  relevant to the scenario—not only success.
- Never populate or commit `.jig/` host state.
- Never place Runtime Adapter or Sandbox Backend preferences in a project.
- A mock must not claim to enforce security, durability, or protocol semantics.
- Delete one-use helpers and speculative abstractions during every review.

## Inward–outward cycle

```text
scenario
  -> desired project tree
  -> tabletop lifecycle and authority trace
  -> specification correction
  -> conformance fixture
  -> smallest real implementation slice
  -> run the scenario
  -> simplify and repeat
```

After the implementation surface has survived this cycle, public `jig init`
Starters are built afresh from the proven APIs. These probe trees are not
promoted merely because they existed first.
