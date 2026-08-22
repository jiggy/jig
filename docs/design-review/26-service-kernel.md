# Service/1 and the kernel boundary: a failure-driven ruling

## Verdict

Stable Services are required for Jig v1, but the proposed service layer still
contains policy that does not belong in a portable protocol. The minimum viable
Service/1 is one supervised process per Mount, statically declared public
interfaces, explicit invocation, exact dependency-binding updates, explicit
availability, graceful unmount, and shared Scope cancellation.

It does **not** standardize provider discovery, semantic selection, health
policy, restart, hot reload, distributed leases, contract registries, Cordis
Fibers, or application events.

The journals need a sharper split than the prior product-surface memo gave
them:

- the durable **operation ledger** is kernel because crash-safe effects and
  child calls cannot be optional;
- the durable **fact log** is also a kernel storage primitive because reliable
  lifecycle facts and Hooks cannot be reconstructed from lossy observations;
- the public Event service, Hook dispatcher, queries, waits, replay UI, and
  application schemas remain bundled modules.

This is not making an event bus core. It is putting the two transactional facts
the kernel already owns--operations and committed occurrences--where crashes
cannot split them.

## 1. The two implementations Service/1 must prove

The standard should freeze only after the same wire protocol hosts both:

### Plain provider

```text
one process
one configured instance
several JSON operations
concurrent calls
graceful shutdown
```

For example, a session store providing `list`, `read`, and `append`.

### Cordis realm

```text
one process
one root Cordis Context/Fiber tree
many local non-serializable services
zero or more declared serializable public services
external dependency proxies that can appear/disappear
native Cordis activation/disposal inside the process
```

If a protocol feature is needed by neither implementation and prevents no named
failure, it is rejected from Service/1.

## 2. The lifecycle model

One Service/1 process hosts exactly one Mount. This avoids multiplexed process
ownership, cross-Mount crashes, and cleanup ambiguity in v1. A future transport
may pool processes without changing Mount semantics, but pooling is not a
conformance behavior.

The identities are:

```text
mountId       configured long-lived provider instance
scopeId       authority and cleanup owner for the Mount
invocationId  one service operation
bindingId     exact dependency-provider binding handle
```

The stdio connection carries these identities; it is not one of them. EOF is
evidence that the process died, not the identity of the provider.

The package statically declares:

- the public service contracts it may provide;
- dependency slots and exact contracts they require;
- whether each dependency is `static` or `dynamic`.

Static is the default. A static slot is pinned for the Mount. A dynamic slot
explicitly opts into availability/replacement updates. This opt-in is necessary
to reconcile determinism for ordinary providers with Cordis's reactive
dependency model.

The declaration does not instantiate anything. Jig resolves it; Service/1 only
transports the resulting exact handles.

## 3. The minimum wire vocabulary

Service/1 needs five service methods plus the shared `scope/cancel` lifecycle
notification.

```text
service/mount
service/invoke
service/bindings
service/status
service/unmount
scope/cancel
```

Dependency calls from the provider reuse Run/1 `effect/call`. Child Flow work
reuses `flow/call`. There is no duplicate `service/call` envelope.

### 3.1 `service/mount`

Host to provider:

```json
{
  "mountId": "M-7",
  "scopeId": "S-7",
  "settings": {},
  "grants": [],
  "bindingsRevision": 1,
  "bindings": {
    "database": {
      "bindingId": "B-12",
      "contract": "https://owner.example/database/1"
    }
  }
}
```

The response means the provider process and its local runtime initialized. It
also returns the initially available subset of statically declared public
services:

```json
{
  "available": ["sessions"]
}
```

An empty `available` set is a valid mounted-but-pending realm. This matters for
Cordis: the root Context may exist while dependent Fibers remain pending.

**Named failure if omitted:** the host cannot distinguish “process spawned”
from “provider initialized with settings, grants, and dependency proxies,” so
it may route calls before initialization or leak a process after failed setup.

### 3.2 `service/invoke`

Host to provider:

```json
{
  "mountId": "M-7",
  "provider": "sessions",
  "operation": "read",
  "invocationId": "I-81",
  "scopeId": "S-I-81",
  "input": {}
}
```

The invocation Scope owns any child effects, child Runs, and temporary
resources created for that call. Calls may be concurrent. Parameters/results
are serializable and validated against the selected service contract when a
contract profile is enabled.

