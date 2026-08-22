# Systems rebuttal: operational decisions after cross-examination

## Revised verdict

The competing reviews agree on the broad split but are too conservative in
three places and too permissive in one:

- An acknowledged `event/emit` can and should be the portable semantic-fact
  channel. Durability is a requested and reported guarantee; telemetry remains
  a separate lossy notification.
- `effect/call` should remain one generic, binding-scoped gateway. Wire methods
  per Agent, Git provider, database, or UI service make the protocol larger
  without improving authority or compatibility.
- One `flow[.<ext>]` implementation with a FLOW-parsed first-line runtime
  directive can provide the same preflight determinism as argv in Markdown or
  a second manifest, provided FLOW—not the OS—defines the grammar and launch
  algorithm.
- Services should be a separately conforming stable module, not an indefinitely
  experimental aspiration. It needs dynamic registration of statically
  declared exports; wholly static registration is too weak for a faithful
  Cordis boundary, while undeclared dynamic publication is too powerful.
- A missing child dependency may be repaired while its original
  not-yet-dispatched `flow/call` waits. That is safe if repair is explicit,
  staged, deadline-bound, and cannot alter or replay the already-running
  parent.
- A Flow Binding is an immutable configured use. Runtime setting overlays and
  parent-to-child setting inheritance are rejected; a one-off override creates
  a new derived Binding revision.

The resulting Run/1 surface is:

```text
flow/run         request       host -> component
flow/call        request       component -> host
effect/call      request       component -> host
event/emit       request       component -> host
telemetry/emit   notification  component -> host
request/cancel   notification  either direction
```

The additional event method is justified because facts and arbitrary effects
have different universal semantics. It does not make a durable event store
mandatory for a small host.

---

## 1. `event/emit`: semantic fact in Run/1, with honest durability

### Decision

Add acknowledged `event/emit` to Run/1 and keep `telemetry/emit` lossy.

An event is a semantic fact: after a successful acknowledgement, the host has
accepted responsibility for that fact under the returned guarantee. Telemetry
is observation: it may be discarded before or after receipt and cannot drive
correct behavior.

Durability is orthogonal to whether the message is semantic. Run/1 defines two
guarantee levels:

| Guarantee | Successful acknowledgement means |
|---|---|
| `accepted` | The host assigned a stable event ID, deduplicates within its current host epoch, and will not intentionally drop the fact while that epoch is live. Restart retention, replay, and hook redelivery are not promised. |
| `durable` | The host committed the immutable fact and deduplication record before replying. It survives a conforming host restart for the advertised retention period and is eligible for at-least-once policy delivery. |

A Run/1 host must recognize the method. It may support only `accepted`, or it
may return `EVENT_UNAVAILABLE` without side effects. It must never silently
downgrade a requested minimum guarantee. Jig supports `durable` and makes it
its normal project default. A tiny host can remain conforming with only
`accepted` or with event publication disabled.

This is preferable to hiding facts behind an event-store `effect/call`:

- event identity, causality, deduplication, and acknowledgement are universal;
- emitters need no provider-specific event-store slot merely to report a fact;
- a Run-only host can expose live semantic events without implementing Jig's
  durable Hook subsystem;
- Jig can still give stronger durability without changing the component API.

It is also preferable to a single “event” notification. A notification cannot
tell a producer whether responsibility transferred and cannot distinguish a
dropped progress update from a fact whose publication failed.

### Protocol and state implications

The request contains:

```json
{
  "ownerRequestId": "h:run:17",
  "operationId": "build-completed:1",
  "type": "example.org/build.completed",
  "data": {},
  "causedBy": "event-or-effect-id",
  "correlationId": "C-42",
  "minimumGuarantee": "durable"
}
```

The result contains:

```json
{
  "eventId": "E-81",
  "guarantee": "durable"
}
```

`operationId` follows the same deduplication rules as `effect/call`. Event
state is:

```text
received -> validated -> accepted/committed -> acknowledged
          \-> rejected
```

For `durable`, accepted/committed is one transactional step: the event row and
the operation result are committed together. A crash after commit but before
the response yields the same `eventId` when the operation is retried. For an
`accepted` host, a host crash may lose the fact and its deduplication record;
the guarantee explicitly ends with the host epoch.

