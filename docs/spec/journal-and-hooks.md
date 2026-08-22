# Jig Journal and Hooks/1

**Status:** reviewed Jig host specification. This is one Jig Capability
Contract/1 and Jig project behavior, not a FLOW `Journal/1` conformance profile
or another FLOW protocol method.

The boundaries are deliberately separate:

```text
Run environment                         immutable invocation facts
flow/call and effect/call               requested operations
Journal Event                           durable immutable fact
Hook                                    inert Event-to-Run admission
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

## 3. Hooks

A v1 Hook is one admitted, immutable tuple:

```text
(authenticated source selector, exact event type)
    -> exact Run-capable Binding
```

The source selector is an inert project reference resolved to an exact Binding
or protected kernel producer identity. Its closed declaration is:

```ts
export default hook({
  source: { binding: "inbox-watcher" },
  type: "https://example.com/events/inbox-item-created",
  target: "triage",
});
```

`source` is exactly `{ binding: LocalName }` or `{ kernel: LocalName }`; the
latter must resolve to a fixed protected Jig registration. `target` is one
Run-capable Binding LocalName. Normalization pins both source and target to the
current admitted revisions. There is no source list, wildcard, semantic type
match, mapping, filter, retry, debounce, callback, or action field.

Each Hook revision owns one half-open Journal interval
`[startPosition, endPosition)`. Publishing a project admission generation and
opening/closing all affected intervals occurs at one Journal boundary. A Hook
never selects history before its start. For every matching `(Hook revision,
eventId)`, Jig inserts or returns one derived Run record transactionally. That
Run receives the exact immutable Event as input and then follows ordinary
Binding admission and input validation. An invalid input makes that same Run
terminal; it does not transform the Event or select again.

Hooks fan out but do not consume, veto, rewrite, delay, debounce, or hide an
Event. Filtering, conditional logic, multi-step reaction, and coalescing belong
in the producer or target Flow. Hook redelivery reuses the same derived Run;
there is no v1 replay mode.

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
