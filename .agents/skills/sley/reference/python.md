---
description: Every public Python export, with exact signatures, defaults, result fields, errors, and host-language behavior.
---

# Python API

Sley requires Python 3.13 or newer. The package includes inline typing through
`py.typed`.

```python
from sley import Flow, node
```

Use this reference when you need an exact Python signature, default, result
field, or error. It covers every name exported by `sley`. For the shared
execution rules behind those names, use
[Runtime semantics](runtime-semantics.md).

## Graph construction

### `node`

```python
@overload
def node(
    handler: Callable[[Context[State, Input]], None | Awaitable[None]],
    /,
    *,
    name: str | None = None,
    retry: RetryPolicy | None = None,
    recover: Callable[
        [Context[State, Input], Failure], None | Awaitable[None]
    ] | None = None,
) -> Node[State, Input]: ...

@overload
def node(
    *,
    name: str | None = None,
    retry: RetryPolicy | None = None,
    recover: Callable[
        [Context[State, Input], Failure], None | Awaitable[None]
    ] | None = None,
) -> Callable[
    [Callable[[Context[State, Input]], None | Awaitable[None]]],
    Node[State, Input],
]: ...
```

`node` accepts a handler directly or acts as `@node` / `@node(...)`. It infers
the Node name from the function name, falling back to `"anonymous"`.

Handlers have this contract:

```python
def handler(context: Context[State, Input]) -> None: ...
async def handler(context: Context[State, Input]) -> None: ...
```

`recover`, when present, receives the same Context input plus a `Failure` and
also returns `None`, synchronously or asynchronously.

### `Node`

```python
class Node(GraphElement[State], Generic[State, Input]):
    def __init__(
        self,
        handler: Callable[[Context[State, Input]], None | Awaitable[None]],
        *,
        name: str,
        retry: RetryPolicy,
        recover: Callable[
            [Context[State, Input], Failure], None | Awaitable[None]
        ] | None,
    ) -> None: ...

    handler: Callable[[Context[State, Input]], None | Awaitable[None]]
    retry: RetryPolicy
    recover: Callable[
        [Context[State, Input], Failure], None | Awaitable[None]
    ] | None
```

`Node` is the final configured graph value returned by `node(...)`; authors do
not subclass it. Prefer `node(...)`, which supplies defaults and name inference,
over calling this constructor directly.

### `GraphElement`

```python
class GraphElement(Generic[State]):
    def __init__(self, name: str) -> None: ...

    @property
    def name(self) -> str: ...

    def link(self, target: GraphElement[State], /) -> None: ...
    def link(self, target: GraphElement[State], action: Action, /) -> None: ...
    def links(self) -> tuple[Link[State], ...]: ...
```

`Node` and `Flow` inherit this interface. Do not use a directly constructed
`GraphElement` as executable work: it has no handler or owned Flow scope, so a
graph containing it fails compilation with `GraphDefinitionError`. Use `Node`
or `Flow`. `links()` returns declaration-ordered links. `link()` is
target-first, returns `None`, and is not chainable.

### `Action` and `Link`

```python
Action: TypeAlias = str

@dataclass(frozen=True, slots=True)
class Link(Generic[State]):
    action: Action | None
    target: GraphElement[State]
```

`None` identifies the unlabelled link. Named actions must be nonempty strings.

### `Flow`

```python
class Flow(GraphElement[State], Generic[State]):
    def __init__(
        self,
        entry: GraphElement[State],
        *,
        name: str = "Flow",
        exits: Iterable[Action] = (),
        concurrency: int = 1,
        max_activations: int | None = None,
        combine: Callable[
            [Context[State, object], ScopeResult], None | Awaitable[None]
        ] | None = None,
        recover: Callable[
            [Context[State, object], ScopeFailure], None | Awaitable[None]
        ] | None = None,
    ) -> None: ...

    entry: GraphElement[State]
    exits: tuple[Action, ...]
    concurrency: int
    max_activations: int | None
    combine: Callable[
        [Context[State, object], ScopeResult], None | Awaitable[None]
    ] | None
    recover: Callable[
        [Context[State, object], ScopeFailure], None | Awaitable[None]
    ] | None

    def compile(self) -> CompiledFlow[State]: ...
    def start(self, initial_state: State) -> RunHandle[State]: ...
    async def run(self, initial_state: State) -> State: ...
```