Acknowledgement never waits for Hooks, subscribers, or downstream Flows. They
run after acceptance. Otherwise an event emitted by A could start a Hook which
calls A and deadlock A's original emission. Hook success cannot retroactively
change event success.

Host-owned event namespaces such as `jig.*` and provider-owned lifecycle facts
cannot be forged by an arbitrary Flow. The grant/binding for the Run determines
which event namespace it may publish. Host lifecycle facts are still generated
by the host in the transaction which changes lifecycle state.

`telemetry/emit` remains a notification with no operation ID, stable event ID,
or acknowledgement. A dropped progress message has no semantic consequence.

### Crash and deadlock cases

- Component crashes after a durable event commit but before receiving the
  reply: the fact remains and a same-operation retry returns the event ID.
- Jig crashes before commit: publication did not succeed; after recovery the
  request is either absent/prepared or indeterminate according to the journal
  boundary. It is never fabricated from telemetry.
- An `accepted` host crashes after acknowledgement: the event may be lost. A
  package that required restart survival should have requested `durable` and
  would not have launched on that host.
- A Hook recursively causes another event: causality depth and project Hook
  policy bound the loop; `event/emit` itself does not await the Hook.

### Falsifying conformance test

Kill a durable host after its event transaction commits but before the response
is written. Restart it and resend the identical request. The host must return
the same `eventId` and the journal must contain exactly one fact. Also install a
Hook that blocks forever: `event/emit` must still acknowledge immediately after
commit. If it waits for the Hook, duplicates the event, or reports `durable`
without surviving restart, this decision is falsified.

---

## 2. Generic `effect/call`, not wire-level methods for every extension

### Decision

Keep one generic `effect/call` in Run/1. Extension contracts define the
operations behind granted bindings; they do not normally add top-level wire
methods.

The method is not an open vendor-RPC tunnel. A component cannot name a provider
or arbitrary URI. It can call only an opaque binding handle supplied for its
live request, and the host validates the operation and payload against that
binding's pinned contract and grant.

```json
{
  "ownerRequestId": "h:run:17",
  "operationId": "review-agent:1",
  "binding": "opaque:B-91",
  "operation": "run",
  "input": {}
}
```

The binding record contains:

```text
provider instance/revision or service registration
contract identity, version and descriptor digest
allowed operations and schemas
effective authority and budget
lifecycle owner
```

Provider-specific SDKs may expose `agent.run()`, `git.commit()`, or
`sessions.read()`, but compile those calls to `effect/call`. A new wire method
is justified only when its interaction shape cannot be represented as one
cancelable request/response—for example, the host-to-provider invocation side
of Service/1. Naming a popular provider is not sufficient justification.

### Why per-extension methods lose

Per-extension methods appear precise but duplicate the difficult machinery:

- every extension must rediscover ownership, operation IDs, cancellation,
  deadlines, errors, journaling, and permission checks;
- a small host needs an extension dispatcher and namespace negotiation rather
  than one uniform unsupported-binding path;
- method names establish no compatibility by themselves; schemas and contract
  identities are still needed;
- a Flow's authority becomes the set of methods a host happens to expose,
  rather than the exact handles granted to that Run;
- cross-provider policy and auditing fragment.

Generic `effect/call` is smaller if—and only if—bindings are opaque,
least-authority, and contract-checked. A string such as
`binding: "openai-anything"` resolved from ambient global state would fail this
test.

### State, crash, and deadlock implications

Every effect uses the common state machine:

```text
prepared -> dispatched -> succeeded | failed | cancelled | indeterminate
```

Intent is journaled before provider dispatch and result before component reply.
Same operation ID and digest joins or replays the original; changed input is an
error; indeterminate is never replayed automatically.

An effect bound to a Service registration adds a wait edge from the owning
request to that provider invocation/capacity resource. A cycle rejects the
newest edge. No database or provider-registry lock remains held across the
call. Cancellation propagates to the provider but cannot promise reversal of an
external effect.

An unavailable or withdrawn binding fails `BINDING_LOST`; the host does not
semantically select a replacement inside `effect/call`.

### Falsifying conformance test

