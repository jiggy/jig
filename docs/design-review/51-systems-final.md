# Final hostile systems review

## Verdict

The candidate has the right macro-boundaries, but it is not yet an implementable
stable specification. Run/1 is repairable without expanding its conceptual
surface. Service/1 and Contract/1 contain three release-blocking holes:

1. the Mount outlives the request which is currently its only valid owner;
2. availability snapshots cannot express and complete a safe generation drain;
3. portable resource/delegated-Service handles have no wire, minting,
   delegation, revocation, or routing semantics.

Those are **fatal** because two independently reasonable implementations will
make incompatible lifecycle and authority decisions. Fourteen **high** issues
can cause duplicated work, stale-provider calls, deadlocks, event loss, escaped
authority, or non-atomic activation. The architecture should not pass its
release gates until every fatal and high finding has a kill-point or adversarial
conformance fixture.

This review does not propose a different product. It identifies the minimum
state/protocol corrections needed to make the candidate's own guarantees true.

## Severity

| Level | Meaning |
|---|---|
| **Fatal** | The stable protocol is internally contradictory or cannot be independently implemented/interoperated safely. |
| **High** | A conforming-looking implementation can duplicate effects, deadlock, lose a promised fact, cross authority, or publish invalid state. |
| **Medium** | Implementations can disagree, diagnostics can lie, or an important failure is discovered too late, without immediate authority/integrity loss. |
| **Low** | Hardening or observability gap whose failure is bounded by stronger rules elsewhere. |

---

# Fatal findings

## SYS-F1 — Fatal: Mount lifetime has no valid owner after `service/mount`

### Break

The candidate states all of the following:

- every outbound request names a **live owner request**;
- `service/mount` returns when initialization succeeds;
- the process then remains alive until `service/unmount` or loss;
- background Service effects belong to the Mount lifetime;
- a connection is not a lifetime identity.

After the `service/mount` response, its request is no longer live. A background
`effect/call`, `flow/call`, `event/append`, resource handle, timer, or listener
therefore has no valid owner. Treating the stdio connection as owner violates a
governing law. Reusing the completed request ID violates the live-owner check.
Inventing a `mountId` is unsafe because no wire rule currently grants or
validates it as authority.

`service/unmount` also has no precise object to address. On a pooled future
transport this becomes immediately unimplementable.

### Minimal fix

Preserve the candidate's immediate mount response and make Mount an explicit
Service/1 lifetime capability:

1. Jig creates an unguessable `mountId` before sending `service/mount` and
   includes it in the request.
2. Initialization-time outbound calls may name the live mount request; after
   success, mount-background calls name `ownerMountId`.
3. The host accepts that owner only on the process/transport authorized for the
   Mount and only while Mount state is `ready` or `draining`.
4. `service/unmount` names `mountId`, is idempotent, revokes new authority before
   cleanup, and closes it on response/deadline/process loss.
5. Per-`service/invoke` work continues to use that live invoke request as the
   narrower owner.

The equally valid alternative is to leave `service/mount` pending for the whole
Mount and use cancellation as unmount, but Service/1 must choose exactly one
model. Mixing the two is the defect.

### Falsifying test

Mount a provider, let the mount request return, then have it perform a
background `event/append` and open a resource. Verify both bind to the Mount,
not the connection. Forge another Mount ID from the same and another process;
both attempts must fail. Race `service/unmount`, process EOF, and a background
effect at every transition. No effect may be admitted after revocation and no
resource may survive terminal Mount cleanup.

## SYS-F2 — Fatal: `service/status` cannot safely order, replace, or drain generations

### Break

`service/status` is described as an acknowledged full availability snapshot,
but:

- it has no monotonic status revision;
- `service/mount` also reports initial availability, creating two authorities;
- concurrent status requests may complete out of order and regress state;
- a component generation key may be reused with changed implementation state;
- disappearance “breaks or drains according to Jig policy,” although only the
  provider knows whether the old generation can still serve;
- a full snapshot has no completion signal telling a provider when a draining
  generation's binding leases are gone;
- it is unclear whether two generations of one export may coexist during
  replacement.

The host cannot choose drain after the underlying Cordis service has already
disappeared. Conversely, immediate removal breaks consumers when the provider
could have drained. A stable service protocol cannot delegate that semantic
fact to unspecified Jig policy.

### Minimal fix

Retain the full-snapshot design only with all of these rules:

