# FLOW Run/1

> *Status: prerelease specification candidate.*

Run/1 is the finite executable boundary for a FLOW package. It deliberately
does not expose a host's durable records, resolver, authority evidence, graph
model, provider identities, or application ontology.

Invocation and cancellation use:

```text
host -> component       flow/run
component -> host       flow/call
either direction        request/cancel
```

The channel extension adds component-to-host `channel/create`,
`channel/subscribe`, `channel/send`, `channel/next`, `channel/close`, and `channel/release`.
Channels carry bounded JSON values during work; they do not start work,
authorize control operations, or replace invocation results.

`flow/run` supplies the complete context to an already selected component.
`flow/call` asks the host to invoke one declared, admitted slot. The selected
implementation may be an ordinary Flow or a trusted native implementation.
These operations have distinct parameter shapes; neither method names nor
interface equality grant authority. The host enforces the caller's actual
invocation authority before effects.

The end-to-end operation is Flow A running Flow B through the host:

```text
host   -> Flow A: flow/run        (context for A)
Flow A -> host:   flow/call       (slot, operation identity, input)
host   -> Flow B: flow/run        (context for B)
```

A child is an invocation relationship, not a different kind of Flow package.
Every component receives the same `flow/run` entry request. Native
implementations need not create a Flow process; they retain the same call-level
input/result, authority, failure and owned-work obligations.

## 1. Process and framing

One component process handles exactly one root `flow/run` request. The channel
is full-duplex JSON-RPC 2.0 over stdio. Here "root" means the owner request on
this component's channel, including when the host launched it as a child:

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

Each sender may originate at most 65,536 request-form messages during one
channel incarnation. Settled and cancelled requests still consume this
lifetime budget; responses and notifications do not. A request with a fresh,
structurally valid ID consumes the budget before method dispatch, including
when its method is unknown or its method params are invalid. A conforming SDK
rejects an attempted 65,537th outbound request locally with
`RESOURCE_EXHAUSTED` and emits no frame, so its root handler may recover. A
receiver which observes a 65,537th request records a fatal `PROTOCOL_ERROR` and
closes without relying on another response. This fixed lifetime bound is
separate from the limit of 64 unresolved component requests on the wire.

Channel implementations reserve at least one simultaneous request slot and
enough remaining request IDs to close/release already allocated endpoints and
pending allocations. Ordinary admission stops before consuming these reserves.
Repeated failed settlement attempts cannot consume unlimited reserved capacity.
Cancellation, host revocation and fencing never depend on a free ordinary slot.

Whenever a request or notification includes `params`, that member must be a
JSON object or array. `null` and scalar `params` make the complete JSON-RPC
envelope invalid; they are not method-level invalid parameters.

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
| `flow/call` without a pending invocation owner | Respond `OWNER_CLOSED`; do not dispatch. |
| 65th simultaneously pending component request | Respond `RESOURCE_EXHAUSTED` to that request; do not dispatch it. |
| 65,537th request originated by one peer during the channel lifetime | Fatal `PROTOCOL_ERROR`; do not dispatch it or rely on a response. |
| Component frame after its root terminal response | Fatal `PROTOCOL_ERROR`; any buffered success is invalidated. |

After sending its root terminal response, a component may immediately stop
reading and exit. A host which sends later traffic is itself nonconforming and
cannot require a response.

## 2. Shared names and values

`slot`, channel names and Run `outcome` use the Package/1 `LocalName` grammar:

```text
[a-z0-9]+(?:-[a-z0-9]+)*
```

Their length is 1–64 ASCII characters. Whether an outcome is `done` or one of
the invocation contract's declared custom outcomes is checked against that contract,
not inferred from this wire grammar.

`operationId` uses the request-ID token grammar and limit. It is stable
semantic identity chosen by component code, not a transport ID generated by an
SDK.