Grant a component one binding implementing only `agent.run`. Have it call the
valid operation, an undeclared operation, a forged binding handle, and the
valid operation twice with the same ID but changed input. Only the first call
may reach the provider; the others must fail before dispatch. Kill the host in
the external-commit/response window and verify the restarted call returns an
indeterminate/recorded result rather than dispatching again. If a host needs a
provider-specific top-level method to enforce any of these properties, the
generic gateway design is falsified.

---

## 3. One `flow[.<ext>]` with a FLOW-owned runtime directive

### Decision

Use one obvious optional implementation file, `flow` or `flow.<ext>`, and put
its runtime declaration in that same file. Do not duplicate executable
authority in `FLOW.md` or `flow.json`.

For a textual implementation the first line is a FLOW directive, not an OS
shebang:

```text
#!flow {"runtime":"deno","version":">=2 <3","args":["run","--quiet"]}
```

FLOW defines the directive grammar as `#!flow ` followed by one compact JSON
object. Required fields are `runtime` and a compatible version constraint;
`args` is an optional array of literal strings. Unknown unnamespaced fields,
duplicate JSON keys, interpolation markers, and shell strings are invalid.

The host—not the OS kernel—parses the line. It resolves `runtime` through an
allowlisted Runtime Provider, checks the installed runtime version, and spawns:

```text
[resolved-runtime-executable, ...literal-args, immutable-flow-file]
```

with `shell: false`. The implementation path is always appended by the host;
the directive has no template language. Runtime dependency preparation is an
explicit installation operation, never a launch side effect.

The extension remains a human hint only. `.ts` does not select Bun, Deno, or
Node. The Runtime Provider must declare and test that its runtime treats the
first line as non-executable source metadata. FLOW does not rely on the OS
understanding `#!`, `/usr/bin/env`, kernel argument splitting, or executable
bits.

Runtime identity is a FLOW-reserved short name or an owner-controlled URI; an
unqualified ecosystem nickname cannot be claimed by whichever package appears
first. The activation lock records the identity and the exact local provider
which resolved it.

A native `flow` file may be launched by a host Runtime Provider only after its
binary format, OS, architecture, and digest are preflighted. A textual launcher
without a valid FLOW directive is not portable. V1 rejects multiple root
`flow*` implementation candidates rather than choosing by suffix order.

This supplies the same information as an argv manifest, but colocates it with
the bytes whose execution it controls. Editing the directive changes the active
revision digest. `FLOW.md` remains the semantic document and does not contain a
second executable pointer which can drift from the implementation.

### State, crash, and security implications

Runtime resolution happens during candidate activation, before the code is
launched and before dependencies receive authority. The activation record pins:

```text
implementation path and digest
directive bytes
Runtime Provider identity/version
resolved executable path/version
literal argv
sandbox plan
```

The process launches only from the immutable snapshot checked during
activation, closing the preflight-to-execution race. If the runtime disappears
after activation but before launch, the Run fails `RUNTIME_UNAVAILABLE`; it is
not attempted with another provider and is not reinterpreted as Markdown.

The Runtime Provider, rather than each Flow, owns platform executable lookup.
This is still deterministic: a project records the resolved provider and
binary in its activation lock. It is not a “runner profile” because it does not
change Flow semantics; it only turns one declared runtime ID into a local
executable.

### Falsifying conformance test

Install a `flow.ts` whose directive requires Deno and whose body would create a
sentinel file if executed. On a Bun-only host, activation must fail
`RUNTIME_UNAVAILABLE`, the sentinel must not exist, and no subprocess or
dependency preparation may run. Then mutate the directive after activation:
an already pinned Run must still execute the old immutable bytes. If extension
inference, OS shebang behavior, mutable source, or fallback affects either
result, the directive design is falsified.

---

## 4. Stable Service/1 with declared dynamic registration

### Decision

Specify Services as a separately conforming `FLOW Service/1` module now. Do not
put it in Run/1, but do not design deep extensibility against a disposable
protocol either. Publication of the `1` label is gated on a Cordis realm and
one unrelated provider runtime passing the same suite; if implementation work
has not met that gate, the build may be called a preview, but the target state
machine is Service/1.

Purely static registration is insufficient for Cordis. Cordis services can
appear, disappear, and be replaced as dependencies or plugin configuration
change. Completely dynamic publication is also wrong: it defeats preflight,
contracts, grants, and trust review.

