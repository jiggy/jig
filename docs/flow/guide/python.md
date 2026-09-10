---
title: Write a Flow in Python
---

# Write a Flow in Python

`jiggy-flow` lets a Python method receive one FLOW Run/1 invocation, call
host-supplied child Flows and capabilities, and return an outcome with data.
It has no runtime dependencies and requires Python 3.11 or newer.
FLOW is independent of Jig; choose a host that supports Python execution.

## Install

The current prerelease candidate is `0.1.0a3`. Check its
[PyPI version page](https://pypi.org/project/jiggy-flow/0.1.0a3/) for publication.
Once available, install it into your application's virtual environment:

```sh
python -m venv .venv
```

Activate with `source .venv/bin/activate` on Linux/macOS or
`.venv\Scripts\Activate.ps1` in Windows PowerShell, then:

```sh
python -m pip install jiggy-flow==0.1.0a3
```

Before publication, install the candidate wheel from its release build with
`python -m pip install /path/to/jiggy_flow-0.1.0a3-py3-none-any.whl`.
An installed package needs neither this repository nor a development task runner.

## Write a method

Save this as `flow.py`:

```python
from jiggy.flow import RunContext, RunResult, handle


async def run(context: RunContext) -> RunResult:
    print("Preparing a greeting")  # Diagnostics go to stderr after handle starts.
    return {"outcome": "done", "output": {"greeting": "Hello", "received": context.input}}


handle(run)
```

`handle` is a synchronous entrypoint that owns the event loop and serves one
Run. Starting `python flow.py` alone waits for a protocol invocation on stdin.
Do not call it inside an already-running asyncio loop.

## Exercise the protocol locally

For a trusted local example on Linux or macOS, use the repository's existing
[independent Python test peer](https://github.com/jiggy/jig/tree/main/conformance/run-1/python-peer).
Save its `run1_peer.py` next to `flow.py`, then save the following as `try_flow.py`:

```python
import sys
import tempfile
import time
from run1_peer import HostPeer, flow_run_request


with tempfile.TemporaryDirectory() as scratch:
    request = flow_run_request("host:1", {"name": "Ada"})
    request["params"]["scratch"] = scratch
    request["params"]["deadlineUnixMs"] = int(time.time() * 1000) + 10_000
    with HostPeer([sys.executable, "flow.py"]) as peer:
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

To distribute a complete Flow package, add `FLOW.md` and describe the Python
entrypoint as specified by [Package/1](../spec/package-format.md). A host owns
launching the interpreter, dependency preparation, authority, limits and cleanup.

## Call a child Flow or capability

Inside your handler, use slots configured by the invoking host:

```python
child = await context.run_child_flow(
    operation_id="summarize-1", slot="summarizer", input=context.input,
)
value = await context.call_capability(
    operation_id="lookup-1", slot="catalogue", method="lookup", input=child["output"],
)
```

A child returns a complete `{ outcome, output }` result; a successful capability
call returns its value. Naming a slot never grants authority or creates a
provider. Operation IDs are supplied by your method and follow Run/1's identity
rules. Await owned calls before returning the root result.

`context.settings`, `context.attachments`, `context.scratch` and
`context.deadline_unix_ms` contain host-supplied invocation data. Attachments
map names to paths and access modes; the SDK does not discover local files or
choose permissions.

## Handle failure and cancellation

Catch `CapabilityError` for a declared capability application error; inspect
`error_name` and `data`. `OperationError` carries an operational `code` and
optional `details`, such as `UNAVAILABLE` or `INVALID_INPUT`. Do not turn every
exception into a successful method outcome.

Root cancellation cancels the handler using `asyncio.CancelledError`. Cancelling
an asyncio task awaiting a child or capability call also cancels that local
wait and sends protocol cancellation if dispatched. Use `try/finally` for local
cleanup and propagate cancellation. A deadline is supplied context, not a timer
created by the SDK. The host owns enforcement and settlement.

Return JSON/1 values only: bounded JSON with safe integral numbers and valid
Unicode. Invalid handler results become `INVALID_RESULT`. Keep protocol stdout
free of raw writes and output from imports before `handle`; ordinary `print`
after entry goes to stderr. See [Run SDK/1](../spec/run-sdk.md) for exact limits,
result validation, logging and cancellation semantics shared with TypeScript.
