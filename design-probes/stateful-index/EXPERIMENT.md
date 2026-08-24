# Stateful Service architecture probe

> **NON-RUNNABLE · NONNORMATIVE · DISPOSABLE**
>
> This project contains complete pseudocode against APIs which do not exist.
> It is a falsification fixture, not a Starter, conformance result, or public
> API commitment.

## Question under test

Can FLOW Service/1 justify its lifecycle and contract machinery through one
small stateful application without requiring public Scope objects, distributed
transactions, callback handles, hidden retries, or provider rebinding?

The probe deliberately combines only:

1. one Bun Service with a writable attachment and four bounded methods;
2. one Python ingestion Run and one Bun search Run;
3. one explicit portable Journal dependency;
4. one selector Hook starting one Python audit Run;
5. concurrent Service invocations;
6. provider loss and uncertain mutation evidence; and
7. replacement of the sole writable Service generation.

There are no Agents, skills, Semantic Choice, Sley graph, owned watcher,
network effect, update implementation, GUI, or dynamic Service dependency.
Those omissions keep every failure attributable to Service/1, Capability
Contracts, Journal publication, Hooks, or project admission.

The absence of dynamic dependencies became a deletion challenge. The later
Cordis reuse probe likewise needed only fixed external bindings and exports;
the combined evidence removed `service/bindings` and post-readiness export
mutation from the reviewed v1 design.

## Review order

1. Read [`SCENARIO.md`](SCENARIO.md).
2. Inspect `jig.ts`, `bindings/`, `hooks/`, and all four `flows/` packages.
3. Treat `design-api.d.ts`, `design-flow.d.ts`, and `tsconfig.json` as
   disposable authoring scaffolding.
4. Tabletop the fixtures under `expected/`, especially replacement and crash
   boundaries.
5. Challenge every hypothetical spelling through [`API-LEDGER.md`](API-LEDGER.md).

The normative specifications under [`../../docs/`](../../docs/) always win.
Any contradiction found here changes the specification first and then this
probe. Never populate or commit `.jig/`.

## Falsification rule

The design fails if a reviewer cannot identify, for every invocation and
Event:

```text
exact consumer and provider generation
owning lifetime and cancellation boundary
fixed dependency Binding used by child effects
durable operation or occurrence key
terminal, lost, or uncertain result
writable attachment lease holder
```

It also fails if resolving the scenario requires a public distributed object,
a Service-specific transaction coordinator, a second Event system, or a
transparent retry/rebinding rule.

## Findings from the first tabletop pass

- The Journal Binding is earned authority rather than incidental glue: a
  portable Service deliberately publishes one exact Event type through it.
- Provider state and Journal commit stay separate. A conventional local outbox
  plus at-least-once cross-generation behavior is sufficient; Jig gains no
  distributed transaction primitive.
- Service method handlers need an invocation-scoped cancellation/effect view,
  distinct from the Mount-background view. This is an SDK projection over
  existing wire ownership, not a public Scope or Context.
- Shadow-first replacement is conditional. Conflicting resource leases or an
  affected Hook source require drain, fencing, admission/Hook-boundary switch,
  and only then replacement startup. FLOW gains no migration callback or
  zero-downtime guarantee.
- Splitting read and write contracts follows an actual authority boundary and
  avoids inventing per-Binding method filters. Repeating those exact contracts
  in independent packages remains visible ceremony, but preserves
  self-contained compatibility. Tooling may copy and verify them; the probe
  does not justify remote references or a second manifest.
- Nothing in this probe uses dynamic dependencies or export mutation. Their
  later removal makes this fixed Service package match the current v1 design.
