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

## Direct channels

Channels exchange bounded JSON values while ordinary calls execute. On a host
supporting the selected update contract, an application can filter Agent updates
without confusing progress completion with the Agent's result:

```python
import asyncio
from jiggy.flow import JsonValue, OperationError, RunContext, RunResult

async def run(context: RunContext) -> RunResult:
    updates = await context.channel(contract="./contracts/public-updates.json")

    async def invoke() -> JsonValue:
        try:
            return await context.call_capability(
                operation_id="answer", slot="agent", method="run", input=context.input,
                channels={"events": updates.send},
            )
        except (Exception, asyncio.CancelledError):
            try:
                await updates.receive.aclose()
            except (Exception, asyncio.CancelledError):
                pass  # Preserve the execution failure, including rejected admission.
            raise

    async def observe() -> None:
        try:
            async with updates.receive:
                async for value in updates.receive:
                    print(value, flush=True)  # Interpret and filter this contract's values.
        except OperationError as error:
            if error.code not in {"LAGGED", "DISCONNECTED"}:
                raise
            print("Progress delivery was incomplete.", flush=True)

    execution, observed = await asyncio.gather(invoke(), observe(), return_exceptions=True)
    if isinstance(execution, BaseException):
        raise execution
    if isinstance(observed, BaseException):
        raise observed
    return {"outcome": "done", "output": execution}
```

The package-local contract describes message meaning; the host must support that exact contract before
dispatch. `asyncio.gather` starts execution and observation together and settles both.
The application must still interpret the returned Agent outcome.

`context.channels` contains declared, host-granted endpoints. An unused endpoint
can be passed through `channels=` on an ordinary child or capability call.
`await sender.send(value)` acknowledges host acceptance, not processing;
`await sender.close()` seals the writer. Receivers provide one async iterator,
`start_sequence`, and `aclose()`. Use `async with` or `finally: await receiver.aclose()`
when iteration may stop early. Disposal settles prior reads and exposes a racing
failure once; cancelling observation does not cancel the work.

Normal `try/except` remains sufficient for recoverable errors. Returning with
unfinished owned work or an active unfinished receiver refuses success. Host
ownership and cleanup—not channel EOF—determine execution completion.

This SDK implements direct JSON channels, not broadcast, binary transport,
WebSockets or continuing Agent control. The wire ceilings remain 64 simultaneous
requests and 65,536 request frames over the Run lifetime. Ordinary admission
reserves one concurrent slot and endpoint-bounded request IDs for settlement;
exhausted ordinary capacity waits or fails with `RESOURCE_EXHAUSTED` before
consuming those reserves.
