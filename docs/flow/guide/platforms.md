---
title: Host and platform integration
description: Implement FLOW invocation in coding agents, ACP clients, and agent platforms.
---

# Host and platform integration

A FLOW host lets your application invoke a reusable method with input and receive
an outcome with data. The method can use code, Agent judgment, or other methods.
Your host selects its implementation and supplies its local powers and execution
context.

This guide is for maintainers adding that ability to a coding agent or platform.
For writing a method instead, start with the [SDK tutorials](./start.mdx).

## Component entry and dependency invocation

Run/0 has two requests because the caller and host supply different information:

| Request | Sender → receiver | Responsibility |
| --- | --- | --- |
| `flow/run` | Host → component | Start the selected component with its complete invocation context. |
| `flow/call` | Component → host | Request an invocation through a declared dependency slot, supplying input and an operation identity. |

The host resolves the slot, checks its grants, and constructs the selected
implementation's context. The caller does not choose its credentials, settings,
attachments, scratch directory, or deadline. A child has its own context and
inherits the remaining deadline; it does not implicitly inherit other powers.

```text
Host → Flow A: flow/run
Flow A → Host: flow/call (slot: greeter)
Host → Flow B: flow/run
Flow B → Host: result
Host → Flow A: result of the call
Flow A → Host: result of its invocation
```

Every launched component receives `flow/run`, including Flow B. A child is an
invocation relationship, not a separate package type. A slot can also select a
host-provided implementation without launching another component process; its
input, result, authority and owned-work obligations still apply.

For an author, the SDK exposes `handle(handler)` to receive an invocation and
`context.call(...)` to invoke a dependency. See [Run/0](../spec/run-protocol.md)
for the wire contract and [Run SDK/0](../spec/run-sdk.md) for that authoring API.

## Place the host alongside ACP

The Agent Client Protocol (ACP) connects a client, such as an editor, to a coding
agent. FLOW connects a host to callable method implementations. These roles are
independent; ACP support does not supply a Run/0 host.

| Placement | What your integration owns |
| --- | --- |
| Inside an ACP Agent | The coding agent hosts Flows as part of its work, launching components and consuming their results. |
| Inside an ACP Client or platform | The application hosts Flows and can supply dependencies backed by one or more ACP Agents. |

In either placement, implement the same FLOW boundary. When supplying an
ACP-backed dependency, an adapter must translate the dependency's declared
input into the Agent's session/prompt API and validate the completed answer
against its result contract. ACP updates are observations; they are not a FLOW
terminal result. Own the session through completion, failure and cancellation,
and distinguish a settled failure from uncertain dispatch. Use separate Agent
contexts when the method requires that isolation.