1. `service/mount` reports initialization only; the first status snapshot is
   the sole readiness/availability authority.
2. Every snapshot has a strictly monotonic `statusRevision`; stale or reused
   revisions with changed content are rejected.
3. Entries are `(export, generationKey, state)` where state is `active`,
   `draining`, or `withdrawn`. The static contract metadata cannot change.
4. A generation key is immutable for the Mount. The host returns/derives one
   exact `registrationId` and rejects equivocation.
5. New and old generations may coexist: new bindings use `active`; old pinned
   bindings may use `draining`; `withdrawn` immediately breaks them.
6. A status request which introduces `draining` remains pending until the host
   has no binding leases or in-flight calls for those generations. The provider
   must remain reentrant and continue serving them meanwhile. Its response is
   the release signal.
7. A snapshot omission of a previously present generation means immediate
   withdrawal, never an inferred drain.

If keeping a long status request is considered too subtle, replace status with
explicit `register` and `unregister(mode=drain|withdraw)` requests. What is not
acceptable is leaving the state implicit.

### Falsifying test

Send status revisions 2 and 3 concurrently and arrange for 3 to arrive/commit
first. Revision 2 must not restore its generation. Replace generation A with B
while one consumer is pinned to A: new consumers must bind B, A must continue
until its drain response, and removal before that must fail. Repeat with
withdrawal and require old calls to fail `BINDING_LOST`. Reuse A's generation
key with different state/metadata and require rejection.

## SYS-F3 — Fatal: Contract/1 handles and callbacks are not a protocol

### Break

Contract/1 claims nominal resource handles, delegated-Service handles, explicit
release, owner-lifetime cleanup, and callbacks-as-services. It does not define:

- their JSON representation or canonical identity;
- whether the host or provider mints them;
- how a receiver distinguishes a handle from attacker-controlled JSON;
- how calls route to the exact provider registration/generation;
- how a handle is transferred to a child Run or another Service;
- whether transfer moves, borrows, or shares authority;
- how lifetime narrowing, revocation, release idempotency, and provider loss
  work;
- how the host discovers nested handles in schema values safely;
- how a finite Run can publish a callback Service when Run/1 has no provider
  publication surface.

A string returned by a provider is not an opaque bearer capability merely
because a schema calls it one. Two implementations will either trust forgeable
tokens, invent incompatible envelopes, or keep process-local objects which
cannot cross FLOW.

### Minimal fix

Remove `handles`, delegated-Service handles, and portable callback claims from
stable Contract/1. V1 methods exchange ordinary JSON values. A service may use
contract-owned opaque IDs, but their validity/lifetime is application behavior,
not a FLOW host guarantee.

Design a separate Handle/1 only after at least two use cases establish minting,
delegation, routing, release, and revocation semantics. Do not make Service/1
stability wait on it.

### Falsifying test

If handles remain, require a cross-process suite which forges a token, replays
it from another Run, passes it to a child without delegation, uses it after
owner cancellation, races release with invocation, loses its provider
generation, and attempts a callback into a finite Run. Unless every case has
one wire-level result shared by two implementations, the feature is not stable.

---

# High findings

## SYS-H1 — High: NDJSON and duplex behavior are underspecified and vulnerable to deadlock/DoS

### Break

“Newline-delimited JSON” does not settle strict UTF-8/BOM handling, CRLF,
maximum frame length, JSON-RPC batches, duplicate IDs, numeric IDs, flush rules,
unknown notifications, stdout pollution, partial EOF, outstanding-request
limits, or stderr/telemetry floods. More importantly, the SDK is not required
to continue reading while awaiting an outbound request. A component which
writes `effect/call` and blocks its protocol reader cannot receive root
cancellation or a Service callback; two otherwise conforming peers deadlock.

### Minimal fix

Specify strict UTF-8, one JSON object per LF-terminated frame, no BOM/batches,
string IDs with direction prefixes, serialized flushed writes, bounded frame
and outstanding-request counts, stdout protocol-only, bounded stderr and
telemetry ingestion, malformed/oversized-frame termination, and EOF failure of
all requests. Protocol readers must remain reentrant while application calls
await. Unknown requests get method-not-found; unknown notifications are ignored
and traced.

### Falsifying test

Issue simultaneous requests in both directions, return responses out of order,
send cancellation during an outbound wait, split every byte boundary, inject a
10 GiB unterminated frame/stdout log/batch/duplicate response, and close EOF
mid-frame. Memory must remain bounded and neither peer may deadlock.

