---
description: The exact cross-language rules for graph definition, control, Flow settlement, failures, scheduling, and results.
---

# Runtime semantics

Use this reference when you need to predict exactly how a graph routes, settles,
retries, or fails. It states the behavior shared by Sley's Python and TypeScript
ports. The [Python API](python.md) and [TypeScript API](typescript.md) give the
exact host-language signatures.

## Graph definitions

`node(handler)` creates a Node backed by one synchronous or asynchronous
callback. A handler returns no application value: it must return `None` in
Python or `undefined` in TypeScript.

Nodes and Flows are graph elements. A source owns its links:

```text
source.link(target)           one unlabelled link
source.link(target, action)   one named link
```

The target is first because it is always required. An action is a nonempty
string. A source can have at most one unlabelled link and one link for each
action. Duplicate links fail when added.

A Flow defines one execution scope with these settings:

| Setting           | Contract                                             |
| ----------------- | ---------------------------------------------------- |
| `entry`           | Required Node or Flow that receives the Flow's input |
| `name`            | Diagnostic name; defaults to `Flow`                  |
| `exits`           | Named actions allowed to leave the scope             |
| `concurrency`     | Positive local activation limit; defaults to `1`     |
| `max_activations` | Optional positive local activation guard             |
| `combine`         | Optional callback after successful scope settlement  |
| `recover`         | Optional callback after failed scope settlement      |

TypeScript spells `max_activations` as `maxActivations` and passes settings in
an options object.

`compile()` validates and snapshots the reachable topology. Later changes to
the definitions do not affect that compiled Flow. Definitions and compiled
Flows contain no invocation state and can be reused.

`describe()` returns fresh plain records containing topology and scalar
policies. It is suitable for inspection and visualization, but it is not an
execution trace.

## State and branch input

At the start of each run, Sley shallow-copies the initial top-level state once.
Every activation in that run shares the resulting state object. The caller's
top-level object is not mutated, but nested objects remain shared references.
The state exposed at completion is the same run-owned object, not another copy.

`context.input` is the message carried by one branch. The root input is absent.
An emission with no replacement input forwards the current input by identity.

Use each data path for one role:

| Data                                | Role                            |
| ----------------------------------- | ------------------------------- |
| `context.state`                     | Facts shared for the entire run |
| `context.input`                     | The item carried by this branch |
| `context.end(value)` or a Flow exit | A settled branch value          |

Sley validates its state carrier and control protocol, not application
schemas. It does not prove that linked handlers agree on an input shape.
Python missing-key access retains normal `KeyError` behavior. TypeScript
missing-property access normally returns `undefined`.

## Callback control

The portable control operations are:

| Meaning                         | Operation             |
| ------------------------------- | --------------------- |
| Unlabelled route, current input | `emit()`              |
| Unlabelled route, new input     | `emit(input=value)`   |
| Named route, current input      | `emit(action)`        |
| Named route, new input          | `emit(action, value)` |
| Hard terminal without output    | `end()`               |
| Hard terminal with output       | `end(value)`          |

TypeScript spells unlabelled input replacement as `emit(undefined, value)`.

Each call appends an intent to a callback-local buffer. It does not schedule
work immediately and does not stop the function. Use an ordinary `return` when
later statements must not run.

The buffer commits only after the callback returns normally with the required
empty return value. A throw or invalid return discards the whole buffer. Sley
also validates every destination before admitting any arm, so one unknown
route rejects the complete fan-out. State writes and external effects are not
part of this atomicity and are never rolled back.

Zero control calls have callback-specific meanings:

| Callback       | Zero-call behavior            |
| -------------- | ----------------------------- |
| Node handler   | Synthesizes one `emit()`      |
| Flow `combine` | Preserves the child terminals |
| Node `recover` | Propagates the node failure   |
| Flow `recover` | Propagates the scope failure  |

## Routing

An emitted action resolves from its source in this order:

1. Follow the matching link.
2. If no link matches, leave the Flow when the action is a declared exit.
3. Otherwise, fail with `unknown_action`.

A matching link therefore takes precedence over an exit with the same name.
The unlabelled action may leave every Flow without declaration. The string
`"default"` is an ordinary named action, not the unlabelled route.

Several control calls create several ordered branch arms. To send several
inputs to one target, emit the same action once per input. Sley does not attach
several physical targets to one action.

## Flow settlement

A Flow waits until all work admitted to its scope settles. A branch settles as
one of two terminal types:

| Terminal | Source                          |
| -------- | ------------------------------- |
| End      | `end()` or `end(value)`         |
| Exit     | A route leaves the current Flow |

`end()` creates an End terminal without output. `end(None)` in Python and
`end(undefined)` in TypeScript create output-bearing terminals whose values
happen to be empty. End bypasses links and terminates only its current branch;
sibling branches continue. An End also passes unchanged through enclosing Flow
boundaries unless a combiner replaces it.

An Exit terminal always carries the exiting branch input as its output. In a
nested Flow, the parent resolves that exit from the child Flow occurrence's
links and then its own declared exits.

