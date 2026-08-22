# Systems ballot: freeze the ownership model, cut the distributed-object model

## Verdict

The candidate has the right layer split, but its protocol is trying to freeze
two incompatible ideas at once:

1. request-scoped execution, where a live request is the owner; and
2. free-standing distributed objects, where Mount IDs and callback/resource
   handles outlive requests.

FLOW v1 should choose the first. It is sufficient for finite Flows and for a
useful long-lived Service profile. The second should not enter v1 until it has
two independent implementations and a convincing authority model.

My binding votes are:

| Question | Ruling |
|---|---|
| Mount ownership | Keep `service/mount` pending for the complete lifetime. Do not expose `mountId` or `service/unmount`. |
| Handles and callbacks | Remove generic resource handles, delegated-Service handles, and callbacks from v1. |
| Durable facts | Remove `event/append`; publish one exact Fact Journal effect contract used through `effect/call`. |
| Service status | Make Service/1 an official, separately conforming stable profile, but publish `1.0` only after the plain-provider and Cordis gates pass. |
| Lifetime identity | A live inbound request is the only wire owner. Scope remains a host implementation concept. |
| Cancellation | Symmetric cancellation of pending requests; cancellation is cooperative until the grace deadline and then process-enforced. |
| Public concepts | Effects and Bindings are public. Hooks are Jig policy. Scope and coeffect are internal vocabulary; Context is SDK convenience only. |
| Main cuts | Callback/resource handles, subscriptions, special event and telemetry core methods, wire Scope/Mount objects, in-place provider healing, contract ranges, automatic interpreted fallback, and underspecified raw grant shorthands. |

This yields a small protocol which can actually be implemented independently.
It does not pretend to be a transparent distributed object system.

---

## 1. The ownership law

The v1 law should be:

> Every operation emitted by a component is owned by exactly one live inbound
> request. When that request terminates, no new owned operation may be
> admitted.

There are only three owner request kinds:

```text
flow/run
service/mount
service/invoke
```

An outbound `flow/call` or `effect/call` names the relevant
`ownerRequestId`. The host verifies all of the following before recording an
operation intent:

```text
the request exists on this channel incarnation
the request is still live
the request is an allowed owner kind
the operation uses a slot visible to that owner
the requested authority fits that owner's Binding and grants
the owner is not cancelling
```

The wire request ID is not itself a durable database identity. The host maps:

```text
(channel incarnation, direction, JSON-RPC request ID)
    -> internal lifetime ID
```

The internal lifetime ID keys journals, children, cleanup, and audit records.
It never needs to cross the protocol. Reusing a JSON-RPC ID after its request
has completed creates no authority because there is no live mapping.

### Deliberate v1 limit

FLOW v1 does not reconnect or resume a live component channel. EOF terminates
all owner requests on that channel. This is an honest limitation and is why a
transport-independent `scopeId` buys nothing in v1. A future resumable
transport profile may introduce an epoch-bound resume capability without
changing the Run model.

### Why not `mountId`?

An immediate `service/mount` result plus `mountId` requires:

```text
mount token minting and authentication
mount cancellation/unmount
mount expiry and revocation
mount-to-connection rebinding
background-operation ownership
separate startup and terminal result semantics
```

A pending request already supplies all of these except reconnection, which v1
does not support. Adding a second lifetime primitive would make every host and
SDK implement two ownership systems for no demonstrated gain.

---

## 2. Minimal Run/1 surface

The stable Run protocol should have four method names:

| Direction | Method | Shape |
|---|---|---|
| Host to component | `flow/run` | Long-running request; its result is the Run terminal result. |
| Component to host | `flow/call` | Owned, journaled child-Flow operation. |
| Component to host | `effect/call` | Owned, journaled call through a declared effect slot. |
| Either request originator to receiver | `request/cancel` | Idempotent notification targeting one still-pending request originated by the sender. |

`stderr` is the required diagnostic channel. Structured lossy telemetry may be
specified later as an optional `Telemetry/1` profile; it is not a Run/1 method.
Durable facts use `effect/call`, as specified below.

