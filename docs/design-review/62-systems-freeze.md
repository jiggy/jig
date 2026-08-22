# Systems freeze audit of `60-reviewed-architecture.md`

## Verdict: BLOCK

The architecture does not need another redesign. Its layer boundaries and
method surfaces are coherent. It is not yet safe to freeze, however, because
six missing transaction/lifetime rules allow two conforming implementations to
disagree about live authority, duplicate Events, Hook activation, configuration
identity, and update atomicity.

The blockers are narrow:

| ID | Severity | Contradiction |
|---|---|---|
| B1 | Fatal | A request may return normally while owned child operations remain live. Ownership then disappears before its work does. |
| B2 | High | Service status is both “strictly increasing” and repeatable, while status/binding revision installation and removal races are not transactional. |
| B3 | Fatal | Event append promises stable retry receipts, but the generic operation ledger forbids replay of uncertain work and supplies no stable provider invocation key. |
| B4 | High | Hook Run creation is atomic per revision/event, but the interval in which a Hook revision owns Events is undefined. |
| B5 | High | Configuration and grants are called immutable while environment values, import closure, and effective raw-authority containment are not fully bound. |
| B6 | Fatal | “Shadow” Service startup may perform irreversible effects before the activation switch, and source plus database activation cannot literally switch in one filesystem/database transaction. |

Apply the patches below and pass the listed crash/race tests. With those
changes, my verdict becomes **PASS for architecture freeze**, while public
`1.0` remains correctly gated on the black-box suites in section 15.

---

## B1 — Owner completion does not quiesce owned work

### Failure

Section 5.3 correctly says every component operation belongs to a live inbound
request. Section 5.7 closes descendants on cancellation. It does not say what
happens when a component sends an ordinary success/error response while one of
its `flow/call` or `effect/call` requests is still pending.

For example:

```text
flow/run R
    -> effect/call E owned by R
    -> component returns successful R result without awaiting E
```

If Jig accepts the Run result immediately, `R` is no longer live but `E` still
has authority. If Jig leaves `R` internally live, the wire result and ownership
state disagree. If it silently reparents `E`, v1 has acquired an unspecified
Scope-transfer operation.

The same failure exists for a returning `service/invoke` and an unexpectedly
returning `service/mount`.

### Minimal normative patch

Add this ownership rule to Run/1 and import it into Service/1:

> Receiving a terminal response closes admission for that owner but does not
> immediately commit the owner terminal state. For every still-pending
> component-originated child request, the host returns `OWNER_CLOSED` and
> cancels its downstream child/provider work; it does not send
> `request/cancel`, because it did not originate that JSON-RPC request. The host
> resolves each child operation to a terminal or `UNCERTAIN` record under the
> bounded cleanup deadline and runs host-owned cleanup. Only then may it
> validate and commit the owner response. No operation is implicitly detached
> or reparented. A component which returns with owned requests outstanding has
> committed a lifecycle violation recorded in diagnostics, even when cleanup
> succeeds.

The terminal protocol response may be buffered while quiescence occurs. If
quiescence exceeds the hard deadline, the process tree is terminated and the
owner is `LOST` rather than successful. For a Service invocation, work
explicitly created under the still-live Mount owner is not a child of the
invocation and is unaffected; there is no automatic owner transfer.

### Falsifying test

Return success from a Run, Service invocation, and Mount while each has:

- an undispatched child;
- a dispatched cancellable effect;
- a dispatched effect whose result is unknowable; and
- a child process ignoring cancellation.

No owner may become `SUCCEEDED` while one of its owned requests is live. The
unknowable effect must become `UNCERTAIN`; the ignoring process must be killed;
no child may issue a new operation after admission closes.

---

## B2 — Service revision and generation publication is not one state machine

### Failure

Section 6.3 requires status revisions to be strictly increasing, then calls an
exact repeated revision idempotent. Those are different order relations.

More importantly, the following ordering is unspecified:

```text
provider sends status revision N removing export X
host concurrently admits service/invoke for generation X
host acknowledges status N
```