## SYS-H2 — High: cancellation direction and terminal race are incomplete

### Break

The vocabulary lists `request/cancel` only host-to-component. A component cannot
cancel its pending `flow/call`, `effect/call`, `event/append`, or Service status
request after its own deadline/branch cancellation. The root rules also do not
say whether success or cancellation wins when both race, when new requests stop,
or how an external operation becomes uncertain.

### Minimal fix

Make `request/cancel` symmetric: a sender may cancel a still-pending request it
originated. Define host terminal states and one durable commit point: first
terminal commit wins; success committed first remains success, cancellation
committed first rejects new descendants and ignores a late response. Propagate
cancel to descendants, then grace, process-tree kill, and cleanup. Cancellation
of dispatched external work becomes `uncertain` unless the provider proves a
terminal result.

### Falsifying test

Cancel from each direction before acceptance, while queued, during dispatch,
after external commit, and concurrently with a response. Kill at every state
write. Exactly one terminal state must survive and no post-cancel child/effect
may be admitted.

## SYS-H3 — High: transport owner IDs are being used as if they were durable identities

### Break

The wire sends `ownerRequestId`, while the operation ledger is keyed by “same
owner.” Request IDs are unique only per sender/connection and may be reused in a
later process. They are authorization references while live, not durable
identity. A reconnect/restart can collide ledger keys or make audit ownership
ambiguous.

Canonical request digest is also undefined: object-key order, JSON numbers,
deadlines, filesystem/binding handles, optional time fields, and schema defaults
can cause either false duplicates or false changes.

### Minimal fix

Map every accepted request to a host-assigned immutable lifetime ID
(`runId`, `mountId`, `invokeId`) and key the durable ledger by
`(lifetimeId, operationId)`. `ownerRequestId` is only the connection-bound proof
that the caller currently holds that lifetime. Define canonical semantic input
using RFC 8785 JSON plus exact binding/attachment identities; exclude transport
IDs, wait deadlines, and telemetry. Host-stamped event time is not caller
semantic input.

### Falsifying test

Reuse `h:1` on two processes/Runs with the same operation ID and different
inputs; records must not collide. Retry one request with reordered JSON keys and
a new JSON-RPC ID; it must deduplicate. Change one binding or attachment identity
while keeping input text; it must be rejected as changed operation.

## SYS-H4 — High: `flow/call` child creation is not atomic with its operation record

### Break

The candidate commits operation intent, then says Jig creates a child. A crash
between child creation, parent/operation linkage, and scheduler enqueue can
produce no child, duplicate children, or an orphan child whose result cannot be
returned. “Dispatched” is too coarse for a host-owned child operation.

### Minimal fix

In one store transaction create the child invocation ID/record, parent relation,
operation record, and durable scheduler enqueue keyed by the operation. Only
then launch the child process. A duplicate attaches to that child ID. If the
parent lifetime is lost, queued/live children are cancelled unless an explicit
detached operation (not in Run/1) exists.

### Falsifying test

Kill Jig after each write from call receipt through child launch and completion.
Recovery must show either no accepted operation or exactly one linked child.
Never two children, an unowned child, or a replayed completed child effect.

## SYS-H5 — High: wait-cycle and capacity claims lack an executable model

### Break

The document says parents do not retain the admission permit children need and
that the newest cycle edge fails. The parent process still consumes memory,
PIDs, sandbox slots, and possibly the configured total process cap. With a cap
of one, “release the admission permit” cannot create a second process. The
wait-for graph does not define nodes/edges for serial provider capacity,
repair Runs, binding readiness, status drains, or Hooks.

### Minimal fix

Separate root admission, runnable-process capacity, and resource limits. An
awaiting parent may release a scheduler execution token but not its OS resource
accounting. If no legal descendant capacity exists, fail immediately
`RESOURCE_EXHAUSTED`. Define wait nodes for live requests, repair jobs, Service
registrations/capacity, and drains; add an edge before blocking and reject it if
it closes a cycle. Never hold DB/registry locks across the wait. Bound depth,
fanout, outstanding operations, and every wait deadline.

### Falsifying test

Run a child call under hard process capacity one, saturate all workers with
parents awaiting children, create A↔B serial Service calls, and make a repair
Flow require the slot it repairs. Every case must fail/break a specific edge,
not hang or exceed the hard limit.

