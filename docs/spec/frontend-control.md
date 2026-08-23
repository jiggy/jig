# Jig frontend control operations

**Status:** reviewed Jig host semantics. This is not a FLOW protocol,
Capability Contract, network endpoint, or conformance label.

A CLI, GUI, or trusted local module needs to request and observe Jig work
without becoming a Flow. Every frontend uses the same host operations and the
same durable records; an HTTP application may wrap them, but does not create a
second execution path.

V1 standardizes the operation semantics below. It deliberately does not
standardize a socket path, JSON-RPC service, daemon topology, browser API,
credential format, or remote administration protocol.

## 1. Frontend authority

Every request is authenticated to one exact Jig project and one host-approved
authority projection. A connection is transport, not identity. Host policy may
mint a local application principal whose ceiling includes only:

```text
exact root Binding IDs it may start
Runs submitted by that principal which it may inspect or cancel
exact Event types and producer identities it may inspect
```

Administrative admission, installation, update, provider invocation, raw
Journal append, attachments, secrets, and `.jig/` access are separate and
absent by default. Application code may request a narrower projection when it
connects, but cannot self-grant one. Browser code never receives a host control
credential merely because a trusted local server serves it.

Local authentication and delegation are host implementation policy. If the
host cannot authenticate and confine a requested frontend principal, the
operation is unavailable rather than silently treated as same-user trust.
Remote exposure additionally requires an application security design outside
Jig/1.

An ordinary same-user process which can read or modify Jig's host files is
already trusted; a narrow client object does not sandbox that process. Strong
separation requires the operator to launch the frontend under an enforcing OS
boundary. The authority projection still prevents accidental widening and is
the only interface a properly isolated frontend needs.

## 2. Root Run operations

The normative root operation remains:

```text
startRun(bindingId, input, submissionId) -> RunSnapshot
```

It has the exact admission, JSON/1 validation, idempotency, revocation, and
generation-pinning behavior defined in
[`project-policy.md`](project-policy.md#10-root-run-admission). A frontend may
name only an allowed active Run Binding. It cannot supply trigger metadata,
settings, attachments, provider choice, runtime choice, or authority.

Two bounded companion operations are required:

```text
getRun(runId) -> RunSnapshot
cancelRun(runId, cancellationId) -> RunSnapshot
```

`getRun` reads one durable Run visible to the frontend principal. It performs
no execution, retry, resolution, or provider query.

`cancelRun` is an idempotent cancellation request. One `cancellationId` is a
project-local retry key scoped to that frontend principal. Repeating the same
key and Run joins the same request; reusing it for another Run conflicts. Its
response is the Run snapshot established at acknowledgement time, not a claim
that all owned work has already terminated. The frontend calls `getRun` to
observe later quiescence. Cancellation never rewrites committed external work
or uncertainty as `cancelled`.

A stable `RunSnapshot` exposes at least:

```text
runId
bindingId and admitted Binding revision
admission generation
state: pending | running | succeeded | failed | cancelled | uncertain
normal { outcome, output } result when succeeded
stable failure code/evidence when failed, cancelled, or uncertain
```

Domain outcomes do not become lifecycle states. A successful `blocked` outcome
is still `succeeded`; execution uncertainty is never a Flow outcome.

## 3. Bounded Event inspection

FLOW's public Journal capability remains append-only. A frontend with explicit
inspection authority may call the host-local operation:

```text
readEvents(after, limit, exactTypes?, exactSources?) -> EventPage
```

`after` is a non-negative project Journal position and is exclusive. `limit`
is 1–256. Selectors are finite exact allowlists further intersected with the
principal's authority; no wildcard or semantic match exists.

The host reads against one Journal high-water snapshot and returns authorized
matching Events in increasing position order. The page contains:

```text
events                    at most limit immutable Events
nextPosition              safe exclusive cursor for the next request
minimumRetainedPosition   earliest position still inspectable
more                      whether another matching page exists in the snapshot
```

If `limit` matching Events are returned, `nextPosition` is the last returned
position and `more` reports whether another match exists through the captured
high-water mark. Otherwise `nextPosition` advances to that high-water mark and
`more` is false, including when hidden or nonmatching Events occupied the gap.
This prevents filtered clients from rescanning the same private positions.

The cursor is valid when `after >= minimumRetainedPosition - 1`. Otherwise Jig
returns `EVENT_CURSOR_EXPIRED` with `minimumRetainedPosition`; it never fabricates a
complete replay. Event inspection does not acknowledge, consume, reserve, or
trigger an Event. Hooks remain the only v1 durable Event-to-Run reaction.

V1 has no frontend subscription or streaming operation. A GUI may poll. An
implementation may offer a transport-local wake-up optimization, but the
client must recover exclusively through `readEvents`; wake-ups have no durable
meaning.

## 4. Application ownership

An application HTTP server, database, browser bundle, authentication policy,
and UI state are Starter/application concerns. They are not automatically
captured, admitted, launched, or sandboxed as FLOW packages.

A project may deliberately build such a process as a FLOW Service only when
its boundary can use declared mediated capabilities and ordinary Service
semantics. Process supervision alone is not a reason to mislabel trusted GUI
application code as a portable Flow or grant raw network authority to imported
packages.

## 5. Required cases

1. CLI, GUI, and trusted-module submission with the same Binding/input/key
   resolves to one Run and admission generation.
2. Same submission key with changed content conflicts before new dispatch.
3. `getRun` cannot observe a Run outside the principal's project/visibility.
4. Duplicate cancellation joins; changed target conflicts; acknowledgement
   does not assert terminal cancellation.
5. A succeeded non-`done` domain outcome remains lifecycle `succeeded`.
6. Event pages are ordered, bounded, authority-filtered, and cursor-safe across
   hidden/nonmatching positions and concurrent appends.
7. Expired cursors fail explicitly; inspection never drives Hooks or claims
   complete history after compaction.
8. Browser code receives no Jig credential or ambient access merely because a
   trusted local application frontend has one.