The document says removal “immediately” closes admission, cancels admitted
invocations, and marks bindings lost, but it does not identify the commit point
which makes those effects visible together. A second host could acknowledge
first and cancel later.

`service/bindings` has a related hole. An invocation “pins one dependency
revision,” and Mount background work uses the latest acknowledged revision, but
the required revision is not explicitly present in the corresponding wire
requests. Concurrent JSON-RPC handling can therefore mix an old and new
snapshot despite ordered line framing.

### Minimal normative patch

Replace “strictly increasing” with:

> A new status or binding snapshot revision is greater than the last accepted
> revision. An exact repeat of the last revision and canonical digest returns
> the original acknowledgement. A lower revision or the same revision with a
> different digest is a protocol error.

Then define these commits:

1. `service/status` carries `ownerRequestId` naming the live Mount request and
   its status revision. It uses that revision—not a separate operation ID—for
   idempotency.
2. Accepting a status snapshot atomically records its digest, assigns any new
   host generations, closes admission for removed generations, marks their
   bindings lost, and records cancellation of admitted invocations. Only then
   may the host acknowledge the snapshot.
3. The first such committed snapshot marks the Mount ready. A status request
   observed after Mount cancellation or from a stale channel epoch fails
   before mutation.
4. `service/bindings` carries the Mount owner and a full revisioned snapshot.
   Its successful response means that entire snapshot is installed.
5. Every `service/invoke` carries the exact acknowledged dependency revision it
   must observe. Every Mount-owned `flow/call`/`effect/call` carries the exact
   acknowledged dependency revision used to resolve its slot. The host rejects
   stale, unknown, or partially installed revisions.
6. Once a Mount is internally draining, new consumer bindings cannot target
   it. Status updates may remove exports but may not add a new availability
   transition.

An already running invocation may be force-cancelled after the removal commit;
the acknowledgement need not wait for its cleanup, but its generation is no
longer callable.

### Falsifying test

Race 10,000 invocations against removal revision 8 while processing revisions
`7, 8, 7, 8-identical, 8-changed, 9`. At the revision-8 commit boundary, every
invocation must be classifiable as admitted-before-and-cancelled or rejected;
none may be newly admitted afterward. Re-add the export at revision 9 and prove
that no old binding reaches its fresh generation.

Concurrently install dependency revision 4 while invocations and background
effects name revisions 3 and 4. Every provider call must observe one complete
snapshot. No request may resolve some slots through 3 and others through 4.

---

## B3 — Event idempotency and generic uncertainty currently disagree

### Failure

Section 5.6 says an uncertain dispatched effect is not silently replayed and a
new attempt uses a new `operationId`. Section 9.2 says retrying the same Event
operation returns the same receipt.

For a host-native Journal using the same database, Jig can atomically commit:

```text
Event + Event receipt + outer effect result
```

For a mounted or remote provider, it cannot. A crash can occur after the
Journal commits the Event but before Jig commits the outer operation result.
The outer record is `UNCERTAIN`. Returning the original receipt requires either
redispatch or a provider query, but Service/1 currently gives the Journal no
stable provider-visible invocation key with which to deduplicate or query.

Thus “at most one Event receipt” is not implementable for every provider which
can satisfy the advertised Journal contract.

### Minimal normative patch

Make idempotency an exact property of the official Journal contract:

1. Every effect-provider dispatch carries a host-stamped stable `callKey` and
   canonical request digest derived from the durable outer operation record.
   They are protocol envelope fields, not mutable method input.
2. Service `service/invoke` carries that key when it dispatches an effect
   provider. Provider application code receives it through its provider SDK.
3. The Journal `append` method must durably and atomically store
   `(callKey, digest, Event, receipt)`. The same key/digest returns the same
   receipt; the same key with another digest fails.
4. The Journal exposes a recovery lookup by `callKey`, or explicitly permits
   idempotent redispatch of `append` with that key. Jig may perform this recovery
   only for contracts which declare and pass the exact idempotency profile.
5. Generic uncertain effects remain non-replayed. Journal recovery is not a
   loophole which allows Jig to replay arbitrary operations.
6. A host-native Journal may optimize the two records into one transaction but
   must present the same observable semantics.

