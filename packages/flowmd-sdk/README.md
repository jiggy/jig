# flowmd-sdk

Minimal, dependency-free Python projection of FLOW Run/1.

This is a private `0.0.0` candidate, not a stable release. Its authoritative
source-checkout documents are `docs/spec/run-sdk.md` (the component API) and
`docs/spec/run-protocol.md` (wire behavior). Stable external documentation
URLs will be added before publication. This installed README contains a
minimal quickstart.

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

`serve()` owns the process's protocol stdin and stdout and serves exactly one
root Run. Handler cancellation uses ordinary `asyncio.CancelledError`.
Cancelling a task awaiting `call_flow()` or `call_effect()` sends the matching
Run/1 cancellation notification.

The SDK emits at most 64 outbound requests simultaneously; additional calling
tasks wait for wire admission. It emits at most 65,536 outbound requests over
the complete Run lifetime; a later call fails locally with `OperationError`
code `RESOURCE_EXHAUSTED` rather than emitting another frame.
