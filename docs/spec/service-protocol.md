# FLOW Service/1

**Status:** closed wire candidate. The method, frame, ownership, readiness,
and error models in this document are fixed for the first implementation and
black-box corpus. Service/1 is not `1.0` until independent Hosts and Providers
pass that corpus.

Service/1 is the optional portable boundary for one long-lived component whose
package declares fixed capability exports and dependencies. The export set may
be empty: a watcher, timer, or ingress component can own Mount-background work
without inventing a dummy callable capability. Ordinary finite work remains
Run/1. A Run-only FLOW Host need not implement Service/1.

The complete protocol has six methods:

```text
host -> provider        service/mount
host -> provider        service/invoke
provider -> host        service/ready
provider -> host        flow/call
provider -> host        effect/call
either direction        request/cancel
```

There is no wire Mount ID, `service/unmount`, callback, subscription, stream,
generic resource handle, provider-selected generation, or dynamic export or
dependency registration.

## 1. Process, framing, and limits

One provider process serves exactly one `service/mount` request. The mount
request remains pending for the complete process lifetime. The channel is
full-duplex JSON-RPC 2.0 over stdio with the same byte framing, FLOW JSON/1
domain, UTF-8 rules, request-ID grammar, correlation rules, fatal-close split,
and 16,777,216-byte frame limit as [Run/1](run-protocol.md#1-process-and-framing).

Each sender may originate at most 65,536 requests over one channel
incarnation. Host and Provider each permit at most 64 requests originated by
the peer to remain unresolved at once. A conforming sender queues or rejects
additional local work rather than exceeding the wire bound. A receiver rejects
the 65th otherwise valid concurrent request with `RESOURCE_EXHAUSTED`. A
65,537th request is a fatal `PROTOCOL_ERROR`.

Host request IDs name cooperative Service owners on this channel:

- the pending `service/mount` request owns Mount-background work; and
- each pending `service/invoke` request owns work caused by that invocation.

They remain wire correlation IDs, not durable Mount, generation, consumer,
operation, or provider identities. Jig keeps those identities privately.

The process has protocol stdin, protocol stdout, and diagnostic stderr exactly
as Run/1 does. A Sandbox Backend may proxy those logical streams over another
mechanism, but the Provider observes this byte contract.

## 2. Shared values

`export`, `slot`, `method`, declared application-error `name`, and every value
in the readiness `exports` array use Package/1 `LocalName`:

```text
[a-z0-9]+(?:-[a-z0-9]+)*
```

The limit is 1–64 ASCII characters. `operationId` uses the Run/1 request-ID
token grammar and 128-byte limit. Inputs, values, declared error data, settings,
and operational error details are bounded FLOW JSON/1. Settings is always an
object.

Every deadline is a nonnegative JSON/1 safe integer containing a
host-authoritative UTC Unix epoch deadline in milliseconds. It is advisory to
Provider cleanup; the Host still enforces cancellation and containment.

Attachments have the exact Run/1 shape and 256-entry bound. Their paths and
the private scratch path are already sandbox-local. Service/1 conveys no host
path, grant, Backend, Adapter, endpoint, provider generation, or enforcement
receipt.

## 3. `service/mount`

The Host begins the one Mount:

```json
{
  "jsonrpc": "2.0",
  "id": "host:1",
  "method": "service/mount",
  "params": {
    "protocol": "service/1",
    "settings": {},
    "attachments": {},
    "scratch": "/workspace/scratch",
    "startupDeadlineUnixMs": 1787558400000
  }
}
```

The params contain exactly the five shown fields. `protocol` is an exact
activation-mismatch guard, not negotiation. The startup deadline governs
initialization through acknowledged readiness; it is not a promised maximum
Mount lifetime.

The Mount request remains pending after readiness. Mount initialization and
background work may use the fixed dependency slots through owner-attributed
calls. Returning a successful mount result before readiness is a protocol
violation. Initialization failure is an operational error response.

The Host ends a healthy Mount by sending `request/cancel` for the still-pending
mount request. Cancellation closes all new admission, recursively cancels live
invocations and Provider-originated work, and begins bounded Provider cleanup.
After owned work and cleanup settle, the Provider responds to `service/mount`
with exactly `{}`. The Provider may also end voluntarily with that result after
readiness; this loses all exports and does not create a durable success object.

There is no `service/unmount` because the pending mount request is already the
owner and cancellation target.

## 4. `service/ready`

After every package-declared export is locally callable, the Provider sends
exactly one request:

```json
{
  "jsonrpc": "2.0",
  "id": "provider:1",
  "method": "service/ready",
  "params": {
    "ownerRequestId": "host:1",
    "exports": ["documents", "sessions"]
  }
}
```

`ownerRequestId` must name the one pending `service/mount`. `exports` contains
0–256 unique LocalNames in ascending Unicode code-point order. It must exactly
equal the package's admitted `provides` LocalNames. Unknown, duplicate, missing,
extra, unsorted, stale-owner, second, or post-cancellation readiness is a fatal
Provider protocol error.

The Host atomically allocates fresh internal provider generations, serializes
and flushes the success response `{}`, and only then admits leases or sends
`service/invoke`. A failed response write opens no admission. The Provider may
serve invocations only after it receives that acknowledgement. Readiness has
no `operationId` and owns no child work.

## 5. `service/invoke`

After readiness acknowledgement, the Host may issue several concurrent
invocations:

```json
{
  "jsonrpc": "2.0",
  "id": "host:2",
  "method": "service/invoke",
  "params": {
    "export": "sessions",
    "method": "read",
    "input": {"session-id": "s-1"},
    "deadlineUnixMs": 1787558400000
  }
}
```

The four members shown are required and closed. Jig has already pinned and
validated the consumer Binding, provider generation, exact Capability
Contract, method, input, authority, operation key, and deadline before
Provider application code sees the request. Those host facts are not repeated
on this channel.

Success or a declared application failure uses the Capability Contract/1
tagged result:

```json
{"value": {"session-id": "s-1"}}
```

```json
{"error": {"name": "not-found", "data": {"session-id": "s-1"}}}
```

Operational and protocol failures remain JSON-RPC errors. Multiple invocations
may settle out of order. Service/1 promises separate cooperative ownership and
cancellation, not transaction isolation, linearizability, hostile sibling
isolation, or serialization. A provider needing different hard authority
ceilings runs in separate Mount processes.

## 6. Owner-attributed calls

Every Provider-originated `flow/call` or `effect/call` adds one required
`ownerRequestId` before the unchanged Run/1 call fields:

```json
{
  "jsonrpc": "2.0",
  "id": "provider:2",
  "method": "effect/call",
  "params": {
    "ownerRequestId": "host:2",
    "operationId": "load:1",
    "slot": "storage",
    "method": "read",
    "input": {"key": "s-1"}
  }
}
```

The owner must be the live mount request or one live invocation request. The
Host responds `OWNER_CLOSED` without dispatch when it is unknown, stale,
cancelled, already terminal, or not Host-originated. A call owned by one
invocation is cancelled with that invocation and cannot be reattributed to the
Mount or a sibling. A Mount-background call is not cancelled merely because
one invocation ends.

`operationId` semantics are scoped to the named owner:

```text
same ownerRequestId + same operationId + same canonical method/params
    join or return the same operation result

same ownerRequestId + same operationId + different canonical method/params
    OPERATION_CONFLICT before another dispatch
```

The same spelling under two different invocation owners names two operations.
The Provider SDK generates transport IDs privately; component code supplies
stable semantic operation IDs.

Dependencies and child-Flow slots are the complete sets pinned before Mount
initialization. Calls cannot create a slot or select a provider endpoint.
Dependency loss cancels the complete Mount rather than healing it in place.

## 7. Cancellation and deadlines

`request/cancel` has exactly the Run/1 notification shape. Only the originator
of a pending request may target it. Duplicate, stale, unknown, settled, and
opposite-direction IDs are harmless no-ops; malformed cancellation is fatal.

Cancelling an invocation closes its admission, asks its handler and owned calls
to stop, and leaves Mount-background and sibling work alone. The original
invocation still receives at most one terminal result or error if the channel
survives. If cooperative cancellation does not settle within host policy, Jig
may fence the complete Mount because Service/1 does not promise hostile
in-process sibling isolation.

Cancelling the mount recursively closes every owner on the channel. Provider
cleanup is bounded by host policy and the Sandbox Backend; Service/1 adds no
Provider-selected grace or cleanup deadline.

Every terminal race follows Run/1: a committed result wins a later observed
cancellation or deadline; otherwise the first recorded cancellation or
deadline determines `CANCELLED` or `DEADLINE_EXCEEDED`.

## 8. Errors

Service/1 uses the same standard JSON-RPC codes and closed operational code set
as Run/1. The machine registry is
[`machine/service-1-errors.json`](machine/service-1-errors.json).

`-32602` means the Service/1 method envelope is invalid. `INVALID_INPUT` means
the already selected Capability Contract rejected the application input.
`INVALID_RESULT` means the Provider produced an invalid contract result.
Provider loss is reported to consumers as `UNAVAILABLE`; uncertainty after an
unprovable external dispatch remains `UNCERTAIN`.

`PROTOCOL_ERROR` and `CHANNEL_LOST` are local channel classifications. They are
not operational error frames sent over a channel which cannot be trusted.

## 9. Readiness, completion, and loss

Before acknowledged readiness, the Host sends no invocation. After readiness,
the export set is immutable. The Provider cannot withdraw one export or add a
new one. Loss of any required dependency or public export ends the complete
Mount.

The Provider must settle every outbound call owned by an invocation before
responding to that invocation. It must settle every Mount-owned call, every
invocation, and cleanup before responding successfully to `service/mount`.
Nothing is detached, reparented, or transferred.

After the mount response, the Host continues draining stdout and waits for
clean Backend completion. Mount success requires one acknowledged readiness,
one valid mount terminal, no pending request in either direction, frame-boundary
EOF, zero process exit, and successful containment cleanup. A response followed
by invalid trailing output, nonzero exit, or failed fencing is not success.

Provider EOF, crash, protocol failure, or failed cleanup loses the complete
export set immediately. Every pending invocation and dependent consumer
observes provider loss. Restart creates fresh host generations; existing
consumers are never rebound silently.

## 10. Required conformance cases

1. One mount request remains pending through one acknowledged readiness and
   several out-of-order invocations.
2. Invocation before readiness acknowledgement is a Host protocol failure.
3. Readiness with wrong owner, duplicate, unsorted, missing, extra, or second
   exports is fatal and opens no admission.
4. Mount- and invocation-owned calls dispatch under distinct owners; stale and
   cross-owner calls return `OWNER_CLOSED`.
5. The same operation ID deduplicates only within one owner; conflicting params
   fail before a second dispatch.
6. Invocation cancellation does not cancel siblings or Mount-background work.
7. Mount cancellation cancels the complete channel tree and awaits cleanup.
8. A handler which catches cancellation cannot publish success after
   cancellation won.
9. Detached invocation or Mount work prevents the corresponding owner success.
10. Capability success and declared error tags remain distinct from operational
    JSON-RPC errors.
11. Provider crash loses every export and pending invocation; restart produces
    fresh host identities.
12. Request lifetime, concurrency, framing, invalid params, unknown method,
    cancellation, and terminal-publication races match the finite rules above.
