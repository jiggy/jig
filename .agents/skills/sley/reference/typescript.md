---
description: Every public TypeScript and JavaScript export, with exact signatures, defaults, result fields, errors, and runtime behavior.
---

# TypeScript API

The `@jigging/sley` package provides ESM, CommonJS, and TypeScript declarations.

```typescript
import { Flow, node } from '@jigging/sley'

import type { Context, RunResult } from '@jigging/sley'
```

Use this reference when you need an exact TypeScript signature, default, result
field, or runtime error. It covers all eight runtime values and every exported
type. For the shared execution rules behind them, use
[Runtime semantics](runtime-semantics.md).

## Compatibility

The published JavaScript and TypeScript declarations target ES2022. TypeScript
projects must include the ES2022 library or a later one; the declarations use
the native `ErrorOptions` type for cause chaining.

Sley's package and runtime tests run in CI on Node 24. The repository also
provides a Chromium runtime smoke check for an ES2022 browser bundle. Bun,
Deno, and other browsers are not verified compatibility targets.

The package intentionally omits `package.json#engines`: Sley is not
Node-specific, and the project has not tested a minimum Node release. That
omission is not a promise that every JavaScript runtime is supported.

## Graph construction

### `node`

```typescript
function node<State extends object = Record<string, unknown>, Input = unknown>(
  handler: NodeHandler<State, Input>,
  options?: NodeOptions<State, Input>,
): Node<State, Input>
```

The function infers the Node name from `handler.name`, falling back to
`'anonymous'`.

### `Node`

```typescript
class Node<State extends object = Record<string, unknown>, Input = unknown> extends GraphElement<State> {
  constructor(handler: NodeHandler<State, Input>, options?: NodeOptions<State, Input>)
}
```

`Node` is a final configured graph value; authors do not subclass it. The
`node(...)` function and constructor have equivalent behavior.

### `NodeHandler` and `NodeRecoveryHandler`

```typescript
type NodeHandler<State extends object = Record<string, unknown>, Input = unknown> = (
  context: Context<State, Input>,
) => void | PromiseLike<void>

type NodeRecoveryHandler<State extends object = Record<string, unknown>, Input = unknown> = (
  context: Context<State, Input>,
  failure: Failure,
) => void | PromiseLike<void>
```

Returning any non-`undefined` application value is an invalid outcome.

### `NodeOptions`

```typescript
interface NodeOptions<State extends object = Record<string, unknown>, Input = unknown> {
  readonly name?: string
  readonly retry?: RetryPolicy
  readonly recover?: NodeRecoveryHandler<State, Input>
}
```

Unknown option keys fail at runtime rather than being ignored.

### `GraphElement`

```typescript
abstract class GraphElement<State extends object = Record<string, unknown>> {
  readonly name: string

  link(target: GraphElement<State>): void
  link(target: GraphElement<State>, action: Action): void
  links(): readonly Link<State>[]
}
```

`Node` and `Flow` inherit this interface. `links()` returns declaration-ordered
links. `link()` is target-first, returns `void`, and is not chainable.

### `Action` and `Link`

```typescript
type Action = string

interface Link<State extends object = Record<string, unknown>> {
  readonly action: Action | null
  readonly target: GraphElement<State>
}
```

`null` identifies the unlabelled link. Named actions must be nonempty strings.

### `Flow`

```typescript
class Flow<State extends object = Record<string, unknown>> extends GraphElement<State> {
  constructor(entry: GraphElement<State>, options?: FlowOptions<State>)

  get entry(): GraphElement<State>
  get exits(): readonly Action[]
  get concurrency(): number
  get maxActivations(): number | undefined

  compile(): CompiledFlow<State>
  start(initialState: Readonly<State>): RunHandle<State>
  run(initialState: Readonly<State>): Promise<State>
}
```

`exits` is captured when the Flow is constructed. `concurrency` and
`maxActivations` must be positive safe integers when supplied. Duplicate exits
and unknown option keys are invalid.

`start()` returns immediately with a handle and defers callback execution to a
Promise turn. `run()` resolves with final state or rejects with `RunError`.

### `FlowOptions`