Clarify the two durability boundaries:

```text
Journal commit
    proves the Event and its Journal receipt are durable.

Outer effect commit
    proves Jig durably knows the operation result.
```

They are one transaction only for a co-located implementation. A crash between
them leaves the outer operation uncertain until contract-authorized recovery
finds the receipt.

### Falsifying test

Implement the Journal as a separate Service database. Kill Jig or the provider
at every write/response boundary. Repeat the original `effect/call` and also
send a changed payload under the same operation ID. Across all executions there
must be at most one Event and one receipt, and the changed payload must never
dispatch. Repeat the same test with a non-idempotent arbitrary Service method;
Jig must not redispatch it from `UNCERTAIN`.

---

## B4 — Hook revisions have no temporal ownership of Events

### Failure

Section 9.3 gives the correct deduplication key, `(Hook revision, Event ID)`,
but never defines which Hook revision applies when an Event commit races with
`jig apply`, Hook addition, Hook removal, or Hook replacement.

Without an activation interval, both old and new revisions may create a Run,
or neither may. A newly added Hook might also implicitly replay the entire
Journal. “Replay is explicit” does not by itself identify the live boundary.

The text also says Jig atomically creates a derived Run but does not distinguish
Run-record creation from successful dispatch. Capacity, missing providers, or
process failure must not cause a second Hook Run to be created.

### Minimal normative patch

Give each inert Hook revision a Journal interval:

```text
hook revision H is active on [startPosition, endPosition)
```

The activation transaction orders Hook revision publication against the Event
Journal position:

- adding a Hook sets `startPosition` to the next Event position after the
  activation boundary;
- replacing/removing it closes the old interval and opens any new interval at
  the same boundary;
- no historical Event is selected without an explicit replay operation;
- an Event belongs to every Hook revision whose exact type matches and whose
  interval contains its position.

For each selected pair, one database transaction inserts or returns a derived
Run record with a unique key `(hookRevisionDigest, eventId)`. The record may
remain `PENDING`, `BLOCKED`, or later fail; Hook delivery is complete once that
record exists, not when the Flow succeeds. Redelivery returns the same Run.

At Hook activation, Jig validates that the exact target Flow Binding exists and
its input schema accepts the normative Event envelope. The Flow receives the
unaltered envelope as both declared Hook input and trigger reference. V1 has no
mapper.

Explicit replay has its own durable replay ID and range. If replay is intended
to create a second Run, its unique key includes that replay ID; otherwise it
returns the original Run. The operator must choose rather than receiving an
implicit duplicate.

### Falsifying test

Commit Events continuously while atomically adding, replacing, and removing a
Hook. Every Event position must select exactly the revisions whose half-open
interval contains it. Kill Jig between Event commit, Hook selection, derived
Run insertion, and dispatch. Each selected pair must have exactly one Run ID,
even if the Run never becomes runnable. Adding a Hook must process zero prior
Events until an explicit replay is requested.

---

## B5 — Configuration and grants are not yet one immutable value

### Failure A: environment values

Package metadata can request `env: [CI]`. The architecture says the environment
starts empty, there is no environment fallback, and every Run pins immutable
configuration. It does not say where `CI` obtains a value.

If Jig copies its ambient process environment, the no-fallback rule is false.
If the value is read at every Run, the Binding is not immutable. If it is a
secret, recording the plaintext in activation/provenance is unsafe.

### Failure B: configuration import closure

Jig snapshots project/config source “and dependencies,” then evaluates it. It
does not define whether dependency means only local imports, a lockfile closure,
runtime package resolution, or whatever the host module loader happens to find.
Two hosts can normalize different desired state from the same visible tree.

No ordinary filesystem can promise a simultaneous atomic snapshot of several
files being edited. “Coherent source generation” is therefore too strong
unless Jig has a filesystem snapshot primitive or a declared capture protocol.

### Failure C: grant satisfaction

“Bindings approve the request; they cannot silently widen it” and a trusted
override may record wider authority. The exact inclusion rule is missing. An
implementation could treat a package network-origin list as documentation and
approve a broader gateway while another rejects it.