**Named failure if omitted:** there is no service.

### 3.3 `service/bindings`

Host to provider, as an acknowledged request:

```json
{
  "mountId": "M-7",
  "revision": 2,
  "bindings": {
    "search": {
      "bindingId": "B-44",
      "contract": "https://owner.example/search/1"
    }
  }
}
```

It is a full atomic snapshot, not a sequence of add/remove mutations. Revisions
increase monotonically. Only declared dynamic slots may change. The response
means the adapter installed the complete snapshot.

Every `effect/call` uses the exact `bindingId` obtained from the current
snapshot, not merely the slot string. This avoids a race in which the host and
provider disagree about which revision a call targets. The host retains an old
binding for already admitted calls until they settle. After the snapshot is
acknowledged, new calls using retired IDs fail rather than silently reaching a
replacement.

An abrupt dependency crash invalidates its binding immediately; in-flight/new
calls receive `provider_lost`, and the host then sends the new snapshot. A
replacement receives a new binding ID even if it implements the same contract.

The Cordis adapter maps each dynamic slot to a Cordis service proxy/provider.
Snapshot application causes native dependent Fibers to activate or return to
pending. A plain provider with only static dependencies never receives this
method after mount.

**Named failure if omitted:** either the entire Cordis realm must be destroyed
whenever one external dependency appears/disappears, losing unrelated local
state, or the adapter must poll/race an out-of-band Jig API. Neither is a
portable Service boundary.

### 3.4 `service/status`

Provider to host, as an acknowledged request:

```json
{
  "mountId": "M-7",
  "revision": 4,
  "available": ["sessions"]
}
```

The set is a full snapshot of currently callable, statically declared public
services. It cannot add a new contract that was absent from package metadata.
The host atomically publishes/unpublishes those provider entries and
acknowledges the revision.

This is not telemetry. `event/emit` cannot replace it because observations may
be dropped. Availability changes routing and therefore require acknowledgement.

The Cordis adapter sends status after native public provider Fibers activate or
deactivate. A plain provider normally reports once through `service/mount` and
never changes status.

**Named failure if omitted:** consumers are routed to a public service after
its required local Fiber has become pending, or a newly available public
service remains undiscoverable. Returning `unavailable` from every invocation
is too late for dependency activation and creates retry storms.

### 3.5 `service/unmount`

Host to provider, as a request with a deadline. Before sending it, the host
stops admitting new invocations. It waits for or cancels existing invocation
Scopes according to project policy, then asks the provider to dispose local
resources. The response means graceful cleanup completed. At the deadline the
sandbox supervisor terminates the process tree and records incomplete cleanup.

There is no separate `service/drain` method. Draining is host ingress policy:

```text
stop new invokes
wait/cancel admitted invokes
unmount
kill at deadline
```

The provider does not need to negotiate that sequence.

**Named failure if omitted:** a provider cannot flush state, release leases, or
run Cordis disposers before forced process termination.

### 3.6 `scope/cancel`

Host to provider notification targeting either an invocation Scope or, during
forced shutdown, the Mount Scope. The provider stops admitting new work beneath
that Scope and propagates cancellation to its local operation/Agent/Flow calls.

This shared lifecycle message should replace protocol-specific
`flow/cancel`/`service/cancel` duplication. Runs, Mounts, and service invocations
create Scopes through their own start messages; v1 still has no arbitrary
`scope/open` API.

**Named failure if omitted:** cancellation of one long-running service method
either kills the whole provider or lets work continue after its caller and
authority have ended.

## 4. Crash, loss, and dependency cycles

### Provider process crash

EOF/process death closes the Mount Scope. The host:

1. marks every advertised public service unavailable;
2. completes in-flight invokes with `provider_lost` unless a completed result
   was durably recorded;
3. invalidates dependency binding IDs pointing to that Mount;
4. sends binding snapshots to dynamic dependents;
5. commits the loss as a durable host fact;
6. runs Jig restart policy, if any, for a **new** Mount/binding ID.

Existing consumers are never made to believe the replacement is the same
provider instance.

Automatic restart, backoff, state restoration, failover ranking, and whether a
dependent is restarted or remains pending are Jig policy. Service/1 standardizes
only the observable loss and new identity.

