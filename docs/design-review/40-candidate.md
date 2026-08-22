# Candidate architecture for final hostile review

This document is intentionally opinionated. It is the first complete candidate,
not a collection of options. A decision remains only when it protects a named
invariant and has a defined failure mode.

## 1. Product boundary

The system has four layers:

```text
FLOW Package/1
    portable source package and semantic procedure

FLOW Run/1
    finite invocation boundary for any implementation runtime

FLOW Service/1 + Service Contract/1
    separately conforming long-lived, multi-operation boundary

Jig
    host, resolver, lifecycle supervisor, security boundary, journal,
    project reconciler, and source manager
```

Caskada, Cordis, imperative programs, and Agent interpreters are runtimes behind
those boundaries. None receives a privileged path through Jig.

The governing laws are:

1. A runner owns its internal control flow and continuation.
2. Jig owns external authority, dependency binding, process lifetime, and
   durable host state.
3. FLOW owns the portable boundary, not the application's ontology.
4. Flows compose by intent or exact project binding. Public Services compose by
   exact contract.
5. Semantic reasoning ranks already-eligible choices; it never proves runtime,
   schema, contract, permission, provenance, or trust compatibility.
6. Mutable authored source never executes. Runs and Mounts pin immutable active
   revisions.
7. A connection transports identities; it is not itself a Run, Mount, binding,
   session, or lifetime.
8. Every resource has a host-owned lifetime. Cancellation revokes authority even
   when external side effects cannot be reversed.
9. An uncertain external operation is never replayed silently.
10. Events are committed facts. Disposable progress is telemetry.

## 2. FLOW Package/1

### 2.1 Minimum package

Only `FLOW.md` is required:

```markdown
---
flow: 1
name: gauntlet-loop
description: >
  Build and improve an inspectable artifact through implementation,
  evaluation, and revision.
---

# Gauntlet Loop

Read the supplied request and inspect the attached roots ...
```

The required frontmatter is only:

```text
flow
name
description
```

The Markdown body is the human- and Agent-readable procedure. Prompts, skills,
references, scripts, assets, and tests remain ordinary adjacent files. There is
no YAML workflow language, mapper, expression evaluator, or graph schema.

A `FLOW.md`-only package is an instruction implementation. A host executes it
through an Agent-backed instruction runner. If no such runner is configured,
the package remains discoverable but invocation fails before work starts with
`IMPLEMENTATION_UNAVAILABLE`.

### 2.2 One exact implementation

An exact package may add exactly one root file named:

```text
flow
flow.<single-suffix>
```

The suffix is for humans and tools. It never chooses a runtime. Multiple root
implementation candidates are invalid.

An executable package declares required execution semantics in the already
required `FLOW.md`:

```yaml
runtime:
  contract: https://example.org/flow-runtimes/deno
  version: ^2.0.0
```

This is a portable runtime contract, not an executable path, command, argv,
package-manager task, or runner profile. The package declares the semantics it
requires; the project/host binds that requirement to one concrete trusted
Runtime Provider during activation.

The Runtime Provider owns a fixed launch algorithm. The activation pins:

```text
package and implementation digests
runtime contract identity and version
concrete Runtime Provider identity and digest
resolved runtime binary and observed version
launch-plan digest
sandbox backend and enforcement report
```

The host always launches without a shell from the immutable snapshot. Runtime
selection never consults file associations, `PATH` order, registration order,
or a SemanticRouter.

There is deliberately no normative shebang. OS shebang parsing is not portable,
a FLOW-specific first line would not work uniformly for binaries and source
languages, and `FLOW.md` already exists for safe language-neutral discovery.
A local implementation may contain a language shebang, but it has no authority
over portable FLOW launch.

If a package declares Deno semantics and only a Bun provider exists, activation
fails without launching code. If the package falsely declares Bun while using
Deno-only features, that is a defective package declaration; source inference
cannot make dishonesty deterministic.

### 2.3 Exact execution and interpreted fallback

If an exact implementation exists, it is the default. A missing runtime is a
compatibility failure, not permission to silently interpret the Markdown.

Interpreted degradation is permitted only when both are true:

1. the package explicitly declares its Markdown body an acceptable fallback;
2. the project Binding permits that fallback.

The choice is made before the Run and recorded as a distinct implementation
identity. Jig never falls back after an executable starts, crashes, or performs
an effect.