All `input`, `output`, settings and operational error details are bounded
JSON/1 values. `settings` is always an object. Output is required, including
for a declared domain refusal; use `null` when no more meaningful value exists.

`deadlineUnixMs` is a nonnegative JSON/1 safe integer containing the
host-authoritative UTC Unix epoch deadline in milliseconds. It is advisory to
component cleanup; the host remains responsible for cancellation and enforced
termination. Calls inherit the remaining root deadline
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

`params` has these required fields and optional `channels`:

| Field | Meaning |
|---|---|
| `protocol` | Exact literal `run/1`; a cheap activation-mismatch guard, not negotiation. |
| `input` | Actual invocation input. |
| `settings` | Complete invocation-stable configured settings object. |
| `attachments` | Map from `LocalName` to one sandbox-local root and access mode. |
| `scratch` | Nonempty sandbox-local private read-write root path. |
| `deadlineUnixMs` | Finite host-enforced root deadline. |

`channels`, when present, maps at most 256 `LocalName` entries to distinct
host-granted endpoints defined below. Absence means an empty map.

Each attachment has exactly:

```json
{
  "path": "/sandbox/path",
  "access": "read"
}
```

`path` is a nonempty runtime-native path inside the already prepared sandbox.
`access` is exactly `read` or `read-write`. The outer execution envelope, not
an SDK path helper, enforces the view. One Run has at most 256 named
attachments.

There is no Run ID, parent ID, trigger field, correlation field, provider
identity, slot inventory, enforcement receipt, or negotiated limit
object in Run/1. The initial profile accepts no operation selector. A triggering
fact belongs in `input`; lifecycle and authority
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

While its root request is pending, the component may invoke a declared slot:

```json
{
  "jsonrpc": "2.0",
  "id": "component:1",
  "method": "flow/call",
  "params": {
    "operationId": "research:1",
    "slot": "research",
    "intent": "Compare the supplied alternatives.",
    "input": {}
  }
}
```

Params have exactly the required `operationId`, `slot` and `input`, plus
optional `intent` and `channels`. `slot` names one dependency declared by
Package/1 metadata's `uses` map. A host supplies its exact Flow or native
implementation; a slot is not a package address, implementation URI or request
for catalogue discovery. A named dependency must match the selected
[Invocation Contract/1](invocation-contracts.md) and its complete channel closure.

`intent` is an optional 1–16,384 Unicode-scalar advisory string. It never becomes
application input, Agent instructions, provider arguments or authority. Exact
host routes may treat it as inert. Any host use must stay within the already
authorized slot meaning, without changing or forwarding the actual application
input or widening authority. Instructions belong in `input`.

Optional `channels` maps at most 256 callee-declared `LocalName`s to held
endpoint-reference strings. Omission and an explicit empty map remain distinct
operation content. Validate selected-operation requirements and actual grants
before atomic transfer or dispatch. There is no attachment-transfer parameter,
method selector or operation selector in this initial profile.

A normal reply is directly the complete RunResult:

```json
{
  "jsonrpc": "2.0",
  "id": "component:1",
  "result": {
    "outcome": "done",
    "output": null
  }
}
```

Declared domain refusal is also a normal complete result, such as
`{"outcome":"not-found","output":{"key":"missing"}}` under an interface declaring
that outcome. No success-value wrapper, named-error envelope, unwrapping or
exception conversion exists. Operational failures use the existing JSON-RPC
error envelope.

Each call supplies bounded JSON/1 input and explicit channel rights, and returns
a separately validated complete result. Interface identity cannot select trusted
native control or retention capacity, or turn caller-manufactured data into host
evidence. Every lifecycle owner uses the same admitted implementation and
configuration, with no fallback after an explicit unsupported selection.

Ordinary Flow invocation is finite work under its own context. It does not merge
graphs or implicitly inherit settings, attachments or authority. Native routes
retain their own qualified execution and cleanup owners. Hosts may impose smaller
concurrency, depth, resources or retained-result budgets and report
`RESOURCE_EXHAUSTED`; the Run/1 identity, replay, cancellation and lifetime rules
still apply.