The minimum correct compromise is:

> Export names and contracts are declared statically by the package; live
> provider registrations within that declared authority ceiling are dynamic.

A Cordis adapter may expose a configured subset of realm services. It may
register or withdraw those exports as the corresponding Cordis services become
available. It may not turn an arbitrary newly observed Cordis object into a
portable service.

### Service/1 methods

Service/1 adds:

| Direction | Method | Kind |
|---|---|---|
| host -> component | `service/mount` | lifetime request |
| component -> host | `service/register` | request |
| component -> host | `service/unregister` | request |
| component -> host | `service/ready` | notification |
| host -> component | `service/invoke` | request |

It reuses `flow/call`, `effect/call`, `event/emit`, `telemetry/emit`, and
`request/cancel`.

The package declaration supplies the maximum export set:

```text
local export name
contract identity and accepted descriptor media type
exact provided contract version and descriptor digest
concurrency mode and maximum in-flight calls
required authority
```

`service/register` names one declared export and a component-local generation
key. The host returns an opaque `registrationId`; retrying the same operation
returns the same ID. Registrations made during startup are staged.
`service/ready` atomically publishes the currently staged set and marks startup
complete. A declared export which must exist at readiness but is absent makes
the mount fail. Optional declared exports may register later; after readiness a
successful register is immediately eligible for new bindings.

`service/unregister` supports two honest modes:

- `drain`: stop new bindings, preserve the registration for pinned consumers,
  and acknowledge removal only after leases and in-flight calls reach zero;
- `withdraw`: stop new bindings and immediately break existing ones with
  `BINDING_LOST`, for a provider which can no longer serve them.

The component must not claim `drain` after its underlying Cordis service has
already disappeared. A hot replacement can register a new generation for new
bindings while the old generation drains.

A draining unregister request may remain pending while old consumers finish.
The component SDK must therefore keep dispatching `service/invoke` requests,
and the provider must remain usable, until the unregister response arrives.
Each invoke identifies the opaque `registrationId`; a component cannot redirect
an old registration's invocation to a new generation merely because both
implement the same contract.

### State machines

Mount:

```text
created -> starting -> ready -> draining -> stopping -> stopped
                    \-> failed       \---------------> failed
```

Registration:

```text
staged -> active -> draining -> removed
                \-> withdrawn
                \-> lost
```

Binding:

```text
resolved -> pinned(registrationId) -> released
                                  \-> broken
```

The `service/mount` request remains pending for the mount lifetime. Every
`service/invoke` request is a child ownership scope. Outbound work performed
for it names that live request as owner; background maintenance names the mount
request. On process loss all registrations become `lost` and all binding leases
become broken. A restarted mount receives new IDs and cannot heal active
consumers invisibly.

Required dependency cycles are rejected before mount. Lazy runtime calls add
edges to the host wait-for graph; the newest edge closing a cycle fails
`WAIT_CYCLE`. Registration and readiness never wait for Hooks or downstream
binding reactions. No registry lock is held while an unregister drains.

### Falsifying conformance test

Mount a Cordis test realm whose declared export appears, is replaced, and then
disappears while one old and one new consumer are pinned. Verify that an
undeclared export is rejected; nothing is invokable before `service/ready`; the
new consumer binds the new registration; the old consumer continues through a
declared drain; withdrawal yields `BINDING_LOST`; and killing the realm removes
every registration/listener/lease without rebinding consumers. Also create A
and B with synchronous circular calls; the newest edge must fail rather than
hang. Any need to serialize a Cordis object directly or publish an undeclared
contract falsifies the boundary.

---

## 5. In-place repair of a waiting, not-yet-dispatched `flow/call`

### Decision

Allow it. The earlier blanket prohibition confused resuming opaque runner
state with completing an outstanding host request. The parent runner is still
alive and already awaiting `flow/call`; no continuation is serialized or
replayed. If no child has been dispatched, installing and binding an approved
candidate can safely satisfy that same request.

This behavior is not implicit. The project snapshot chooses, per Flow slot:

```text
onMissing: fail | wait
repair: none | manual | <maintenance Flow Binding>
deadline
approval policy
```

`fail` is the portable default. `wait` lets a human or configured maintenance
Flow repair the environment while the call remains pending. A caller cannot
grant itself repair or installation authority through `flow/call`.