### 2.4 Optional conventional value schemas

Packages may contain these fixed optional files:

```text
input.schema.json
settings.schema.json
output.schema.json
```

They are JSON Schema documents describing values, not shared runtime files.
Every invocation still receives its own input and every Binding its own settings.
No package needs a schema merely to be runnable.

Optional frontmatter is reserved for public outcomes, required Run facilities,
minimum raw permissions, and Service uses/provides. It must never express
branching, mappings, provider selection, or configuration inheritance.

### 2.5 Identity and distribution

`name` is friendly metadata, not global identity. An installed package revision
is identified by:

```text
resolved source URI
component subpath
source revision
content digest
```

Sources may be Git, npm, OCI, a local directory, or an index entry. An index is
search infrastructure, not a namespace owner or source of truth. Discovery
parses inert metadata and never executes package code.

## 3. FLOW Run/1

### 3.1 Transport and process model

Run/1 is duplex JSON-RPC 2.0 over newline-delimited JSON on stdio:

```text
stdout    protocol only
stdin     protocol only
stderr    unstructured diagnostics
```

V1 launches one root Run per process. This intentionally trades negligible
startup overhead for isolation and unambiguous lifetime. A later transport may
pool processes without changing Run semantics.

There is no stateful initialization handshake. The root request carries the
protocol generation and all invocation context. Request IDs from each direction
use disjoint prefixes.

### 3.2 Complete Run/1 method vocabulary

```text
host -> component
    flow/run          request
    request/cancel    notification for a pending request

component -> host
    flow/call         request
    effect/call       request
    event/append      request
    telemetry/emit    notification
```

No provider-specific top-level methods belong in Run/1.

### 3.3 Run context: explicit coeffects

`flow/run` supplies the immutable environment needed by this invocation:

```text
Run identity and deadline
per-invocation input
Binding-owned settings
trigger and causality metadata
local dependency slots
named attached filesystem roots and access modes
effective grants and their enforcement report
supported host facilities
```

These are **coeffects**: environmental facts supplied to execution. The SDK may
present them as an immutable `RunContext`, but FLOW does not define a remote
Context object, ambient service locator, or mutable distributed memory.

Time, randomness, secrets, network calls, Agent work, Git operations, and other
observable environmental operations are effects when determinism or mediation
matters; they are not silently injected globals.

Settings and input are distinct:

- settings identify one configured project use and do not change within a Run;
- input varies per invocation;
- secrets are opaque capability handles, never settings or inherited environment;
- attached roots are explicit capabilities, not a universal Workspace or Task.

### 3.4 `flow/call`

A child call names a consumer-local slot and supplies input:

```json
{
  "ownerRequestId": "h:run:17",
  "operationId": "research:1",
  "slot": "research",
  "intent": "Research and justify a comparison target",
  "input": {}
}
```

An exact project binding wins. Otherwise Jig resolves the slot once, pins the
selected Flow Binding for the parent lifetime, creates a child lifetime, runs
the child, and returns its public outcome. Parent settings and authority do not
flow implicitly into the child.

The child is an operation, not a merged graph. Caskada, Cordis, and imperative
parents keep their internal continuations private while awaiting the same call.

### 3.5 `effect/call`

All host-mediated operations use one binding-scoped gateway:

```json
{
  "ownerRequestId": "h:run:17",
  "operationId": "builder-agent:1",
  "slot": "agent",
  "operation": "run",
  "input": {}
}
```

The component can name only a local slot, not a provider endpoint. The host
validates the operation, value schemas, authority, budget, and pinned provider
before dispatch. Typed Agent, Git, secrets, database, and UI SDKs lower to this
same envelope.

### 3.6 Operation identity and uncertainty

JSON-RPC request IDs correlate transport messages. `operationId` identifies one
semantic operation inside its owner lifetime.

The host ledger uses:

```text
received -> intent-committed -> dispatched
                              -> succeeded | failed | cancelled | uncertain
```

Rules:

- intent is committed before dispatch;
- a terminal result is committed before replying;
- same owner, operation ID, and canonical request digest joins/replays the same
  record;
- reuse with changed input is an error;
- an external success followed by a crash before result commit is `uncertain`;
- uncertain operations are never retried automatically;
- an intentional semantic retry uses a new operation ID;
- cancellation does not claim to reverse an already committed external effect.