## 5. Channels

This extension supports finite, single-writer JSON/1 sequences. A direct source
has one receiver; a broadcast source has independently bounded subscriptions.
Arbitrary byte transports, persistent streams and continuing Agent control are
not part of this extension.

An endpoint grant is a closed object:

| Field | Meaning |
| --- | --- |
| `endpoint` | Opaque reference using the request-ID token grammar, bound to the receiving invocation |
| `direction` | `send` or `receive` |
| `delivery` | `direct` or `broadcast` |
| `contract` | Optional exact `{id, version, digest}` [Channel Contract/1](channel-contracts.md) source identity |
| `startSequence` | Required positive JSON/1 integer for receivers; `1` for direct delivery; absent for senders |

Endpoint possession grants only the indicated communication right. It is not
portable JSON authority: a string copied into ordinary input grants nothing.
The creating Run owns the source's lifetime. An unused endpoint may transfer
through an exact `flow/call`; its cleanup owner does not change.
First local use claims a right. Inspecting metadata does not claim it.

Broadcast creation also grants subscription authority to the creating invocation
only. Its opaque source reference uses the endpoint token grammar but is not an
endpoint and cannot be transferred in a call map. Moving a writer does not move
subscription authority. Each successful subscription allocates a distinct reader
starting at the next accepted sequence. Late subscriptions receive no history;
preallocated readers may lag even before their first read. Source sealing or
failure prevents new subscriptions. All allocations count over the owner's
lifetime; releasing one does not replenish that allowance.

Before dispatch, the host atomically validates all mapped rights, declaration
requirements, contracts, provider support, delivery, queued-prefix constraints
and capacity, then moves the rights and constructs the callee's grants.
Rejected admission changes no rights. Exact operation joins precede moved-right
rejection; changed mappings conflict. An SDK offer or failed final result does
not establish whether rights moved. The host retains authoritative ownership.
No cross-root connection, ambient lookup or late injection into an ungranted
running participant is implied.

Disposing a receiver does not revoke its peer's unused send right. While the
source owner remains live and the source is neither failed nor sealed, that
sender remains transferable under the same checks, even after receiver
disposal. For direct delivery, its sends and close still fail `DISCONNECTED`;
transfer cannot revive delivery. Broadcast delivery continues for other readers
and permits later subscriptions while the source remains open. A disposed receiver
is not transferable. Required ports require a
grant, not a guarantee that the peer remains available. This keeps observation
disposal independent of whether producer admission wins or loses that race.

| Request | Closed parameters | Successful result |
| --- | --- | --- |
| `channel/create` | Optional `delivery: "direct"` or `"broadcast"`; optional `schema` or package-local `contract`, mutually exclusive | Direct: `{send: grant, receive: grant}`; broadcast: `{send: grant, source: opaqueReference}` |
| `channel/subscribe` | `{source: opaqueReference}` | One broadcast receive grant owned by the creating invocation |
| `channel/send` | `{endpoint, value}` | `null`: validated, snapshotted host acceptance, not processing or durability |
| `channel/next` | `{endpoint}` | `{item: {sequence, value}}` or `{end: {lastSequence}}` |
| `channel/close` | `{endpoint, error?: "LAGGED"}` | `null`: clean writer seal or producer-declared abnormal end |
| `channel/release` | `{endpoint}` | `{status: "released"}`, `{status: "ended", lastSequence}`, or `{status: "failed", code, details?}` |