### Dependency cycles

Static required dependency cycles fail before mount with a cycle diagnostic.
There is no universal two-phase activation protocol.

Dynamic dependencies permit realms to mount pending, but do not guarantee that
a logically circular pair will become ready. If neither publishes a bootstrap
service, both remain pending and Jig reports the wait cycle. If two active
service invocations synchronously wait on each other, the host's invocation
wait graph fails the newest edge with `dependency_cycle`; scheduler capacity is
not a solution.

Authors break the cycle with a smaller bootstrap contract, an optional dynamic
edge, or asynchronous fact/message exchange. Service/1 does not guess.

## 5. What is universal and what belongs to Jig

### FLOW Service/1 owns

- Mount/invocation/Scope/binding identities independent of a connection;
- process initialization and graceful unmount messages;
- exact serialized service invocation;
- static public service declarations and contract references;
- static versus explicitly dynamic dependency slots;
- atomic versioned binding snapshots with exact binding IDs;
- acknowledged public availability snapshots;
- per-invocation and Mount cancellation;
- provider-loss and dependency-cycle error categories;
- the rule that replacement creates a new identity;
- no arbitrary in-process objects across the boundary.

### Jig's Services module owns

- package/provider discovery and catalogue indexing;
- exact/semantic provider selection and binding locks;
- trust decisions and sandbox backend selection;
- when to mount, restart, drain, replace, or leave pending;
- health probes beyond process/explicit status;
- source updates, shadow candidates, and rollout policy;
- timeout/backoff/resource limits;
- dependency graph diagnostics and user presentation;
- Cordis adapter implementation;
- service contract descriptor profile and conformance runner;
- durable provider lifecycle facts;
- pooling or process reuse optimizations.

Service/1 does not contain a registry, resolver, reconciler, HMR system, event
bus, or distributed coordinator.

## 6. Features rejected for lack of a named failure

Do not add:

- **dynamic `service/provide`:** public contracts are statically discoverable;
  `service/status` changes availability without changing interface identity;
- **`service/drain`:** ingress control plus `service/unmount` already prevents
  new calls and permits cleanup;
- **heartbeat/lease messages:** local stdio process supervision already detects
  crash; remote transports may define their own liveness profile;
- **transparent restart:** state and identity semantics are service-specific;
- **subscription primitives:** a service contract can expose a stream handle or
  durable fact service after a real cross-runtime pattern is proven;
- **Cordis event modes:** local to the Cordis realm;
- **HMR/version switching:** Jig activation policy, not provider wire semantics;
- **distributed consensus/readiness:** out of scope for a local process ABI;
- **service method SemVer inference:** exact contract compatibility is resolved
  before Mount; natural language and “newer” do not prove API compatibility;
- **arbitrary Mount nesting:** one process/one Mount is sufficient for v1;
- **unmount effect inverses:** cleanup is guaranteed for host-owned resources;
  external irreversible effects remain classified, not magically undone.

## 7. The operation ledger belongs to the kernel

Calling it an optional Effect module would make Run/1 behavior depend on which
plugins happen to be installed. The kernel mediates `effect/call`,
`flow/call`, and service invocation. It must durably record:

```text
operation ID
owning Scope
canonical request digest
intent recorded
dispatch/provider identity
completed result or error
indeterminate completion
cancellation
```

The required transaction order is:

```text
persist intent
    → dispatch
    → persist completion
    → return completion
```

If the host crashes after external success but before durable completion, the
operation is `indeterminate`; it is not replayed. If completion is present, a
repeated identical operation ID returns it. These are kernel semantics because
otherwise child Runs, Agent effects, Hooks, and Services have incompatible
crash behavior.

An implementation may supply a pluggable durable storage backend, but “memory
only” is a different non-durable conformance profile and must not be Jig's
default or stable guarantee.

## 8. The fact log also belongs to the kernel--narrowly

The previous memo placed the durable Events module entirely outside the kernel.
That is one layer too far out.

Consider the named failure:

```text
Agent effect completes
    → operation result is committed
    → host crashes before Events module appends agent.completed
    → completion Hook never runs
```

Reversing the order produces the opposite failure: a Hook observes completion
before the operation result exists. Retrying either side can duplicate derived
work.

