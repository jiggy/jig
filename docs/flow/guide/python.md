---
title: Write a Flow in Python
---

# Write a Flow in Python

`jiggy-flow` lets a Python method receive one FLOW Run/1 invocation, call
host-supplied slots, and return an outcome with data.
It has no runtime dependencies and requires Python 3.11 or newer.
FLOW is independent of Jig; choose a host that supports Python execution.

## Install

Install the latest published prerelease from
[PyPI](https://pypi.org/project/jiggy-flow/) into your application's virtual environment:

```sh
python -m venv .venv
```

Activate with `source .venv/bin/activate` on Linux/macOS or
`.venv\Scripts\Activate.ps1` in Windows PowerShell, then:

```sh
python -m pip install --upgrade --pre jiggy-flow
```

This guide describes the current source interface. To test an unpublished
candidate, pass its matching built `.whl` file to `python -m pip install`;
an older published archive does not establish support for this interface.
An installed package needs neither this repository nor a development task runner.

## Write a method

Save this as `FLOW.py`:

```python
from jiggy.flow import RunContext, RunResult, handle


async def run(context: RunContext) -> RunResult:
    print("Preparing a greeting")  # Diagnostics go to stderr after handle starts.
    return {"outcome": "done", "output": {"greeting": "Hello", "received": context.input}}


handle(run)
```

`handle` is a synchronous entrypoint that owns the event loop and serves one
Run. Starting `python FLOW.py` alone waits for a protocol invocation on stdin.
Do not call it inside an already-running asyncio loop.

## Exercise the protocol locally

For a trusted local example on Linux or macOS, use the repository's existing
[independent Python test peer](https://github.com/jiggy/jig/tree/main/conformance/run-1/python-peer).
Save its `run1_peer.py` next to `FLOW.py`, then save the following as `try_flow.py`:

```python
import sys
import tempfile
import time
from run1_peer import HostPeer, flow_run_request


with tempfile.TemporaryDirectory() as scratch:
    request = flow_run_request("host:1", {"name": "Ada"})
    request["params"]["scratch"] = scratch
    request["params"]["deadlineUnixMs"] = int(time.time() * 1000) + 10_000
    with HostPeer([sys.executable, "FLOW.py"]) as peer:
        peer.send(request)
        response = peer.receive()
        print(response)
        peer.finish()
```

Run `python try_flow.py`. The response contains `result.outcome: "done"` and
`result.output` with the greeting and supplied input. The test peer is a bounded
protocol exercise, not a sandbox or production host; run only your own trusted
code with it. Its pipe polling is POSIX-specific. Installed SDK runtime tests
also run in the Windows CI job independently of this peer.

`FLOW.py` is the package's single implementation. Add optional `FLOW.meta.json`
for metadata/dependencies and `FLOW.contract.json` for input/result validation or
ports, as specified by [Package/1](../spec/package-format.md). A host owns
launching the interpreter, dependency preparation, authority, limits and cleanup.

## Call a declared slot

Inside your handler, use slots configured by the invoking host:

```python
child = await context.call(
    operation_id="summarize-1", slot="summarizer", input=context.input,
)
result = await context.call(
    operation_id="lookup-1", slot="catalogue", input=child["output"],
)
```

Every call returns the complete `{ outcome, output }` result, whether the selected
implementation is a Flow or a native service. Declare both slots under `uses`
in `FLOW.meta.json`; the host selects and authorizes their implementations.
Naming a slot never grants authority or creates a provider. Operation IDs are supplied by your method and follow Run/1's identity
rules. Await owned calls before returning the root result.

`context.settings`, `context.attachments`, `context.scratch` and
`context.deadline_unix_ms` contain host-supplied invocation data. Attachments
map names to paths and access modes; the SDK does not discover local files or
choose permissions.

## Handle failure and cancellation

Inspect the returned `outcome` for a domain refusal such as `blocked` or
`not-found`; it is normal result data. `OperationError` carries an operational `code` and
optional `details`, such as `UNAVAILABLE` or `INVALID_INPUT`. Do not turn every
exception into a successful method outcome.

Root cancellation cancels the handler using `asyncio.CancelledError`. Cancelling
an asyncio task awaiting a call also cancels that local
wait and sends protocol cancellation if dispatched. Use `try/finally` for local
cleanup and propagate cancellation. A deadline is supplied context, not a timer
created by the SDK. The host owns enforcement and settlement.

Return JSON/1 values only: bounded JSON with safe integral numbers and valid
Unicode. Invalid handler results become `INVALID_RESULT`. Keep protocol stdout
free of raw writes and output from imports before `handle`; ordinary `print`
after entry goes to stderr. See [Run SDK/1](../spec/run-sdk.md) for exact limits,
result validation, logging and cancellation semantics shared with TypeScript.
