# Jig Journal and Hooks/1

**Status:** reviewed Jig host specification. This is one Jig Capability
Contract/1 and Jig project behavior, not a FLOW `Journal/1` conformance profile
or another FLOW protocol method.

The boundaries are deliberately separate:

```text
Run environment                         immutable invocation facts
flow/call and effect/call               requested operations
Journal Event                           durable immutable fact
Hook                                    inert Event-source-to-Run admission
stderr                                  bounded diagnostic text
```

“Coeffect” describes the first row in effect-system theory; it is not another
public object or API. An Event is intentionally dependable application input,
not telemetry. Lossy telemetry, if added later, will use a different seam.

## 1. Exact Journal capability

The canonical descriptor is
[`journal.capability.json`](contracts/jig/journal.capability.json):

```text
Contract   https://jig.dev/contracts/journal
Version    1.0.0
Digest     sha256:dd749f53de3a5f80e02386699355e28c1fd7e707b2b12bdf2d5c725eb436ddf9
```

The descriptor is the wire-shape authority. The only v1 method is:

```text
append({ type, data, subject?, occurredAtUnixMs? }) -> Event
```

`type` is an exact bounded string. Public producers should use an
owner-controlled URI, but Jig assigns no semantic compatibility to similar
spellings. `data` is any bounded JSON/1 value. `subject` is an optional domain
identifier. `occurredAtUnixMs` is an optional, untrusted domain assertion in
Unix milliseconds; it is not commit time.

The returned closed Event is:

```text
eventId, journalPosition, type, source, committedAtUnixMs, data
optional subject, occurredAtUnixMs, causedBy, correlationId, runId
```

The caller supplies only the four append fields. Jig supplies the stable ID,
project-local monotonically increasing position, authenticated source,
host-observed commit time, and available owner/correlation fields. Positions
are positive JSON/1 integers and are ordered only within one Jig project. Jig
must refuse another append before exhausting that integer domain; it never
wraps or invents a distributed global order.

## 2. Authority, idempotency, and atomicity

The Journal is a trusted host-capability provider. A package requests its exact
contract through an ordinary effect slot. The admitted Binding fixes the
authenticated producer identity and may attenuate publication to an exact
finite set of event types. The caller cannot choose `source`, impersonate a
kernel producer, or publish into a protected Jig lifecycle namespace.

The enclosing `effect/call` operation ID is append idempotency. Repeating the
same operation and request digest returns the recorded Event. A different
operation ID intentionally creates another Event. Jig commits, in one local
transaction:

```text
Event
append result and operation-ledger terminal record
matching Hook selections and their derived-Run outbox records
```

A crash exposes either none of that transaction or all of it. The host never
redispatches a committed append. Canonical Jig lifecycle Events use the same
Event value and transaction directly inside the kernel; an external provider
observation cannot masquerade as one.

Only Jig's canonical host provider can drive Jig Hooks. A host-native or FLOW
Service provider implementing the same descriptor elsewhere supplies the same
method/value interface, but acquires no `Journal/1` label, kernel namespace,
Hook authority, or atomicity claim.

## 3. Hooks and Event Sources

A v1 Hook is one admitted, immutable relation:

```text
one Event source -> one exact Run-capable Binding
```

The source has two deliberately different forms.

An **Event selector** reacts to facts produced elsewhere. It fixes an
authenticated producer and exact Event type:

```ts
export default hook({
  on: event(
    bindingRef("github-ingress"),
    "https://example.com/events/issue-opened",
  ),
  run: bindingRef("triage"),
});
```

The producer reference resolves to an exact Binding or protected kernel
producer identity. Normalization pins the producer, type, and target Binding
to the admitted generation.

An owned **Event Source use** is a small convenience for common host
observations. A trusted installed source integration exports an inert
constructor which fixes its Event type, payload schema, settings schema,
requested authority, activation algorithm, and cleanup behavior. The Hook
contains the observation configuration and owns that source lifetime:

```ts
import { stableTextFiles } from "@jig/hooks-files";

export default hook({
  on: stableTextFiles({
    root: root("./inbox"),
    suffix: ".md",
    settleMs: 250,
    maxBytes: 1_048_576,
  }),
  run: bindingRef("triage"),
});
```

This authoring form is still inert. The Hook file does not execute a watcher
or callback. During activation Jig resolves the exact installed integration,
validates its settings and authority, starts the source under a host-owned
lifetime, and exposes the complete authority delta for consent. The source may
buffer observations while preparing, but cannot commit an Event before its
Hook interval opens. Removal first closes new source admission at a Journal
boundary and then disposes the source lifetime. A source which cannot become
ready prevents that Hook revision from activating.

The normalized source use pins:

```text
integration artifact, registration ID, and revision
one exact Event type and bounded payload schema
complete validated settings and approved roots/authority
source occurrence-key and conflict semantics
preparation, readiness, cancellation, and cleanup implementation
admission generation and Hook revision
```