```typescript
interface FlowOptions<State extends object = Record<string, unknown>> {
  readonly name?: string
  readonly exits?: readonly Action[]
  readonly concurrency?: number
  readonly maxActivations?: number
  readonly combine?: FlowCombineHandler<State>
  readonly recover?: FlowRecoveryHandler<State>
}
```

### `FlowCombineHandler` and `FlowRecoveryHandler`

```typescript
type FlowCombineHandler<State extends object = Record<string, unknown>> = (
  context: Context<State>,
  result: ScopeResult,
) => void | PromiseLike<void>

type FlowRecoveryHandler<State extends object = Record<string, unknown>> = (
  context: Context<State>,
  failure: ScopeFailure,
) => void | PromiseLike<void>
```

### `CompiledFlow`

```typescript
interface CompiledFlow<State extends object = Record<string, unknown>> {
  start(initialState: Readonly<State>): RunHandle<State>
  run(initialState: Readonly<State>): Promise<State>
  describe(): CompiledDescription
}
```

Obtain one with `flow.compile()`. The snapshot can run repeatedly with fresh
top-level state.

### `CompiledDescription`

```typescript
interface DescriptionRoot {
  readonly element_id: 1
  readonly scope_id: 1
}

interface DescriptionLink {
  readonly action: Action | null
  readonly target_element_id: number
}

interface DescriptionScope {
  readonly scope_id: number
  readonly owner_element_id: number
  readonly parent_scope_id: number | null
  readonly entry_element_id: number
  readonly name: string
  readonly exits: readonly Action[]
  readonly concurrency: number
  readonly max_activations: number | null
}

interface DescriptionNode {
  readonly element_id: number
  readonly kind: 'node'
  readonly name: string
  readonly links: readonly DescriptionLink[]
  readonly max_attempts: number
}

interface DescriptionFlow {
  readonly element_id: number
  readonly kind: 'flow'
  readonly name: string
  readonly links: readonly DescriptionLink[]
  readonly owned_scope_id: number
}

type DescriptionElement = DescriptionNode | DescriptionFlow

interface CompiledDescription {
  readonly schema_version: 1
  readonly root: DescriptionRoot
  readonly scopes: readonly DescriptionScope[]
  readonly elements: readonly DescriptionElement[]
}
```

`DescriptionRoot`, `DescriptionLink`, `DescriptionScope`, `DescriptionNode`,
`DescriptionFlow`, and `DescriptionElement` are exported for inspectors that
need to name individual records.

Absent actions, parent scopes, and activation limits are represented by
`null`. Callbacks, recovery policies, run state, and execution events are not
included. Narrow `DescriptionElement` on `kind` before reading
`max_attempts` or `owned_scope_id`. Each call returns detached records.

## Callback context

### `Context`

```typescript
interface Context<State extends object = Record<string, unknown>, Input = unknown> {
  readonly state: State
  readonly input: Input

  emit(): void
  emit(action: undefined, input: unknown): void
  emit(action: Action): void
  emit(action: Action, input: unknown): void
  end(): void
  end(output: unknown): void
}
```

Sley creates Context objects; applications do not. The `state` and `input`
bindings are readonly, but their referenced application values keep normal
mutability. Context access fails after its callback settles.

Use `emit(undefined, value)` to replace input on the unlabelled route.
`end()` and `end(undefined)` are distinct: only the second carries output.
Neither operation returns from the JavaScript function.

### `RetryPolicy`

```typescript
interface RetryPolicy {
  readonly maxAttempts?: number
  readonly shouldRetry?: (failure: Failure) => boolean
  readonly delayMs?: number | ((attempt: number, failure: Failure) => number)
}
```

Defaults are `1`, `() => true`, and `0`. Attempt and delay values must be safe
integers; attempts are positive and delays nonnegative. The callback argument
is the attempt that just failed. Policy callbacks are synchronous and their
return values are checked at runtime.

## Terminals and scope values

### `EndTerminal`

```typescript
interface EndTerminalBase {
  readonly type: 'end'
  readonly sequence: number
  readonly sourceActivationId: number
}

type EndTerminal = EndTerminalBase &
  ({ readonly hasOutput: false; readonly output: undefined } | { readonly hasOutput: true; readonly output: unknown })
```

