---
title: Write a Flow in TypeScript or JavaScript
description: Install the FLOW SDK, handle input, call methods, and exercise a local Run/0 exchange.
---

# Write a Flow in TypeScript or JavaScript

`@jigging/flow` lets a method receive one FLOW Run/0 invocation, call
host-supplied slots, and return an outcome with data. It has no runtime
dependencies. The same SDK serves TypeScript and JavaScript; your host supplies
the execution runtime and local powers.

## Install and write a method

For a local SDK exercise, use Node 24 and npm in an empty directory:

```sh
npm init -y
npm pkg set type=module
npm install --save-exact @jigging/flow@alpha
```

Use the explicit `alpha` channel. Keep the resolved package version and lockfile
with your application. For a hosted project, follow that host's dependency
packaging instructions; [Jig's first Flow](https://jig.md/guide/) initializes
a package with its qualified SDK revision.

Save this as `FLOW.ts`:

```ts
import { handle } from "@jigging/flow";

await handle(async (run) => {
  console.log("Preparing a greeting");
  return {
    outcome: "done",
    output: { greeting: "Hello", received: run.input },
  };
});
```

This source is also valid JavaScript: use `FLOW.mjs` instead for that
implementation. A package contains one `FLOW.<ext>`, so choose one file rather
than keeping both. Node 24 can execute this TypeScript example directly; Bun
can also execute it. Neither command by itself supplies a FLOW host.

`handle()` owns protocol stdin/stdout, handles one invocation, and routes ordinary
console diagnostics to stderr after entry. Running `node FLOW.ts` alone waits
for a host request. Keep raw stdout writes and import-time logging off that channel.

## Exercise the protocol locally

For this trusted local exercise on Linux or macOS, use Python 3.11+ and the
existing [Run/0 test peer](https://github.com/jiggy/jig/tree/main/conformance/run-0/python-peer).
Save its `run0_peer.py` beside `FLOW.ts`, then create `try_flow.py`:

```python
import json
import tempfile
import time
from run0_peer import HostPeer, flow_run_request


with tempfile.TemporaryDirectory() as scratch:
    request = flow_run_request("host:1", {"name": "Ada"})
    request["params"]["scratch"] = scratch
    request["params"]["deadlineUnixMs"] = int(time.time() * 1000) + 10_000
    with HostPeer(["node", "FLOW.ts"]) as peer:
        peer.send(request)
        response = peer.receive()
        print(json.dumps(response))
        peer.finish()
```

Run `python try_flow.py`. The response's `result` is:

```json
{"outcome":"done","output":{"greeting":"Hello","received":{"name":"Ada"}}}
```

For JavaScript, change the command to `["node", "FLOW.mjs"]`; for Bun and
TypeScript, use `["bun", "FLOW.ts"]`. The peer imports neither SDK. It exercises
the protocol for your own trusted code; it is not a sandbox or production host.
Its pipe polling requires POSIX, so this particular exercise is not a Windows
runner. Python is a dependency of this test peer, not of the TypeScript SDK.

Change `greeting` to `Welcome` and run again. Check that `received` is unchanged
and the greeting has changed. As a protocol failure case, remove
`request["params"]["input"]` before sending: the response has an error instead
of a successful result.

## Call a configured method

Inside a handler, call a dependency using its local slot:

```ts
const result = await run.call({
  operationId: "review:1",
  slot: "reviewer",
  input: run.input,
});
return result;
```

Declare the dependency in `FLOW.meta.json` beside the implementation:

```json
{"uses":{"reviewer":{}}}
```

The host must bind `reviewer` to an authorized implementation. The small test
peer exercise above does not configure or serve such calls. Every reply contains
both `outcome` and `output`; inspect the outcome before using the data. Forwarding
custom outcomes also requires declaring them in your own `FLOW.contract.json`.
An optional named contract is useful when independently maintained consumers
need exact matching; ordinary calls do not require one.

## Handle failure and cancellation

Operational failures reject with `OperationError`. Domain responses such as
`blocked` remain ordinary results when declared by the method. Await owned
calls before returning, and do not replace operational failure with a `done`
result. Invalid handler results fail validation.

`run.signal` reports root cancellation. Pass a call-specific signal as the
second argument to `run.call` when needed. The host owns deadline enforcement
and cleanup; cancellation is not proof that remote effects were undone.

The [Run SDK reference](../spec/run-sdk.md) covers settings, attachments,
channels, JSON limits, and exact lifecycle rules. For another authoring format,
see [Python](./python.md) or [Markdown](./markdown.md).
