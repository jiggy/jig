# Systems review: the smallest operationally complete Jig + FLOW

## Verdict

The design should be split into one small stable execution protocol and one
separately versioned service extension:

```text
FLOW Package/1
    FLOW.md plus ordinary files and, optionally, one exact argv entrypoint

FLOW Run/1
    one finite invocation, structured child calls, mediated effects,
    cancellation, and lossy tracing

FLOW Services/0.x
    an optional, long-lived, statically declared service boundary

Jig
    a host for immutable revisions, request ownership, selection, supervision,
    journals, sandbox policy, and explicit reconciliation
```

This is deliberately not a distributed object system, universal graph, event
bus, package registry, or application framework. Caskada, Cordis, an
imperative executable, and an interpreted `FLOW.md` all cross `FLOW Run/1`.
None receives an in-process shortcut.

The most important correction to the preceding exploration is this:

> A live request tree is the portable lifetime model. `Scope` is Jig's internal
> implementation of ownership, and `Context` is an SDK view. Components do not
> manufacture or transmit authority-bearing scope identifiers.

The second correction is equally important:

> Durable facts are not protocol notifications. `trace/emit` may be dropped;
> anything which controls later work must be committed through a durable host
> effect.

The third is a boundary on ambition:

> Run/1 can be stable early. Services should ship at the same time so that the
> architecture is tested against Cordis-class components, but remain a
> separately claimed `0.x` extension until two materially different service
> runtimes pass its lifecycle suite.

## 1. Decisions, without ambiguity

| Question | Decision |
|---|---|
| Is `FLOW.md` required? | Yes. It is the semantic entrypoint and the complete interpreted form. |
| Must a simple Flow have a manifest, schema, graph, or contract? | No. `name`, `description`, and Markdown are sufficient. |
| How is exact code launched? | One optional, explicit argv declaration. Never infer a runtime from an extension and never invoke a shell. |
| Is a shebang normative? | No. A host may honor one as a platform convenience, but FLOW does not treat `#!` as a portable runtime declaration. |
| May an executable silently fall back to Markdown interpretation? | No. Interpretation is an explicit execution choice. |
| Does Jig execute Caskada in-process? | No. Every executable crosses the same Run/1 boundary. |
| What is the public lifetime primitive? | An invocation and its live request tree. |
| Is `Scope` protocol-visible? | No. The host derives scopes from accepted requests. |
| Is `Context` protocol-visible? | No. It is the SDK's immutable projection of run parameters and granted clients. |
| Are host effects core? | Yes. Without one mediated escape hatch, portable executable Flows either hard-code host APIs or bypass policy. |
| Are durable events core? | No. They are an official capability implemented through `effect/call`. |
| Is progress core? | A best-effort `trace/emit` notification is core and explicitly non-semantic. |
| Are hooks protocol middleware? | No. Hooks are project policy over durable facts. |
| Are long-lived services in Run/1? | No. They are an optional, separately versioned Services extension. |
| Do Services ship with the first Jig release? | Yes, as experimental but complete `Services/0.x`, not as a prerequisite for Run conformance. |
| Can a provider change halfway through a Run? | No. Bindings are pinned to an exact revision and, for services, an exact mount. |
| Does Jig retry unknown effects? | Never automatically. Unknown completion is a first-class terminal state. |
| Does cancellation undo effects? | No. It stops future work and attempts cleanup; committed or uncertain external effects remain so. |
| Does a saved source file immediately become running code? | No. `jig apply` creates and validates an immutable active revision. Watch mode is an explicit development feature. |
| Is arbitrary runner crash resumption promised? | No. A process loss makes its live invocation `lost`; rerun is a new invocation. |

## 2. Package and entrypoint

`FLOW.md` is the only required file. Its body is instructions suitable for an
Agent interpreter. A code-backed package adds an exact entry declaration only
when needed:

```markdown
---
name: gauntlet-loop
description: Iteratively builds and evaluates an artifact.

entry:
  protocol: flow.run/1
  command: deno
  args: ["run", "--quiet", "flow.ts"]

settings:
  schema: ./settings.schema.json
---

# Gauntlet Loop

...
```

The declaration has these semantics:

- `command` is a logical executable name resolved by host policy, not by an
  inherited, attacker-controlled `PATH`.
- `args` is an argv array. There is no shell expansion, quoting language,
  interpolation, or command string.
- Relative file arguments resolve in the immutable package revision mounted
  read-only for the process.
- The package declares one protocol, not a list of preferred runner profiles.
- Runtime availability is a deterministic preflight condition. A Deno entry is
  not attempted with Bun.
- Platform variants, if eventually necessary, should be selected as package
  artifacts by the installer. They should not turn `FLOW.md` into a runtime
  negotiation language.

A `FLOW.md`-only package has no exact executable. It requires an explicitly
configured interpreter provider, normally an Agent. If none exists, invocation
fails before execution with `FLOW_INTERPRETER_UNAVAILABLE`. This is honest;
instructions cannot execute themselves.