FLOW promises neither exactly-once external execution nor arbitrary continuation
recovery. If the host dies, the opaque runner continuation is lost even when
completed operations and events survive.

### 3.7 Events and telemetry

`event/append` publishes a semantic fact. Success has one meaning:

> The immutable event, stable event ID, and operation-deduplication result were
> committed to the host's durable journal before acknowledgement.

There is no acknowledged-but-volatile event tier. A host without a durable
journal returns `EVENT_JOURNAL_UNAVAILABLE` without accepting the fact and may
still conform to Run/1. Packages that require events declare the facility so
incompatibility is normally caught before launch.

The event envelope is CloudEvents-compatible where useful and includes type,
producer/source, data, time, subject/schema when present, Run correlation, and
causation. Host and provider namespaces are protected; an arbitrary Flow cannot
forge `jig.run.completed` or `agent.completed`.

Acknowledgement never waits for a Hook, subscriber, GUI, or derived Flow. Those
are reactions after commit.

`telemetry/emit` is disposable structured observation: progress, logs, spans,
token deltas, and node transitions. It has no acknowledgement, stable event ID,
deduplication, or control-flow consequence. Stderr remains available for plain
diagnostics.

### 3.8 Cancellation and ownership

`request/cancel` targets a live request ID. Cancelling a root Run closes its
host-owned lifetime, denies new descendant effects, propagates cancellation
child-first, waits a bounded grace period, and then uses the isolation backend
to terminate remaining process trees.

Every outbound request names a live owner request. Components cannot open an
arbitrary Scope or acquire authority by inventing an ID. `Scope` is the normative
lifetime/ownership semantic inside Jig; it is not a general remote object.
`RunContext` is an SDK projection. `Mount` becomes public only in Service/1.

## 4. Resolution and fault tolerance

### 4.1 Resolver core, semantic selector module

Unresolved dependency state is a Jig primitive. Semantic reasoning is not.

For a child Flow slot Jig performs, in order:

1. exact project binding;
2. still-valid locked/pinned selection;
3. deterministic filtering by implementation/runtime availability, value
   schemas, grants, trust, recursion/budget policy, and platform;
4. direct selection when exactly one candidate remains;
5. optional Semantic Resolver ranking only among the remaining candidates;
6. otherwise `BINDING_AMBIGUOUS` with every candidate and rejection reason.

The semantic model receives bounded candidate IDs and descriptions as untrusted
data, runs without mutation authority, and must return an allowlisted ID. It
cannot install packages, waive compatibility, grant permissions, or certify
completion. Its choice, evidence, model/provider, and candidate set are recorded.

This makes fault tolerance available without making Jig Agent-dependent:

```text
deterministic resolver and explicit missing/ambiguous states    always
semantic ranking and generation                                optional
```

### 4.2 Missing dependency repair

The default is `fail` with a durable diagnostic. A Flow Binding may opt one
slot into bounded waiting repair:

```text
onMissing: fail | wait
repair: none | manual | <maintenance Flow Binding>
deadline
approval policy
```

A waiting first `flow/call` may be satisfied after repair only when no provider
was bound or dispatched for that slot. Repair runs in a separate isolated
lifetime and staging tree. Its output is installed, checked, permission-reviewed,
approved, activated, and passed through the normal resolver before the original
child is created.

This is delayed first binding, not mid-Run rebinding or continuation replay.
Cancellation prevents later dispatch. A host/parent crash ends the waiting call;
validated installed source may help a future Run but cannot resurrect the lost
continuation. Repair dependency cycles fail explicitly.

Without an Agent, exact installation or manual binding may still repair the
diagnostic. Generation and semantic selection remain unavailable rather than
silently guessed.

## 5. Flow Bindings and project configuration

### 5.1 One configured-use abstraction

A Flow package is reusable source. A **Flow Binding** is one immutable
project-local use:

```text
Binding ID
exact package revision
complete settings value
slot bindings and selection/missing policy
attached-root mapping
grant/sandbox policy
optional local discovery description
```

Runs target Binding revisions, not mutable package directories. Two modes of
one package are two Bindings, not profiles, roles, variants, or runtime overlays.

```ts
const reviewFast = bind({
  use: "./flows/review",
  settings: { maxRetries: 1, threshold: 0.7 },
});

const reviewStrict = bind({
  use: "./flows/review",
  settings: { maxRetries: 5, threshold: 0.95 },
});
```

