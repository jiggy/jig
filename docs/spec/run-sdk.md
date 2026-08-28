# FLOW Run SDK/1

**Status:** closed candidate projection of
[`FLOW Run/1`](run-protocol.md). The implementations remain private `0.0.0`
packages. The complete shared corpus has passed under the Bun peer and an
independently implemented Python host peer; publication and a general
third-party conformance label remain separate release decisions.

This document fixes the public component-author interface for the Run/1
slice. It does not add wire behavior. When this document and Run/1 differ,
Run/1 owns the protocol and this projection must be corrected.

## 1. Surface and ownership

The TypeScript package root is `@flowmd/sdk`. The Python distribution is
`flowmd-sdk`, imported as `flowmd_sdk`. These root modules expose Run SDK/1
only. The separately gated Service SDK/1 candidate uses
`@flowmd/sdk/service` and `flowmd_sdk.service`; importing this Run surface does
not imply Service/1 conformance.

Both expose only:

```text
serve
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

`serve` owns protocol stdin and stdout for the process and serves exactly one
root Run. Application logs go to stderr. Calling other protocol, resolver,
Binding, provider, sandbox, Jig administration, Service, Agent, or graph APIs
through this SDK is impossible because none are exposed.

## 2. TypeScript

```ts
type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

interface RunResult {
  readonly outcome: string;
  readonly output: JsonValue;
}

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

declare function serve(handler: RunHandler): Promise<void>;
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

def serve(handler: RunHandler) -> None: ...
```

`serve` owns and creates the process event loop, so it is a synchronous
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
outcome. `callEffect` and `call_effect` unwrap a successful effect `{ value }`.
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

The deadline is exposed as context, not implemented as an SDK timer. Jig or
another host remains responsible for enforcing it and terminating an
uncooperative process.

## 7. Minimal examples

TypeScript:

```ts
import { serve } from "@flowmd/sdk";

await serve(async (run) => {
  const child = await run.callFlow({
    operationId: "research:1",
    slot: "research",
    input: run.input,
  });
  return { outcome: "done", output: child.output };
});
```

Python:

```python
from flowmd_sdk import RunContext, RunResult, serve


async def run(context: RunContext) -> RunResult:
    child = await context.call_flow(
        operation_id="research:1",
        slot="research",
        input=context.input,
    )
    return {"outcome": "done", "output": child["output"]}


serve(run)
```

The implementations live under `packages/flow-sdk/` and
`packages/flowmd-sdk/`. The shared executable seed is
[`conformance/run-1/`](../../conformance/run-1/).
