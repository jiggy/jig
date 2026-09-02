# flowmd-sdk

Minimal, dependency-free Python projection of FLOW Run/1.

This is a private `0.0.0` candidate, not a stable release. Its authoritative
documents are [Run SDK/1](https://flow.jig.md/spec/run-sdk) and
[Run/1](https://flow.jig.md/spec/run-protocol). This installed README contains
a minimal quickstart.

Finite work uses `handle()`:

```python
from flowmd_sdk import RunContext, RunResult, handle


async def run(context: RunContext) -> RunResult:
    child = await context.call_flow(
        operation_id="research:1",
        slot="research",
        intent="Research this request.",
        input=context.input,
    )
    return {"outcome": "done", "output": child["output"]}


handle(run)
```

`handle()` owns the process's protocol stdin and stdout and handles exactly one
root Run. Once called, it routes ordinary `print()` and `sys.stdout` output to
diagnostic stderr, including output after `handle()` returns. Output written
before `handle()` begins and raw writes to file descriptor 1 remain invalid
protocol output. Handler cancellation uses ordinary `asyncio.CancelledError`.
Cancelling a task awaiting `call_flow()` or `call_effect()` sends the matching
Run/1 cancellation notification.

The SDK emits at most 64 outbound requests simultaneously; additional calling
tasks wait for wire admission. It emits at most 65,536 outbound requests over
the complete Run lifetime; a later call fails locally with `OperationError`
code `RESOURCE_EXHAUSTED` rather than emitting another frame.