`advisory`/`unavailable` failure is also expressed in terms of a “required
restriction,” without defining the isolation dimensions generated by the
effective launch/grant plan.

### Minimal normative patch

Define one complete Binding/activation environment:

1. A package `env` entry is an allowlisted required name only. The Binding must
   supply an explicit immutable literal value or a versioned secret reference.
   Jig never reads the host environment implicitly.
2. Literal values are part of the Binding digest. A secret reference pins
   provider identity and secret version/digest, while plaintext is redacted and
   delivered only inside the sandbox. Rotating the secret creates a new Binding
   revision.
3. The configuration snapshot contains the entry source, all statically
   resolved local imports, the exact dependency lock and selected package
   artifacts, and the evaluator/loader contract identity. Evaluation can import
   only from that snapshot closure. Dynamic or ambient resolution fails.
4. Capture produces an immutable **candidate**, not a mythical instantaneous
   multi-file view. Jig copies and hashes, verifies that observed sources did
   not change during capture, and retries on detected change. The candidate is
   then the sole input to evaluation/checks. A stable intermediate edit may be
   captured; validation and explicit apply, not filesystem simultaneity, are the
   safety boundary.
5. For raw authority, the effective Binding grant must contain every package
   minimum and may contain nothing outside it. A wider grant requires the
   explicit exact-digest trusted override and is recorded as nonportable local
   policy.
6. Named attachment requirements must resolve to existing Binding attachments
   with equal or stronger requested modes before launch.
7. Runtime planning expands the effective grant into a closed list of isolation
   predicates: package/root visibility, writes, environment, descriptors,
   network mediation/denial, process/descendant policy, resource limits, and
   termination control as applicable. Every predicate must report `enforced`
   or `mediated` for untrusted execution; any `advisory` or `unavailable`
   predicate rejects launch.
8. Preparation/install authority is a separate recorded grant plan and sandbox
   report. It never inherits broader host or Runtime Provider authority merely
   because preparation is trusted code.

### Falsifying test

Run one Binding under hosts with different ambient `CI`, `PATH`, module caches,
package-manager globals, and current directories. It must normalize and execute
identically or fail before launch. Rotate a secret; old Runs must retain their
pinned version and new Runs must require a new Binding revision.

Attempt widening with an extra origin, Git helper, inherited descriptor,
package-manager install hook, transitive child process, and undeclared writable
attachment. An untrusted activation must reject unless every authority is in
the exact effective plan and its predicate is enforced/mediated. A trusted
override must display the excess authority rather than calling the package
portable or sandboxed.

---

## B6 — Activation publication is atomic only inside one authority domain

### Failure A: shadow Service effects

Section 13 says `apply` shadow-starts required Services before switching the
activation pointer, and that a failed candidate leaves the old activation safe.
A candidate Mount can perform a database migration, network request, Event
append, or Agent effect during startup. Those effects cannot be rolled back
when readiness fails. Calling the process “shadow” hides no authority from it.

The old activation can remain routable, but the external world is not
unchanged. The architecture's general uncertainty law is correct; update prose
must not create an exception.

### Failure B: source plus activation switch

`jig rollback` and update promise a matched visible source-and-activation
transaction. Source replacement and a database activation pointer are not one
atomic primitive on ordinary platforms. A crash may occur after either side.

### Failure C: activation generation visibility

“New work sees all-new or all-old” requires root admission, Resolver catalog,
Flow Bindings, Hook intervals, Service eligibility, grants, and normalized
configuration to select one generation. That generation field is not currently
made normative at each admission point.

### Minimal normative patch

Narrow the atomicity claim:

> Activation publication atomically changes Jig's **admission generation**.
> Every new root Run, binding resolution, Hook interval, and Service-consumer
> binding is admitted against exactly one generation. Existing owners retain
> their prior generation. Publication does not atomically roll back external
> effects performed by candidate Services.

Then require:

1. A shadow Mount belongs to an immutable candidate activation and receives no
   consumer bindings before publication. Its outbound effects are nevertheless
   real, grant-checked, operation-journaled, attributed to the candidate, and
   potentially irreversible.