`flow/run` completes with:

```json
{
  "outcome": "done",
  "output": {}
}
```

Domain outcomes are declared package values. Protocol violation, execution
failure, provider loss, cancellation, timeout, and host loss are not custom
outcomes.

Both outbound call forms carry:

```text
ownerRequestId
operationId
slot or selector
operation/input as applicable
```

The request ID correlates one JSON-RPC exchange. `operationId` identifies one
semantic operation inside its owner lifetime.

### Operation deduplication

The durable key is:

```text
(activation digest, internal owner lifetime ID, operationId)
```

The host records a canonical digest of the semantic request. A repeat with the
same key and digest returns or follows the existing operation. The same key
with different content fails before dispatch. Request IDs never provide
idempotency.

There is no caller-supplied attempt counter. Provider retries are host policy
constrained by the effect contract. An uncertain non-idempotent operation is
never automatically redispatched. A caller that deliberately requests new
work uses a new `operationId` and thereby makes that choice visible.

---

## 3. Service/1: an official small profile, not an experimental object model

Service support is central to the stated Cordis boundary. Leaving all of it as
an indefinite experiment would make FLOW a one-shot subprocess protocol, not
the intended component standard. Service/1 should therefore be an official,
separately conforming profile.

That does **not** justify freezing the current speculative surface. Publish
`Service/1` only when a plain provider and a Cordis realm pass the same
black-box suite. If they do not, delay the `Service/1` identifier; do not ship
an incompatible protocol under a stable name. Run/1 need not wait for it.

### Service/1 method surface

| Direction | Method | Purpose |
|---|---|---|
| Host to component | `service/mount` | Pending lifetime request. Initial settings, grants, roots, and dependency bindings are its parameters. |
| Host to component | `service/invoke` | Invoke one method of one host-pinned export generation. The request owns work caused by that invocation. |
| Host to component | `service/bindings` | Install one monotonically versioned full snapshot of dynamic dependency bindings. |
| Component to host | `service/status` | Publish one monotonically versioned full snapshot of currently available declared exports. |
| Either direction | `request/cancel` | Cancel a pending request. |

Service/1 imports `flow/call` and `effect/call` as one normative Host-Calls
subset. Their schemas and semantics are identical to Run/1 and are part of the
Service/1 conformance suite.

There is no:

```text
service/unmount
mountId
service/register/resource-handle API
service/call(handle, ...)
generic subscribe/signal operation
```

### Mount lifecycle

```text
                    startup/status timeout
                             |
                             v
STARTING --status(ready)--> ACTIVE --resolver stops new bindings--> DRAINING
    |                           |                                  |
    | error/EOF                 | error/EOF                        | zero users
    v                           v                                  v
  LOST                        LOST                        CANCELLING
                                                                |
                                                  cleanup + mount response
                                                                v
                                                             STOPPED
```

`service/mount` does not return at `ACTIVE`. Its eventual response is the
terminal acknowledgement that cleanup has finished. A startup error may return
before any ready status. Host cancellation begins teardown. Failure to finish
within the grace period causes process-tree termination and a `LOST` record.

For v1, one Service process/channel owns one Mount. It may handle many
concurrent `service/invoke` requests. This removes ambiguous multiplexing and
does not preclude a later pool profile.

### Readiness and export generations

The first acknowledged valid `service/status` snapshot marks the Mount ready.
Every snapshot has a strictly increasing revision and contains the complete set
of available exports from the package's statically declared export ceiling.

Rules:

1. The host assigns a fresh opaque registration generation on every
   unavailable-to-available transition.
2. The component never supplies a generation key.
3. Repeating a revision with the same digest is idempotent; repeating it with
   different content or sending a lower revision is a protocol error.
4. Removing an export closes admission immediately and makes its existing
   binding generation lost. Re-adding the name creates a different generation;
   old consumers never heal to it.
