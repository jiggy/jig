# Jig architecture probes

These directories are disposable, pre-implementation design fixtures. They
exercise authoring ergonomics and trace complete user journeys before Jig,
FLOW SDKs, or Sley exist.

They are **not** public Starters, reference implementations, conformance
evidence, or compatibility promises. A pleasant hypothetical API proves
nothing about protocol behavior, confinement, crash recovery, or
interoperability.

All TypeScript probes consume the one declaration-only candidate FLOW SDK in
[`design-flow-sdk.d.ts`](design-flow-sdk.d.ts). Individual probes may declare
runtime globals, but must not invent incompatible `@flowmd/sdk` surfaces.

## Probe index

- [`minimal-portable/`](minimal-portable/) — two independent exact Run
  packages, two runtime ecosystems, no Agent or dynamic routing.
- [`default-run/`](default-run/) — one self-contained Bun Run admitted from
  `flows/` alone, proving that Bindings are a normalized execution identity
  and customization layer rather than mandatory authoring boilerplate.
- [`dynamic-defaults/`](dynamic-defaults/) — two zero-boilerplate derived Runs
  behind one intentionally authored `allRuns()` dispatch policy, with
  add/remove generations, finite authority closure, ancestor filtering, and
  bounded ambiguity.
- [`software-factory/`](software-factory/) — a Starter-shaped Event/Hook spine,
  fixed Sley routing, Agent-backed strategy Flows, one distinct open-ended
  `flow/call`, and separately staged missing-Flow maintenance.
- [`stateful-index/`](stateful-index/) — a Bun Service shared by Python and Bun
  Runs, an explicit portable Journal producer path, concurrent invocation
  ownership, persistent-outbox recovery, and exclusive-writer replacement.
- [`gui-document-desk/`](gui-document-desk/) — a framework-free browser UI and
  trusted Bun application frontend using candidate host-local Run control while
  three sandboxed FLOW packages remain networkless.
- [`cordis-timer/`](cordis-timer/) — the published Cordis Timer plugin reused
  unchanged inside one 50-line Bun FLOW Service, exposing one JSON `wait`
  operation to a small Python Run while callbacks stay realm-local.

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
- Prefer Bun for new TypeScript probes and Python for the second independent
  runtime; use Deno only when a scenario specifically exercises Deno semantics.
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
