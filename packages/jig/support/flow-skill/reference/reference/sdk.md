---
title: SDK API
description: Look up FLOW handlers, invocation context, dependency calls, results, errors, artifacts, and channels.
---

# SDK API

The SDK receives one invocation, exposes its context, and lets your method call host-bound dependencies.
Use the same handler API for a directly launched Flow and a Flow called by another method.

| Language | Package | Import |
| --- | --- | --- |
| TypeScript or JavaScript | `@jigging/flow` | `@jigging/flow` |
| Python | `jiggy-flow` | `jiggy.flow` |

This page summarizes the current author interface.
[Run SDK/0](../spec/run-sdk.md) defines exact types and behavior, with [Run/0](../spec/run-protocol.md) owning the wire protocol.
For installation and a complete task, follow the [build guides](https://flow.jig.md/build/).

## Receive an invocation

TypeScript's `handle(handler)` returns a promise and receives an async handler:

```ts
import { handle } from "@jigging/flow";

await handle(async (run) => ({ outcome: "done", output: run.input }));
```

Python's `handle(handler)` creates and owns the event loop:

```python
from jiggy.flow import RunContext, RunResult, handle


async def run(context: RunContext) -> RunResult:
    return {"outcome": "done", "output": context.input}


handle(run)
```

These illustrative echo handlers require a host exchange on stdin and stdout.
Python's synchronous entrypoint belongs outside an already-running asyncio loop.
The host supplies the context and qualifies the execution runtime.

## Invocation context

| TypeScript | Python | Contains |
| --- | --- | --- |
| `run.input` | `context.input` | The invocation's JSON/0 input. |
| `run.settings` | `context.settings` | Validated implementation settings. |
| `run.attachments` | `context.attachments` | Authorized attachment paths and access modes, with artifact references on readonly views. |
| `run.channels` | `context.channels` | Endpoints supplied for this invocation. |
| `run.scratch` | `context.scratch` | The host-prepared scratch directory. |
| `run.deadlineUnixMs` | `context.deadline_unix_ms` | The host-supplied finite deadline. |
| `run.signal` | Handler task cancellation | Root cancellation. |

Declarations name needed interfaces. The host supplies actual implementations, context, and authority.
The SDK exposes the deadline, and the host enforces it.

## Call a dependency

Inside a handler, an illustrative call to a host-bound `reviewer` slot is:

```ts
const result = await run.call({
  operationId: "review:1",
  slot: "reviewer",
  input: run.input,
});
```

The equivalent Python call is:

```python
result = await context.call(
    operation_id="review:1", slot="reviewer", input=context.input,
)
```

Declare the slot under `uses` in the package metadata.
The host binds and authorizes its target before invocation.
Your code supplies the operation identity according to [Run/0 identity rules](../spec/run-protocol.md#6-operation-identity).

Optional call fields carry `intent`, `channels`, and `attachments`.
Intent is advisory metadata. Explicit channel and attachment mappings carry the rights the host checks.
See [Run SDK/0 values and snapshots](../spec/run-sdk.md#4-values-and-snapshots) for optional-field and snapshot semantics.

## Results and errors

`call` returns a complete `CallResult`, including `outcome`, `output`, and optional held `artifacts`.
Inspect the outcome before consuming its output.
Declared domain outcomes remain data. Operational failures raise `OperationError`.

| Value | Use |
| --- | --- |
| `RunResult` | The handler's `outcome`, JSON/0 `output`, and optional selected `artifactResults`. |
| `CallResult` | A dependency's `outcome`, JSON/0 `output`, and optional held `artifacts`. |
| `OperationError.code` | Machine-readable failure classification. |
| `OperationError.message` | Human-readable explanation. |
| `OperationError.details` | Optional structured detail, represented by `None` when omitted in Python. |

Branch on error codes rather than human messages.
Invalid handler results become `INVALID_RESULT`.
`PROTOCOL_ERROR` and `CHANNEL_LOST` are local-only classifications.
See [results and errors](../spec/run-sdk.md#5-results-and-errors) for the complete rules.

## Cancellation and owned work

TypeScript accepts a call-specific `AbortSignal` as `run.call`'s second argument.
Python uses ordinary task cancellation for an awaited call.
Both cancel the local wait and send protocol cancellation when the request reached the wire.

Await owned calls before returning the handler result.
The SDK settles outstanding requests and rejects abandoned live work.
Cancellation neither proves remote work stopped nor reverses an external effect.
The host owns enforcement and final settlement.

## Channels and artifacts

`run.channel(...)` or `context.channel(...)` requests a direct pair or isolated broadcast channel.
The API exposes sender, receiver, and broadcast interfaces for sending, observing, subscribing, and closing.
Read the [channel projection](../spec/run-sdk.md#9-channel-projection) for exact types and ownership.

Artifacts are opaque held references outside domain JSON.
Forward selected references through `artifactResults` and explicit attachment mappings.
Ordinary cleanup releases live rights automatically.
Advanced early release uses `release(...)`, when the host supports that operation.
Read [immutable artifact handoff](../spec/run-sdk.md#immutable-artifact-handoff) before transferring or releasing references.

## Protocol output

After entry, the SDK routes ordinary console or `print` diagnostics to stderr.
Keep import-time logging, raw stdout writes, and inherited child stdout off the protocol stream.
For exact logging and completion semantics, use [Run SDK/0](../spec/run-sdk.md).