2. Projects which require side-effect-free preflight must use a Service/runtime
   check that needs no external authority, or skip shadow Mount and accept a
   post-publication readiness window. FLOW makes no generic purity claim.
3. Failure or abandonment cancels candidate Mounts and reports every committed
   or uncertain startup effect. It does not claim to restore external state.
4. The publication transaction changes one durable admission-generation
   pointer and opens/closes Hook intervals at the same Journal boundary. All
   admission paths read or receive that exact generation.
5. A Run pins the generation at root admission. Later unresolved discovery
   uses its pinned catalog/policy generation. A successful missing-binding
   repair may extend only that owner's binding table with one explicitly
   recorded provider revision; it does not silently switch the owner's project
   generation.
6. Visible-source replacement plus database publication uses a durable update
   transaction and recovery state machine, not an impossible cross-medium
   atomic write:

```text
PREPARED
  -> SOURCE_SWITCHED
  -> ADMISSION_SWITCHED
  -> COMMITTED
```

Before either switch, old source and activation remain authoritative. While a
switch transaction is incomplete, the coordinator blocks new admission. On
restart it deterministically rolls forward or rolls back according to the
recorded transaction and verifies both digests before reopening admission.
Directory replacement must use a same-filesystem atomic rename where available;
unsupported filesystems fail the operation rather than weaken the claim.
7. Rollback is the same state machine with old/new directions exchanged.
   Runtime-only pinning never edits source and remains visibly divergent.

### Falsifying test

Start a candidate Service which commits an external effect and then fails
readiness. The old activation must remain routable; the candidate effect must
remain visible as committed/uncertain and must not be described as rolled back.

Kill Jig before and after every filesystem rename, admission-pointer update,
Hook interval boundary, Service readiness acknowledgement, and transaction
commit. Before admission resumes, visible source, normalized configuration,
resolver catalog, Hook intervals, root Runs, and new Service bindings must all
refer to one recovered generation. Existing old owners must remain pinned and
auditable.

---

## Additional required clarifications (not redesign blockers)

These can be folded into the normative schemas/state registry while applying
the six patches:

1. **Service control ownership.** `service/status` is Mount-owned but not an
   effect operation; its revision is its idempotency key. `service/bindings` is
   a host control request and cannot own component work. Only `flow/run`,
   `service/mount`, and `service/invoke` are operation owners.
2. **Draining semantics.** Draining stops new consumer bindings, not existing
   pinned invocations. Mount-background work remains permitted until Mount
   cancellation unless project policy cancels it earlier; it remains budgeted
   and journaled.
3. **Terminal race.** Sending `request/cancel` moves the originator to
   `CANCEL_REQUESTED`, not `CANCELLED`. A normal response may win if the receiver
   completed first. Cancellation is proven by the terminal response or by
   enforced process loss; dispatched effects retain their independent states.
4. **Journal ordering.** `journalPosition` is monotonic only in one named Jig
   Journal partition. Hooks are attached to that partition; the specification
   makes no global distributed total-order claim.
5. **Run output and Hook validation.** Output validation occurs before owner
   success commits. Hook target input compatibility is validation of the
   concrete Event/1 envelope, not schema-subtyping inference.
6. **Unknown profile behavior.** Package discovery remains inert, but activation
   requiring `Callable/1`, `Telemetry/1`, an unknown Grant Profile, or another
   unsupported facility fails before process launch with a machine-readable
   unsupported-profile diagnostic.

---

## Freeze gate

The candidate becomes a **PASS** when all of the following are true:

- the six minimal patches are incorporated into the normative architecture;
- schemas name every revision/generation/call key needed above;
- the crash/race tests pass for a host-native and separately mounted Journal;
- plain and Cordis Service providers pass the same owner/status tests;
- update kill injection proves logical source/admission atomicity through
  recovery rather than claiming an impossible physical transaction; and
- the sandbox report fails closed for every undeclared direct or transitive
  authority in the reference escape suite.

No new public object, method family, workflow language, or application concept
is needed. The required changes close ownership and transaction boundaries the
candidate already intends to provide.