An executable package is not silently reinterpreted when its runtime is
missing or crashes. A user may explicitly request interpreted mode, in which
case that choice, interpreter revision, and grants are recorded.

Package names are descriptive, not globally unique identities. An installed
revision is identified by:

```text
source URI + component path + source revision + content digest
```

No central registry is required.

## 3. Which concepts exist at which layer

| Concept | Jig internals | SDK | Wire protocol |
|---|---|---|---|
| **Package revision** | Content-addressed immutable tree | Read-only package files | Entry metadata, not a runtime handle |
| **Configured instance** | Project-local package + settings + binding/grant policy | Not an object | Instance identity may appear in diagnostics |
| **Invocation (Run)** | Durable lifecycle record | `RunContext` | `invocationId` in `flow/run` |
| **Request** | Live ownership and wait node | Promise plus `AbortSignal` | JSON-RPC request ID |
| **Scope** | Resource owner derived from a request | Only `signal` and `defer()` behavior | Not visible |
| **Context** | No separate durable entity | Immutable `RunContext`/`MountContext` | Expanded fields, no `contextId` |
| **Binding** | Exact target/provider selection | Opaque callable client | Opaque binding handle |
| **Mount** | Durable service-instance lifecycle | `MountContext` | `mountId` in Services only |
| **Fact** | Immutable journal row | Event-store client | An effect API, not Run/1 notification |
| **Trace** | Optional observation | Trace sink | `trace/emit` notification |

`RunContext` should expose only what a component was granted:

```text
input, settings, named filesystems, bindings, deadline,
AbortSignal, flow.call(), effects.call(), trace.emit(), defer()
```

It must not expose Jig's database, catalogue, ambient environment, provider
objects, or a mutable service locator.

### Request-derived ownership

Every accepted request creates an internal scope. A component-originated child
request names the still-live inbound request which owns it. For a one-shot
process this is normally the `flow/run` request. For a service it may be either
the long-lived `service/mount` request or one particular `service/invoke`
request.

This matters. If a service handles ten calls concurrently, an effect started
for call 7 must be cancelled with call 7, not merely when the entire service is
unmounted. A free-form `scopeId` would let the component claim authority it was
not granted. An `ownerRequestId` can be validated against the connection's
live inbound request set.

No detached background work exists in Run/1. Work outliving a Run must be a
mounted Service or an explicit external durable effect.

## 4. FLOW Run/1: the exact method surface

Run/1 has exactly five methods.

| Direction | JSON-RPC method | Kind | Purpose |
|---|---|---|---|
| Host -> component | `flow/run` | request | Execute one finite Flow and return one terminal result. |
| Component -> host | `flow/call` | request | Invoke a child Flow through host discovery, policy, and ownership. |
| Component -> host | `effect/call` | request | Invoke a granted, named host-effect binding. |
| Component -> host | `trace/emit` | notification | Emit droppable diagnostic/progress information. |
| Either direction | `request/cancel` | notification | Ask the peer to cancel a live request it sent. |

There is no `initialize`, `scope/create`, `flow/handoff`, `event/publish`,
`event/wait`, `agent/run`, `capability/provide`, graph method, or generic
extension dispatcher in the stable core.

### Transport

The required transport is JSON-RPC 2.0 over UTF-8 NDJSON on stdio:

- one compact JSON object per line;
- no JSON-RPC batches;
- stdout contains protocol frames only;
- stderr contains human diagnostics only;
- writes are serialized and flushed;
- both peers keep reading and dispatching while awaiting their own outbound
  requests;
- request IDs are unique per sender for the connection; `h:` and `c:` string
  prefixes are recommended and required by the conformance fixtures;
- maximum frame size, outstanding-request count, stderr rate, and total output
  are host limits reported at launch;
- a malformed frame, oversized frame, stdout log line, or duplicate terminal
  response is a protocol violation;
- EOF fails all outstanding requests and causes the process-owned invocation
  or mount to become lost/failed;
- unknown requests receive JSON-RPC `Method not found`; unknown notifications
  are ignored and may be traced.

NDJSON is intentionally narrow. Large or binary values belong in granted file
attachments, not protocol frames.

### `flow/run`

The host sends one root request per process. Its parameters contain:

```text
protocolVersion = "flow.run/1"
invocationId
input             JSON
settings          final resolved JSON object
bindings          opaque named handles and descriptive metadata
filesystems       named guest paths and read/write modes
deadline          absolute host deadline
limits            advertised frame/output/concurrency limits
```

`/flow` is the read-only immutable package revision. `/run` is a private
writable run filesystem. Additional named filesystems are explicit grants.
Host paths need not be revealed. Children receive a new `/run`; other
filesystems are not inherited unless `flow/call` forwards them explicitly.
Writable sharing is opt-in and may be rejected when the host cannot make its
concurrency semantics safe.