## SYS-H6 — High: host crash can leave unfenced Run/Service processes performing effects

### Break

The candidate marks opaque continuations lost but does not require parent-death
containment, coordinator fencing, or orphan reconciliation. After Jig crashes,
a Service or trusted process may continue direct filesystem/network work while
a restarted Jig mounts a replacement. Two provider generations can act
concurrently outside the operation ledger.

### Minimal fix

Use an exclusive project-coordinator lease and per-process supervisor lease.
Sandbox/container/Job ownership must kill children on parent death where the
backend claims containment. On restart, fence the old coordinator generation,
mark live Runs/Mounts lost, mark dispatched unresolved effects uncertain,
revoke registrations/bindings, and kill/quarantine known orphan groups before
admitting replacements. A backend unable to contain an untrusted orphan cannot
claim sufficient isolation.

### Falsifying test

SIGKILL Jig while a provider writes a heartbeat and an effect is dispatched;
restart immediately. The old heartbeat/process must stop before a replacement
becomes bindable, and the effect must be terminal-recorded or uncertain, never
reissued silently.

## SYS-H7 — High: dynamic Service binding snapshots can change dependencies inside one invoke

### Break

`service/bindings` replaces a full dynamic-dependency snapshot, but there is no
defined revision acknowledgement, stale-message rule, or per-invocation pin.
An invoke may call dependency X, receive a new snapshot, then call the same slot
again and unknowingly hit Y. Calls name exact IDs only if SDK/application code
captures them correctly; the Service context itself is mutable.

### Minimal fix

Every snapshot has a monotonic `bindingRevision`; the response acknowledges the
applied revision and stale snapshots cannot regress it. Each `service/invoke`
captures one dependency-snapshot revision for its lifetime, and slot lookups in
that invocation resolve against it. Mount-background work uses an explicitly
chosen/latest revision. Replacing a provider gives a new opaque binding ID;
removed IDs fail rather than redirect.

### Falsifying test

Update a dynamic slot while an invoke is between two calls to it. Both calls
must use the old exact binding; a later invoke uses the new one. Reorder snapshot
versions and use a removed ID; neither may reach the replacement implicitly.

## SYS-H8 — High: event commit, cancellation, and operation recovery need one exact transaction

### Break

The candidate promises event + deduplication commit before acknowledgement and
a shared transactional store, but does not define the event operation state or
its cancellation race. A host could commit the event, mark the request
cancelled, and report failure; the producer may retry in a new Run while Hooks
already react. A remote journal adapter can also acknowledge before it has a
recoverable receipt.

### Minimal fix

Commit event row, canonical payload digest, stable event ID, and operation
success result in one transaction. Before commit cancellation wins with no
event; after commit event success wins and cannot be retracted. A dropped
response on the still-live Run replays the same event ID. Host death loses the
opaque Run but not the event. A remote journal may acknowledge only after a
reconcilable durable receipt.

### Falsifying test

Kill/cancel at every instruction around the event transaction and response.
Recovery must show either no event plus cancellation or one event plus the
stable success record. Block every Hook forever and verify append acknowledgement
still follows commit immediately.

## SYS-H9 — High: waiting repair lacks an atomic activation-to-dispatch fence

### Break

The text correctly forbids repair after binding/dispatch but does not define the
transaction which races candidate activation, resolver wakeup, parent
cancellation/deadline, binding pin, and child creation. A candidate can activate
after cancellation and still dispatch, or two catalogue changes can create two
children.

### Minimal fix

Persist the call state:

```text
resolving -> waiting-repair -> binding-committed -> child-created
                         \-> cancelled/timed-out
```

On catalogue epoch change, resolve again, then atomically compare live owner,
deadline, operation state, and candidate epoch while writing the exact binding
and child record. Only one compare-and-swap can win. Repair Runs are wait-graph
nodes and staged code cannot enter the catalogue before checks/approval.

### Falsifying test

Race cancellation, two candidate activations, Semantic Resolver completion,
deadline, and host crash at every state. A live parent receives at most one
child; a lost/cancelled parent receives none.

## SYS-H10 — High: Hook deduplication is asserted without an atomic dispatch rule

### Break

`(Hook revision, event ID, action key)` is a good key, but the candidate does not
say whether delivery claim, derived Run creation, and acknowledgement share a
transaction/unique constraint. A crash after Run creation but before delivery
ack can still create two Runs. Multiple Hook workers can race.