The application chooses the Agent route and its grants. An arbitrary slot name
or model response must not create a new route. FLOW does not define a universal
ACP adapter, provider configuration, or host admission UI. Consult the
[ACP documentation](https://agentclientprotocol.com/protocol/v1/overview) for its
session protocol; use the dependency's actual invocation contract for its data.

### Walkthrough: Servicing a declared slot with an ACP Agent

Consider a caller Flow that declares a dependency slot `summarizer` in its
`FLOW.meta.json`:

```json
{"uses":{"summarizer":{}}}
```

When running in an ACP Client orchestrator, the host routes calls for
`slot: "summarizer"` to an admitted ACP Agent session. The integration follows
these explicit boundaries:

1. **Declared route validation**:
   The caller component issues a child call:
   ```json
   {"jsonrpc":"2.0","id":"c:1","method":"flow/call","params":{"slot":"summarizer","operationId":"sum:1","input":{"text":"..."}}}
   ```
   The host validates that `slot: "summarizer"` exists in its static, operator-authorized
   route table. A model-generated slot name or ungranted target is refused immediately
   with a JSON-RPC error.
2. **Translate input to an ACP prompt**:
   The adapter formats the declared input into the ACP Agent's prompt or session work.
   It supplies bounded context and instructions, preserving any attachments or scratch
   directories authorized for that slot.
3. **ACP updates are observations, not terminal results**:
   During execution, the ACP Agent emits streaming notifications (text tokens, tool
   calls, thought updates). These are streaming observations. If the caller component
   declared an incoming progress channel, the host may forward updates; otherwise,
   they serve as host diagnostics. They do not fulfill the pending `flow/call`.
4. **Contract validation of the final answer**:
   When the ACP Agent signals turn completion, the adapter extracts the final response,
   validates that it satisfies the slot's contract (e.g., verifying `{ summary: string }`),
   and returns the complete correlated result to the caller component:
   ```json
   {"jsonrpc":"2.0","id":"c:1","result":{"outcome":"done","output":{"summary":"..."}}}
   ```
5. **Cancellation and failure ownership**:
   If the caller cancels or hits a deadline, the host sends `request/cancel` and the
   adapter terminates or cancels the ACP session (`session/cancel`). If the ACP Agent
   process crashes, disconnects, or emits malformed output, the adapter returns a
   settled JSON-RPC operational error. If side effects cannot be verified, the host
   records execution as uncertain rather than retrying automatically.

| Responsibility | Who implements it |
| --- | --- |
| Transport, process launch & ACP session lifecycle | The maintainer / platform integration |
| Run/0 framing, slot validation, deadlines & child responses | The FLOW host framework |
| Component execution, recipe selection & dependency calls | The Flow component (via SDK or Markdown interpreter) |

## Implement the invocation lifecycle

1. Inspect [Package/0](../spec/package-format.md): exactly one root `FLOW.<ext>`
   entrypoint, its metadata, and any invocation contract. Code metadata lives in
   optional `FLOW.meta.json`; Markdown metadata lives in frontmatter. Check the
   selected runtime, dependency requirements and supported channels.
2. Prepare the execution environment and grants before starting work. Supply
   only selected settings, attachments, scratch space and a finite deadline.
   Keep credentials with their responsible host implementation.
3. Send one complete `flow/run` request with a string request ID. Run/0 uses
   bounded LF-terminated UTF-8 JSON objects over full-duplex stdio. Keep the
   reader active while awaiting responses and serialize writes. Stderr carries
   diagnostics, not protocol frames.
4. Service `flow/call` only while its invocation owner is pending. Validate its
   declared slot, operation identity, input and any explicit channel transfer;
   resolve only an authorized implementation. Supply the callee's own context.
5. Return and validate complete `{ outcome, output }` results. Declared domain
   refusals are normal results; operational failures use the JSON-RPC error
   envelope. Neither progress nor channel EOF establishes successful execution.
6. On cancellation, send `request/cancel` with the pending request's ID. Enforce
   deadlines and bounded termination even if the component ignores cancellation.
   Settle the complete owned subtree and resources; do not retry uncertain work
   automatically.
7. After a terminal response, drain stdout and await process exit. Accept success
   only with a valid correlated result, no pending owned requests, no trailing
   bytes or frames, successful cleanup and a zero exit status. A shutdown kill
   after a result is an execution failure.

Cancellation has this exact notification shape; it carries no `id` and receives
no response:

```json
{"jsonrpc":"2.0","method":"request/cancel","params":{"requestId":"host:1"}}
```

Run/0 specifies validation, error codes, identity, cancellation and completion in
more detail. These duties do not prescribe Jig's review, persistence or sandbox
implementation.

## Exercise both directions locally

This trusted-code exercise runs a caller and a greeter using Node 24, npm and
Python 3.11+ on Linux or macOS. It uses the public, standard-library-only
[Run/0 test peer](https://github.com/jiggy/jig/tree/main/conformance/run-0/python-peer).
The peer checks framing and process completion. It inherits the launching
process's environment and does not contain descendants; run it with the clean
environment below and only code you trust. It is not a production host library.

Create an empty directory and install the published SDK:

```sh
npm init -y
npm pkg set type=module
npm install --save-exact @jigging/flow@alpha
mkdir greeter
```

Save this caller as `FLOW.mjs`:

```js
import { handle } from "@jigging/flow";

await handle(async (context) => context.call({
  operationId: "greet:1",
  slot: "greeter",
  input: context.input,
}));
```

Declare its dependency in `FLOW.meta.json`:

```json
{"uses":{"greeter":{}}}
```

Save this implementation as `greeter/FLOW.mjs`. Both packages use the installed
SDK in this local exercise:

```js
import { handle } from "@jigging/flow";

await handle(async (context) => ({
  outcome: "done",
  output: { message: `Hello, ${context.input}!` },
}));
```

Save the public peer's `run0_peer.py` in the exercise directory, then save this
as `host.py`. It serves one exact dependency call for these packages. A general
host additionally needs the other validation, authority, concurrency, channels
and lifecycle duties described above.

```python
import json
import tempfile
import time
from pathlib import Path
from run0_peer import HostPeer, flow_run_request, require_exact_object, success


def done_result(message, request_id):
    require_exact_object(message, {"jsonrpc", "id", "result"})
    if message["id"] != request_id:
        raise RuntimeError("Unexpected response ID")
    result = require_exact_object(message["result"], {"outcome", "output"})
    if result["outcome"] != "done":
        raise RuntimeError("These packages declare only the done outcome")
    return result


def remaining(deadline):
    seconds = (deadline - int(time.time() * 1000)) / 1000
    if seconds <= 0:
        raise TimeoutError("Invocation deadline expired")
    return seconds


with tempfile.TemporaryDirectory() as directory:
    scratch = Path(directory)
    (scratch / "caller").mkdir()
    (scratch / "greeter").mkdir()
    deadline = int(time.time() * 1000) + 5_000
    request = flow_run_request("host:1", "Ada")
    request["params"].update(scratch=str(scratch / "caller"), deadlineUnixMs=deadline)

    with HostPeer(["node", "FLOW.mjs"], timeout=1) as caller:
        caller.send(request)
        call = caller.validate_request(
            caller.receive(timeout=remaining(deadline)), "flow/call"
        )
        params = require_exact_object(call["params"], {"slot", "operationId", "input"})
        if params != {"slot": "greeter", "operationId": "greet:1", "input": "Ada"}:
            raise RuntimeError("The call does not match this exercise's granted route")

        child_request = flow_run_request("host:greeter:1", params["input"])
        child_request["params"].update(
            scratch=str(scratch / "greeter"), deadlineUnixMs=deadline
        )
        with HostPeer(["node", "greeter/FLOW.mjs"], timeout=1) as greeter:
            greeter.send(child_request)
            child_result = done_result(
                greeter.receive(timeout=remaining(deadline)), "host:greeter:1"
            )
            greeter.finish()

        caller.send(success(call["id"], child_result))
        result = done_result(caller.receive(timeout=remaining(deadline)), "host:1")
        caller.finish()

    if result != {"outcome": "done", "output": {"message": "Hello, Ada!"}}:
        raise RuntimeError("Unexpected greeting result")
    print(json.dumps(result))
```

Run the exercise without ambient credentials:

```sh
env -i PATH="$PATH" python3 host.py
```

The expected output is:

```json
{"outcome":"done","output":{"message":"Hello, Ada!"}}
```

Change `Hello,` to `Welcome,` in the greeter and change the final expected message
in `host.py`. Run again: the caller is unchanged and receives the new result.
As a failure case, remove `output` from the greeter's return value. The SDK
rejects it; the host does not print a successful result. A component which emits
trailing stdout or exits nonzero after responding must also fail completion.

## Verify an implementation

Use the [Run/0 conformance corpus](https://github.com/jiggy/jig/tree/main/conformance/run-0)
and its README for executable component/host-peer checks. Start with ordinary
invocation and slot calls, then test malformed frames, error responses,
cancellation, pending work, nonzero exits and trailing output. Implement the
channel extension when your host claims that support.

Protocol evidence does not establish containment. The host's threat model must
cover filesystem and network authority, resource limits, credentials, descendant
ownership and cleanup. Those controls belong to the host; a method declaration
cannot grant them. Share implementation experience in
[GitHub Discussions](https://github.com/jiggy/jig/discussions).