A successful JSON-RPC result is:

```json
{
  "outcome": "done",
  "output": {}
}
```

`outcome` is a Flow-domain result such as `done` or `blocked`. Protocol errors,
process loss, cancellation, and host failures are not custom outcomes. This
keeps “the procedure could not complete” distinct from “the executable failed
to run.”

### `flow/call`

The request contains:

```text
ownerRequestId
effectId
target:
    binding <project/run-pinned slot>, or
    exact <package revision/instance>, or
    selector <intent and deterministic constraints>
input
forwardedFilesystems
deadline
```

It creates a child invocation and a child internal scope. A binding or exact
target requires no semantic router. An intent selector may require one. A
Run-only host without semantic selection returns `SELECTION_UNAVAILABLE`; it
does not guess.

`flow/call` is not folded into `effect/call`. Its structured-child semantics,
run tree, package selection, outcome, cancellation, and diagnostics are the
universal composition mechanism and deserve one explicit method.

### `effect/call`

The request contains:

```text
ownerRequestId
effectId
binding           opaque handle supplied in flow/run/service/mount
operation
input
deadline
```

The binding, not the component, determines the provider, authority, contract,
and service mount. Run/1 does not define operation names. Agent sessions,
durable facts, Git, databases, approvals, UI contribution, and network proxies
are APIs behind bindings. A minimal host can supply none and must return
`BINDING_UNAVAILABLE` rather than exposing ambient host APIs.

`effect/call` belongs in Run/1 because it is the single portable mediation
point. The effect APIs themselves do not.

### `trace/emit`

A trace has an `ownerRequestId`, type/level, message or structured data, and an
optional component timestamp. The host stamps reception time and correlation.

Delivery is best effort. It can be sampled, reordered across concurrent
requests, truncated, or dropped. A component whose correctness changes when a
trace is lost is non-conforming.

### `request/cancel`

The sender identifies a live request it originated. Cancellation is
idempotent and best effort; the normal response still closes the request. The
notification does not claim that external effects were reversed.

## 5. State machines and ownership

### Invocation

```text
queued -> starting -> running -> succeeded
                         |  |-> failed
                         |  |-> lost
                         `-> cancelling -> cancelled
```

“Waiting for a child” is not another durable lifecycle state. It is a live
wait edge on a running invocation. A successful invocation stores its Flow
outcome separately.

On host restart, `starting`, `running`, and `cancelling` invocations whose
process supervisors were lost become `lost`. Jig does not pretend it can
restore an arbitrary interpreter stack or graph continuation. A new attempt is
a new invocation.

### Request

```text
accepted -> executing -> responded
                    |-> cancelled
                    `-> lost
```

The host keeps an ownership tree rooted at `flow/run` or `service/mount`.
Resources registered while handling a request belong to that request unless a
more specific live child request owns them.

Closing a request scope performs, in order:

1. stop accepting new child requests owned by it;
2. cancel live descendants;
3. signal registered local cleanup callbacks in reverse registration order;
4. terminate host-owned process groups, subscriptions, leases, and temporary
   resources;
5. journal every cleanup success or failure;
6. close the request even if one cleanup action fails.

Cleanup guarantees an attempt and an audit record, not a mathematical inverse.
Effects are classified by their provider as scope-owned, durable,
compensatable, or irreversible. Durable and irreversible effects survive
scope closure.

### Terminal races

The first terminal state durably committed by the host wins. If success was
committed before cancellation, success wins. If cancellation was committed
first, a late success response is recorded as late and ignored. This rule is
testable and prevents network timing from rewriting history.

## 6. Effects, idempotency, retries, and uncertainty

Every `flow/call` and `effect/call` has a component-chosen `effectId`, unique
within its owner request. Before dispatch, Jig durably stores:

```text
(owner request, effectId, canonical semantic request digest)
```

The effect journal state machine is:

```text
prepared -> dispatched -> succeeded
                       |-> failed
                       |-> cancelled
                       `-> uncertain