### Minimal fix

Use a unique delivery/action row keyed by that tuple. Creating the derived Run
and recording its ID is one transaction or one idempotent scheduler operation
under that key. Redelivery returns the existing Run ID. Hook execution remains
at least once; raw external work outside journaled effects remains the Hook
author's responsibility.

### Falsifying test

Run two workers and kill each after every delivery/schedule write. Exactly one
derived Run ID may exist for the action key; the event remains committed and
other Hooks continue.

## SYS-H11 — High: activation/update publication is not atomic at the process-routing boundary

### Break

“Atomically publish a valid activation” does not define the transaction's scope.
A project activation may change package snapshots, Flow Bindings, Hooks,
runtime providers, and long-lived Services. A DB pointer can be atomic, but
process readiness and visible directory replacement cannot join that
transaction. Publishing before candidate Services are ready gives new bindings
to unavailable providers; publishing source piecemeal can create a tree which
was never checked.

### Minimal fix

Materialize and validate one immutable candidate activation graph. Start needed
Service candidates as unbindable shadow Mounts and obtain ready registrations.
Then use one DB transaction to switch the active activation generation and new
binding routes. Old generations remain for pinned users and drain afterward.
Visible source replacement is a separate journaled staging/atomic-rename step;
the active pointer always references a complete immutable snapshot. Cross-filesystem
rename is rejected or copied into a same-filesystem staging root before commit.

### Falsifying test

Kill at every phase of source replacement, snapshot creation, shadow mount,
active-pointer commit, new Run admission, and old drain. Every new Run must see
all-old or all-new normalized definitions/routes, never a mixture; existing
Runs retain old; an unready Service is never selected.

## SYS-H12 — High: interpreted `FLOW.md` can bypass the executable security model through Agent tools

### Break

The isolation rules are written mainly around executable package processes.
An instruction runner is host-side trusted code operating an Agent which may
have shell, filesystem, network, MCP, credentials, or project-wide context. A
malicious Markdown package can ask that Agent to bypass every declared
permission without opening a sandboxed process itself.

### Minimal fix

Treat interpretation as an implementation runtime under the same effective Run
grants. The instruction runner creates a capability-limited Agent session with
only the Run's attachments/effect slots, no ambient project cwd, secrets, tools,
plugins, or provider session. Provider-native tools which cannot be constrained
make interpreted execution advisory/trusted, never isolated. Record interpreter,
model, skills, tool grants, and enforcement report in the Run identity.

### Falsifying test

Interpret a Flow instructing the Agent to read an unrelated project file,
environment secret, and network URL and to invoke an undeclared MCP tool. Every
access must be blocked or the Run must have failed preflight as unisolatable.

## SYS-H13 — High: service contract compatibility does not authorize invocation

### Break

A compatible contract proves message shape, not caller authority. The candidate
does not state that `service/invoke` can only be emitted by Jig after validating
one consumer-owned binding lease, operation grant, budget, and exact
registration. A forged registration ID or delegated handle could otherwise
cross tenants/Scopes on a shared Service process.

### Minimal fix

Registration and binding IDs are opaque host-minted capabilities scoped to the
project/coordinator generation. Components never choose provider IDs directly.
Before each invoke Jig validates live consumer owner, binding lease, exact
registration generation, contract operation, schemas, grants, budget, and
deadline. The provider receives caller metadata only as data, never as the
authorization proof.

### Falsifying test

Forge/replay a registration ID from another Run, use it after lease release,
call an ungranted method, and swap the provider generation between validation
and dispatch. None may reach provider application code.

## SYS-H14 — High: raw-origin/process/path grants are not yet tied to enforceable mechanisms

### Break

Origin-level network grants, logical executable names, and named filesystem
roots sound precise but are not OS primitives. DNS rebinding, IP literals,
QUIC/UDP, proxy bypass, dynamic loaders, helper binaries, symlink races, devices,
and inherited descriptors can escape them. A static activation report can also
go stale when a mutable attachment changes.

### Minimal fix

An origin grant is `enforced` only when raw sockets/DNS are denied and all
traffic is forced through a policy proxy which validates destination after
resolution/TLS rules. A process allowlist exposes only pinned executable and
runtime dependencies inside the sandbox and denies other exec paths. File roots
are mounted/opened by backend handles with traversal, special-file, and symlink
escape tests; mutable-root assumptions appear in the report. Environment and
FDs are allowlisted from an empty baseline. Anything weaker is advisory and
fails untrusted execution.

