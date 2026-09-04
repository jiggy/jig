# FLOW Run SDK/1

> *Status: prerelease SDK projection of [`FLOW Run/1`](run-protocol.md). The
> TypeScript implementation is `@jigging/flow@0.1.0-alpha.5`; the Python
> implementation is not yet published.*

This document fixes the public component-author interface for the Run/1
slice. It does not add wire behavior. When this document and Run/1 differ,
Run/1 owns the protocol and this projection must be corrected.

## 1. Surface and ownership

The TypeScript package root is `@jigging/flow`. The Python distribution is
`flowmd-sdk`, imported as `flowmd_sdk`. These root modules expose Run SDK/1
only.

Both expose only:

```text
handle
RunContext
RunResult
OperationError
EffectError
JSON value types
attachment types
handler types
```

The TypeScript projection additionally names `FlowCall`, `EffectCall`, and
`CallOptions`; Python expresses the same values as keyword-only method
arguments and uses ordinary task cancellation.

`handle` owns protocol stdin and stdout for the process and handles exactly one
root Run. The TypeScript SDK captures its transport first, then replaces the
global console with one backed by stderr; an imported library that reads the
current global console during the handler is therefore safe. The Python SDK
routes ordinary `print()` and `sys.stdout` output to stderr. Redirection remains
installed after the one-shot call so later application output cannot become
trailing protocol bytes.

Output from modules evaluated before `handle`, a console/stdout reference
cached before `handle`, raw writes to stdout or file descriptor 1, and a child
process inheriting stdout remain invalid protocol output. Bare Run/1
implementations are responsible for keeping protocol stdout clean. The SDK
never treats malformed protocol output as a log.

A TypeScript entrypoint may import only `handle` statically and dynamically
import its application module from the handler. In that form the SDK installs
console redirection before evaluating the later application graph, including
its top-level console calls and any console methods it then caches. This is an
authoring pattern, not a second SDK operation, and it does not make raw stdout
or inherited child stdout valid.

Calling other protocol, resolver, host-configuration, provider, sandbox,
administration, Agent, or graph APIs through this SDK is impossible because
none are exposed.

## 2. TypeScript

```ts
type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type RunResult = {
  readonly outcome: string;
  readonly output: JsonValue;
};

interface FlowCall {
  readonly operationId: string;
  readonly slot: string;
  readonly intent?: string;
  readonly input: JsonValue;
}

interface EffectCall {
  readonly operationId: string;
  readonly slot: string;
  readonly method: string;
  readonly input: JsonValue;
}

interface RunContext {
  readonly input: JsonValue;
  readonly settings: Readonly<Record<string, JsonValue>>;
  readonly attachments: Readonly<Record<string, Attachment>>;
  readonly scratch: string;
  readonly deadlineUnixMs: number;
  readonly signal: AbortSignal;

  callFlow(call: FlowCall, options?: { signal?: AbortSignal }):
    Promise<RunResult>;

  callEffect(call: EffectCall, options?: { signal?: AbortSignal }):
    Promise<JsonValue>;
}

type RunHandler = (context: RunContext) => Promise<RunResult>;

declare function handle(handler: RunHandler): Promise<void>;
```

`run.signal` reports root cancellation. If a call-specific signal is already
aborted when `callFlow` or `callEffect` is invoked, or becomes aborted while
that call is pending, the returned promise rejects with an `OperationError`
whose `code` is exactly `CANCELLED`. The SDK sends `request/cancel` if the
request reached the wire. This cancels the local wait promptly; it does not
claim that remote work was undone.

Code which catches only to observe this cancellation must rethrow every other
failure:

```ts
try {
  await run.callEffect(call, { signal });
} catch (error) {
  if (!(error instanceof OperationError) || error.code !== "CANCELLED") {
    throw error;
  }
}
```

In particular, passing a call-specific signal does not convert an unrelated
effect, operation, protocol, channel, validation, or programming failure into
cancellation or success.

## 3. Python

```python
class RunResult(TypedDict):
    outcome: str
    output: JsonValue


class RunContext(Protocol):
    @property
    def input(self) -> JsonValue: ...

    @property
    def settings(self) -> Mapping[str, JsonValue]: ...

    @property
    def attachments(self) -> Mapping[str, Attachment]: ...

    @property
    def scratch(self) -> str: ...

    @property
    def deadline_unix_ms(self) -> int: ...

    async def call_flow(
        self,
        *,
        operation_id: str,
        slot: str,
        input: JsonValue,
        intent: str | None = None,
    ) -> RunResult: ...

    async def call_effect(
        self,
        *,
        operation_id: str,
        slot: str,
        method: str,
        input: JsonValue,
    ) -> JsonValue: ...


RunHandler = Callable[[RunContext], Awaitable[RunResult]]

def handle(handler: RunHandler) -> None: ...
```