Creation defaults to direct delivery and generic JSON/1. Schemas use Schema/1.
`contract` is either a package-local `./path.json` string or the closed object
`{slot: LocalName, channel: LocalName}`. The latter selects the named agreement
on that channel port in the invoking package's declared dependency contract.
Both names are at most 64 characters. Resolution MUST use the caller's captured
declaration and its offline closure, never a selected provider's files or a URL.
Missing declarations, missing ports or ports without a named agreement fail
before allocation. Resolution neither invokes the slot nor grants endpoint or
execution rights; ordinary delivery and transfer checks still apply.
Named references resolve only against the invoking package. Unsupported valid
requests fail operationally before allocation or dispatch. Invalid RPC shapes
retain the ordinary incompatibility rules.

The host assigns accepted sequences starting at one. Receivers validate a
contiguous interval from their immutable `startSequence`; a clean end equals
the last delivered sequence (`startSequence - 1` for an empty interval).
There is one outstanding read and no SDK prefetch. Direct full queues exert
bounded sender pressure; receiver disposal rejects pending and future sends
with `DISCONNECTED`.

Broadcast acceptance does not wait for readers. A reader exceeding its capacity
fails with sticky `LAGGED`, independently of the writer and other readers. A
reader-schema failure likewise affects only that subscription. With no readers,
accepted values advance sequence and source byte budget but are not retained.
Source-invalid or oversized values instead fail the entire source before
acceptance. Source/writer constraints apply before per-reader validation;
adding a reader never adds its validator to a broadcast source. Connection
admission still rejects known conflicting nontrivial writer/reader schemas in
either binding order, including all staged mappings and existing live subscribers.
The host bounds queues,
retained/in-flight payload, pending sends, parser/writer buffers and lifetime
allocations. A committed but unread response consumes receiver capacity until
the next read releases its credit.

Clean writer close rejects while sends remain unaccepted; otherwise it seals without
waiting for the receiver or execution result. Accepted data can drain while
the source owner lives. Failure before sealing aborts the source. Previously
explicitly sealed intervals remain sealed despite subsequent producer failure;
neither sealing nor receiver EOF establishes execution success.

An owned writer may instead close with `error:"LAGGED"` to declare incomplete
delivery. This optional cause is a closed enumeration, not an arbitrary error
message or execution status. The host checks writer authority before changing
the source, records its sticky abnormal end, rejects pending sends and wakes
all still-active receivers with `LAGGED`. This abnormal close is allowed while
sends remain pending; their operations still settle separately. Repeating the
same abnormal close joins that end. An earlier explicit clean seal cannot be
rewritten into a failure: such a later abnormal close rejects `INVALID_INPUT`.
A prior source failure stays authoritative. Receiver disposal and committed
read responses keep their ordinary ordering rules.

The producer's declaration establishes only incomplete observation. It does
not cancel producer execution or supply host-authenticated process, authority,
or cleanup evidence. Ordinary calls and language-level failure recovery are
unchanged.

Failure discards only uncommitted queued values. A committed read response may
still arrive; the next read or release reports the sticky cause. Revocation and
clean-end commitment are atomically ordered by the host. Local read cancellation
may win before SDK end exposure. Root cancellation independently prevents
execution success.

Cancelling an active read disposes its receiver. The SDK retains and drains
the original read response and disposal response; it cannot restart iteration
after silently skipping a committed item. Cancelling a send retracts only an
unaccepted pending value, never an accepted value or permission to replay it.
Cancelling a close/release wait retains its settlement action.

Cancelling a creation or subscription wait does not prove that no allocation
occurred. The SDK retains the wire response and disposes any late grants before
completion; it cannot lose or replay an uncertain allocation. A newly allocated
broadcast receiver is active owned work even if never read. Its holder must
finish or dispose it; finalization cannot silently turn abandonment into success.

Uncancelled receiver disposal waits for its response and all prior reads. It
exposes a previously unexposed terminal failure even if a read waiter was
cancelled before that failure arrived. An internally known cause is not exposed
until a public operation rejects/raises with it. Repeated disposal joins the
same action and does not rethrow an already exposed cause. Disposal that wins
before an earlier source failure means deliberate incomplete delivery, not a
new failure. Observation cancellation does not cancel producer execution.