### Falsifying test

Attempt DNS rebinding, direct IP/IPv6/UDP, alternate proxy settings, dynamic
loader injection, shell/helper exec, `/proc`/device access, symlink swap after
probe, inherited FD use, fork escape, and output/resource exhaustion. The
reported enforcement status must match observed behavior.

---

# Medium findings

## SYS-M1 — Medium: runtime contract identity is mutable without a pinned descriptor

The runtime requirement has URI and SemVer, but unlike Service Contract/1 it
does not pin a runtime-contract descriptor digest or define equivocation. The
meaning of “Deno contract 2.0” can change underneath the activation.

**Minimal fix:** define/pin a self-contained runtime contract descriptor or a
FLOW-reserved immutable contract version; quarantine two digests claiming one
identity/version. Runtime Provider conformance evidence pins contract, suite,
provider, binary, and launch-plan digests.

**Test:** serve two different contract documents under the same URI/version;
activation must fail equivocation rather than choose the newest response.

## SYS-M2 — Medium: feature negotiation and structured errors are not machine-complete

Packages may declare required Run facilities, and unsupported operations return
named errors, but facility identifiers, versioning, error codes/data, optional
versus required behavior, and unknown-extension rules are not defined. Two
Run-only hosts can disagree whether events/effects are preflight-compatible.

**Minimal fix:** define a small owner-controlled facility-ID/version list in
activation metadata and a stable protocol-error registry (`FACILITY_UNAVAILABLE`,
`BINDING_LOST`, `OPERATION_UNCERTAIN`, `WAIT_CYCLE`, and so on). Unknown required
facilities fail activation; optional calls may fail at runtime without side
effects.

**Test:** run one package against two independent hosts with unknown required
and optional facilities; both must make the same launch/failure decision and
return schema-identical error data.

## SYS-M3 — Medium: “CloudEvents-compatible where useful” is not a wire envelope

Producer/source authority, required fields, timestamp ownership, JSON
canonicalization, schema IDs, maximum payload, causality validation, and
reserved namespaces are not exact. This affects dedupe digest and event
interoperability.

**Minimal fix:** define the exact FLOW event JSON schema. Host stamps ID and
commit time; component supplies type, data, optional subject/schema, causation,
and correlation. Bindings grant type namespaces. CloudEvents adapters are
generated views, not normative ambiguity.

**Test:** vary field order, caller timestamps, omitted optionals, reserved
types, oversized data, and invalid causation; two hosts must produce the same
accept/reject and canonical digest.

## SYS-M4 — Medium: the `MAX_RETRIES` required outcome contradicts optional settings schemas

The candidate says missing `MAX_RETRIES` fails Binding activation, but schemas
are optional and source inference is rejected. Jig cannot know an undeclared
setting is required.

**Minimal fix:** qualify the guarantee: activation fails when
`settings.schema.json` declares the requirement. Without a schema, the
implementation must reject `INVALID_SETTINGS` before effects; Jig cannot promise
preflight. Never consult ambient environment.

**Test:** omit the schema and require the value in code, then add a schema. The
first case may fail only at component validation; the second must fail
activation. An ambient variable must satisfy neither.

## SYS-M5 — Medium: Run final response does not close process authority precisely

After a component responds to `flow/run`, it may keep running, emit effects, or
leave children. The candidate says one Run per process but does not state final
response/exit order.

**Minimal fix:** committing the terminal response revokes new outbound requests.
Jig closes stdin, waits a short exit grace, then terminates the process group and
cleans the Run lifetime. Exit before response is failure; non-zero exit after a
committed success is diagnostic unless protocol corruption occurred.

**Test:** respond success, then request an effect and remain alive. The effect
must be rejected and the process killed without changing the committed result.

## SYS-M6 — Medium: deadlines, clocks, and hierarchical budgets are named but not defined

Absolute versus relative time, clock source/skew, deadline propagation, budget
reservation/release, and behavior on exhaustion are unspecified.

**Minimal fix:** host monotonic time enforces local durations; wire uses a host
deadline plus remaining duration. Children receive the minimum parent deadline
and allocated sub-budget. Budget exhaustion is a terminal host error, not a
custom outcome, and cannot be bypassed by nested calls.