### 5.2 Settings rules

There is no precedence stack. In particular:

- no environment fallback;
- no parent-to-child inheritance;
- no per-call settings merge;
- no host interpretation of JSON Schema `default`;
- no deep-merge or expression language.

Package code owns static defaults. A Binding owns a complete configured value.
Per-request variation belongs in input. A required missing `maxRetries` fails
Binding activation even if `MAX_RETRIES` exists in Jig's environment.

A one-off configuration creates and journals a distinct ephemeral Binding
revision before launch; it never mutates a named Binding.

### 5.3 `jig.ts` and normalized desired state

Jig's default project frontend is one trusted `jig.ts`. Ordinary TypeScript
imports split it into any structure the project wants:

```ts
export default defineJig({
  use: [services(), events(), agents, semanticResolver],
  flows: { gauntlet, reviewFast, reviewStrict },
  hooks: [reviewCompletedBuild],
});
```

`jig apply` evaluates it once and normalizes it to an inert serializable project
definition. The activation is content-addressed and immutable. Project code is
trusted authority and is never loaded from an untrusted Flow merely because
that Flow was discovered.

There are no magic `bindings/`, `hooks/`, `agents/`, or `policies/` directories;
Starters may create those for readability. `.jig/` alone is reserved generated
state. A future GUI or other authoring frontend may emit the same normalized
definition. Files are Jig's default ownership medium, not its application
ontology.

## 6. Effects, facts, Hooks, and Agents in Jig

### 6.1 Kernel journal boundary

Jig's kernel owns two narrow durable primitives in one transactional store:

```text
operation ledger
fact log / transactional outbox
```

This lets a host/provider operation result and zero or more authenticated
lifecycle facts commit atomically. Otherwise a crash can commit
`agent.completed` without its Agent result, or the result without the fact that
drives a promised Hook.

The fact log knows only immutable envelopes, identity, causality, and producer
authority. It does not contain Hook code, schemas, routing policy, or application
meaning.

### 6.2 Hooks

A Hook is local project policy over committed facts. It is not a portable Flow
type, middleware, graph edge, `HOOK.md`, or event interception chain.

Rules:

- fact commit precedes delivery;
- delivery is at least once;
- Hooks fan out independently and cannot veto, consume, delay, or rewrite the
  fact;
- Hook failure never rolls back the fact;
- scheduling uses `(Hook revision, event ID, action key)` as an idempotency key;
- complex work starts a Flow; raw external work in Hook code loses Jig's effect
  guarantees unless it uses a journaled host operation;
- adding a Hook affects future events; replay is an explicit operator action.

Environmental producers such as a filesystem watcher or HTTP listener append
facts through authenticated host operations. A software-factory Starter can
therefore implement `inbox -> triage -> Kanban` entirely outside the kernel.

### 6.3 Agents

FLOW is Agent-neutral. Jig is Agent-native through a stable Agent module and a
project-owned `AgentProvider` interface supporting the subset a provider
actually has:

```text
one-shot run
open/prompt/cancel/close session
structured output
normalized lifecycle facts
provider telemetry
```

Codex, Claude Code, ACP, and process adapters are provider implementations, not
different core Agent classes. Starters may generate editable local adapters so
projects own their flavors. An Agent is supplied through an effect slot; a Flow
does not import the vendor unless it deliberately takes a vendor-specific
contract.

Agent sessions are owned by the requesting lifetime. Provider completion is an
authenticated fact committed with the effect result where the backend permits.
Message deltas and tool progress are telemetry. Provider-native events remain
namespaced.

## 7. FLOW Service/1

### 7.1 Stability and conformance boundary

Service/1 is stable and separately conforming, not experimental and not a Run/1
tax. A small host may claim `Package/1 + Run/1`; Jig v1 also implements
`Service/1 + Service Contract/1`.

Jig is not called stable until the same Service/1 suite passes for a plain
provider and a Cordis realm. Separate conformance claims are a complexity
firewall, not runner profiles.

A Service package has an exact implementation. One process hosts one Mount in
v1.

### 7.2 Static interface, dynamic liveness

The package statically declares:

```text
public service exports and exact contract descriptors
required service slots and compatible contract ranges
whether each dependency slot is static or explicitly dynamic
```

Static is the default. No process may publish a contract that was absent from
inert package metadata. Runtime liveness may change without changing the public
interface ceiling.