```

`prepared` means no external dispatch occurred and is safe to resume.
`dispatched` means the operation may have escaped Jig. If the host loses the
ability to determine its outcome, it becomes `uncertain`, not `failed`.

Duplicate behavior is exact:

| Existing state | Same ID and same semantic digest |
|---|---|
| `prepared` | Continue the original dispatch. |
| `dispatched` in this live host | Join the original promise; do not dispatch again. |
| `succeeded` or `failed` | Replay the recorded response. |
| `cancelled` | Replay cancellation. |
| `uncertain` | Return `EFFECT_UNCERTAIN`; never dispatch silently. |

The same ID with a different semantic digest is `EFFECT_ID_REUSED` and a
component protocol error. The semantic digest includes target/binding,
operation, input, and granted attachment identities; trace metadata and the
wait deadline do not change the operation's identity.

A transport retry uses the same `effectId`. A semantic retry after a known
failure uses a new `effectId`. There is no generic `attempt` field which can
magically turn a non-idempotent operation into an idempotent one.

Providers may support an idempotency key or status query and resolve an
otherwise uncertain operation. That is provider behavior recorded by Jig, not
a Run/1 guarantee. Whole-Run automatic retry is off by default because a new
interpreter process cannot prove which direct or external effects the old one
performed.

Exactly-once execution is neither promised nor approximated by wording. The
guarantee is at-most-one dispatch by one live Jig coordinator plus durable
deduplication where its journal survives. A crash between an external commit
and a provider receipt still yields uncertainty unless that provider can
resolve it.

## 7. Cancellation and deadlines

When a Run is cancelled, Jig atomically marks it `cancelling` and then:

1. rejects new child/effect requests owned by its subtree;
2. sends `request/cancel` to every live descendant request;
3. cancels queued children without launching them;
4. asks host effect providers to cancel in-flight work;
5. sends cancellation to the component SDK's `AbortSignal`;
6. waits a configured grace period;
7. terminates the entire sandbox/process group;
8. runs host-owned cleanup and marks the Run `cancelled`.

Deadlines use the same path. A child deadline cannot exceed its owner's
deadline. Cancellation of an effect means only that Jig stopped awaiting or
asked its provider to stop. If external completion is not known, the effect is
`uncertain`.

The SDK must continue to read and dispatch protocol messages while an outbound
request is pending. A synchronous “write request, stop reading until response”
SDK is non-conforming because it deadlocks nested calls and cancellation.

## 8. Scheduler waits and deadlock handling

Jig maintains a live wait-for graph over invocations, service calls, service
mount startup, and provider capacity. Before accepting a synchronous wait edge,
it checks whether that edge closes a cycle. The newest edge is rejected with
`WAIT_CYCLE`; Jig never waits for a timeout to diagnose a cycle it already
knows about.

Rules:

- no database transaction, project lock, provider-registry write lock, or
  scheduler admission lock is held across an external await;
- root-admission limits and descendant-execution capacity are separate;
- a parent waiting for a child does not retain a scarce scheduler token which
  the child needs;
- if a configured hard process limit leaves no legal capacity for a child,
  `RESOURCE_EXHAUSTED` is returned immediately rather than deadlocking;
- recursion depth, total descendants, outstanding effects, and parallel fanout
  are explicit inherited budgets;
- every cross-process wait has a deadline;
- serial providers are modeled as capacity-one resources in the wait graph.

This does not detect arbitrary deadlocks internal to opaque component code. It
does prevent host-created deadlocks and cross-boundary synchronous cycles.

## 9. FLOW Services/0.x

Long-lived services are required to test the architecture against plugin
systems, but forcing them into Run/1 would turn every Flow host into a
distributed object runtime. They therefore ship as an optional extension with
an independent conformance claim.

Services/0.x adds only three methods:

| Direction | Method | Kind | Purpose |
|---|---|---|---|
| Host -> component | `service/mount` | long-lived request | Start one service component in one process. |
| Component -> host | `service/ready` | notification | Atomically publish all statically declared providers. |
| Host -> component | `service/invoke` | request | Invoke one declared serializable operation. |

It reuses `effect/call`, `flow/call`, `trace/emit`, and `request/cancel`.

There is deliberately no dynamic `capability/provide` in the first extension.
The package declares its exported contracts and provider names before code is
loaded. `service/ready` publishes the complete set atomically. If one required
provider cannot start, the mount fails. This is enough for a Cordis realm to
export a deliberate boundary while retaining arbitrary local services.

Service contracts are separate machine-readable, JSON-Schema-based RPC
descriptions with an owner-controlled URI, semantic interface version, and
content digest. Package version and service-contract version are independent.
Only serializable declared operations cross the boundary.

### Mount lifecycle

```text
created -> starting -> ready -> draining -> stopping -> stopped
                    \-> failed       \---------------> failed