Independent readers/writers must remain serviced while operations are pending.
A blocked transport cannot prevent other participants' progress or host fencing.
Control has priority only between complete frames; no delivery is promised over
a broken or persistently blocked pipe.

## 6. Operation identity

`operationId` belongs to the authenticated invoking participant, not the whole
root tree. Siblings reusing one spelling never share an operation. A supplied
caller/session ID is ordinary data and cannot choose that identity scope.

```text
same caller + same operationId + same canonical call content
    joins or returns the established operation result

same caller + same operationId + different canonical call content
    OPERATION_CONFLICT before another dispatch
```

Canonical equality compares this exact byte sequence:

```text
UTF8("FLOW-Call/1\0") || RFC8785(complete validated flow/call params without operationId)
```

The separator is one NUL byte. Remove only `operationId`; preserve all other
members and optional-key presence. Slot, actual input, advisory intent and
channel mappings retain distinct meaning. Omitted `channels` and `channels:{}`
conflict under one identity. There is no empty-map or schema-default
normalization. Transport request IDs and wait timing are not semantic input.

The operation remains bound to its authenticated caller and the exact admitted
implementation, configuration and grants selected for it. A duplicate must not
re-resolve that selection. An authenticated exact duplicate can join without
transferring already moved endpoints again; it cannot resurrect revoked rights
or join another caller. Changing the slot conflicts even when both slots resolve
to the same package or interface. New operations validate all actual rights,
resources, support and endpoint requirements before atomic transfer and dispatch.

The host chooses persistence; Run/1 defines no ledger schema, public call hash,
global registry, internal activation ID or recovery database.

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
| `OPERATION_CONFLICT` | The operation ID was already used with different canonical call content. |
| `UNAVAILABLE` | No admitted target or provider was callable for this operation. |
| `PERMISSION_DENIED` | Host authority policy refused the requested operation. |
| `RESOURCE_EXHAUSTED` | A declared protocol or host capacity bound prevented admission or completion. |
| `INVALID_INPUT` | Application input failed the selected invocation's declared validation after the Run/1 envelope was valid. |
| `INVALID_RESULT` | A component or called implementation produced an invalid declared result. |
| `UNCERTAIN` | Dispatch may have occurred, but a trustworthy terminal result cannot be proved. |
| `EXECUTION_FAILED` | Admitted application work failed and no narrower code above applies. |
| `LAGGED` | Channel delivery failed because its bounded observation capacity was exceeded. |
| `DISCONNECTED` | The connected receiver was disposed or its communication right ended. |

JSON-RPC `-32602` means the Run/1 method params themselves are invalid;
`INVALID_INPUT` is downstream application validation. JSON-RPC `-32603` means
the peer failed while processing the protocol; `EXECUTION_FAILED` means the
admitted application work failed.

Every request has one atomic terminal decision. A committed result or error
wins a later cancellation or deadline observation. Otherwise the first
recorded cancellation/deadline terminal condition determines `CANCELLED` or
`DEADLINE_EXCEEDED`; no peer sends two terminal responses.

That decision fixes the request-level result or error. Overall Run acceptance
also requires the clean process completion described in Section 9.

Host-internal distinctions such as which host binding, provider, runtime
selection, or execution envelope was unavailable belong in durable host
diagnostics, not the portable error taxonomy. Activation failures which occur
before a channel exists are not Run/1 errors.

