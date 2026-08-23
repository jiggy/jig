# Software factory architecture probe

> **NON-RUNNABLE · NONNORMATIVE · DISPOSABLE**
>
> This is a pre-implementation design experiment, not a Starter, example app,
> compatibility promise, conformance result, or source of public API truth.
> The `jig` and `spindle` modules and every executable behavior implied below
> are absent. Expected artifacts are tabletop fixtures produced by reviewers.

## Question under test

Can a realistic but bounded software-factory journey remain understandable
when it combines:

1. a finite inbox producer and canonical immutable Event;
2. one exact inert Hook;
3. a Spindle-local semantic Router over two connected strategy Flows;
4. exact Agent and Semantic Choice dependencies;
5. package-local Agent skills;
6. one distinct open-ended Jig `flow/call`; and
7. operator-started missing-Flow repair which cannot activate its own output?

The probe tests whether these concepts compose ergonomically without making a
Router into a catalogue resolver, a Hook into middleware, or repair into an
authority bypass. It does not test protocol bytes, durability, confinement,
Spindle execution, Agent quality, multiple tickets, or working software.

## Review order

1. Read [`SCENARIO.md`](SCENARIO.md).
2. Inspect the author-owned `jig.ts`, `bindings/`, `hooks/`, `flows/`,
   `inbox/`, `workspace/`, `repair-staging/`, and `examples/` trees.
3. Treat `design-api.d.ts`, `design-spindle.d.ts`, and `tsconfig.json` only as
   declaration-only review scaffolding.
4. Compare the tabletop artifacts under `expected/` with the normative docs.
5. Use [`API-LEDGER.md`](API-LEDGER.md) to challenge every invented spelling.

Normative documents under [`../../docs/`](../../docs/) always win. Never run,
publish, install, or promote this tree. Never add `.jig/`, a speculative
`jig.lock`, Runtime Adapter selection, Sandbox Backend policy, or credentials.

## Deliberate scope

Included:

- one manually submitted ticket file and finite producer Run;
- one canonical Journal effect and one exact Hook;
- one Spindle package containing the finite Gauntlet and Majority-Vote route
  table;
- exact Agent and chooser Bindings;
- one read-write workspace for one ticket only;
- two approved reference-research candidate Bindings;
- one separate repair Flow writing inert proposals to staging; and
- success, missing, ambiguity, uncertainty, crash, cancellation, revocation,
  and skill-isolation walkthroughs.

Excluded:

- inbox watcher Service or filesystem ingress daemon;
- Task, Kanban, Git, branches, worktrees, GUI, approvals, or Agent sessions;
- concurrent tickets or workspace allocation;
- dynamic graph rewiring, route arguments, confidence, or generated plans;
- deferred cross-generation `WAITING_BINDING` and automatic repair/resume;
- public lock serialization; and
- any project choice of Adapter, toolchain, Sandbox Backend, or raw command.

## Project files and probe harness

The Starter-shaped project owns `.gitignore`, `jig.ts`, `bindings/`, `hooks/`,
`flows/`, `inbox/`, `workspace/`, `repair-staging/`, and `examples/`. The
Markdown documents at this root, declaration files, `tsconfig.json`, and
`expected/` are probe-only harness and must not be interpreted as project
configuration.

The shape is intentionally fuller than the minimal-portable probe but complete
only for this scenario. Public Starters must later be rebuilt from working
APIs. This tree should be rewritten whenever an assumption loses and deleted
after its cases become executable acceptance and conformance fixtures.
