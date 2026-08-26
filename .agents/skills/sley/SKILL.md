---
name: sley
description: Build, change, debug, or review in-process workflow graphs with Sley in Python or TypeScript. Applies when code imports `sley` or `@jigging/sley`, or the request explicitly names Sley.
license: MPL-2.0
---

# Sley

Make the workflow's meaningful paths visible while leaving local work as
ordinary code. A graph earns its place only when it is easier to scan than the
conditions, callbacks, or counters it replaces.

## Choose the path

- For Python construction, typing, results, or errors, search
  [reference/python.md](reference/python.md) for the public name in use.
- For JavaScript or TypeScript construction, typing, results, or errors, search
  [reference/typescript.md](reference/typescript.md) for the public name in use.
- For graph definitions, control, routing, settlement, fan-out, combine, nested
  Flows, scheduling, results, failures, or intentional limits, search
  [reference/runtime-semantics.md](reference/runtime-semantics.md) for the
  relevant heading.
- For application schemas and payload trust boundaries, read
  [guides/validation-and-types.md](guides/validation-and-types.md).
- For bounded parallelism, shared-state safety, or loops, read
  [guides/concurrency-and-cycles.md](guides/concurrency-and-cycles.md).
- For transient operations and fallback policy, read
  [guides/retry-and-recovery.md](guides/retry-and-recovery.md).
- For compiled topology and terminal evidence, read
  [guides/inspection.md](guides/inspection.md).
- For services, blocking work, shared clients, or provider limits, read
  [guides/integration-boundaries.md](guides/integration-boundaries.md).
- For verification strategy and failure assertions, read
  [guides/testing.md](guides/testing.md).

## Build the graph

1. Trace the existing workflow from inputs to observable outcomes. Keep helper
   calls and local conditions as ordinary code.
2. Create a Node only for a meaningful workflow step, decision, retry boundary,
   or independently scheduled unit of work.
3. Put whole-run facts in `context.state`. Carry branch-specific work through
   `context.input`. Use `context.end(value)` only for a completed branch value
   that must settle or be combined.
4. Connect each allowed transition with `source.link(target, action?)`. The
   target is required; the optional action names the decision outcome.
5. Route with `context.emit(...)`. A successful Node with no control call takes
   its unlabelled path. A leaf with no matching unlabelled link exits its Flow
   normally and needs no `end()`.
6. Wrap the entry element in a Flow. Use `run(initialState)` for the final shared
   state and `start(initialState).result()` only when terminal or failure detail
   is required.

Handlers communicate through state, input, emissions, and terminal outputs.
They return no application value. Control calls buffer intent and do not stop
the function; use the host language's `return` when later statements must not
run.

## Keep the boundary honest

- Sley owns in-process graph execution. The application owns payload validation,
  storage, service policy, timeouts, persistence, tracing, and distribution.
- Each run shallow-copies the initial top-level state once. Every branch shares
  that run-owned state, including nested object references. Coordinate
  concurrent writes exactly as ordinary concurrent code requires.
- Prefer branch inputs and terminal outputs over shared counters or result lists
  when work fans out.
- Validate untrusted state or input before writes, effects, or control calls.
- Pair fan-out with the Flow that owns its `combine` boundary. Nest around owned
  behavior or policy, not file organization.
- Give every cycle a domain exit and an explicit activation guard.
- Put retry around the smallest safe repeatable operation. Recover at the
  smallest boundary with enough context to choose the fallback.

## Completion criterion

Finish when every changed route has an observable check, the project's existing
type and test commands pass, and every remaining Node represents topology or
runtime policy that an ordinary function call would hide.