Therefore the operation-commit transaction must be able to append zero or more
immutable facts atomically. Logically, Jig kernel storage contains:

```text
operation ledger
fact log / transactional outbox
```

They may be tables in one database; they need not be separate services. A
provider handler completes an operation with:

```text
result
+ zero or more host/provider-authenticated fact envelopes
```

The kernel commits both or neither. Host lifecycle transitions such as
`jig.run.completed`, `jig.scope.cancelled`, and `jig.provider.lost` use the same
primitive. An environmental producer can append a fact under an idempotency key
in its own kernel transaction.

The fact log is intentionally dumb:

```text
fact ID
type
time
producer identity
Scope/Run/Mount correlation
payload
causation/idempotency key
```

It does not know Hook code, schemas, routing, replay policy, user permissions,
or application meaning.

### What remains modular

The bundled Events/Hooks modules own:

- exposing append/query/wait operations to Flows as a bound effect/service;
- validating application event schemas;
- durable consumer cursors and replay UI;
- Hook registration, at-least-once delivery, filtering, and diagnostics;
- deduplicated scheduling of derived Runs;
- retention/archive configuration and human presentation.

Hook scheduling uses a deterministic operation ID derived from Hook revision,
fact ID, and action key. If delivery repeats after a crash, the kernel operation
ledger returns the existing scheduling result.

Lossy Run/1 `event/emit` observations do not enter the fact log automatically.
A telemetry sink may retain them, sample them, or discard them. Promoting an
observation to a durable fact requires an acknowledged host/provider operation
or a host-owned lifecycle transition.

This division keeps a reliable transactional substrate in the kernel without
turning Jig into an application event framework.

## 9. Kernel/module boundary after correction

### Kernel

```text
Package activation snapshots and provenance
Scope/Run ownership and process supervision
generic effect/child/service dispatch registration
operation ledger
fact log / transactional outbox
binding handle table
grant evaluation and sandbox interface
atomic activation and cancellation
```

### Stable bundled Services module

```text
Service/1 protocol host
Mount registry and dependency resolver
provider selection/loss/restart policy
contract verification
Cordis adapter
```

### Other bundled modules

```text
Events/Hook APIs and delivery
Agents and instruction runner
Semantic Resolver
telemetry storage/UI
source install/update/repair
watchers and ingress
```

The kernel offers registration points for effect handlers and root Scope
supervisors. It does not invent a general plugin framework to load modules;
`jig.ts` composes ordinary startup code under the project root Scope.

## 10. Conformance tests that decide stability

Service/1 is not stable until two unrelated adapters pass at least these tests:

1. plain provider mounts, advertises two operations, serves concurrent invokes,
   and unmounts cleanly;
2. cancellation of one invoke leaves other invokes/provider alive;
3. Mount cancellation terminates all descendant effects/processes;
4. static dependency loss makes the dependent unavailable without rebinding;
5. dynamic dependency appears, disappears, and is replaced with distinct
   binding IDs;
6. old in-flight calls settle against the old binding while new calls cannot
   accidentally cross revisions;
7. Cordis public provider status follows native Fiber activation/pending state;
8. required static dependency cycle fails before activation;
9. runtime wait cycle fails explicitly rather than exhausting scheduler slots;
10. provider crash produces `provider_lost`, removes availability, invalidates
    bindings, and commits one durable loss fact;
11. host stops admission, drains/cancels, runs Cordis disposers, and force-kills
    at deadline;
12. operation result and provider lifecycle fact survive crash atomically;
13. a Run-only host remains conformant without implementing any Service method.

If the Cordis adapter requires additional messages, first prove that they solve
a boundary failure rather than expose Cordis convenience. If the plain provider
cannot implement the protocol without Cordis-shaped machinery, the protocol is
too large.

## Final ruling

The portable service boundary is not “Cordis over RPC.” It is:

> Mount one serializable provider process, invoke declared operations, update
> explicitly dynamic binding handles, acknowledge public availability, cancel
> owned work, and unmount cleanly.

Everything about finding, trusting, restarting, updating, observing, or
presenting that provider belongs to Jig.

The kernel boundary is equally strict:

> If losing a record across a crash can duplicate an external operation or
> permanently lose a promised Hook trigger, its minimal transaction belongs in
> the kernel. The APIs and policies built over those records remain modules.