### 7.3 Minimum Service/1 methods

```text
host -> component
    service/mount       initialize one configured provider
    service/invoke      call one exact export generation
    service/bindings    replace the full dynamic-dependency snapshot
    service/unmount     graceful cleanup after ingress stops
    request/cancel      cancel a pending invocation

component -> host
    service/status      acknowledged full availability snapshot

component -> host methods reused from Run/1
    flow/call
    effect/call
    event/append
    telemetry/emit
```

`service/mount` supplies settings, grants, and initial exact dependency
bindings. Its response means local initialization succeeded and reports initial
availability. The process remains alive until unmount or loss.

`service/bindings` is a monotonically versioned full snapshot, not unordered
add/remove notifications. Only declared dynamic slots may change. Each binding
has a new opaque ID when its provider identity changes. Calls name the exact ID,
so a race cannot silently cross revisions.

`service/status` is an acknowledged availability snapshot. Every available
export carries a component generation key; the host derives a registration ID
from Mount, export, and generation. Disappearance breaks or drains that exact
generation according to Jig policy. Reappearance with a different generation
does not heal old consumers.

`service/invoke` identifies the exact registration and remains pending for one
operation. Its child effects are owned by that invocation. Calls may be
concurrent subject to contract/provider limits.

For unmount, Jig first stops new admission, waits for or cancels admitted calls,
then requests cleanup, and finally force-terminates at the deadline. Draining,
restart, health, rollout, HMR, and provider selection are Jig policies, not wire
methods.

Provider crash marks all registrations lost, breaks pinned consumers, commits a
provider-loss fact, and creates no transparent replacement. A restarted provider
is a new Mount/registration identity.

Static required dependency cycles fail before mount. Runtime synchronous wait
cycles fail the newest edge in Jig's wait-for graph rather than deadlocking the
scheduler.

### 7.4 Cordis boundary

One Cordis realm maps to one Mount:

```text
root Cordis Context/Fiber tree        Mount lifetime
declared external injections          Service binding proxies
declared serializable exports         static Service contract ceiling
Fiber activation/pending              acknowledged export availability
dynamic external service changes      versioned binding snapshots
root disposal                         service/unmount
```

Local Cordis objects, closures, symbols, event modes, Fibers, and services stay
inside the realm. Only explicitly declared serializable interfaces cross. A
DSH-oriented component still needs the relevant DSH service contracts or a DSH
compatibility provider; Cordis alone cannot make application APIs portable.

## 8. Service Contract/1

### 8.1 When it exists

Ordinary Flows never need a contract. A public portable Service does because a
stable multi-operation interface cannot be selected by prose.

Local opaque services are legal under explicit project binding but make no
portable claim and cannot satisfy a public contract by semantic similarity.

### 8.2 Canonical descriptor

The canonical artifact is a self-contained FLOW-owned JSON descriptor whose
values use JSON Schema 2020-12:

```json
{
  "$schema": "https://flow.example/schemas/service-contract-1.json",
  "flowService": 1,
  "id": "https://example.org/contracts/session-store",
  "version": "1.2.0",
  "methods": {
    "read": {
      "input": { "$ref": "#/$defs/ReadInput" },
      "output": { "$ref": "#/$defs/Session" },
      "errors": {
        "not_found": { "data": { "$ref": "#/$defs/NotFound" } }
      }
    }
  },
  "handles": {},
  "facts": {},
  "conformance": {
    "flow": "./conformance",
    "digest": "sha256:..."
  },
  "$defs": {}
}
```

It defines only:

```text
owner-controlled contract identity
exact interface version
method input/output and named application-error schemas
optional nominal resource or delegated-Service handles
optional provider fact schemas
optional executable conformance Flow
closed local JSON Schema definitions
```

It defines no endpoints, transport, provider discovery, auth scheme, graph,
Task, Agent, GUI, mapper, expression, runtime, or selection policy.

OpenRPC is a generated ordinary-method documentation/client view, not the
canonical contract: the lifecycle-critical handle, ownership, fact, and
conformance semantics would otherwise live in ignored extensions. TypeSpec and
Smithy may be authoring sources which emit the canonical descriptor. V1 remains
JSON-valued; binary/streaming data crosses through granted resource handles
until a real second encoding profile is justified.

