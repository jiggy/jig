# FLOW Run SDK/1

> *Status: prerelease SDK projection of [`FLOW Run/1`](run-protocol.md).*

This document fixes the public component-author interface for the Run/1
slice. It does not add wire behavior. When this document and Run/1 differ,
Run/1 owns the protocol and this projection must be corrected.

## 1. Surface and ownership

The TypeScript package root is `@jigging/flow`. The Python distribution is
`jiggy-flow`, imported as `jiggy.flow`. These root modules expose Run SDK/1
only.

Both expose only:

```text
handle
RunContext
RunResult
OperationError
JSON value types
attachment types
handler types
ChannelSender / ChannelReceiver / ChannelEndpoint / ChannelPair / ChannelBroadcast
ChannelContractIdentity
```

The TypeScript projection additionally names `FlowCall`, `CallOptions`,
`ChannelOptions`, and `ChannelCloseOptions`; Python expresses the same values as keyword-only method
arguments and uses ordinary task cancellation.

`handle` receives this Flow's `flow/run` invocation. `run.call(...)` invokes a
declared local slot through `flow/call` and returns its complete `RunResult`,
whether the host selects an ordinary Flow or a native implementation. Authors
do not construct the host-supplied context. The initial single-operation profile
accepts no method or operation selector.

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
  readonly channels?: Readonly<Record<string, ChannelEndpoint>>;
}

interface RunContext {
  readonly input: JsonValue;
  readonly settings: Readonly<Record<string, JsonValue>>;
  readonly attachments: Readonly<Record<string, Attachment>>;
  readonly channels: Readonly<Record<string, ChannelEndpoint>>;
  readonly scratch: string;
  readonly deadlineUnixMs: number;
  readonly signal: AbortSignal;

  call(call: FlowCall, options?: { signal?: AbortSignal }): Promise<RunResult>;

  channel(options: ChannelOptions & { delivery: 'broadcast' }, callOptions?: CallOptions):
    Promise<ChannelBroadcast>;
  channel(options?: ChannelOptions & { delivery?: 'direct' }, callOptions?: CallOptions):
    Promise<ChannelPair>;
  channel(options: ChannelOptions, callOptions?: CallOptions):
    Promise<ChannelPair | ChannelBroadcast>;
}

type RunHandler = (context: RunContext) => Promise<RunResult>;