### Resolution state machine

```text
received
  -> resolving
      -> bound -> dispatch-prepared -> child-running -> terminal
      -> missing
          -> failed                         (onMissing=fail)
          -> waiting-repair                 (onMissing=wait)
                -> resolving                (catalogue epoch changed)
                -> timed-out/cancelled
```

The host journals the original selector, operation ID, caller snapshot,
candidate-rejection reasons, and catalogue epoch. While `waiting-repair`:

- no child invocation ID exists;
- no Flow provider has been selected or dispatched;
- the parent process may remain suspended on the JSON-RPC request;
- the scheduler releases child-execution admission capacity;
- no resolver or catalogue lock is held;
- duplicate calls with the same operation ID attach to the same wait;
- cancellation closes the wait and prevents later dispatch.

Repair runs in staging with its own grants. It may add source, create a Flow
Binding, or propose a slot binding. Deterministic checks, sandbox probing,
contract/schema checks, and configured approval run before activation. When the
catalogue epoch advances, the original deterministic resolver runs again. It
does not accept the repair Agent's assertion that its output matches. If one
eligible candidate remains, Jig atomically records and pins the binding before
creating the child invocation. If several remain, normal semantic/ambiguity
rules apply.

The repair is owned by the waiting call by default. Cancellation cancels an
otherwise unshared repair Run. Several identical missing diagnostics may join
one repair transaction; it is cancelled only when its last waiter disappears.
A project may explicitly make maintenance durable/background work, but that is
project policy and does not give the cancelled call permission to resume.

### Crash and deadlock implications

- Host/component crash while waiting: the parent Run becomes lost, so that
  call cannot resume. Validated staged or activated source remains ordinary
  project state and benefits a future Run.
- Crash after binding commit but before child dispatch: the call record shows
  `dispatch-prepared` with no child; recovery must not invent a continuation
  for the lost parent. A new Run may reuse the binding.
- Crash after child dispatch: normal child-effect uncertainty applies; repair
  is no longer part of the path.
- Repair Flow needs the same missing slot: the wait-for graph detects the
  original-call -> repair -> missing-slot cycle and returns `WAIT_CYCLE`.
- A human adds two plausible candidates: the request becomes ambiguous rather
  than letting filesystem order decide.
- Parent deadline expires during approval: the waiting request cancels and no
  later activation dispatches a child for it.

This does not rewind earlier parent effects and does not swap its package,
settings, grants, or already pinned slots. The only new fact in its environment
is resolution of a slot which was explicitly unresolved and waiting.

### Falsifying conformance test

Start a parent whose `flow/call` is journaled as missing/waiting. Activate one
validated candidate, crash Jig at every boundary between activation, binding
commit, and child creation, and then restart. During a live host the original
request must dispatch exactly one child and return its result; after loss of the
parent it must dispatch none. Repeat with cancellation immediately before
activation and with two candidates. Any child launch before validation,
post-cancellation launch, duplicate dispatch, silent choice, or parent replay
falsifies safe in-place repair.

---

## 6. Flow Bindings and settings: immutable, explicit, non-inheriting

### Decision

A **Flow Binding** is the project-local configured identity of a reusable Flow:

```text
Binding revision =
    Binding ID
  + exact package revision/digest
  + settings object
  + slot bindings/selection policy
  + grants and sandbox policy
  + local discovery description
```

The lower-case “binding” passed on the wire is an opaque resolved dependency or
effect handle. The capitalized Flow Binding is an authored project definition.
Keeping those meanings explicit avoids turning a package directory into mutable
global configuration.

Settings obey four rules:

1. A Flow Binding owns one complete JSON settings object.
2. Parent settings never inherit into a child and a `flow/call` carries input,
   not a settings overlay.
3. Editing a Binding creates a new immutable Binding revision for future Runs;
   existing Runs retain the old revision.
4. A one-off override materializes an ephemeral derived Binding revision before
   launch. It does not mutate the base Binding or merge after the Run starts.

There is no runtime precedence stack such as:

```text
package < root config < environment < parent < call override
```

That model is impossible to inspect and makes two invocations of “the same”
Binding behave differently without identity changing.