5. Already admitted invocations are cancelled on removal. If an implementation
   needs graceful removal, it keeps the export present until those invocations
   finish.
6. Graceful package update occurs between Mounts: the old Mount continues to
   advertise the old generation while new bindings select the ready new Mount.
   The host cancels the old Mount after its pinned consumers and invocations
   drain, or after an explicit bounded drain deadline.

This is enough for a Cordis service to disappear and later return without
lying about continuity.

### Dependency snapshots

Static dependencies are fixed in `service/mount`. Loss of a required static
provider cancels the Mount; it is not rebound in place.

Only dependencies explicitly declared dynamic may receive
`service/bindings`. Each update is a monotonically versioned full snapshot and
is installed atomically. The component either acknowledges the new revision or
rejects it and retains the previous one. Every `service/invoke` names the
binding revision under which it was admitted. Mount-owned background calls
name the latest acknowledged revision.

No undeclared slot or export may appear at runtime.

---

## 4. Remove generic handles and callbacks from v1

The stable Service contract should contain only:

```text
canonical contract identity and exact descriptor digest
named methods
JSON input and output schemas
named application-error schemas
```

Use a tagged method result for domain errors. Reserve JSON-RPC errors for
protocol, validation, authority, cancellation, capacity, and provider-loss
failures.

Do not include in v1:

```text
resource handles
delegated-Service handles
callbacks
subscriptions or signals
provider fact declarations
automatic release claims
contract SemVer ranges
contract-owned executable conformance Flows
```

A safe generic callable handle requires a host-minted bearer token, nominal
type annotations in schemas, attenuation, delegation rules, provider routing,
owner transfer, revocation, expiry, cancellation, wait-cycle admission, and
crash recovery. That is a distributed object protocol, not a small addition to
JSON method calls.

Service/1 instead supports:

```text
request/response methods
revisioned snapshots
changes-since or long-poll methods
durable facts through a separately bound Fact Journal
project Hooks that start new Runs
```

This means Service/1 cannot port every Cordis or DSH extension. That limitation
must be reported explicitly. A host-side Cordis realm with serializable methods
and dynamic availability is the v1 target; transparent JavaScript callbacks,
browser components, and arbitrary service objects are not.

If two ecosystems later prove callbacks necessary, add a separately versioned
`Callable/1` profile. Its first release gate must include token forgery,
cross-contract use, delegation, revocation, A-to-B-to-A wait cycles, provider
loss, and owner cleanup. Do not reserve half a handle grammar in Service/1.

---

## 5. Durable facts are an effect, not a fifth Run primitive

Remove `event/append` from Run/1 and Service/1. Publish one official exact
Fact Journal effect contract, for example:

```text
https://flow.dev/contracts/fact-journal/1
```

A package that needs durable publication declares a finite effect slot bound to
that exact descriptor. It calls `append` through `effect/call`.

Caller-controlled input is limited to:

```text
type
subject (optional)
schema identity (optional)
data
occurredAt (optional and explicitly untrusted)
```

The provider assigns and returns:

```text
factId
committedAt
authenticated producer identity
owner/Run correlation
monotonic journal position within the provider's defined ordering domain
```

The append result is returned only after the fact and its deduplication record
are durable. There is no `accepted` but volatile semantic tier. The same
operation key and digest returns the same receipt; a changed payload under the
same key fails. A crash after journal commit but before response may make the
outer effect uncertain, but retrying the same operation cannot append a second
fact.

Jig implements this contract with its kernel fact log. A smaller host may leave
the slot unbound and reject the package before launch. Host lifecycle facts are
committed directly by the host transaction/outbox; a component cannot forge
their namespace.

Jig Hooks consume Jig's fact log. Fact query/wait is another method of the same
effect contract, not a graph or Run primitive. A short wait remains under its
owner deadline. A long external wait ends the current Run with a domain outcome
such as `waiting`; a later Hook starts a new Run. V1 does not persist an opaque
graph continuation.

Why this is better than `event/append`:

