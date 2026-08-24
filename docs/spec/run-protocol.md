# FLOW Run/1

**Status:** closed candidate specification. The schemas, error registry, SDKs,
and conformance corpus named here are part of the same release slice; Run/1
does not receive a stable conformance label until two independent peers pass
that corpus.

Run/1 is the finite executable boundary for a FLOW package. It deliberately
does not expose Jig's durable records, resolver, authority evidence, graph
model, provider identities, or application ontology.

The complete protocol has four methods:

```text
host -> component       flow/run
component -> host       flow/call
component -> host       effect/call
either direction        request/cancel
```

## 1. Process and framing

One component process serves exactly one root `flow/run` request. The channel
is full-duplex JSON-RPC 2.0 over stdio:

```text
stdin     protocol frames only
stdout    protocol frames only
stderr    unstructured diagnostics only
```

Each stdin or stdout frame is one JSON object encoded as UTF-8 and terminated
by one LF byte. The LF is not part of the frame payload. A frame has at most
16,777,216 bytes before LF. Empty frames, JSON-RPC batches, a BOM, invalid
UTF-8, duplicate object members, lone Unicode surrogates, and values outside
[`FLOW JSON/1`](json-values.md) are invalid. EOF after nonempty bytes without LF
is an incomplete frame.

Both peers keep their reader active while awaiting responses. Writes are
serialized and flushed. A component may have at most 64 component-originated
requests awaiting responses at once; an SDK may queue additional calls rather
than put them on the wire. A host sends exactly one `flow/run` request.

Request IDs are 1–128 byte ASCII tokens matching:

```text
[A-Za-z0-9][A-Za-z0-9._:/-]*
```

Each sender chooses its own ID namespace and never reuses an ID during one
channel incarnation, including after the request settles. Opposite directions
may coincidentally use the same spelling. IDs correlate wire messages only;
they are not durable Run or operation identities. Numeric and `null` request
IDs are invalid in Run/1.

An unknown well-formed request method receives JSON-RPC `-32601`. A recognized
request with invalid params receives `-32602`. Unknown notifications are
ignored. The direction restrictions in this specification are part of method
validity.

For a complete, bounded, LF-terminated, valid-UTF-8 frame which fails JSON/1,
a peer should best-effort send `-32700` with `id: null`, flush, and close. This
includes JSON syntax errors, a BOM, duplicate members, lone surrogates, and
out-of-domain JSON/1 numbers or value bounds. For a parsed batch, non-object,
or invalid JSON-RPC envelope it should best-effort send `-32600` with `id:
null` or an unambiguous valid ID, then close. Invalid UTF-8, an oversized or
incomplete frame, an unknown/duplicate response, reuse of a request ID, and a
failed write close the channel without relying on another frame.

Every fatal close stops admission, cancels owned work, and fails local pending
calls under this exact split:

- `PROTOCOL_ERROR` means a detected framing, JSON/1, envelope, correlation, or
  protocol-state violation by the peer;
- `CHANNEL_LOST` means EOF, read/write failure, or transport loss without a
  detected peer-protocol violation.

A valid standard JSON-RPC error received in response to a correctly emitted
Run/1 request proves that the peers disagree about the fixed protocol. It is a
fatal `PROTOCOL_ERROR`, not a per-call `OperationError`. A peer must never rely
on a best-effort error frame arriving over a corrupted channel.

State-dependent request handling is fixed as follows:

| Input | Receiver behavior |
|---|---|
| Request-form method unavailable in this direction, including request-form `request/cancel` | Respond `-32601`; the channel may continue. |
| Notification other than a valid `request/cancel`, including notification-form request methods | Ignore it. |
| Recognized method with invalid params | Respond `-32602`. An invalid root request then ends the one-Run component process. |
| Second `flow/run` | Best-effort `-32600`, then fatal `PROTOCOL_ERROR`. |
| `flow/call` or `effect/call` without a pending root owner | Respond `OWNER_CLOSED`; do not dispatch. |
| 65th simultaneously pending component request | Respond `RESOURCE_EXHAUSTED` to that request; do not dispatch it. |
| Component frame after its root terminal response | Fatal `PROTOCOL_ERROR`; any buffered success is invalidated. |

After sending its root terminal response, a component may immediately stop
reading and exit. A host which sends later traffic is itself nonconforming and
cannot require a response.

## 2. Shared names and values

`slot`, `method`, declared effect-error `name`, and Run `outcome` use the
Package/1 `LocalName` grammar:

```text
[a-z0-9]+(?:-[a-z0-9]+)*
```

Their length is 1–64 ASCII characters. Whether an outcome is `done` or one of
the package's declared custom outcomes is checked against the exact package,
not inferred from this wire grammar.

`operationId` uses the request-ID token grammar and limit. It is stable
semantic identity chosen by component code, not a transport ID generated by an
SDK.

All `input`, `output`, settings, effect values, error data, and error details
are bounded JSON/1 values. `settings` is always an object. Output and declared
effect-error data are required; use `null` when no more meaningful value
exists.