`PROTOCOL_ERROR` and `CHANNEL_LOST` are local terminal classifications, not
`-32000` values sent over a channel which can no longer be trusted. The
machine-readable registry is
[`run-1-errors.json`](https://flow.jig.md/schemas/run-1-errors.json).

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

Recoverable settled failures use ordinary language recovery; there is no error
acknowledgement or global settled-failure ledger. An ignored, already-settled
recoverable failure may escape detection. Fatal loss of this invocation's
transport, root cancellation, unresolved ownership or failed cleanup still
prevent success. A child that is conclusively fenced and cleaned may instead
return a recoverable parent-local operational error; fatality follows the
affected owner, not a word in an error message.

Before implicit writer sealing, account for handler error or invalid result,
fatal/cancellation state, abandoned live work and active unfinished receivers.
Capture abandonment at handler settlement; cleanup does not erase it. Resolve
retained cancellation/disposal accounting and recheck eligibility. The host,
which knows actual endpoint transfers and source state, seals only healthy
held writers after eligibility; a known disqualifier aborts unsealed sources.
A wholly unused unconnected pair can be released automatically. An activated
receiver must reach end, terminal failure or explicit disposal. Recheck fatal
and cancellation state before accepting the execution terminal.

The host must keep the component's stdin open while the root request is
pending. After receiving and validating the complete root terminal response,
it may close that sending half immediately. The component must tolerate this
causally later half-close.

Component stdin and stdout are independent byte streams; Run/1 infers no
physical wall-clock ordering between them. The component locally linearizes a
terminal response by claiming publication immediately before its serialized
transport write begins. An stdin EOF, framing failure, or fatal protocol
condition prevents the root response only when the component's protocol state
machine atomically claims it before that publication claim. Once publication
has started, later stdin state cannot overturn it: the complete write and
runtime-buffer flush wins, while a write failure is `CHANNEL_LOST`. Flush is
not `fsync`, a peer acknowledgement, or proof that the host received the
frame. Kernel or runtime buffering does not establish cross-pipe order; bytes
merely read or queued by the transport have no priority. After publication
starts, the component may stop reading; unread or subsequently observed host
input has no response guarantee.

After receiving a root response, the host continues draining component stdout
and awaits process termination. It accepts the Run only when the response is
valid and correlated, no component-originated request remains pending, stdout
ends on a frame boundary with no trailing bytes or frames, and the process
exits zero. The supervising host classifies premature termination
deterministically:

- a host-enforced kill after a recorded cancellation or deadline is
  `CANCELLED` or `DEADLINE_EXCEEDED` respectively, unless a terminal response
  had already won;
- a detected peer-protocol violation is `PROTOCOL_ERROR`;
- a nonzero process exit without either condition is `EXECUTION_FAILED`;
- component-stdout EOF, transport loss, or a zero exit before a complete
  response is
  `CHANNEL_LOST`.

A response fixes the request decision but does not by itself satisfy those
acceptance conditions. A nonzero exit, pending owned work, invalid output,
trailing component bytes or frames, or a post-response shutdown kill prevents
overall success. A post-response shutdown kill is an `EXECUTION_FAILED`
lifecycle failure rather than a later cancellation or request deadline winning
the already-fixed request decision. Cleanup failure must surface through
process exit; there is no hidden cleanup-acknowledgement protocol.

## 10. Machine interface and SDK projection

The closed message schema is
[`run-1.json`](https://flow.jig.md/schemas/run-1.json). Direction and response
correlation remain protocol state and cannot be proven by a context-free JSON
Schema document. Framing and JSON/1 validation happen before schema validation.

The TypeScript package `@jigging/flow` and Python distribution/import
`jiggy-flow`/`jiggy.flow` expose the same semantic surface:

```text
handle(handler)
RunContext
RunResult
call
channel / channels and directional endpoint types
OperationError
JSON value types
```

They do not expose JSON-RPC envelopes, transport IDs, pending tables,
resolution, host bindings, providers, schema loading, sandboxes,
administration controls, Services, Agents, or graph types. `operationId`
remains caller-supplied.

The exact language projections and their cancellation/error behavior are
closed in [`Run SDK/1`](run-sdk.md).

The corpus under `conformance/run-1/` provides executable evidence for this
candidate through separately implemented TypeScript and Python participants.
Passing that repository corpus is not a certification of a third-party
implementation.