```text
one operation ledger and cancellation model
one binding/authority mechanism
no mandatory journal feature in a minimal Run host
an exact independently versioned fact envelope
no ambiguous accepted-versus-durable method levels
```

---

## 6. Exact request, operation, and cancellation state machines

### Request owner state

```text
OPEN --> CANCEL_REQUESTED --> terminal
  |             |               ^
  |             +-- target acknowledges by its terminal response
  +---------------- response/error/EOF/deadline -----------------+

terminal = SUCCEEDED | FAILED | CANCELLED | LOST
```

The request originator may send `request/cancel` only for its own still-pending
request. Cancellation is symmetric because both peers originate requests.
Duplicate cancellation is harmless. The target stops admitting new child
operations as soon as it observes cancellation and propagates cancellation to
its owned request subtree.

Cancellation and an ordinary response may race. The target's first terminal
decision wins:

- if work completed before it observed cancellation, the ordinary result may
  win;
- if cancellation was accepted first, it returns the standard cancellation
  error after cleanup;
- if the channel or process is killed before a terminal response, the host
  records `LOST`, while individual dispatched operations may be `uncertain`.

The originator learns which side won from the single terminal response. Merely
sending a cancellation notification is not proof that external work was
undone.

### Operation state

```text
             cancel before dispatch
INTENT ------------------------------> CANCELLED
   |
   | durable dispatch admission
   v
DISPATCHED --> SUCCEEDED
     |-------> FAILED
     |-------> CANCELLED       only with authoritative provider evidence
     `-------> UNCERTAIN       success/failure cannot be established