Nominal resource handles are opaque bearer capabilities tied to a provider,
declared type, and owner lifetime. A resource handle may declare an explicit
release method; closure triggers best-effort release, not a fictional inverse
for arbitrary external effects. A delegated-Service handle refers to an
already-published provider satisfying an exact contract range; callbacks are
services, never serialized closures.

Live notifications are expressed through an explicit contracted callback
Service in v1. Durable provider facts use `event/append`. A generic subscription
and signal protocol is deferred until two independent service ecosystems prove
one common lifecycle; it is not smuggled into Contract/1 prematurely.

### 8.3 Identity, compatibility, and evidence

The contract identity is an owner-controlled absolute URI. The descriptor has
an exact SemVer version. A consumer requirement is either exact or a compatible
range with an explicit lower bound, such as `^2.3.0`; prerelease and 0.x
selection are exact-only in v1.

The lock stores SHA-256 over RFC 8785 canonical JSON. Two different descriptor
digests claiming the same ID and exact version are quarantined as equivocation,
not semantically ranked.

Binding order is:

1. exact contract ID;
2. compatible version range;
3. descriptor digest and publisher authority;
4. platform, grants, trust, availability, and conformance evidence;
5. explicit project binding;
6. semantic ranking only among still-compatible providers;
7. exact provider and descriptor pin for the consumer lifetime.

If a consumer requires review `^2.3.0` and only v1 and v3 exist, the result is
missing. Recovery installs v2, patches the consumer, or uses an explicit adapter
which provides v2 and consumes v3. An Agent-generated adapter is staged and
tested like any other provider; generation does not prove compatibility.

JSON Schema proves shapes, not behavior. A digest-pinned exact executable Flow
may serve as the contract-owned conformance suite. Test evidence is locked with
provider, runtime, and suite digests. It is evidence, not a mathematical proof.

## 9. Security and trust

### 9.1 Deno-like author surface

An executable package asks only for extra authority it genuinely needs:

```yaml
permissions:
  read: [source]
  write: [output]
  net: [https://api.github.com]
  run: [git]
  env: [CI]
```

Semantics are deliberately small:

- filesystem values are package-local attachment names, never host paths;
- network values are normalized origins;
- process values are logical executable grants;
- environment values are literal names;
- secrets are bound capabilities, never environment permissions;
- `true` means unrestricted and demands explicit high-trust policy;
- omission requests no authority beyond read-only package bytes, private Run
  scratch, and protocol stdio.

The package declaration is a minimum need, not a grant. The Flow Binding maps
attachments and project policy sets the maximum. Launch fails unless requested
needs fit the maximum and the backend can enforce the required restrictions.

Raw grants and effect slots are independent. An HTTP effect does not grant raw
network, and raw network does not create a journaled HTTP effect.

### 9.2 Enforceable backend contract

Every isolation backend must support the conceptual operations:

```text
probe(runtime launch plan, immutable snapshot, grant plan)
prepare
spawn/supervise
terminate process tree
dispose
```

Its report classifies each restriction:

```text
enforced      direct bypass is blocked by OS/backend
mediated      access exists only through a host-controlled gateway
advisory      requested policy is visible but bypass remains possible
unavailable   backend cannot supply or restrict it
```

Untrusted execution fails closed if any required denial/restriction is merely
advisory or unavailable. A trusted override pins an exact content digest,
discloses the lost guarantees, and is journaled. There is no universal
multi-platform “sandbox” claim.

A reference Linux backend may combine an OCI/container or namespace boundary,
read-only/bind mounts, process/resource controls, syscall restrictions, and a
network namespace with an egress proxy. A language permission layer such as
Deno is defense in depth, not the outer boundary; raw subprocess or FFI grants
can defeat it. A platform without an adequate backend is incompatible with
untrusted Runs rather than silently permissive.

Discovery never executes code. Dependency preparation and install scripts are
separate explicitly authorized operations. Runtime environment, inherited file
descriptors, symlinks, archives, DNS, child processes, devices, and resource
limits are part of backend conformance tests.

## 10. Source, activation, update, and rollback

### 10.1 Mutable source, immutable runtime

The visible component directory is always the complete effective editable
source. There is no persistent patch stack and no runtime overlay.

```text
jig check     parse, resolve, validate, and probe
jig apply     snapshot and atomically publish a valid activation
jig status    compare authored, active, and running revisions
```