Without `combine`, a successful Flow forwards its terminal set. With
`combine`, Sley calls the combiner once after every branch in the scope settles
successfully. It receives a `ScopeResult`:

- `terminals` contains every End and Exit in settlement order.
- `outputs` projects the value of every output-bearing terminal in that order.

Outputs do not include shared state, callback returns, or intermediate
emissions. Under concurrency, settlement order need not match emission order.

A combiner that emits nothing preserves the terminal set. Any explicit
combiner emissions replace the complete set and route from the Flow occurrence.
A combiner can use `end` to replace the set with hard terminals.

## Retry and recovery

A retry policy belongs to one Node:

| Setting          | Contract                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| Maximum attempts | Positive integer; defaults to `1`                                                                 |
| Retry predicate  | Synchronous `Failure -> bool`; defaults to `true`                                                 |
| Delay            | Nonnegative integer milliseconds, or synchronous `(attempt, Failure) -> integer`; defaults to `0` |

One attempt runs the whole handler with the same state object and branch input.
A failed attempt loses its buffered control, but its direct state mutations and
external effects remain. Retry is considered only for handler failures while
attempts remain. Invalid callback outcomes are not retried.

After retry stops, a configured Node recovery callback runs once. Explicit
control replaces the failure and resumes from the Node. Zero control calls
propagate the failure. A recovery error replaces the controlling failure and
retains the earlier failure through `previous`.

When a Flow has an unhandled child failure, it stops admitting new local work
and waits for work already running in that local wave. A configured Flow
recovery callback then receives a `ScopeFailure`, including settled terminals.
Its explicit control replaces the scope failure and routes from the Flow
occurrence; zero control calls propagate it.

A combine failure gives Flow recovery the exact `ScopeResult` that the
combiner received. Failed nested Flows propagate both their failure and already
settled terminals through enclosing scopes unless recovery replaces them.

## Scheduling and cycle limits

Scheduling belongs to each Flow invocation. `concurrency=1` is serial. A larger
value bounds simultaneous activations in that scope. Nested Flows apply their
own limits.

The accepted implementation uses bounded waves: it admits up to the local
limit, waits for that wave, then admits more. The contract promises an upper
bound, not fairness, global admission control, or continuously work-conserving
scheduling. Synchronous work does not become nonblocking merely because the
limit is greater than one.

Concurrent branches share state and borrowed input references. Sley provides
no transaction or race protection. Coordinate shared writes with normal
application primitives or aggregate branch outputs in `combine`.

`max_activations` counts activations started in one Flow invocation. It fails
before starting work beyond the configured value. Retry attempts and work
inside a nested Flow do not add to the parent count. There is no hidden default
limit.

## Results and failures

`start(initial_state)` returns a handle with `done()` and asynchronous
`result()`. Repeated `result()` calls observe the same result. There is no Sley
cancellation method.

`result()` produces one variant:

```text
Completed(status, state, terminals)
Failed(status, state, terminals, failure)
```

Workflow failure is data in `Failed`; it does not make `result()` throw.
`run(initial_state)` is the everyday projection: it returns the completed state
or raises/rejects with `RunError`, whose `result` is that exact `Failed` value.
Native task cancellation and impossible internal states retain native behavior.

Failure kinds are:

```text
handler          retry_policy      node_recovery
flow_combine     flow_recovery     invalid_outcome
unknown_action   activation_limit  internal
```

Failures identify the scope, activation, element, and attempt when those values
exist. `cause` preserves the host-language application error or thrown value;
`previous` links a replacement failure to the failure it superseded.

## Host-language differences

The execution model is shared; these boundaries deliberately follow each host
language:

| Concern                              | Python                                     | TypeScript                |
| ------------------------------------ | ------------------------------------------ | ------------------------- |
| Initial state                        | String-keyed `Mapping`, captured as `dict` | Plain string-keyed object |
| Missing application field            | Normal `KeyError` for indexed access       | Normally `undefined`      |
| Explicit `None` / `undefined` output | `end(None)`                                | `end(undefined)`          |
| Unlabelled input replacement         | `emit(input=value)`                        | `emit(undefined, value)`  |
| Callback return                      | `None`                                     | `undefined`               |
| Captured application failure         | Ordinary `Exception`                       | Any thrown value          |
| Result collections                   | Tuples                                     | Readonly arrays           |
| Public field spelling                | `snake_case`                               | `camelCase`               |

Invalid calls outside the portable signatures also retain native behavior. For
example, Python can raise `TypeError` for invalid arity before Sley validates a
control value, while TypeScript checks dynamically supplied arguments as an
invalid callback outcome.

TypeScript has one additional Promise boundary: `run()` temporarily masks an
application state field named `then` when it is callable. If application code
makes that property immutable, `run()` rejects; `start().result()` remains
available because it does not resolve with state as the Promise value.

## Intentional limits

Sley deliberately has no built-in schema validation, cross-link payload
checking, tracing, event stream, logging, statistics, timeout, deadline,
cancellation token, persistence, replay, transaction, distribution, global
concurrency policy, or provider integration. Applications use ordinary
host-language and service-client facilities for those concerns.

For application boundaries, continue to
[Validation and types](../guides/validation-and-types.md).