```

The host durably records `INTENT` before provider dispatch. For a child Flow,
child allocation and the transition to dispatched are one transaction. The
first durable terminal operation record wins. A cancellation timeout after
dispatch yields `UNCERTAIN` unless the provider proves cancellation before any
effect could commit.

Operation uncertainty is not converted into failure and is not silently
retried. Normalized `agent.completed` is committed in the same Jig transaction
as the successful Agent effect result; a provider-native completion observed
before that is a differently named provider fact.

### Cleanup

Owner termination performs:

```text
close admission
cancel child requests
wait up to the owner's cleanup deadline
release host-owned resources child-first
run ordered disposers in reverse registration order where order matters
continue cleanup after individual disposer failures
kill the sandbox process tree at the hard deadline
journal every cleanup failure and the final owner state
```

FLOW promises deterministic cleanup only for host-owned resources. External
effects remain completed, cancelled, or uncertain according to their own
records; the protocol never claims a mathematical inverse.

---

## 7. Fencing, crash recovery, waits, and update publication

### Host fencing

One project coordinator holds a durable lease with a monotonically increasing
epoch. Every activation, internal lifetime, provider registration, and
operation record names that epoch. Channels are bound to one process launch and
one epoch.

After coordinator restart:

1. acquire a new epoch;
2. mark all prior live owner requests and registrations `LOST`;
3. classify every prior `DISPATCHED` nonterminal operation as `UNCERTAIN` unless
   its provider journal proves a terminal state;
4. kill or otherwise prove termination of all prior sandbox process groups;
5. refuse new admission if stale processes cannot be fenced;
6. reconcile immutable desired activations and start fresh owners.

A frame from an old channel, a completed owner request, an old Service export
generation, or a prior coordinator epoch fails before dispatch. Provider crash
never silently heals an existing binding to a replacement generation.

### Wait graph and scheduler capacity

Every synchronous pending edge is recorded:

```text
owner -> child Flow
owner -> effect provider
service invocation -> dependency invocation
operation -> repair Run while waiting for a first binding
```

Before admitting an edge, Jig checks the current wait graph and the relevant
capacity resources. It rejects the newest edge that would create a wait cycle
with no runnable vertex. A provider pool of capacity one is a capacity node,
not an excuse to deadlock.

A parent blocked on a child releases its execution-admission token but retains
a separately bounded resident-process/owner quota. Exhausting that quota fails
with `RESOURCE_EXHAUSTED`; it does not create an unbounded collection of
sleeping runtimes.

### Missing-binding repair

A not-yet-dispatched `flow/call` may enter `WAITING_BINDING` under a bounded
policy. It holds neither a provider reservation nor an execution token. Repair
installs and validates a candidate independently. Dispatch is a compare-and-set
requiring all of:

```text
the original owner is still live
the operation is still WAITING_BINDING
the deadline and repair budget remain
the resolved provider revision is activated and permitted
the wait graph still admits the edge
```

Cancellation, timeout, or host loss wins that compare-and-set and permanently
prevents late dispatch. Repair never mutates a running Flow package or Service
Mount in place.

### Activation and update atomicity

Mutable source is snapshotted before parsing, evaluating trusted project code,
compiling, checking, or launching. A candidate activation contains the exact
package-tree digest, Runtime plan, Binding revisions, grants, and checks.

Publication is one durable pointer/generation transaction after shadow
activation succeeds. Existing Runs and Service bindings retain their immutable
revision. New work sees the new generation. A broken candidate leaves the old
activation untouched.

Rollback either restores both visible source and its matching activation, or
is explicitly named as a runtime-only activation pin and reports source drift.
One command must not ambiguously do both.

---

## 8. Public versus internal concepts

| Concept | FLOW wire | FLOW SDK | Jig user/project API | Host internal |
|---|---|---|---|---|
| Run | `flow/run` request | `RunContext` | observable Run record | scheduler/lifetime row |
| Effect | `effect/call` + declared slot | typed effect client | Binding/provider policy | operation ledger/dispatcher |
| Flow Binding | resolved slots and immutable settings in Run input | read-only values | first-class editable/locked project object | activated revision |
| Service Mount | pending `service/mount` only | Service lifecycle callback | status/diagnostics | Mount record and drain policy |
| Scope | no ID or API | only cancellation signal/resource helpers | not an authored object | ownership tree and cleanup |
| Context | serializable input/settings/roots/bindings fields | immutable convenience object | not a DI/service locator | projected view |
| Coeffect | no such public concept | no required type | no | useful implementation theory only |
| Hook | no | no | first-class Jig policy reacting to facts | delivery/action ledger |
| Fact | Fact Journal effect contract | generated client may expose it | Hook/query surface | durable log and outbox |
| Telemetry | optional future profile | logger | sinks/configuration | lossy buffers |
| Operation ID | call field | generated/stable per logical call | visible in audit | dedupe key component |

### Effects

Effects must remain public because they are the portable way executable code
requests host authority. Packages declare finite local slots; Bindings select
exact providers and settings; runtimes cannot create ambient slots. The
operation ledger is internal, but operation IDs and uncertainty are public
semantics.

### Coeffects

Do not teach or standardize “coeffects.” The useful values are ordinary Run
inputs and environment: immutable input, settings, roots, grants, trigger, and
bindings. `RunContext` is an SDK ergonomic wrapper, not a remote object or a
second protocol.

### Hooks

Hooks are Jig project policy, not FLOW package behavior and not protocol
middleware. They observe committed Jig facts. Delivery is at least once.
Derived Jig actions are deduplicated by:

```text
(Hook revision digest, fact ID, explicit action key)
```

The Hook API requires an explicit stable key for dynamic fan-out. A fixed
single action may receive a deterministic default. Hook-owned arbitrary
external side effects are not exactly-once; they must use an idempotent effect
or accept uncertainty. Hooks never consume, mutate, veto, or rewrite the fact
that triggered them.

---

## 9. Security boundary that v1 can honestly claim

Package metadata states minimum needs; a project Binding grants the actual
authority. The host launches the immutable selected implementation in an outer
sandbox with:

```text
only declared file Roots/attachments
filtered environment
no inherited ambient file descriptors
network denied unless an enforceable grant profile permits it
subprocess creation denied unless an enforceable grant profile permits it
all descendants confined by the same or stricter policy
```

Every sandbox backend reports each authority dimension as:

```text
enforced | advisory | unavailable
```

An untrusted package is not launched if any required restriction is merely
advisory or unavailable. A trusted override is an explicit Binding decision,
recorded with the effective wider authority; it is not described as sandboxed.

Do not stabilize URL-pattern network selectors, `run: [git]`, or unrestricted
`true` shorthands until their redirect, DNS, helper, descendant, configuration,
and inherited-authority semantics have conformance tests. Put such powers in
versioned grant profiles. Granting a program never relaxes filesystem,
network, environment, or descendant restrictions implicitly.

The interpreted `FLOW.md` path runs its Agent/conductor in an equally strong
outer sandbox and receives no additional authority. Interpretation is not a
trust bypass.

---

## 10. Features to cut from the candidate

Cut these from the stable v1 specifications, not merely from one SDK:

1. **Immediate Mount response, `mountId`, and `service/unmount`.** The pending
   request is the lifetime.
2. **Wire `scopeId`, public Scope creation, or a distributed Context.** The host
   keeps the ownership tree.
3. **Generic resource and delegated-Service handles.** Contract-defined string
   IDs with explicit release methods are ordinary application data and carry no
   universal cleanup promise.
4. **Callbacks, subscriptions, and signals.** Add a later callable/subscription
   profile only after independent evidence.
5. **`event/append`.** Fact Journal is an exact effect contract.
6. **Core `telemetry/emit`.** `stderr` is sufficient for Run/1; structured
   telemetry is an ignorable optional profile.
7. **Contract fact/handle/conformance-Flow sections.** Service Contract/1 is
   methods, schemas, exact identity/digest, and named errors.
8. **Contract SemVer inference.** Match exact descriptor identities in v1;
   use explicit adapters. Add ranges only after compatibility rules and
   fixtures exist.
9. **Provider-generated generation identities and in-place healing.** Host
   generations are fresh; existing consumers observe loss.
10. **Dynamic undeclared Service dependencies or exports.** Runtime state is a
    subset of a static ceiling.
11. **Automatic interpreted fallback when an exact executable is unavailable.**
    Interpreting Markdown is an explicit Binding/activation choice with its own
    evidence and grants, never a silent degradation path.
12. **Portable raw grant shorthands with undefined transitive authority.** Use
    tested grant profiles or refuse enforcement claims.
13. **Caskada-specific in-process execution or graph inspection in Jig.** It
    remains an external Run/1 reference implementation.
14. **Universal graph schemas, durable arbitrary graph continuation, GUI
    faces/slots, Tasks, Git/worktrees, and guided cross-feature `jig init`.**
    These remain runner, Service, or Starter concerns.
15. **Persistent patch overlays.** The visible effective tree remains directly
    editable; update uses staged deterministic three-way merge, optional Agent
    repair, validation, and atomic publication.

Keep:

```text
one FLOW.md
zero or one exact flow/flow.<ext>
one deterministic Runtime Contract/Provider launch plan
immutable package snapshots
Run/1 request ownership
generic child Flow and effect calls
optional exact Service/1
Bindings and exact provider generations
durable operation/fact journals in Jig
Hooks as local policy
staged reconciliation and source ownership
outer fail-closed isolation
```

---

## 11. Falsifying conformance tests

These are not examples. Failure falsifies the selected architecture.

### T1 — Pending Mount ownership

Mount a provider, acknowledge ready status, then perform a background
`effect/call` owned by the still-pending mount request. It must succeed. Cancel
the Mount, wait for its terminal response, then replay the same call and forge
another request ID. Both must fail before an operation intent or provider
dispatch. EOF must produce the same revocation.

### T2 — No hidden callback support

Give a package metadata requiring a delegated callback or generic resource
handle. Activation must fail with `UNSUPPORTED_PROFILE` before process launch;
it must not reinterpret the token as a slot, raw JSON ID, or ambient address.

### T3 — Fact append through the effect gateway

Kill the host/provider at every boundary from effect intent to fact commit to
effect response. Retrying the same operation and digest must produce at most one
fact and the same fact receipt. A different payload under the same operation ID
must fail. A Run-only host without the Fact Journal binding must reject before
launch.

### T4 — Service status fencing

Send status revisions 3, 2, duplicate 3 with the same bytes, and duplicate 3
with changed bytes. Only the first and exact duplicate may succeed. Remove and
re-add export `sessions`; the old binding must return `PROVIDER_LOST`, never
reach the new registration, and the new registration must have a fresh
host-assigned generation.

### T5 — Selective cancellation

A Caskada Flow starts two child/effect calls, accepts one, cancels the other,
and returns success. Only the abandoned request subtree is cancelled. Then
cancel the root during a dispatched non-idempotent effect: new calls are
rejected, the process tree ends at the hard deadline, and the effect is
`UNCERTAIN` unless the provider proves a terminal result.

### T6 — Provider update drain

Start old and new Mounts. Publish the new activation for new bindings while an
old consumer remains pinned. Both generations must route correctly. After the
old consumer closes, cancel the old Mount and verify that its owner, status,
background calls, and registration generation are all unusable. A forced drain
deadline must produce explicit loss, not silent rebinding.

### T7 — Static versus dynamic dependency loss

Lose a static dependency: the affected Mount must be cancelled and cannot
receive an in-place replacement. Change a dynamic dependency snapshot: the
component either acknowledges the whole next revision or retains the whole
previous revision. Concurrent invocations must each observe one complete
revision, never a mixture.

### T8 — Wait-cycle and capacity safety

With provider capacity one, create A invoking B while B synchronously invokes A,
then repeat through a missing-binding repair Run. The newest edge that closes
the non-runnable cycle must fail. A large population of waiting calls must hit
the bounded resident-owner quota rather than exhausting processes or starving
repair work.

### T9 — Coordinator crash and stale process

Crash Jig after provider dispatch and before response. Start a new coordinator
epoch while the old process tries to emit a response and a new effect. Both
frames must be rejected. If the old sandbox cannot be proven dead, the project
must remain blocked. The prior operation is uncertain unless the provider
ledger proves its terminal state.

### T10 — Hook redelivery

Crash before and after each point in fact commit, Hook delivery, derived-Run
scheduling, and Hook acknowledgement. Redelivery may rerun Hook code, but the
same explicit action key must return the same derived Run. The original fact is
immutable and cannot be vetoed. An arbitrary external Hook side effect receives
no exactly-once claim.

### T11 — Security honesty

Attempt escape through direct I/O, child processes, Git hooks/helpers,
environment variables, inherited descriptors, symlinks, `/proc`, DNS rebinding,
redirects, and executable replacement. A backend reporting `enforced` must stop
all undeclared paths. Otherwise untrusted launch fails or the explicit trusted
override records the wider authority.

### T12 — Independent Service implementation

A team using no Jig source implements the pending-Mount Service provider and a
second host from only schemas/state machines. Exercise concurrent invocation,
background effect, readiness, dynamic status, dependency update, cancellation,
EOF, update drain, and application errors. Any need for `mountId`, Scope APIs,
callback handles, or source-level Jig types fails Service/1.

---

## Final position

The smallest operationally complete architecture is not the one with the
fewest nouns in prose. It is the one with exactly one answer to ownership,
cancellation, durability, and provider identity.

For v1, that answer is:

```text
pending request
    owns work and lifetime

operation ID + durable ledger
    owns idempotency and uncertainty

immutable Binding + host generation
    owns configuration and provider identity

effect slot
    owns every host-mediated operation, including durable facts

Jig Hook
    owns local reaction policy

host-internal Scope
    owns cleanup implementation
```

This is small enough for an independent Run host, strong enough for graph
runners, and sufficient for an initial Cordis service bridge. It deliberately
does not solve callbacks, distributed resources, resumable live channels, or
transparent JavaScript object portability. Those are valid future profiles,
not missing v1 primitives.
