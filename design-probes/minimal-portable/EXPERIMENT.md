# Minimal portable architecture probe

> **NON-RUNNABLE · NONNORMATIVE · DISPOSABLE**
>
> This directory is a pre-implementation design experiment. The `jig` module,
> Jig executable, Runtime Adapters, Sandbox Backend, and FLOW/1 implementations
> used by the files below do not exist here. Nothing in this directory is a
> compatibility promise or a public Starter.

## Question under test

Can a project author discover, configure, admit, inspect, and invoke two small
exact Flows implemented for different runtime ecosystems without learning
Agents, Hooks, semantic routing, Services, Spindle, or host sandbox machinery?

The probe tests the authoring journey and ownership boundaries. Its failure
walkthroughs table-top the user-visible consequences of protocol loss,
cancellation, confinement failure, and crash recovery so success is not the
only path considered. They do not execute or prove component code, protocol
correctness, dependency installation, confinement, performance, or recovery.

## Rules for reviewing this probe

1. Start with [`SCENARIO.md`](SCENARIO.md), not the hypothetical TypeScript.
2. Treat [`design-api.d.ts`](design-api.d.ts) as disposable editor scaffolding.
   It declares shapes and implements nothing.
3. Treat files under [`expected/`](expected/) as tabletop observations, not
   output produced by a working Jig.
4. Do not install dependencies, execute `flow.py` or `flow.ts`, publish either
   package, or use this tree as a Starter.
5. The normative documents under [`../../docs/`](../../docs/) win whenever this
   probe disagrees with them.
6. Record every invented surface in [`API-LEDGER.md`](API-LEDGER.md). An
   invented helper without a demonstrated need is deleted.
7. Never add `.jig/` runtime state or host Runtime Adapter/Sandbox preferences
   to this project.

## Deliberate boundaries

This probe includes:

- one project definition;
- shallow Flow and Binding discovery;
- one Python-shaped exact Flow and one TypeScript-shaped exact Flow;
- all three optional conventional schemas for both Flows, included to exercise
  every Schema/1 seam rather than because every package must declare them;
- two explicit configured Bindings;
- sample Run inputs; and
- expected plan, authority, lifecycle, and failure walkthroughs.

It excludes:

- Agent providers or instruction fallback;
- Hooks or an event source;
- Semantic Choice or missing-Flow repair;
- FLOW Services or capability contracts;
- inbox, Task, Git, GUI, or application-specific structure;
- Spindle or any other graph runner; and
- project-controlled Runtime Adapter or Sandbox Backend selection.

## Project files and probe harness

The files a real project author would own are `.gitignore`, `jig.ts`,
`bindings/`, `flows/`, and `examples/`. `design-api.d.ts`, `tsconfig.json`,
`EXPERIMENT.md`, `SCENARIO.md`, `API-LEDGER.md`, and `expected/` are probe-only
review harness.
No machine should interpret the latter group as Jig project configuration.

## When to rewrite or delete it

Rewrite this tree freely whenever an ergonomic assumption loses. Preserve the
scenario and findings, not the syntax. Delete the probe after its useful cases
have become implementation acceptance tests and conformance fixtures. Public
Starters must later be recreated from working APIs rather than polishing this
prototype in place.