`handle` owns and creates the process event loop, so it is a synchronous
entrypoint and rejects use inside an already-running `asyncio` loop. Root
cancellation cancels the handler task with ordinary `asyncio.CancelledError`.
Cancelling a task awaiting `call_flow` or `call_effect` cancels that local wait
and sends `request/cancel` if the request reached the wire.

## 4. Values and snapshots

Public type annotations describe JSON-shaped values, but the wire accepts only
bounded [`FLOW JSON/1`](json-values.md). SDKs validate every value crossing the
boundary. Invalid call arguments fail locally before a request is admitted;
invalid handler results become `INVALID_RESULT`.

Inbound values are isolated decoded snapshots. Each admitted outbound call is
also snapshotted before asynchronous dispatch, so later caller mutation cannot
change its wire meaning. The SDKs do not recursively freeze application
containers; readonly or frozen outer declarations are authoring guidance, not
a new runtime object model.

The SDK never creates an `operationId`. Component code supplies a stable ID
whose retry and deduplication meaning is defined by Run/1.

## 5. Results and errors

`callFlow` and `call_flow` return the complete child `RunResult`, including its
outcome. In TypeScript, `RunResult` is itself a `JsonValue` and may be retained
directly inside another Run result without rebuilding or casting it.
`callEffect` and `call_effect` unwrap a successful effect `{ value }`.
A declared capability error raises `EffectError`, carrying `errorName` and
`data` in TypeScript or `error_name` and `data` in Python. Its human exception
message is not portable; authors branch only on the named fields.

Operational failure raises:

```text
OperationError(code, message?, details?)
```

Authors inspect `code`, `message`, and `details`; they do not branch on the
human message. In Python, omitted details are represented by `None`.

The eleven Run/1 operational codes may cross the wire. `PROTOCOL_ERROR` and
`CHANNEL_LOST` are local-only classifications and are never serialized as
operational errors. An unhandled valid wire-visible `OperationError` from the
root handler is preserved. An ordinary exception, a local-only code, or
malformed error metadata becomes `EXECUTION_FAILED`.

A standard JSON-RPC error returned for a correctly emitted child request is a
fatal peer incompatibility. The SDK closes the channel as `PROTOCOL_ERROR`
rather than presenting it as an ordinary call failure.

## 6. Completion and cancellation

The handler may issue concurrent child calls; the SDK continues reading while
responses arrive in any order and serializes writes. At most 64
component-originated requests are live on the wire. It emits at most 65,536
requests during the channel lifetime; a later call fails locally with
`OperationError` code `RESOURCE_EXHAUSTED` and emits no request.

Handler return closes admission. The SDK does not detach calls: it requests
cancellation for remaining owned work, waits for each wire request to settle,
and refuses root success when the handler abandoned a live call. A cancelled
local waiter retains an internal wire tombstone until its response or channel
termination so a late response is not misclassified as an unknown ID. An
explicitly cancelled and observed local wait is not abandonment: the handler
may return a result, but the SDK sends that root result only after the cancelled
wire request settles.

The deadline is exposed as context, not implemented as an SDK timer. The host
is responsible for enforcing it and terminating an uncooperative process.

## 7. Minimal root examples

TypeScript:

```ts
import { handle } from "@jigging/flow";

await handle(async (run) => ({ outcome: "done", output: run.input }));
```

Python:

```python
from flowmd_sdk import RunContext, RunResult, handle


async def run(context: RunContext) -> RunResult:
    return {"outcome": "done", "output": context.input}


handle(run)
```

These examples require only the root `flow/run` operation. Availability of
child-Flow and effect slots is host configuration; calling an unavailable slot
returns `UNAVAILABLE`.

## 8. Child-call examples

A child-Flow slot may execute the following TypeScript:

```ts
import { handle } from "@jigging/flow";

await handle(async (run) => {
  const child = await run.callFlow({
    operationId: "research:1",
    slot: "research",
    input: run.input,
  });
  return { outcome: "done", output: child.output };
});
```

The equivalent Python is:

```python
from flowmd_sdk import RunContext, RunResult, handle


async def run(context: RunContext) -> RunResult:
    child = await context.call_flow(
        operation_id="research:1",
        slot="research",
        input=context.input,
    )
    return {"outcome": "done", "output": child["output"]}


handle(run)
```

When a host binds `research`, only the JSON/1 `input` crosses through this SDK
operation and only the complete JSON/1 `RunResult` returns. Child context,
authorization, and resource policy belong to the host; the SDK creates no
implicit inheritance.

The caller-supplied `operationId` retains all Run/1 join, conflict,
cancellation, and uncertainty semantics. Uncertain dispatch is not
automatically replayed. The SDK creates no separately addressable child
history, administration, scheduler, catalogue, resolver, or Agent-specific
surface.

A host may impose a lower child-concurrency limit and report
`RESOURCE_EXHAUSTED`. The Run/1 request-lifetime limit still applies.

The implementations live under `packages/flow-sdk/` and
`packages/flowmd-sdk/`. The shared executable seed is
[`conformance/run-1/`](https://github.com/jigmd/jig/tree/main/conformance/run-1).