declare function handle(handler: RunHandler): Promise<void>;
```

`run.signal` reports root cancellation. If a call-specific signal is already
aborted when `run.call` is invoked, or becomes aborted while
that call is pending, the returned promise rejects with an `OperationError`
whose `code` is exactly `CANCELLED`. The SDK sends `request/cancel` if the
request reached the wire. This cancels the local wait promptly; it does not
claim that remote work was undone.

Code which catches only to observe this cancellation must rethrow every other
failure:

```ts
try {
  await run.call(call, { signal });
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
    def channels(self) -> Mapping[str, ChannelEndpoint]: ...

    @property
    def scratch(self) -> str: ...

    @property
    def deadline_unix_ms(self) -> int: ...

    async def call(
        self,
        *,
        operation_id: str,
        slot: str,
        input: JsonValue,
        intent: str | None = None,
        channels: Mapping[str, ChannelEndpoint] | None = None,
    ) -> RunResult: ...

    async def channel(
        self,
        *,
        delivery: Literal["direct", "broadcast"] = "direct",
        schema: JsonValue = ...,
        contract: str | ChannelSlotContract | None = None,
    ) -> ChannelPair | ChannelBroadcast: ...


RunHandler = Callable[[RunContext], Awaitable[RunResult]]

def handle(handler: RunHandler) -> None: ...
```

`handle` owns and creates the process event loop, so it is a synchronous
entrypoint and rejects use inside an already-running `asyncio` loop. Root
cancellation cancels the handler task with ordinary `asyncio.CancelledError`.
Cancelling a task awaiting `run.call` cancels that local wait
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

Call fields are closed: `operationId`, `slot`, `input` and only optional
`intent` and `channels`. Optional-key presence enters Run/1 identity; omitted
channels and an explicit empty mapping remain distinct. TypeScript explicitly
present `undefined` optional fields reject; Python `None` means omission for
its optional keyword arguments. Intent is advisory metadata, never application
input, Agent instructions, provider arguments or authority.

The SDK never creates an `operationId`. Component code supplies a stable ID
whose retry and deduplication meaning is defined by Run/1.

## 5. Results and errors

`run.call` returns the complete `RunResult`, including its outcome. In
TypeScript, `RunResult` is itself a `JsonValue` and may be retained directly
inside another Run result without rebuilding or casting it. SDKs never unwrap
output or translate declared outcomes into exceptions. Domain outcomes such as
`blocked`, `limit` or `not-found` remain normal data; applications interpret them
explicitly. A handler forwarding a result must declare any custom outcomes it
can itself return.

Operational failure raises:

```text
OperationError(code, message?, details?)
```

Authors inspect `code`, `message`, and `details`; they do not branch on the
human message. In Python, omitted details are represented by `None`.

The thirteen Run/1 operational codes may cross the wire. `PROTOCOL_ERROR` and
`CHANNEL_LOST` are local-only classifications and are never serialized as
operational errors. An unhandled valid wire-visible `OperationError` from the
root handler is preserved. An ordinary exception, a local-only code, or
malformed error metadata becomes `EXECUTION_FAILED`.

A standard JSON-RPC error returned for a correctly emitted call is a
fatal peer incompatibility. The SDK closes the channel as `PROTOCOL_ERROR`
rather than presenting it as an ordinary call failure.

## 6. Completion and cancellation

The handler may issue concurrent calls; the SDK continues reading while
responses arrive in any order and serializes writes. At most 64
component-originated requests are live on the wire. It emits at most 65,536
requests during the channel lifetime; a later call fails locally with
`OperationError` code `RESOURCE_EXHAUSTED` and emits no request.

With channels, ordinary admission reserves at least one live slot and enough
remaining lifetime request IDs for every allocated or pending-allocation
endpoint's settlement. Settlement stays inside the same total wire ceilings.

Handler return closes admission. The SDK does not detach calls: it requests
cancellation for remaining owned work, waits for each wire request to settle,
and refuses root success when the handler abandoned a live call. A cancelled
local waiter retains an internal wire tombstone until its response or channel
termination so a late response is not misclassified as an unknown ID. An
explicitly cancelled and observed local wait is not abandonment: the handler
may return a result, but the SDK sends that root result only after the cancelled
wire request settles.

Normal `try/catch`, `try/except`, `allSettled` and `gather` remain sufficient
for settled recoverable failures. There is no acknowledgement operation or
global settled-failure ledger. An ignored already-settled failure can escape
detection; that does not waive live ownership, root cancellation, fatal
transport loss, uncertain dispatch or failed cleanup. A conclusively cleaned
child failure can remain recoverable in its healthy parent.

Handler settlement and invalid result checks precede implicit writer sealing.
An activated unfinished receiver is abandonment unless it reached terminal
failure or explicit disposal. Previously explicitly sealed intervals are not
retracted by later producer failure. The host alone knows actual transfer and
source state and performs eligible implicit sealing; SDKs never infer moved
rights from final call outcomes. Retained read/disposal settlements finish
before submitting the invocation terminal.

Once an endpoint has been offered in a call's channel map, its terminal
disposition is host-owned, including when admission fails or the callee fails
before sending data. Callers must not infer transfer from receiving a message
or try to dispose all offered endpoints after failure. They still dispose
active receivers they kept locally; the SDK tracks offered rights separately.

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
from jiggy.flow import RunContext, RunResult, handle


async def run(context: RunContext) -> RunResult:
    return {"outcome": "done", "output": context.input}


handle(run)
```

These examples require only the root `flow/run` operation. Availability of
declared slots is host configuration; calling an unavailable slot
returns `UNAVAILABLE`.

## 8. Call examples

A handler can invoke a declared slot with the following TypeScript:

```ts
import { handle } from "@jigging/flow";

await handle(async (run) => {
  const child = await run.call({
    operationId: "research:1",
    slot: "research",
    input: run.input,
  });
  return child;
});
```

The equivalent Python is:

```python
from jiggy.flow import RunContext, RunResult, handle


async def run(context: RunContext) -> RunResult:
    child = await context.call(
        operation_id="research:1",
        slot="research",
        input=context.input,
    )
    return child


handle(run)
```

When a host binds `research`, JSON/1 `input` and any explicitly mapped channel
rights cross through this SDK operation; the complete JSON/1 `RunResult`
returns separately. Child context,
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
`packages/jiggy-flow/`. The shared executable seed is
[`conformance/run-1/`](https://github.com/jiggy/jig/tree/main/conformance/run-1).

## 9. Channel projection

TypeScript names the following interfaces; Python exposes corresponding
protocols, with `start_sequence`, `aclose()`, `__anext__()` and async context
management on receivers. Python channel options are keyword-only arguments.

```ts
interface ChannelContractIdentity {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}
type ChannelOptions = {
  readonly schema?: JsonValue;
  readonly contract?: string | { readonly slot: string; readonly channel: string };
} & ({ readonly delivery?: 'direct' } | { readonly delivery: 'broadcast' });
interface ChannelCloseOptions extends CallOptions {
  readonly error?: 'LAGGED';
}
interface ChannelSender {
  readonly direction: 'send';
  readonly delivery: 'direct' | 'broadcast';
  readonly contract?: ChannelContractIdentity;
  send(value: JsonValue, options?: CallOptions): Promise<void>;
  close(options?: ChannelCloseOptions): Promise<void>;
}
interface ChannelReceiver extends AsyncIterableIterator<JsonValue> {
  readonly direction: 'receive';
  readonly delivery: 'direct' | 'broadcast';
  readonly contract?: ChannelContractIdentity;
  readonly startSequence: number;
  next(options?: CallOptions): Promise<IteratorResult<JsonValue>>;
  close(options?: CallOptions): Promise<void>;
}
type ChannelEndpoint = ChannelSender | ChannelReceiver;
interface ChannelPair {
  readonly send: ChannelSender;
  readonly receive: ChannelReceiver;
}
interface ChannelBroadcast {
  readonly send: ChannelSender;
  subscribe(options?: CallOptions): Promise<ChannelReceiver>;
}
```

Python absent contract identity is `None`. `schema` and `contract` are mutually
exclusive, including explicit `schema: true`. Endpoint references remain
private SDK/host machinery, never ordinary input data. Literal direct creation
returns `ChannelPair`; literal broadcast returns `ChannelBroadcast` in both
SDKs. Python supplies matching typing overloads and `await source.subscribe()`.

Only the creator retains `subscribe`; transferring `source.send` leaves that
authority with its creator. Each subscription gets a separate reader with an
immutable starting sequence. Subscribe before producer dispatch when a consumer
requires the beginning. Late readers receive only a suffix, not retained history.
An allocated subscription is active work even before its first read and must
finish or be disposed. Cancelling creation or subscription retains settlement
and disposes late grants; failed cleanup cannot be recovered as success.

Broadcast sends do not wait for readers. A slow reader fails locally with
`LAGGED`; a receiver-schema failure is likewise local. Both are distinct from
a source/writer error, which aborts unsealed output for all readers. The caller
still awaits execution independently and handles recoverable channel errors
with ordinary language constructs.

`await sender.close({error: 'LAGGED'})`, or Python
`await sender.close(error="LAGGED")`, declares incomplete output using ordinary
writer authority. Clean `close()` is unchanged. Abnormal close may settle a
source with pending sends; those send operations receive their own failures.
The close acknowledgement is observation evidence, never execution evidence.
It wakes active receivers with the sticky stream error without cancelling the
work. Repeated same-cause closes join settlement; a previously requested clean
end cannot be rewritten as failure. Cancellation of a close waiter retains
its settlement as before. Other producer error values are rejected locally.

There is one iterator and one pending read per receiver, without prefetch.
TypeScript iterator `return()` disposes on early loop exit. Python early exit
requires `async with receiver` or explicit `aclose()` in `finally`; a bare
`async for` break is insufficient. Fully exhausting either iterator is enough.

Cancelling an active read starts retained receiver disposal. An uncancelled
close joins that disposal and every prior read/tombstone, exposing the first
previously unexposed terminal cause. A cause received internally after its
public read was cancelled has not yet been exposed. Repeated close suppresses
that same cause only after a public operation raised/rejected with it. Cancelling
a close waiter does not cancel settlement or lose its later cause. Ordinary
language recovery applies; no acknowledgement or query operation is needed.

Local failure to start a read is an operation failure, not proof that its
endpoint ended. A fatal current-connection error remains fatal even when caught.
Sender acceptance, receiver end and the separate execution result retain their
different meanings under [Run/1](run-protocol.md#5-channels).

An application must start producer work before awaiting its first message.
In Python, assigning a coroutine alone does not start it. `gather` starts both
coroutines below and retains both outcomes:

```python
updates = await run.channel(contract={"slot": "agent", "channel": "events"})

async def invoke():
    try:
        return await run.call(
            operation_id="answer", slot="agent", input=run.input,
            channels={"events": updates.send},
        )
    except (Exception, asyncio.CancelledError):
        # Rejected admission may leave no producer to end the stream.
        try:
            await updates.receive.aclose()
        except (Exception, asyncio.CancelledError):
            pass  # Preserve the execution failure.
        raise

async def observe():
    try:
        async with updates.receive:
            async for value in updates.receive:
                print(value, flush=True)
    except OperationError as error:
        if error.code not in {"LAGGED", "DISCONNECTED"}:
            raise
        print("Progress delivery was incomplete.", flush=True)

execution, observed = await asyncio.gather(invoke(), observe(), return_exceptions=True)
if isinstance(execution, BaseException):
    raise execution
if isinstance(observed, BaseException):
    raise observed
answer = execution
```

This excerpt assumes an admitted Agent-like slot and matching package-local
channel contract. Application code interprets/filter values and the actual final
answer. Neither that slot's meaning nor a logging sink is part of FLOW.