`deadlineUnixMs` is a nonnegative JSON/1 safe integer containing the
host-authoritative UTC Unix epoch deadline in milliseconds. It is advisory to
component cleanup; the host remains responsible for cancellation and enforced
termination. Child Flow and effect calls inherit the remaining root deadline
and cannot supply or widen one.

## 3. `flow/run`

The host's only request is:

```json
{
  "jsonrpc": "2.0",
  "id": "host:1",
  "method": "flow/run",
  "params": {
    "protocol": "run/1",
    "input": {},
    "settings": {},
    "attachments": {
      "source": {
        "path": "/workspace/source",
        "access": "read"
      }
    },
    "scratch": "/workspace/scratch",
    "deadlineUnixMs": 1787558400000
  }
}
```

`params` has exactly these required fields:

| Field | Meaning |
|---|---|
| `protocol` | Exact literal `run/1`; a cheap activation-mismatch guard, not negotiation. |
| `input` | Actual invocation input. |
| `settings` | Complete invocation-stable configured settings object. |
| `attachments` | Map from `LocalName` to one sandbox-local root and access mode. |
| `scratch` | Nonempty sandbox-local private read-write root path. |
| `deadlineUnixMs` | Finite host-enforced root deadline. |

Each attachment has exactly:

```json
{
  "path": "/sandbox/path",
  "access": "read"
}
```

`path` is a nonempty runtime-native path inside the already prepared sandbox.
`access` is exactly `read` or `read-write`. The outer Sandbox Backend, not an
SDK path helper, enforces the view. One Run has at most 256 named attachments.

There is no Run ID, parent ID, trigger field, correlation field, provider
identity, slot inventory, grant, enforcement receipt, or negotiated limit
object in Run/1. A triggering fact belongs in `input`; lifecycle and authority
evidence remain host-side.

A successful result is exactly:

```json
{
  "outcome": "done",
  "output": null
}
```

Protocol, execution, cancellation, deadline, provider, or uncertainty failures
are JSON-RPC failures. They never masquerade as package outcomes.

## 4. `flow/call`

While its root request is pending, the component may request one child Flow:

```json
{
  "jsonrpc": "2.0",
  "id": "component:1",
  "method": "flow/call",
  "params": {
    "operationId": "research:1",
    "slot": "research",
    "intent": "Find and justify a suitable comparison target.",
    "input": {}
  }
}
```

`operationId`, `slot`, and `input` are required. `intent` is the only optional
member and is a 1–16,384 scalar string. It describes the requested work for an
already admitted slot; it does not name candidates, configure a resolver, grant
catalogue access, or widen authority. Exact project binding still wins, and an
absent intent never means catalogue-wide discovery.

Success returns the same complete `{ outcome, output }` value as `flow/run`.
Nested execution is a host operation, not graph merging or settings/authority
inheritance.

## 5. `effect/call`

While its root request is pending, the component may call one method through a
bound capability slot:

```json
{
  "jsonrpc": "2.0",
  "id": "component:2",
  "method": "effect/call",
  "params": {
    "operationId": "artifact-write:1",
    "slot": "artifacts",
    "method": "write",
    "input": {}
  }
}
```

The params have exactly the four shown fields. A successful capability method
returns exactly one of:

```json
{ "value": null }
```

```json
{
  "error": {
    "name": "not-found",
    "data": {}
  }
}
```

The second form is an application error declared by the exact capability
contract, not a JSON-RPC error. Both `value` and `error`, neither member, an
unknown member, or missing error `data` is invalid.

## 6. Operation identity

`operationId` is scoped to the one root Run. For observable Run/1 behavior:

```text
same operationId + same canonical method/params
    joins or returns the same operation result

same operationId + different canonical method/params
    OPERATION_CONFLICT before another dispatch
```

The canonical comparison includes `flow/call` or `effect/call`, slot, method
when present, intent when present, and input. Transport IDs and wait timing are
not semantic input. The host chooses its persistence strategy; Run/1 does not
standardize Jig's ledger schema, activation digest, internal lifetime IDs, or
recovery database.

Each transport request is one waiter even when several requests join the same
operation. Cancelling one request settles or removes only that waiter; it does
not cancel another waiter. The receiver may request cancellation of shared
underlying work only after no live waiter remains. A terminal operation result
which won the receiver's atomic race may still settle a concurrent
cancellation; otherwise the cancelled waiter receives `CANCELLED` while other
waiters remain attached.

An operation is never automatically replayed after unprovable dispatch.
Uncertain completion is returned as `UNCERTAIN`. A deliberate new attempt uses
a new `operationId`.

## 7. Errors

Run/1 uses standard JSON-RPC `-32700`, `-32600`, `-32601`, `-32602`, and
`-32603` with their standard meanings. Operational failures use numeric code
`-32000` and this exact data shape:

```json
{
  "code": "UNAVAILABLE",
  "details": null
}
```