The combiner contract is:

```python
def combine(context: Context[State], result: ScopeResult) -> None: ...
```

Flow recovery has this contract:

```python
def recover(context: Context[State], failure: ScopeFailure) -> None: ...
```

Both callbacks may instead be asynchronous. `exits` is captured as a tuple.
`concurrency` and `max_activations` must be positive integers when supplied.
Duplicate exits are invalid.

`start()` captures state and schedules the run with `asyncio.create_task`, so it
must be called while an event loop is running. `run()` returns the final state
or raises `RunError`.

### `CompiledFlow`

```python
class CompiledFlow(Generic[State]):
    def start(self, initial_state: State) -> RunHandle[State]: ...
    async def run(self, initial_state: State) -> State: ...
    def describe(self) -> CompiledDescription: ...
```

Obtain a compiled Flow with `flow.compile()`. The snapshot can run repeatedly;
each invocation receives fresh top-level state.

### `CompiledDescription`

```python
class DescriptionRoot(TypedDict):
    element_id: Literal[1]
    scope_id: Literal[1]

class DescriptionLink(TypedDict):
    action: Action | None
    target_element_id: int

class DescriptionScope(TypedDict):
    scope_id: int
    owner_element_id: int
    parent_scope_id: int | None
    entry_element_id: int
    name: str
    exits: list[Action]
    concurrency: int
    max_activations: int | None

class DescriptionNode(TypedDict):
    element_id: int
    kind: Literal["node"]
    name: str
    links: list[DescriptionLink]
    max_attempts: int

class DescriptionFlow(TypedDict):
    element_id: int
    kind: Literal["flow"]
    name: str
    links: list[DescriptionLink]
    owned_scope_id: int

DescriptionElement: TypeAlias = DescriptionNode | DescriptionFlow

class CompiledDescription(TypedDict):
    schema_version: Literal[1]
    root: DescriptionRoot
    scopes: list[DescriptionScope]
    elements: list[DescriptionElement]
```

`DescriptionRoot`, `DescriptionLink`, `DescriptionScope`, `DescriptionNode`,
`DescriptionFlow`, and `DescriptionElement` are exported for inspectors that
need to name individual records.

Actions and absent parent scope / activation limit use `None` in the returned
records. Callbacks, recovery policies, run state, and execution events are not
included. Narrow `DescriptionElement` on `kind` before reading `max_attempts`
or `owned_scope_id`. Each call returns detached records.

## Callback context

### `Context`

```python
class Context(Protocol, Generic[State, Input]):
    @property
    def state(self) -> State: ...

    @property
    def input(self) -> Input: ...

    def emit(self) -> None: ...
    def emit(self, *, input: object) -> None: ...
    def emit(self, action: Action, /) -> None: ...
    def emit(self, action: Action, input: object, /) -> None: ...
    def end(self) -> None: ...
    def end(self, output: object, /) -> None: ...
```

Sley creates Context objects; application code does not. The Context is valid
only while its callback is active. `state` is the mutable run-owned dictionary;
`input` is the current branch binding.

`end()` and `end(None)` are distinct. The first omits output; the second emits
an explicit `None` output. Neither `emit` nor `end` exits the Python function.

### `RetryPolicy`

```python
@dataclass(frozen=True, slots=True)
class RetryPolicy:
    max_attempts: int = 1
    should_retry: Callable[[Failure], bool] = ...
    delay_ms: int | Callable[[int, Failure], int] = 0
```

`max_attempts` is a positive integer counting the first attempt. `delay_ms` is
a nonnegative integer number of milliseconds or a synchronous callback. The
callback's integer argument is the attempt that just failed. `should_retry`
must be synchronous and return exactly `bool`. The `...` above denotes Sley's
built-in always-true predicate; that private helper is not part of the public
API.

