# jiggy-flow

Minimal, dependency-free Python projection of FLOW Run/1.

This is the `0.1.0a1` prerelease candidate. Publication is tracked on
[PyPI](https://pypi.org/project/jiggy-flow/0.1.0a1/); it does not establish a stable
compatibility promise. Python 3.11 or newer is required. Once published, install
with `python -m pip install jiggy-flow==0.1.0a1`, or install the candidate wheel
before publication. The SDK has no third-party runtime dependencies.

The [Python guide](https://flow.jig.md/guide/python) walks through a complete
method and a local Run/1 exchange. FLOW does not require Jig; execution support
belongs to the chosen host. Its authoritative documents are [Run SDK/1](https://flow.jig.md/spec/run-sdk) and
[Run/1](https://flow.jig.md/spec/run-protocol). This installed README contains
a minimal quickstart.

Finite work uses `handle()`:

```python
from jiggy.flow import RunContext, RunResult, handle


async def run(context: RunContext) -> RunResult:
    child = await context.run_child_flow(
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
Cancelling a task awaiting `run_child_flow()` or `call_capability()` sends the matching
Run/1 cancellation notification.

The SDK emits at most 64 outbound requests simultaneously; additional calling
tasks wait for wire admission. It emits at most 65,536 outbound requests over
the complete Run lifetime; a later call fails locally with `OperationError`
code `RESOURCE_EXHAUSTED` rather than emitting another frame.