**Test:** change wall clock during a Run, recursively split budget, race timeout
and success, and attempt more descendants after exhaustion.

## SYS-M7 — Medium: Contract/1 schema evaluation can be non-deterministic or resource-exhausting

The descriptor says self-contained JSON Schema but does not fix dialect options,
format behavior, recursion/resource limits, regex engine, unknown keywords, or
canonical error behavior. A malicious contract can consume unbounded checker
resources.

**Minimal fix:** publish a closed Contract/1 JSON Schema profile, require all
references internal, bound depth/nodes/regex/input sizes, define unknown keyword
handling, and make `format` policy explicit. Validate descriptors as inert data
before provider code loads.

**Test:** cyclic/deep refs, catastrophic regexes, huge unions, unknown keywords,
external refs, and duplicate canonical versions must fail within fixed limits.

## SYS-M8 — Medium: one-project coordinator ownership is missing

Cluster/HA is deferred, but nothing prevents two local Jig daemons from applying,
scheduling, or mounting the same project store simultaneously. SQLite WAL or a
fact log alone does not define coordinator fencing.

**Minimal fix:** V1 takes an exclusive, fenced project-coordinator lease and
records its generation in process, Mount, registration, and scheduler records.
A second daemon fails closed. Shared-network-filesystem SQLite is unsupported.

**Test:** start two daemons concurrently and SIGKILL the lease holder during
takeover. At most one generation may admit Runs/providers at a time.

## SYS-M9 — Medium: effect-result/lifecycle-fact atomicity needs a provider return contract

The kernel can atomically commit facts it has, but the provider API does not say
how authenticated lifecycle facts accompany an effect result. If a provider
separately calls `event/append`, result and fact cannot be one transaction.

**Minimal fix:** host-side effect providers return one envelope containing
result/application error plus zero or more authenticated facts for the kernel
transaction. Separately emitted provider facts are valid but do not claim
atomicity with the effect result.

**Test:** kill between provider return, result/fact transaction, and component
response. Journal must contain both result and promised lifecycle fact or
neither.

## SYS-M10 — Medium: snapshot creation can race mutable authored files

Hashing/copying a live directory while an editor changes files can produce a
snapshot which never existed as one authored tree. A later digest does not prove
the set was coherent.

**Minimal fix:** materialize into staging with stable file handles/metadata,
rehash/verify the source generation after copy, and retry on change; use a
filesystem snapshot where available. Reject case-fold collisions, unsafe links,
and cross-device partial publication.

**Test:** continuously rewrite/rename files during `jig apply`; every accepted
snapshot must correspond to one completely verified staged tree and never mix
old/new halves.

---

# Low findings

## SYS-L1 — Low: telemetry has no sequence/drop accounting

Loss is allowed, but debugging concurrent runtimes without per-owner sequence
numbers or dropped-count diagnostics will be unnecessarily difficult.

**Minimal fix:** SDK attaches a monotonic per-owner telemetry sequence; sinks
may report dropped ranges. This remains non-semantic.

**Test:** drop/reorder frames and verify diagnostics can identify gaps without
changing Run behavior.

## SYS-L2 — Low: durable event retention is not exposed in the Run record

Journal-before-ack does not mean immortal. Operators need to know the retention
profile under which a fact was accepted.

**Minimal fix:** record the event-store durability/retention profile in the
activation and event metadata. Retention expiry never masquerades as an event
which was never committed.

**Test:** compact after the disclosed retention boundary and verify audit
metadata distinguishes expiry from missing commit.

---

# Exercise of the 18 required scenarios