Package code owns optional defaults. JSON Schema's `default` is documentation,
not a host mutation instruction. The host validates the Binding's supplied
settings against the package's optional schema. A required missing value blocks
Binding activation. If a behavior varies naturally per invocation, it belongs
in Flow input rather than settings.

Binding authoring modules may use ordinary language composition—imports,
constants, and object spread—to avoid repetition. `jig apply` captures only the
fully resolved serializable definition. There is no runtime `extends`, deep
merge, expression language, or implicit global default.

Grants are not settings. Project/host security policy intersects the Binding's
requested grants and may only reduce authority. Secrets in settings are opaque
secret references. A caller cannot change model credentials, provider
bindings, sandbox mode, or service contracts by putting similarly named fields
in input.

### Slot and override behavior

- A Flow Binding's explicit slot target wins over semantic selection.
- A slot without an explicit target resolves once according to its declared
  selection/missing policy and pins the exact target for the Run.
- A target Flow Binding's settings arrive unchanged. The consumer supplies only
  child input and explicitly forwarded file roots.
- To use the same package in fast and strict modes, define `review-fast` and
  `review-strict`; both remain independent router candidates.
- A CLI one-off override should accept a complete replacement settings object.
  If a `--set` convenience is offered, it performs explicit JSON-Pointer
  replacements against a copy before launch, materializes the resulting
  complete object as a derived Binding revision, and journals both the
  transformation and effective settings digest. Nothing is overlaid at runtime.
- Overrides cannot expand grants beyond project policy and cannot alter an
  already active Run.

### State, crash, and deadlock implications

Binding definitions transition:

```text
authored -> resolved -> validated -> active revision
                            \-> invalid
```

Run binding snapshots transition:

```text
unresolved -> pinned(exact Binding revision) -> released
```

Configuration evaluation and schema validation happen during `jig apply`, not
while holding a `flow/call`. No Binding module is re-evaluated in a component
process. A crash after a new Binding revision activates cannot mutate the old
revision pinned by a live Run. Cycles between explicit Flow Binding slots are
reported statically when possible and by the runtime wait graph when calls are
lazy.

If `MAX_RETRIES` is schema-required and absent, the Binding is invalid before
launch. If it is not declared, Jig cannot infer it from source or ambient
environment; the implementation must return invalid settings before effects.

### Falsifying conformance test

Create `review-fast` and `review-strict` over one package with different
settings, start both, then edit the strict Binding while both are live. Each Run
must retain its original settings and identity. Have a parent try to pass a
settings-shaped child input and an explicit wire settings override; the input
must remain input and the override must be rejected. Remove a schema-required
value while `MAX_RETRIES` exists in Jig's environment: activation must still
fail. If ambient values, parent settings, mutable files, or call-time overlays
change the child settings, the Binding model is falsified.

---

## Consolidated state boundary

The six decisions fit one state model:

```text
immutable Flow Binding revision
        |
        v
flow/run request (root ownership scope)
        |
        +-- flow/call -- resolving -- [optional waiting repair]
        |                    |
        |                    `-- pinned child Binding -> child Run
        |
        +-- effect/call -- pinned opaque effect/service binding
        |
        +-- event/emit -- acknowledged fact guarantee
        |
        `-- telemetry/emit -- lossy observation

Service/1 mount request
        |
        +-- statically permitted export
        |       `-- dynamically registered generation -> pinned consumers
        |
        `-- invoke request -> request-owned child effects
```

Every potentially blocking edge is represented in Jig's wait-for graph. Every
externally visible operation has an operation ID and a pre-dispatch journal
state. Every authority is derived from a pinned Binding or static service
declaration. Every repair or source change produces a validated immutable
revision before it can satisfy a wait. No LLM result establishes compatibility,
trust, or completion.

## Final recommendation

Adopt the revised six-method Run/1, the one-file FLOW runtime directive, stable
but separately conforming Service/1 with declared dynamic registrations,
waiting-call repair, and immutable Flow Bindings. These choices improve
minimalism because they remove the second launcher authority and wire-level
extension proliferation; improve operational completeness because facts,
Cordis liveness, and incomplete-environment repair have exact states; and
preserve independent hosts because durability, Services, semantic routing,
sandboxing, and repair remain separately claimed capabilities rather than
false universal guarantees.