`details` is optional bounded JSON/1 diagnostic data. `message` is required by
JSON-RPC, contains 1–1,024 Unicode scalar values, and is non-normative human
text. The closed wire-visible code set is:

| Code | Normative meaning |
|---|---|
| `CANCELLED` | Cooperative cancellation won the terminal race. |
| `DEADLINE_EXCEEDED` | The host-authoritative deadline won the terminal race. |
| `OWNER_CLOSED` | The root stopped admitting owned work before this operation could be admitted or settled. |
| `OPERATION_CONFLICT` | The operation ID was already used with different canonical method or params. |
| `UNAVAILABLE` | No admitted target or provider was callable for this operation. |
| `PERMISSION_DENIED` | Host authority policy refused the requested operation. |
| `RESOURCE_EXHAUSTED` | A declared protocol or host capacity bound prevented admission or completion. |
| `INVALID_INPUT` | Application input failed the selected Flow or capability's declared validation after the Run/1 envelope was valid. |
| `INVALID_RESULT` | A component, child Flow, or capability produced an invalid declared result. |
| `UNCERTAIN` | Dispatch may have occurred, but a trustworthy terminal result cannot be proved. |
| `EXECUTION_FAILED` | Admitted application work failed and no narrower code above applies. |

JSON-RPC `-32602` means the Run/1 method params themselves are invalid;
`INVALID_INPUT` is downstream application validation. JSON-RPC `-32603` means
the peer failed while processing the protocol; `EXECUTION_FAILED` means the
admitted application work failed.

Every request has one atomic terminal decision. A committed result or error
wins a later cancellation or deadline observation. Otherwise the first
recorded cancellation/deadline terminal condition determines `CANCELLED` or
`DEADLINE_EXCEEDED`; no peer sends two terminal responses.

Host-internal distinctions such as which Binding, provider, Runtime Adapter,
or Sandbox Backend was unavailable belong in durable host diagnostics, not the
portable error taxonomy. Activation failures which occur before a channel
exists are not Run/1 errors.

`PROTOCOL_ERROR` and `CHANNEL_LOST` are local terminal classifications, not
`-32000` values sent over a channel which can no longer be trusted. The
machine-readable registry is
[`machine/run-1-errors.json`](machine/run-1-errors.json).

## 8. Cancellation

The originator of a pending request may send this notification:

```json
{
  "jsonrpc": "2.0",
  "method": "request/cancel",
  "params": {
    "requestId": "component:1"
  }
}
```

It has no `id` and receives no response. A valid target must have been
originated by the notifier on this channel. Duplicate, stale, already-terminal,
unknown, and opposite-direction targets are harmless no-ops because response
and cancellation may race. A malformed cancellation notification is fatal:
the sender cannot safely assume it requested cancellation.

Cancellation closes new work for that request and asks the receiver to stop.
It does not prove that dispatched external work was undone. The original
request still receives at most one eventual result or error if the channel
survives.

Root cancellation applies to the complete component-owned subtree. An SDK
must propagate it to the handler and cancel its pending outbound waits. The
host enforces the deadline and terminates an uncooperative process after its
private grace policy.

## 9. Completion and exit

The component admits outbound calls only while `flow/run` is pending. It must
settle every outbound request before returning the root result or error. Calls
cannot be detached, reparented, or transferred. A normal root response with
outstanding owned work cannot become success.

A complete valid root response followed by clean process exit survives EOF.
The supervising host classifies premature termination deterministically:

- a host-enforced kill after a recorded cancellation or deadline is
  `CANCELLED` or `DEADLINE_EXCEEDED` respectively, unless a terminal response
  had already won;
- a detected peer-protocol violation is `PROTOCOL_ERROR`;
- a nonzero process exit without either condition is `EXECUTION_FAILED`;
- EOF, transport loss, or a zero exit before a complete response is
  `CHANNEL_LOST`.

A nonzero exit after an apparently successful response, pending owned work,
invalid output, failed cleanup, trailing component frames, or deadline kill
prevents success.

## 10. Machine interface and SDK projection

The closed message schema is
[`machine/run-1.schema.json`](machine/run-1.schema.json). Direction and response
correlation remain protocol state and cannot be proven by a context-free JSON
Schema document. Framing and JSON/1 validation happen before schema validation.

The TypeScript package `@flowmd/sdk` and Python distribution/import
`flowmd-sdk`/`flowmd_sdk` expose the same semantic surface:

```text
serve(handler)
RunContext
RunResult
callFlow / call_flow
callEffect / call_effect
OperationError
EffectError
JSON value types
```

They do not expose JSON-RPC envelopes, transport IDs, pending tables,
resolution, Bindings, providers, schema loading, sandboxes, Jig controls,
Services, Agents, or graph types. `operationId` remains caller-supplied.

The exact language projections and their cancellation/error behavior are
closed in [`Run SDK/1`](run-sdk.md).

The seed corpus under `conformance/run-1/` is executable evidence for this
candidate, not yet the complete conformance corpus. A stable label requires
the closed release-gate matrix and a second independent implementation rather
than two wrappers around one codec.