After activation the trusted integration may submit only
`{ occurrenceKey, data, subject?, occurredAtUnixMs? }`. Jig validates the
bounded value, supplies the authenticated source and commit fields, and owns
the Journal transaction. Repeating one source revision and occurrence key with
the same value returns the same Event; changed content under that key is a
source conflict. The integration cannot start a Run directly.

The integration commits authenticated Events through Jig's internal Journal
producer surface; application code does not need a Journal Binding merely to
use it. The source cannot impersonate a kernel producer or publish an Event
type outside its registration. This is trusted Jig-module machinery, not a new
FLOW primitive and not sandboxed package code.

Custom, portable, reusable, or multi-consumer producers remain ordinary FLOW
Services with an explicit Journal effect Binding. Their Hooks use the Event
selector form. Therefore signal producers are not all Flows, and an owned
source convenience does not remove the more general Service path.

Both forms normalize to one authenticated producer identity, one exact Event
type, one target Binding, and one Hook interval. The declaration has no source
list, wildcard, semantic type match, mapping, filter, retry, callback, or
action field. Source-specific observation controls such as settling or
coalescing belong to the registered source settings; application branching and
transformation belong to the target Flow.

Each Hook revision owns one half-open Journal interval
`[startPosition, endPosition)`. Publishing a project admission generation and
opening/closing all affected intervals occurs at one Journal boundary. A Hook
never selects history before its start. For every matching `(Hook revision,
eventId)`, Jig inserts or returns one derived Run record transactionally. That
insert uses the Hook revision's already-pinned target Binding and admission
generation; it never resolves the target LocalName against newer live policy.
A pair selected before later revocation still inserts or returns that unique
Run. If revocation closes dispatch first, the Run becomes terminal and
non-dispatchable with the reason recorded. The Run receives the exact immutable
Event as input and then follows ordinary input validation. An invalid input
makes that same Run terminal; it does not transform the Event or select again.

When replacement changes the exact Service Binding selected as an Event
source, Jig closes new leases to the old Service and drains and fences its
publication authority before closing that source's Hook interval. The new
interval opens at the admission boundary before the replacement Service starts.
This conservative ordering prevents draining old invocations from publishing
after their interval and prevents replacement startup Events from preceding
theirs. Removing a Hook while leaving its source Binding unchanged does not
fence the producer; later Events intentionally have no such reaction.

Hooks fan out but do not consume, veto, rewrite, delay, or hide a committed
Event. An owned source may settle or coalesce raw observations only as fixed by
its registered semantics, before an Event exists. Filtering facts,
conditionals, and multi-step reaction belong in the producer or target Flow.
Hook redelivery reuses the same derived Run; there is no v1 replay mode.

## 4. Deliberate omissions

The public v1 Journal capability has no read, query, wait, replay,
subscription, stream, or replacement-provider method. Host inspection tools
may read the local Journal without creating a portable component API. Jig may
compact Event payloads only after every selected derived Run durably owns its
input and audit policy permits it.

A Flow does not hold a live continuation for a long human or external wait. It
returns a domain outcome such as `waiting`; a later Event and Hook start a new
Run. This removes the only proposed need for a public `Journal.wait` from v1.

Agent Session `events()` is a provider-owned, bounded observation log for one
session. It is not the Jig Journal. A normalized Jig lifecycle Event such as an
Agent-effect completion is committed separately by the kernel when that effect
result becomes authoritative.

## 5. Required conformance cases

1. The descriptor validates under Capability Contract/1 and independent
   implementations reproduce its digest.
2. A caller cannot set source, position, ID, commit time, Run, correlation, or
   protected lifecycle fields.
3. The same outer operation and request returns the same Event; a different
   operation creates a new position.
4. Kill injection at every append boundary exposes neither a partial Event nor
   an Event without its operation result and Hook outbox.
5. Source and type authority is exact; semantic similarity and unapproved
   namespaces never grant publication.
   Unknown Hook fields, source lists, wildcards, and non-Run targets reject.
6. Hook add, replacement, removal, Event commit, and project revocation align
   at exact half-open Journal positions.
7. Duplicate delivery creates one derived Run per `(Hook revision, eventId)`.
8. The derived Run retains the exact Event even after Journal compaction; input
   rejection terminates that Run without reselection.
9. External implementations of the descriptor cannot drive Jig Hooks or claim
   Jig kernel atomicity.
10. An owned Event Source cannot publish before its Hook interval opens, after
    source admission closes, under another source identity, or outside its
    registration-declared Event type and authority ceiling.
11. Source readiness failure leaves the candidate inactive; disposal closes
    observation and publication without running project callback code.
12. Replacing a Service Binding selected as a Hook source fences the old
    producer before its interval closes and opens the replacement interval
    before replacement startup publication; removing only the Hook does not
    fence an otherwise unchanged producer.
