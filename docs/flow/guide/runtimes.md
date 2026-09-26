---
title: Runtimes and language support
description: Separate SDK availability from host support and implement another FLOW SDK.
---

# Runtimes and language support

FLOW's invocation boundary is independent of the language used inside a method.
A component needs a runtime that can implement Run/0 over stdio; its host must
support launching that runtime with the required context and grants.

## Choose an implementation

| Format | Component runtime | Available SDK or interpreter | Execution requirements |
| --- | --- | --- | --- |
| Markdown | Host's Markdown interpreter and Agent | Markdown/0 implemented by Jig | A host supporting the profile and its required Agent/dependency grants. |
| TypeScript | Bun, or Node with suitable TypeScript support | npm `@jigging/flow@alpha` | The tutorial exercises direct execution on Node 24; other toolchains must prepare executable code for their selected host. |
| JavaScript | Node or Bun | npm `@jigging/flow@alpha` | The host must support the selected runtime; the tutorial exercises Node 24. |
| Python | Python 3.11+ | PyPI `jiggy-flow` with `--pre` | A host supporting Python and the package's dependencies. |
| Another language | Its executable runtime | Implement Run/0, optionally an SDK | Qualify both the component protocol and the host's ability to launch that runtime. |

See the [TypeScript/JavaScript](./typescript.md), [Python](./python.md), and
[Markdown](./markdown.md) tutorials for complete authoring paths. Node's direct
TypeScript execution is a specific runtime feature, not a property of the SDK;
consult [Node's TypeScript support](https://nodejs.org/api/typescript.html) when
choosing another Node version or syntax.

SDK availability is separate from host support. For example, Jig's current alpha
is developed primarily on NixOS (used for manual maintainer smoke testing) with
automated CI test suites and host conformance qualified on provisioned
Ubuntu 24.04 x86_64, requiring the documented Linux facilities; see its
[supported-host requirements](https://jig.md/guide/#supported-host). An SDK smoke
on another operating system does not qualify Jig there, and neither environment
establishes macOS or aarch64 support. Other hosts publish their own supported
runtimes, platforms, and authority guarantees.

Code may itself call Agents and produce uncertain judgments. Markdown always
uses the current profile's reasoning interpreter. These implementation choices
do not change the caller's result envelope or guarantee equivalent behavior.

## Implement an SDK in another language

An SDK lets an author receive an invocation through `handle(handler)` and call
dependencies through `context.call(...)`. It supplies serialization, validation,
cancellation and owned-request accounting around the author's method. Read
[Run SDK/0](../spec/run-sdk.md) for the exact projection; [Run/0](../spec/run-protocol.md)
owns the wire behavior.

### Receive the component's invocation

The host selects the component and sends one `flow/run` request. This is the
entry request for every component, including one launched because another Flow
called it. The host supplies the full context:

```json
{
  "jsonrpc": "2.0",
  "id": "host:1",
  "method": "flow/run",
  "params": {
    "protocol": "run/0",
    "input": "Ada",
    "settings": {},
    "attachments": {},
    "scratch": "/sandbox/scratch",
    "deadlineUnixMs": 4000000000000
  }
}
```

The scratch path is inside the environment prepared by the host; the illustrative
deadline must be replaced with its actual finite deadline. Validate the complete
request before calling the handler. Expose input, settings, attachments,
channels, scratch, deadline and cancellation through the context. The author
does not manufacture that context.

Run/0 IDs are bounded ASCII strings, never numbers. Frames are LF-terminated
UTF-8 objects within JSON/0 and framing bounds, not arbitrary JSON-RPC batches.
Keep the reader active while waiting for replies, serialize and flush writes,
and account for request IDs and pending requests throughout the exchange.

### Invoke a dependency through the host

When the handler calls a slot, the SDK sends `flow/call` with a fresh wire request
ID and the operation identity supplied by the author:

```json
{
  "jsonrpc": "2.0",
  "id": "component:1",
  "method": "flow/call",
  "params": {
    "operationId": "greet:1",
    "slot": "greeter",
    "input": "Ada"
  }
}
```

The host resolves and authorizes the slot. If it launches another component, it
constructs that component's `flow/run` context. A native implementation uses the
same call-level input/result boundary. The SDK does not choose package paths,
credentials, runtime settings or new powers. Optional `intent` and `channels`
have the exact meanings specified by Run/0.

Both operations return the complete result, with required `outcome` and `output`:

```json
{
  "jsonrpc": "2.0",
  "id": "component:1",
  "result": {
    "outcome": "done",
    "output": { "message": "Hello, Ada!" }
  }
}
```

Correlate and validate responses. Preserve declared domain outcomes as data;
raise operational errors separately. Do not unwrap output automatically or
translate a declared refusal into an exception.

### Cancel and finish owned work

Cancellation targets a pending request using its string ID:

```json
{"jsonrpc":"2.0","method":"request/cancel","params":{"requestId":"host:1"}}
```

The SDK propagates root cancellation to the handler and pending outbound waits.
The host enforces termination; cancellation does not retract an external effect
already dispatched. Apply the specified distinction between operational errors,
fatal protocol errors and transport loss.

Before emitting the root response, settle every owned outbound request and any
channel work. Validate the handler result, flush the response, and exit with the
required status. A response alone does not establish success: the host also
checks process exit, pending work and trailing stdout.

### Preserve protocol output

Capture the protocol writer before redirecting ordinary application logging to
stderr, as described by Run SDK/0. Import-time logging, cached stdout references,
raw descriptor writes and child processes inheriting stdout need separate care.
Stdout carries protocol frames only.

## Verify the implementation

Run the [public conformance corpus](https://github.com/jiggy/jig/tree/main/conformance/run-0)
using its README. Exercise normal invocation, dependency calls, malformed input,
ID reuse, error handling, cancellation, abandoned work, process exits and trailing
frames. Qualify channels if your SDK implements that extension.

The [host integration guide](./platforms.md) exercises a real caller/child exchange
and explains the additional host duties. Neither an SDK nor conformance evidence
supplies containment, credentials, package resolution or an ACP adapter.
