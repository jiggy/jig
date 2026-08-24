# flowmd-sdk

Minimal, dependency-free Python projection of FLOW Run/1.

The candidate public surface is specified in
[`docs/spec/run-sdk.md`](../../docs/spec/run-sdk.md); wire behavior is specified
in [`docs/spec/run-protocol.md`](../../docs/spec/run-protocol.md).

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

Build and verify both distribution formats with:

```console
python -m build
python tests/package_smoke.py dist/*.whl dist/*.tar.gz
```
