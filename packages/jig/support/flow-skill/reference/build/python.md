---
title: Write a Flow in Python
description: Package a Python procedure with explicit input, an outcome, and a result another consumer can check.
---

# Write a Flow in Python

Use `jiggy-flow` to receive a host invocation and return a result from Python.
Callers use the same input and result boundary for Python, TypeScript, and Markdown methods.

The illustrative classifier recognizes a few words and suggests a support queue.
The application owns any routing or assignment that follows.

## What you need

The SDK requires Python 3.11 or newer and has no runtime dependencies.
Execution also needs a host that supports Python and the package's dependencies.
Jig's current alpha supports Markdown and TypeScript, so use the local SDK check below for this Python example.
The [support reference](../reference/support.md) separates SDK availability from qualified host support.

## Install the SDK

Create a virtual environment:

```sh
python -m venv .venv
```

Activate it with `source .venv/bin/activate` on Linux or macOS.
In Windows PowerShell, use `.venv\Scripts\Activate.ps1`.
Then install the latest published prerelease from [PyPI](https://pypi.org/project/jiggy-flow/):

```sh
python -m pip install --upgrade --pre jiggy-flow
```

This guide describes the current source interface.
To qualify an unpublished candidate, install its matching built wheel.
Use the revision qualified by your selected host when integrating an application.

## Write the method

Save this as `FLOW.py`:

```python title="FLOW.py"
from jiggy.flow import OperationError, RunContext, RunResult, handle


async def run(context: RunContext) -> RunResult:
    value = context.input
    message = value.get("message") if isinstance(value, dict) else None
    if not isinstance(message, str):
        raise OperationError(
            "INVALID_INPUT", "Expected an object with a message string."
        )

    text = message.lower()
    if any(word in text for word in ("charged", "invoice", "payment")):
        queue = "billing"
    elif any(word in text for word in ("password", "login", "error")):
        queue = "technical"
    else:
        queue = "manual"

    return {"outcome": "done", "output": {"queue": queue}}


handle(run)
```

`handle()` is the synchronous entrypoint that owns the event loop and serves one invocation.
Call it at process entry, outside an existing asyncio loop.
The handler returns portable data or raises an operational error.

For input `{"message":"I was charged twice."}`, the method returns:

```json
{"outcome":"done","output":{"queue":"billing"}}
```

For `{"message":12}`, the handler raises `INVALID_INPUT`.
[Outcomes and failures](outcomes.md) explains how callers handle these distinct responses.

## Check it locally

Follow [Exercise an installed SDK](https://flow.jig.md/implement/sdk.md#exercise-an-installed-sdk) with this `FLOW.py` and its classifier input.
That complete POSIX exercise supplies a Run/0 request and checks the process response.
Use it for trusted local code and SDK qualification.
It provides neither host containment nor application permissions.

Starting `python FLOW.py` alone waits for the protocol request on stdin.
A production application invokes the method through a host's supported execution interface.
The host prepares the interpreter, dependencies, authority, deadline, and cleanup.

## Make it useful for your task

Add `refund` to the billing words.
Repeat the local check with `{"message":"Please refund my order."}`.
The queue changes from `manual` to `billing`.
Test representative messages before relying on the classifier's suggestions.

Keep this method's implementation in `FLOW.py`.
Optional `FLOW.meta.json` describes its purpose and declared dependencies.
Optional `FLOW.contract.json` adds input/result validation, custom outcomes, or ports when needed.
[Package/0](../spec/package-format.md) defines their exact formats.

## Build on the result

Use `context.call()` for host-bound dependencies, and inspect each returned outcome before using its output.
Await owned calls before returning your result.
The [composition guide](compose.md) explains the shared calling model.

Root cancellation reaches the handler as `asyncio.CancelledError`.
Use `try/finally` for local cleanup and propagate cancellation.
The host enforces deadlines and settles execution.

After `handle()` starts, ordinary `print()` diagnostics go to stderr.
Keep raw writes and import-time logging off protocol stdout.
The [SDK reference](../reference/sdk.md) covers settings, attachments, errors, channels, and cancellation in both languages.