Saving a file does not mutate an active Run. Watch mode may call the same apply
transaction, but it has no weaker semantics. Broken candidates leave the prior
activation live.

### 10.2 Three-way update

For imported source Jig retains the pristine adopted revision. Update uses:

```text
BASE        previous pristine upstream
LOCAL       current visible edited source
UPSTREAM    new pristine upstream
```

It first performs a deterministic three-way tree merge in staging, then runs
package, runtime, contract, security, and project checks. Conflicts stop safely.
An optional maintenance Flow receives BASE, LOCAL, UPSTREAM, partial merge,
conflicts, tests, and release notes to preserve local intent and repair semantic
drift. Its result is still an untrusted candidate subject to the same checks and
approval.

Only a valid candidate publishes atomically. Old Runs and consumers retain old
snapshots; long-lived providers drain or are broken under explicit policy.
Rollback selects a previous complete activation.

Patch files remain an optional export/review format, never a second source of
truth. Basic check, clean update, and rollback require no Agent.

## 11. Jig product decomposition

### 11.1 Kernel

The smallest credible Jig kernel owns:

```text
immutable project/package activation
Run ownership, scheduler, wait-for graph, cancellation, and process supervision
Binding handle table and resolver extension point
generic child/effect/service dispatch registration
operation ledger
minimal fact log / transactional outbox
grant evaluation and isolation-backend interface
atomic publication and durable identity/provenance records
```

No lock is held across an external call. Parent Runs awaiting children do not
consume the same admission capacity required to start those children. Budgets,
deadlines, and authority are hierarchical.

### 11.2 Stable bundled modules

Jig v1 ships, but initializes only when configured:

```text
Services            Service/1, contracts, mount/binding policy
Events and Hooks    query/replay/cursors, Hook delivery, schemas
Agents              providers, sessions, instruction runner
Semantic Resolver   Agent-backed ranking after deterministic filters
Source tooling      install, diff, update, repair, rollback
Telemetry           sinks and OpenTelemetry adapters
Watch/ingress        environmental facts
Runtime Providers   Deno, Bun, Python, native, and others
Isolation backends  platform-specific enforcement
```

“Module” is not another package standard. It is normal trusted project startup
code registered under the project lifetime and disposed with it. There is no
`MODULE.md`, plugin graph, or module marketplace in Jig.

### 11.3 Starters

Starters own application policy:

```text
Task, WorkItem, inbox, Kanban
Git repositories and worktrees
GUI and HTTP application structure
approval/checkpoint policy
specific Agent adapters and Flow catalogues
```

`jig init` supports bare, one exact prebuilt Starter, or a guided generator
which asks whether to include an Agent provider, Semantic Resolver,
missing-Flow repair, software-factory ingress, Git, or GUI support. Generation
is one-time source creation; the result is ordinary user-owned files with no
Starter inheritance, runtime pack graph, or update coupling.

Only `jig.ts` and `.jig/` are Jig conventions. All application folders are
ordinary source.

## 12. Reference runtimes

### 12.1 Caskada

Caskada v3 is a separate first-party FLOW runtime, not a Jig executor. It uses
the same Run/1 boundary and conformance suite as every other executable.

Its internal model remains small:

```text
Node
Flow
Router (a specialized Node)
Agent (a useful Node specialization)
```

Graph definitions are immutable; visit/retry/branch state is per Run; Nodes
return transitions rather than mutating shared trigger state; host operations
are awaited effects. A router derives candidates from self-described local
targets or delegates catalogue Flow selection to Jig. Public `RouterContract`
plumbing is not an authoring requirement.

Caskada owns graph inspection and visualization. FLOW does not require a
universal graph or let Jig mirror the runner's continuation.

### 12.2 Cordis and a plain runtime

The Cordis realm adapter proves long-lived reactive-service compatibility. A
small Python imperative implementation proves that Run/1 is neither TypeScript-
nor graph-specific. Jig gives neither an in-process optimization in v1.

A future trusted loopback/in-process transport is acceptable only if it passes
identical FLOW semantics and is generic rather than Caskada-specific.

## 13. Required failure outcomes

