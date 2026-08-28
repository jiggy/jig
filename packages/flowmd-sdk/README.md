# flowmd-sdk

Minimal, dependency-free Python projection of FLOW Run/1. The separately gated
Service/1 candidate is available from `flowmd_sdk.service`.

This is a private `0.0.0` candidate, not a stable release. Its authoritative
source-checkout documents are `docs/spec/run-sdk.md`,
`docs/spec/service-sdk.md`, `docs/spec/run-protocol.md`, and
`docs/spec/service-protocol.md`. Stable external documentation URLs will be
added before publication. This installed README contains minimal quickstarts.

Finite work uses `serve()`:

```python
from flowmd_sdk import RunContext, RunResult, serve


async def run(context: RunContext) -> RunResult:
    child = await context.call_flow(
        operation_id="research:1",
        slot="research",
        intent="Research this request.",
        input=context.input,
    )
    return {"outcome": "done", "output": child["output"]}


serve(run)
```

A long-lived provider with a fixed export set uses `serve_service()`:

```python
from flowmd_sdk.service import ServiceDefinition, serve_service


async def clock(invocation):
    return {"method": invocation.method}


async def mount(context):
    await context.ready()
    await context.cancelled()


serve_service(ServiceDefinition(
    exports={"clock": clock},
    mount=mount,
))
```

`serve()` owns the process's protocol stdin and stdout and serves exactly one
root Run. Handler cancellation uses ordinary `asyncio.CancelledError`.
Cancelling a task awaiting `call_flow()` or `call_effect()` sends the matching
Run/1 cancellation notification.

`serve_service()` owns the same protocol streams for exactly one Service
Mount. Its export map is captured before protocol input. `ready()` publishes
that exact set, concurrent invocations have separate task-cancellation
lifetimes, and calls made from a context remain owned by that Mount or
invocation.

The SDK emits at most 64 outbound requests simultaneously; additional calling
tasks wait for wire admission. It emits at most 65,536 outbound requests over
the complete Run lifetime; a later call fails locally with `OperationError`
code `RESOURCE_EXHAUSTED` rather than emitting another frame.