```

The `service/mount` request remains pending for the complete mount lifetime.
The component sends `service/ready` exactly once after initialization. Until
then no provider is bindable. A normal mount response means the service has
stopped; EOF or process death before a clean response means `failed`.

`service/invoke` is a child request of the mount. An outbound effect made while
handling it uses that invoke request as `ownerRequestId`; background service
maintenance uses the mount request. This is what gives per-call cancellation
meaning even with concurrent invocations.

Each declared provider specifies `serial` or `parallel` and `maxInFlight`.
Default is `serial`. The protocol reader remains reentrant even when the
application provider is serial; requests may queue in the SDK, but wait-cycle
checking occurs before a queue wait is accepted.

### Pinning, crash, and drain

A consumer binding pins:

```text
package digest + mountId + provider name + contract URI/version/digest
```

If the mount crashes, in-flight calls fail `PROVIDER_LOST`, future calls on
those bindings fail `BINDING_LOST`, and no active consumer is silently rebound.
A restarted provider has a new `mountId`. New Runs may bind to it.

For replacement, Jig:

1. starts and validates a candidate mount;
2. waits for `service/ready`;
3. publishes it for new bindings;
4. marks the old mount `draining`, so it receives no new bindings;
5. continues serving calls from already pinned Runs;
6. stops the old mount when its binding leases and in-flight calls reach zero;
7. after a bounded administrative drain deadline, cancels remaining calls and
   records forced drain as a failure.

There is no generic hot-reload operation. Staging and draining are host
algorithms over ordinary mounts.

Services should launch with Jig, a Cordis realm bridge, and one small
non-Cordis reference service. They should not claim `Services/1` until both
implementations pass startup, reentrancy, cycle, crash, pinning, and drain
tests. This is early enough to expose bad assumptions without freezing them in
Run/1.

## 10. Facts, traces, and hooks

These must remain three distinct concepts.

### Trace

A trace is lossy observation. It uses `trace/emit`; dropping it is harmless.
Progress, debug output, token deltas, and sampled timing belong here.

### Fact

A fact is an immutable, durably committed statement used by policy or later
work. Jig itself commits lifecycle facts such as `run.started` and
`run.finished` in the same transaction as the corresponding state transition.

A component publishes an application fact through an official durable-event
binding using `effect/call`. The provider returns only after commit and applies
the normal effect idempotency rules. A host without a durable event store simply
does not supply this binding. No `trace/emit` frame is ever promoted into a
fact after the fact.

### Hook

A hook is project-local policy consuming facts. It is not middleware and
cannot mutate, veto, or consume the fact. Delivery is at least once.

Jig stores `(hookInstanceId, factId)` plus a deterministic dispatch key. Starting
a Flow from a hook is an idempotent scheduler operation keyed by that tuple. If
Jig crashes after creating the child Run but before acknowledging the delivery,
redelivery attaches to the same Run rather than creating another. The hook may
still observe the fact twice, so arbitrary external hook handlers must also be
idempotent.

Hooks never parse provider-private logs to synthesize public lifecycle facts.
The owner of an operation emits or commits its facts.

## 11. Discovery, bindings, settings, and instances

### Configured instances

A project can create any number of configured instances of one package. An
instance contains:

```text
project-local instance ID
exact package/revision reference or update channel
settings
binding overrides
grants and execution mode
optional selection tags
```

Thus `review-fast` and `review-strict` can use the same package with different
models, budgets, and settings. Flows select or bind instances, not mutable
global package configuration.

Settings are JSON data, separate from Flow input. Resolution order is fixed:

```text
package defaults < project instance < explicitly recorded invocation override
```

There is no ambient project environment inheritance. Secrets are opaque secret
references and are not written in clear text to lockfiles or traces. A package
may declare an optional JSON Schema. Missing required settings make the
instance unavailable at preflight. Without a schema, Jig cannot infer a missing
setting; the executable must reject it explicitly. Portable code should not
silently require an ambient `MAX_RETRIES` variable.

### Selection

For a child Flow, Jig applies this order:

1. an exact target in the call;
2. an explicit project binding for the consumer slot;
3. a still-valid recorded lock;
4. deterministic filtering by protocol, runtime, platform, settings,
   permissions, trust, availability, and declared constraints;
5. if exactly one candidate remains, select it;
6. if several remain and a SemanticRouter is configured, let it rank only
   those candidates and record its evidence;
7. otherwise return `AMBIGUOUS_BINDING`.

Capability/service selection additionally requires exact contract identity and
a compatible declared version range before semantic ranking. Natural language
never overrides protocol compatibility.

A slot binding is persisted and reused until its catalogue inputs become
invalid or the user requests rebinding. Every active Run pins the exact result.
An ad-hoc intent call without a slot is selected per call and only recorded in
that Run.

The lock/provenance record includes consumer and slot, selected instance,
source/revision/digest, settings digest, runtime declaration, grants, contract
identity/version/digest where applicable, selection policy version, and
semantic-selection evidence. It never treats the friendly package name as
identity.

### Missing dependencies and repair

Zero candidates yields `FLOW_UNBOUND` or `BINDING_UNAVAILABLE` plus a durable
diagnostic containing the selector, filters, nearby incompatible candidates,
and required grants/settings.

Repair is a separate, visible project transaction. If configured, an Agent may
search, install, generate, or adapt a candidate in staging, but the active call
does not silently mutate its environment and continue. The candidate must pass
checks and approval policy, then a later retry/new Run may bind it. Without an
Agent, the same deterministic diagnostic remains useful.

## 12. Persistence and crash boundaries

For a local Jig project, SQLite in WAL mode is the correct authority. JSONL is
useful for export and logs, but cannot safely coordinate request deduplication,
hook delivery, provider leases, and atomic state/fact transitions.

The durable store minimally contains:

```text
installed source provenance and immutable revisions
configured instances and project binding rules
active revision pointers and binding locks
invocations and their parent relation
request/effect journal and uncertainty state
service mounts, provider records, and binding leases
durable facts and hook deliveries
grant approvals and sandbox enforcement reports
update/apply transactions
```

Traces may use a bounded append-only store and are not correctness state.
Secrets are external references.

Jig writes intent before dispatching an external operation and writes result
before replying to the component. It never holds a database transaction while
waiting on a process, Agent, child Flow, or provider.

V1 is a single-writer project coordinator. It can run many packages, Runs, and
providers concurrently, but two Jig daemons do not share one project store.
The daemon takes an exclusive project lease. Cluster coordination requires a
future transactional `StateStore` implementation with leases; SQLite on a
shared network filesystem is not advertised as multi-host safety.

After daemon death:

- queued work may remain queued;
- live opaque Runs become `lost`;
- dispatched unresolved effects become `uncertain` unless their provider can
  query a receipt;
- child processes are killed by process-group/container/VM supervision where
  supported and reaped on restart;
- service registrations disappear and restart as new mounts;
- hooks resume from durable delivery state;
- immutable active revisions and completed outcomes remain valid.

## 13. Security and grants

Protocol mediation is not a sandbox. A component that can call the operating
system directly can bypass `effect/call` unless execution is confined.

Jig uses three execution modes:

| Mode | Meaning |
|---|---|
| `isolated` | Every required restriction must be enforceable; otherwise launch is refused. Default for untrusted source. |
| `restricted` | Some restrictions are mediated/advisory; exact gaps require explicit approval for the pinned digest. |
| `trusted` | No containment claim. Reserved for explicitly trusted exact digests. |

Grant vocabulary is small and concrete:

- named filesystem mounts with guest path and `read`/`write` mode;
- network `none`, `loopback`, `proxy`, or `unrestricted`;
- child process `none`, `sandboxed`, or `host`, with executable allowlists;
- explicit environment keys and secret handles;
- wall time, CPU, memory, process count, writable bytes, stdout frame/output,
  and outstanding request limits.

Each backend reports every requested control as:

```text
enforced | mediated | advisory | unavailable
```

`SandboxBackend` is responsible for capability probing, preparation, a signed
enforcement report, process-tree spawning/termination, and cleanup. Linux may
use namespaces, bind mounts, seccomp/Landlock and cgroups; a rootless OCI or VM
backend may be stronger. On macOS a VM/container is required for strong
claims. On Windows AppContainer/restricted tokens, ACLs, Job Objects, or Hyper-V
must report their actual coverage. A “domain allowlist” is enforced only when
traffic is forced through a mediated proxy; DNS filtering alone is not claimed
as network confinement.

Additional invariants:

- discovery never executes package code;
- validation executes with no more authority than the candidate would receive;
- argv is never passed through a shell;
- inherited environment variables and file descriptors are removed by default;
- bindings are opaque, connection-bound, and unforgeable;
- archive extraction and mounted trees reject traversal, unsafe symlinks, and
  special-file escapes;
- generated or repaired code is staged and never automatically trusted;
- the grant set, approval, sandbox backend, backend version, and enforcement
  report are journaled against the content digest.

A host lacking an adequate backend may still conform to Run/1. It must refuse
untrusted executables or require an explicit `trusted` decision; it may not
advertise isolation it does not provide.

## 14. Source reconciliation, updates, and rollback

The visible package tree is the user's editable desired source. Running code is
always an immutable content-addressed snapshot.

`jig apply`:

1. snapshots the visible tree;
2. parses `FLOW.md` without executing code;
3. validates settings, bindings, grants, entrypoint, and package structure;
4. runs declared checks in the candidate sandbox;
5. starts service candidates in a shadow mount when applicable;
6. atomically marks the candidate active for new Runs/bindings;
7. drains old service revisions; existing Runs retain their pinned revision.

Saving a file does not execute it. `jig dev --watch` is explicit and uses the
same candidate pipeline.

An update is a transaction over:

```text
BASE      pristine upstream revision originally installed
LOCAL     current visible source
UPSTREAM  new pristine upstream revision
```

Jig first performs a deterministic three-way tree merge in staging. It does
not maintain a permanent runtime patch overlay. Conflicts leave the active and
visible trees unchanged and produce an inspectable update workspace. An Agent
repair Flow may resolve the staging candidate, but deterministic checks and
project approval still gate publication.

A textually clean merge cannot prove semantic preservation. No generic system
can infer the intent of arbitrary local edits. Therefore, when local divergence
exists, a clean candidate is validated but not silently auto-published by a
background updater. It requires the project's configured review policy:
deterministic tests at minimum, and explicit approval or an optional recorded
Agent review where policy demands it. Previous active snapshots make rollback
atomic.

## 15. Jig kernel and optional components

The minimum Jig kernel is:

```text
FLOW.md/package reader and immutable revision catalogue
configured instances, exact references, and deterministic resolver
Run/1 stdio host and process supervisor
request ownership tree, scheduler, cancellation, and wait-cycle detector
opaque effect-binding broker and effect journal
SQLite state/fact journal
Space/filesystem attachment manager
sandbox backend interface and fail-closed launch policy
explicit apply/reconciliation and provenance
```

Services/0.x is an official optional host module shipped beside the kernel.

The following are official or project-owned components, not kernel concepts:

```text
Agent provider and FLOW.md interpreter
SemanticRouter
durable event-store capability and hook worker
Caskada runtime
Cordis service realm bridge
Git, worktrees, task boards, GUI, inboxes, schedules, webhooks
Agent-based update repair and missing-provider creation
public/private package indexes
```

The kernel can diagnose ambiguity and absence without an Agent. It can execute
an exact, self-contained Run without Services, a durable event store, semantic
routing, or a sandbox only when trust policy permits.

## 16. The 18 adversarial scenarios

| # | Scenario | Required outcome |
|---:|---|---|
| 1 | `FLOW.md` only, no Agent | Preflight returns `FLOW_INTERPRETER_UNAVAILABLE`. No package code or guessed procedure runs. The package remains installable and inspectable. |
| 2 | Deno-only `flow.ts`, host has Bun | The explicit `deno` entry is unavailable, so preflight returns `RUNTIME_UNAVAILABLE`. Jig never substitutes Bun based on `.ts`. If the author falsely declares Bun, execution failure is an author/package defect. |
| 3 | Two plausible child providers | Exact/project/locked binding wins first. Otherwise deterministic filters run. With a router, its recorded choice is pinned; without one, return `AMBIGUOUS_BINDING` with both candidates. Never choose by directory order. |
| 4 | No child Flow, Agent present/absent | The call returns `FLOW_UNBOUND` with deterministic diagnostics in both cases. With policy and an Agent, Jig may open a separate staged repair transaction; it does not mutate and resume the live call. Without an Agent, a human can act on the same report. |
| 5 | External effect commits, response is lost | The effect is `uncertain`. Duplicate calls with the same ID return `EFFECT_UNCERTAIN`; Jig does not redispatch. A provider receipt/status query may resolve it. Otherwise human or domain reconciliation is required. |
| 6 | Cancellation with children/subprocesses | Jig rejects new descendants, recursively cancels live requests, signals providers, terminates the sandbox process tree after grace, journals cleanup, and returns `cancelled`. Already committed/uncertain effects retain those states. |
| 7 | Two mounted providers synchronously depend on each other | Adding the second wait edge closes a cycle, so the newest call fails `WAIT_CYCLE`. Startup fails or the provider handles the error; Jig does not hang. Services needing mutual interaction must break startup/call synchronicity explicitly. |
| 8 | Mounted provider crashes with pinned consumers | The mount becomes `failed`; in-flight invokes fail `PROVIDER_LOST`; subsequent calls fail `BINDING_LOST`. A replacement is a new mount for new Runs. Existing consumers are not silently rebound. |
| 9 | Untrusted Flow opens network/files directly | In `isolated` mode the OS/VM backend blocks access outside grants. FLOW protocol mediation alone is not cited as protection. If no adequate sandbox exists, launch is refused. |
| 10 | Host cannot enforce requested restriction | Preflight reports the control `unavailable` and refuses `isolated` execution. `restricted` or `trusted` execution requires an explicit digest-pinned approval showing the gap. |
| 11 | Durable fact redelivered after restart | At-least-once delivery is expected. `(hookId,factId)` maps to one deterministic scheduler dispatch, so a Flow-launching hook reattaches to the existing child Run. Arbitrary hook code must still tolerate repeated observation. |
| 12 | Progress message dropped | Nothing semantic changes because progress is `trace/emit`. A message needed to trigger work must instead be a committed fact through the event-store binding. |
| 13 | Local and upstream edit same behavior | Three-way merge stops in an update workspace. Active and visible sources remain unchanged. Deterministic or Agent-assisted resolution is reviewed, checked, then explicitly published. |
| 14 | Merge is textual success but semantic break | This is not generically decidable. Tests/schema checks may catch it; optional Agent/human review may catch more. A locally diverged package is not background-auto-published merely because text merged. The old immutable revision remains rollback-safe. |
| 15 | Two configured uses of one package | Two project instance IDs reference the same package digest with independent settings, grants, and bindings. Selection and locks name the instance, so state does not collide. |
| 16 | Code requires missing `MAX_RETRIES` | If declared in the settings schema, the instance is unavailable before launch with a precise missing-setting diagnostic. If undeclared, Jig cannot know; the component must return invalid settings. Ambient environment inheritance is forbidden. |
| 17 | Cordis exports one serializable service | The Cordis adapter declares and exports only that boundary contract through Services. Local closures, symbols, fibers, and other service objects stay inside the realm and retain native Cordis semantics. |
| 18 | Third-party host implements only Run | It truthfully claims Package/1 + Run/1. It can run exact self-contained packages and exact child calls it can resolve. Services packages are incompatible; intent-only calls return `SELECTION_UNAVAILABLE`; absent effects return `BINDING_UNAVAILABLE`; untrusted code is refused unless explicitly trusted because no sandbox is claimed. |

## 17. Conformance and independent implementability

Claims are granular:

```text
flow.package/1
flow.run/1-host
flow.run/1-component
flow.services/0.x-host
flow.services/0.x-component
jig.sandbox/<backend-profile>
```

Interpreter, semantic selection, durable facts, and hooks are capabilities, not
inflated Run/1 compliance claims.

### Run/1 fixtures

Both host and component suites must test:

- NDJSON framing, stdout pollution, oversized/malformed frames, and EOF;
- simultaneous bidirectional requests and out-of-order responses;
- nested `flow/call` while the parent continues reading;
- validation of live `ownerRequestId` and rejection after owner completion;
- cancellation before launch, during a child, during an effect, and racing a
  successful terminal commit;
- process-tree kill after grace;
- duplicate effect ID while live, after success/failure, with a changed digest,
  and after uncertainty;
- crash in the external-commit/response window;
- process limit one with a nested call returning capacity error rather than
  hanging;
- recursion/fanout/deadline budget enforcement;
- trace drop without behavior change;
- attachment non-inheritance and writable-sharing rejection;
- unknown method and notification behavior.

### Services fixtures

- invoke before ready is impossible;
- atomic publication of all declared providers;
- mount cancellation during startup and after ready;
- serial and bounded-parallel invocation;
- reentrant protocol traffic while an application call is pending;
- synchronous A/B wait cycle rejection;
- provider crash with in-flight and pinned consumers;
- shadow replacement, new-binding switch, old-binding drain, and forced drain;
- no leaked provider, listener, process, request, or binding lease after stop.

### Jig and sandbox fixtures

- state/fact atomicity and hook redelivery after kill-at-every-commit-point;
- restart conversion of live Runs/effects to `lost`/`uncertain`;
- exclusive project coordinator lease;
- immutable revision pinning during source edits and rollback;
- conflicted and semantically failing update candidates leave active state
  untouched;
- path traversal, archive escape, unsafe symlink, inherited FD/env, direct
  network, process escape, memory/pid/output limit, and cleanup tests;
- the enforcement report must match independently observed backend behavior.

No conformance fixture requires an Agent or an LLM.

## 18. Evaluation and explicit failure boundary

| Criterion | Assessment | Remaining boundary |
|---|---:|---|
| Conceptual economy | 4.5/5 | Services necessarily add one separate lifecycle. |
| Independent implementation | 4.5/5 | Sandbox behavior is profile-specific, not universal. |
| Retry/crash/cancel determinism | 4/5 | External commit without receipt is irreducibly uncertain. |
| Least-authority security | 4/5 | Some platforms require a VM for honest isolation. |
| Fault tolerance without hidden mutation | 4.5/5 | Opaque runner stacks are restarted, not resumed. |
| Source ergonomics and adoption | 4.5/5 | Exact executable portability still depends on an installed runtime. |
| Scale | 3.5/5 | V1 deliberately supports one project coordinator, not an HA cluster. |
| Evolution | 4.5/5 | Services remains 0.x until diverse runtimes prove it. |

The design fails closed at its real limits:

- It cannot execute Markdown instructions without an interpreter.
- It cannot make an unacknowledged external commit exactly once.
- It cannot resume an arbitrary lost graph or language stack.
- It cannot serialize arbitrary Cordis/JavaScript objects across processes.
- It cannot enforce restrictions unsupported by the selected sandbox backend.
- It cannot prove that a textually clean source merge preserves human intent.
- It cannot safely share one SQLite project coordinator across multiple hosts.
- It cannot make lossy traces into reliable triggers.

Those are not missing features disguised as elegance. They are explicit system
boundaries. Everything on the other side has a deterministic state,
diagnostic, and recovery path.

## Final architecture in one paragraph

FLOW Package/1 is a human- and Agent-readable directory with an optional exact
argv executable. FLOW Run/1 is a five-method, request-tree protocol for a
finite invocation, child Flow calls, mediated effects, cancellation, and lossy
traces. Jig derives internal scopes from requests, pins immutable revisions and
bindings, supervises every process, journals effects before dispatch, refuses
to replay uncertainty, detects cross-boundary wait cycles, and publishes source
changes only through validated immutable snapshots. Durable facts and hooks
are optional host capabilities. FLOW Services ships beside Run as a separately
versioned extension for static, serializable, long-lived provider boundaries,
with pinning, crash failure, and draining made explicit. Projects own Agents,
semantic routing, application models, policy, and repair Flows; the kernel owns
only the mechanisms required to make those choices safe and inspectable.