## Terminals and scope values

All result records are frozen, slotted dataclasses.

### `EndTerminal`

```python
@dataclass(frozen=True, slots=True)
class EndTerminal:
    has_output: bool
    output: object
    sequence: int
    source_activation_id: int
    type: Literal["end"] = "end"
```

When `has_output` is false, `output` is `None` only as a placeholder. Inspect
`has_output` to distinguish `end()` from `end(None)`.

### `ExitTerminal`

```python
@dataclass(frozen=True, slots=True)
class ExitTerminal:
    action: Action | None
    output: object
    sequence: int
    source_activation_id: int
    has_output: Literal[True] = True
    type: Literal["exit"] = "exit"
```

Exit output is the branch input that crossed the Flow boundary. `action=None`
is an unlabelled exit.

### `Terminal`

```python
Terminal: TypeAlias = EndTerminal | ExitTerminal
```

Only `ExitTerminal` has `action`. Narrow on `terminal.type` or use
`isinstance` before reading it.

### `ScopeResult`

```python
@dataclass(frozen=True, slots=True)
class ScopeResult:
    terminals: tuple[Terminal, ...]

    @property
    def outputs(self) -> tuple[object, ...]: ...
```

`outputs` includes output-bearing End and Exit values in terminal settlement
order.

### `ScopeFailure`

```python
@dataclass(frozen=True, slots=True)
class ScopeFailure:
    primary: Failure
    terminals: tuple[Terminal, ...]
    result: ScopeResult | None
    failing_activation_id: int | None
```

`result` is populated when `combine` failed after receiving a `ScopeResult`;
otherwise it is `None`. `terminals` contains work settled before the failure.

## Run results

### `RunHandle`

```python
class RunHandle(Protocol, Generic[State]):
    def done(self) -> bool: ...
    async def result(self) -> RunResult[State]: ...
```

The handle has no cancellation method. Repeated `result()` calls return the
same result object.

### `Completed`, `Failed`, and `RunResult`

```python
@dataclass(frozen=True, slots=True)
class Completed(Generic[State]):
    state: State
    terminals: tuple[Terminal, ...]
    status: Literal["completed"] = "completed"

@dataclass(frozen=True, slots=True)
class Failed(Generic[State]):
    state: State
    terminals: tuple[Terminal, ...]
    failure: Failure
    status: Literal["failed"] = "failed"

RunResult: TypeAlias = Completed[State] | Failed[State]
```

Narrow on `result.status`. The record is frozen, but nested state and terminal
values retain their normal mutability.

## Failures and errors

### `Failure`

```python
@dataclass(frozen=True, slots=True)
class Failure:
    failure_id: int
    kind: Literal[
        "handler", "retry_policy", "node_recovery", "flow_combine",
        "flow_recovery", "invalid_outcome", "unknown_action",
        "activation_limit", "internal",
    ]
    message: str
    cause: BaseException | None
    scope_id: int
    activation_id: int | None
    element_id: int | None
    attempt: int | None
    previous: Failure | None = None
```

IDs identify this run only. `attempt` is present for Node handler and retry
policy failures. A replacement policy or recovery failure links to the earlier
failure through `previous`.

### Error hierarchy

```text
Exception
└── SleyError
    ├── GraphDefinitionError
    │   └── DuplicateLinkError
    └── RunError[State]
```

- `SleyError` is the package base exception.
- `GraphDefinitionError` reports an invalid graph, option, policy, or callback
  definition.
- `DuplicateLinkError` reports a second unlabelled link or second link for one
  action.
- `RunError` is raised by `run()` for a `Failed` result. Its `result` field is
  that exact result, and a controlling application exception is attached using
  normal Python exception chaining.

Invalid initial state raises `TypeError` before callbacks run. Python accepts a
string-keyed `Mapping`, captures it as a new `dict`, and preserves nested
references. Ordinary application `Exception` instances become Failures where
retry or recovery can act; native `BaseException` behavior, including task
cancellation, is preserved.

For the corresponding port, continue to the
[TypeScript API](typescript.md).