`hasOutput` distinguishes `end()` from `end(undefined)`.

### `ExitTerminal`

```typescript
interface ExitTerminal {
  readonly type: 'exit'
  readonly action: Action | null
  readonly hasOutput: true
  readonly output: unknown
  readonly sequence: number
  readonly sourceActivationId: number
}
```

Exit output is the branch input that crossed the Flow boundary. `action: null`
is an unlabelled exit.

### `Terminal`

```typescript
type Terminal = EndTerminal | ExitTerminal
```

Only `ExitTerminal` has `action`. Narrow on `terminal.type` first.

### `ScopeResult`

```typescript
interface ScopeResult {
  readonly terminals: readonly Terminal[]
  readonly outputs: readonly unknown[]
}
```

`outputs` includes output-bearing End and Exit values in terminal settlement
order.

### `ScopeFailure`

```typescript
interface ScopeFailure {
  readonly primary: Failure
  readonly terminals: readonly Terminal[]
  readonly result: ScopeResult | null
  readonly failingActivationId: number | null
}
```

`result` is populated when `combine` failed after receiving a `ScopeResult`;
otherwise it is `null`. `terminals` contains work settled before failure.

## Run results

### `RunHandle`

```typescript
interface RunHandle<State extends object = Record<string, unknown>> {
  done(): boolean
  result(): Promise<RunResult<State>>
}
```

The handle has no cancellation method. Repeated `result()` calls return the
same Promise and result object.

### `Completed`, `Failed`, and `RunResult`

```typescript
interface Completed<State extends object = Record<string, unknown>> {
  readonly status: 'completed'
  readonly state: State
  readonly terminals: readonly Terminal[]
}

interface Failed<State extends object = Record<string, unknown>> {
  readonly status: 'failed'
  readonly state: State
  readonly terminals: readonly Terminal[]
  readonly failure: Failure
}

type RunResult<State extends object = Record<string, unknown>> = Completed<State> | Failed<State>
```

Narrow on `result.status`. Result records are shallowly frozen; nested state
and terminal values retain their application-defined mutability.

## Failures and errors

### `FailureKind`

```typescript
type FailureKind =
  | 'handler'
  | 'retry_policy'
  | 'node_recovery'
  | 'flow_combine'
  | 'flow_recovery'
  | 'invalid_outcome'
  | 'unknown_action'
  | 'activation_limit'
  | 'internal'
```

### `Failure`

```typescript
interface Failure {
  readonly failureId: number
  readonly kind: FailureKind
  readonly message: string
  readonly cause: unknown | null
  readonly scopeId: number
  readonly activationId: number | null
  readonly elementId: number | null
  readonly attempt: number | null
  readonly previous: Failure | null
}
```

IDs identify this run only. `attempt` is populated for Node handler and retry
policy failures. TypeScript preserves any thrown value in `cause`, including a
value that is not an `Error`. Replacement policy and recovery failures link to
the earlier failure through `previous`.

### Runtime error values

```typescript
class SleyError extends Error {
  constructor(message?: string, options?: ErrorOptions)
}

class GraphDefinitionError extends SleyError {}
class DuplicateLinkError extends GraphDefinitionError {}

class RunError<State extends object = Record<string, unknown>> extends SleyError {
  readonly result: Failed<State>
  constructor(result: Failed<State>)
}
```

- `SleyError` is the package base error.
- `GraphDefinitionError` reports an invalid graph, option, or policy.
- `DuplicateLinkError` reports a second unlabelled link or second link for one
  action.
- `RunError` is rejected by `run()` for a `Failed` result. Its `result` is that
  exact value and its standard `cause` is the controlling thrown value when
  present.

Invalid initial state throws `TypeError` before callbacks run. State must be a
plain object with only string own keys; arrays, class instances, collection
objects, and symbol keys are rejected. Sley copies enumerable own string
properties into a new ordinary object and preserves nested references.

Because Promises assimilate objects with a callable `then`, `run()` temporarily
masks such a state property while resolving. If application code makes that
property immutable, `run()` rejects with `TypeError`; `start().result()` still
returns the structured result without projecting state as the Promise value.

For the corresponding port, return to the [Python API](python.md).