| Scenario | Required result |
|---|---|
| Markdown-only Flow, no Agent | Discoverable; invocation fails `IMPLEMENTATION_UNAVAILABLE` before work. |
| Deno Flow, Bun-only host | Declared runtime contract fails activation; no launch or preparation. |
| Two plausible Flow providers | Semantic Resolver chooses only if configured; otherwise explicit ambiguity. |
| Missing child | Durable diagnostic; optional bounded staged repair; never invisible generation. |
| External success then crash | Recorded result if committed; otherwise `uncertain`; no auto-replay. |
| Cancellation with descendants | New authority revoked, child-first cancellation, bounded cleanup, force termination. |
| Mutual synchronous providers | Static cycle rejected or newest runtime wait edge fails. |
| Provider crashes | Exact registration lost; consumers fail; replacement gets new identity. |
| Untrusted direct I/O | Outer backend blocks it or activation fails; mediation alone is not called isolation. |
| Backend cannot restrict | Untrusted Run fails; exact-digest trusted override is explicit and journaled. |
| Hook delivered twice | Same Hook/event/action scheduling key resolves to the same derived Run. |
| Progress dropped | No outcome, fact, Hook, or control decision changes. |
| Local/upstream textual conflict | Staged update stops or Agent repairs; active revision remains. |
| Clean merge breaks intent | Tests/review may reject; architecture admits no proof from text merge alone. |
| Two configurations | Two immutable Flow Bindings over one package snapshot. |
| Missing `MAX_RETRIES` | Binding activation fails; ambient environment is ignored. |
| Cordis exports one service | Only declared JSON contract crosses; other realm objects stay local. |
| Minimal Run-only host | Can claim Package/1 + Run/1 without Services, semantic routing, Hooks, or sandbox enforcement; unavailable features fail honestly. |

## 14. Explicit removals and deferrals

Remove from the architecture:

```text
privileged in-process Caskada execution
universal graph schemas or mirrored runner state
Task, Work, Git worktree, GUI, or Kanban in Jig core
FLOW.json and arbitrary package command/argv templates
normative OS or FLOW pseudo-shebangs
contracts for ordinary Flow calls
OpenRPC as the canonical Service contract
volatile acknowledged events
ambient mutable Context/service-locator objects
universal Workspace/Space ontology
settings inheritance, environment fallback, or call-time overlays
per-call semantic provider routing
semantic compatibility or trust decisions
silent mid-lifetime rebinding
automatic replay of uncertain work
exactly-once or arbitrary graph-resumption claims
Hooks as middleware or completion gates
permanent patch stacks or runtime overlays
save-time mutation of active definitions
mandatory central registries
universal sandbox claims without enforcement
undeclared dynamic Service exports
raw provider RPC tunnelling
```

Defer until independently proven:

```text
cluster/HA and remote transports
process pooling
universal byte/duplex streaming
generic Service signal/subscription protocol
dynamic anonymous callbacks
cross-host event replication
durable restoration of opaque runner continuations
universal GUI-client code packaging
```

## 15. Release gates

Do not call the architecture stable until independent implementations pass:

1. Caskada Run/1, a plain Python Run/1, and Jig's host conformance suite.
2. A plain Service provider and one Cordis realm over the same Service/1 suite.
3. Runtime-provider tests for Deno, Bun, Python, and a native artifact with no
   package argv or suffix guessing.
4. Kill-point tests around operation intent, external dispatch, result commit,
   event commit, Hook scheduling, cancellation, provider loss, and update
   publication.
5. Sandbox escape tests against direct filesystem, network, subprocess, env,
   descriptor, symlink/archive, and resource-limit paths.
6. Contract tests for version mismatch, descriptor equivocation, forged handles,
   provider loss, callbacks, and explicit adapters.
7. Source-update tests preserving nonconflicting exact edits and refusing an
   invalid merged candidate.
8. An ecosystem exercise importing a DSH-class component through declared
   Services without exposing Cordis objects or adding DSH concepts to FLOW.

## Final definition

**FLOW** is an open package and protocol family for portable agent-readable
procedures, exact finite executions, and separately conforming long-lived
services.

**Jig** is a general-purpose host that turns mutable user-owned project source
into immutable activations, resolves and supervises FLOW components under
least authority, records effects and facts truthfully, and exposes semantic
selection and repair without making correctness depend on an Agent.

**Caskada** is one elegant graph runtime for FLOW, not the architecture's center.

The compact formula is:

```text
FLOW Package gives meaning
FLOW Run gives execution portability
FLOW Service Contract gives precise long-lived interoperability
Jig gives lifecycle, authority, binding, durability, and evolution
Starters give applications their opinions
```
