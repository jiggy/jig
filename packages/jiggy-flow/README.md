# jiggy-flow

Minimal, dependency-free Python projection of FLOW Run/1.

The SDK is prerelease software and requires Python 3.11 or newer. Install the
latest published prerelease with `python -m pip install --upgrade --pre jiggy-flow`.
See [PyPI](https://pypi.org/project/jiggy-flow/) for available releases. Prereleases
do not establish a stable compatibility promise. The SDK has no third-party
runtime dependencies.

The [Python guide](https://flow.jig.md/guide/python) walks through a complete
method and a local Run/1 exchange. FLOW does not require Jig; execution support
belongs to the chosen host. Its authoritative documents are [Run SDK/1](https://flow.jig.md/spec/run-sdk) and
[Run/1](https://flow.jig.md/spec/run-protocol). This installed README contains
a minimal quickstart.

Finite work uses `handle()` in the package's single `FLOW.py` entrypoint:

```python
from jiggy.flow import RunContext, RunResult, handle


async def run(context: RunContext) -> RunResult:
    child = await context.call(
        operation_id="research:1",
        slot="research",
        intent="Research this request.",
        input=context.input,
    )
    return child


handle(run)
```

`handle()` owns the process's protocol stdin and stdout and handles exactly one
root Run. Once called, it routes ordinary `print()` and `sys.stdout` output to
diagnostic stderr, including output after `handle()` returns. Output written
before `handle()` begins and raw writes to file descriptor 1 remain invalid
protocol output. Handler cancellation uses ordinary `asyncio.CancelledError`.
Cancelling a task awaiting `call()` sends the matching
Run/1 cancellation notification.

`call()` invokes a declared local slot and returns the complete
`{"outcome": ..., "output": ...}` result. Domain outcomes such as `blocked` or
`not-found` are normal data; interpret them explicitly. Operational failures raise
`OperationError`. The optional `intent` is advisory metadata, separate from the
application `input`. An omitted `channels` map and `channels={}` retain distinct
call identities. Calls have no method selector. A handler forwarding a result
must declare any custom outcomes it can return in its own contract.

Optional `flow.meta.json` declares package metadata and dependency slots. Optional
`FLOW.contract.json` owns input/result validation, custom outcomes, channels and caller
attachments; `settings.schema.json` separately validates implementation settings.
No descriptor is needed for unconstrained bounded input and a `done` result.

## Direct channels

Channels exchange bounded JSON values while ordinary calls execute. On a host
supporting the selected update contract, an application can filter Agent updates
without confusing progress completion with the Agent's result:

```python
import asyncio
from jiggy.flow import OperationError, RunContext, RunResult

async def run(context: RunContext) -> RunResult:
    updates = await context.channel(contract="./contracts/public-updates.json")

    async def invoke() -> RunResult:
        try:
            return await context.call(
                operation_id="answer", slot="agent", input=context.input,
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
can be passed through `channels=` on an ordinary `call()`.
`await sender.send(value)` acknowledges host acceptance, not processing;
`await sender.close()` seals the writer. Receivers provide one async iterator,
`start_sequence`, and `aclose()`. Use `async with` or `finally: await receiver.aclose()`
when iteration may stop early. Disposal settles prior reads and exposes a racing
failure once; cancelling observation does not cancel the work.

Normal `try/except` remains sufficient for recoverable errors. Returning with
unfinished owned work or an active unfinished receiver refuses success. Host
ownership and cleanup—not channel EOF—determine execution completion.

## Broadcast channels

Use `await context.channel(delivery="broadcast")` for one writer and independent
receivers. The returned `ChannelBroadcast` has `send` and `async subscribe()`:

```python
updates = await context.channel(delivery="broadcast")
display = await updates.subscribe()
recorder = await updates.subscribe()
```

Pass the writer and each unused receiver through the same ordinary `channels=`
call maps, then settle those calls. Each subscription is active immediately:
consume it to its end or terminal failure, transfer it, or explicitly dispose it.
The creator retains subscription authority when the writer moves; the source
itself cannot move or enter JSON input. A later subscription receives only
future values, with its actual `start_sequence`; there is no history replay.

A full subscriber fails with `LAGGED` without blocking the writer or another
subscriber. Catch that error normally if incomplete observation is acceptable.
No subscribers means no retained payload, not a queued history. Source closure
rejects new subscriptions while existing subscribers drain their accepted
prefixes. Channel completion still does not establish execution success.

The SDK supports direct and broadcast JSON channels, not binary transport,
WebSockets or continuing Agent control. The wire ceilings remain 64 simultaneous
requests and 65,536 request frames over the Run lifetime. Ordinary admission
reserves one concurrent slot and endpoint-bounded request IDs for settlement;
exhausted ordinary capacity waits or fails with `RESOURCE_EXHAUSTED` before
consuming those reserves.