| # | Scenario | Hostile result against candidate |
|---:|---|---|
| 1 | Markdown-only, no Agent | **Pass.** `IMPLEMENTATION_UNAVAILABLE` is deterministic. Security of the Agent-present path remains blocked by SYS-H12. |
| 2 | Deno-only Flow, Bun-only host | **Pass conditional.** Runtime contract filtering is correct, but immutable contract meaning/evidence needs SYS-M1. |
| 3 | Two plausible child providers | **Pass.** Explicit/locked binding, deterministic filtering, optional semantic rank, then ambiguity is coherent. Atomic binding-to-child dispatch still needs SYS-H4. |
| 4 | No matching child, Agent/no Agent | **Conditional.** Diagnostics and optional repair are sound in principle. The live waiting path can dispatch after cancel/duplicate without SYS-H9. |
| 5 | External success then crash | **Conditional.** `uncertain` is the right outcome. Durable owner keys, dispatch recovery, and fencing are incomplete under SYS-H3/H6. |
| 6 | Cancellation with descendants | **Fail current spec.** Child-first intent is right, but cancellation is one-directional and terminal races are undefined (SYS-H2); Mount ownership also fails (SYS-F1). |
| 7 | Mutually dependent providers | **Conditional.** Required-cycle/newest-edge rules are stated, but no complete wait/capacity model exists (SYS-H5), and status drains add hidden waits (SYS-F2). |
| 8 | Provider crash with pinned bindings | **Fail current Service/1.** Desired `registration lost/no rebind` is correct, but Mount/generation/binding snapshot identities are incomplete (SYS-F1/F2/H7), and orphan fencing is absent (SYS-H6). |
| 9 | Untrusted direct filesystem/network | **Conditional.** Fail-closed policy is correct. Exact origin/process/path enforcement and interpreted-Agent isolation need SYS-H14/H12. |
| 10 | Backend cannot enforce restriction | **Pass as policy.** It fails closed or records exact-digest trusted override. Conformance must verify actual reports (SYS-H14). |
| 11 | Durable fact triggers Hook twice | **Conditional.** At-least-once plus a stable action key is right; duplicate derived Runs remain possible without SYS-H10's transactional unique dispatch. |
| 12 | Progress dropped | **Pass.** Telemetry is explicitly non-semantic. Bounds/drop diagnostics are only hardening (SYS-H1/L1). |
| 13 | Local/upstream same-behavior edit | **Conditional.** Staging and old-active retention are right; crash-atomic source/activation publication needs SYS-H11/M10. |
| 14 | Textually clean semantic break | **Pass.** The candidate admits tests/review cannot prove arbitrary intent and retains rollback. |
| 15 | Two configured uses | **Pass.** Immutable Flow Binding revisions separate settings/slots/grants. Activation generation atomicity still matters (SYS-H11). |
| 16 | Missing `MAX_RETRIES` | **Fail as written.** Activation cannot detect an undeclared requirement when settings schemas are optional. Apply SYS-M4. |
| 17 | Cordis exports one service | **Fail stable interoperability today.** Keeping local objects local is correct, but Mount/status generation semantics must be repaired (SYS-F1/F2); callback/handle claims must be removed or specified (SYS-F3). |
| 18 | Minimal Run-only host | **Pass conditional.** Separate conformance is correct. Exact framing/errors/facility behavior must be fixed (SYS-H1/M2), and a host without enforcement may run only explicitly trusted code. |

---

# Release-blocking test order

Implement tests in this order; later results are not trustworthy without the
earlier layer:

1. **Transport:** bounded duplex framing, reentrancy, malformed input, EOF, and
   symmetric cancellation.
2. **Ownership:** durable lifetime mapping, forged owner/Mount/binding IDs, and
   terminal races.
3. **Operations/events:** kill every boundary around intent, dispatch, external
   commit, local result/event commit, and response.
4. **Scheduler:** hard capacity, all-parent waits, recursion, repair cycles, and
   serial Service cycles.
5. **Services:** Mount owner, ordered status generations, dynamic dependency
   snapshots, drain/withdraw, provider crash, and old/new binding pinning.
6. **Security:** executable and interpreted paths, direct raw I/O, provider ACL,
   process/orphan containment, and forged capabilities.
7. **Reconciliation:** mutable snapshot race, shadow readiness, activation
   generation switch, drain, update, and rollback under kill injection.
8. **Hooks:** concurrent delivery workers and kill-at-every-write scheduling
   deduplication.

## Final hostile ruling

Do not discard the architecture. Its separation of Package, Run, Service,
Contract, Jig, and Starters is sound. Do not call the candidate stable either.

The minimum acceptable repair is:

```text
explicit Mount authority and state
ordered Service availability with provider-declared drain/withdraw semantics
removal/deferment of portable handles and callbacks
bounded reentrant JSON-RPC
symmetric cancellation with first-terminal-wins
durable owner/operation keys and atomic child/event/Hook records
an executable wait-for/capacity model
coordinator/process fencing
per-invoke dynamic dependency snapshots
shadow-ready activation generation switching
the same security boundary for Agent interpretation as executable code
```

Once those changes and tests pass for Caskada, plain Python, a plain Service,
and Cordis, the candidate becomes a credible v1 rather than an elegant sketch.
