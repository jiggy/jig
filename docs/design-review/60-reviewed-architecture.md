# Jig + FLOW: reviewed architecture

**Status:** architecture freeze passed independent minimalist, systems, and
ecosystem reviews. Public `1.0` labels remain conditional on the conformance
gates in section 15.

This design is the result of repeated adversarial review and refutation. It deliberately
keeps the ambitious parts of Jig, but it refuses to make a portable claim for a
mechanism that does not yet have a complete ownership, failure, and authority
model.

## 1. The architecture in one view

```text
FLOW Package/1
    inert, inspectable package: FLOW.md plus zero or one implementation

FLOW Runtime/1
    exact semantics for preparing and launching that implementation

FLOW Run/1
    small finite-invocation protocol

FLOW Service/1 + Service Contract/1
    official, separately conforming profile for long-lived JSON services

Jig
    project host: activation, resolution, scheduling, effects, security,
    journals, reconciliation, and user-owned policy
```

`Package/1`, `Runtime/1`, `Run/1`, `Service/1`, and `Service Contract/1`
have separate conformance labels. `Service/1` is not experimental, but it is
not a tax on a Run-only host. Jig implements it; a small third-party host may
implement only Package and Run.

Caskada, Cordis, an imperative Python program, and an Agent instruction runner
are implementations behind these boundaries. None receives a privileged Jig
execution path.

The governing laws are:

1. A runtime owns its private control flow and continuation.
2. Jig owns external authority, binding, durable host state, and process
   lifetime.
3. FLOW standardizes the component boundary, not graphs, plugins, tasks, GUIs,
   Git, or an application ontology.
4. A Flow performs finite work. A Service supplies a stable multi-operation
   interface.
5. Flows may be selected by intent; public Services match exact contracts.
6. Semantic reasoning may rank eligible candidates. It may not establish
   compatibility, trust, permission, or completion.
7. Every component operation belongs to one live inbound request.
8. Request IDs correlate live wire ownership; host-internal lifetime IDs own
   durable records and cleanup.
9. Every Run and Mount pins immutable package, configuration, runtime,
   provider, and grant revisions.
10. Uncertain external work is never replayed silently.
11. Durable events and diagnostics are different; diagnostics never drive
    control flow.
12. User-owned source is ordinary editable source; runtime state is derived
    from immutable snapshots.

## 2. The deliberately small vocabulary

| Concept | Meaning |
|---|---|
| **Flow** | One finite invocation which returns one domain outcome. |
| **Service** | A long-lived provider exposing named request/response methods. |
| **Effect** | An explicit call from a component to a host-bound external capability. |
| **Binding** | One immutable configured use of an exact FLOW Package revision. |
| **Event** | An immutable fact committed to a durable journal. |
| **Hook** | Jig policy which starts one Flow from a committed event. |
| **Scope** | Jig's internal lifetime/cleanup tree; not an authored or wire object. |
| **Runtime Provider** | Trusted host code implementing one exact Runtime Contract. |

There is no public `Task`, `Work`, `Worktree`, remote `Context`, arbitrary
`Scope`, runner profile, graph schema, callback handle, or distributed object
model in v1.

An SDK may expose `RunContext` as a read-only convenience object. It is only a
projection of the `flow/run` parameters, not a service locator or remote
object.

## 3. FLOW Package/1

### 3.1 Package shape

Only `FLOW.md` is required. An exact implementation adds exactly one regular
root file named `flow` or `flow.<single-suffix>`, where the suffix is one
bounded ASCII alphanumeric segment.

```text
gauntlet-loop/
├── FLOW.md
├── flow.ts                 optional; exactly one root implementation
├── input.schema.json       optional fixed convention
├── settings.schema.json    optional fixed convention
├── output.schema.json      optional fixed convention
├── contracts/              optional Service descriptors
├── prompts/
├── skills/
├── references/
├── scripts/
└── assets/
```

`flow.ts` is visually obvious, but `.ts` never chooses Deno, Bun, or Node. The
declared Runtime Contract does.

### 3.2 Closed frontmatter

The complete v1 field vocabulary is:

```yaml
---
flow: 1
name: gauntlet-loop
description: >
  Build and improve an inspectable artifact through implementation,
  evaluation, and revision.

# Required only when a root implementation exists.
runtime:
  contract: https://flow.dev/runtimes/deno
  version: 1.0.0
  digest: sha256:...

# Valid only when both package and project explicitly permit instruction mode.
fallback: instruction

# Structured capabilities consumed through effect/call.
uses:
  agent:
    contract: https://flow.dev/contracts/agent
    version: 1.0.0
    digest: sha256:...
  sessions:
    contract: https://example.org/contracts/sessions
    version: 1.0.0
    digest: sha256:...
    binding: dynamic

# Present only for a Service provider. Each value is a package-relative
# Service Contract/1 descriptor.
service: 1
provides:
  sessions: ./contracts/session-store.flow-service.json

outcomes:
  blocked: Progress requires external input.

permissions:
  read: [source]
  write: [output]
---
```

Required fields are only `flow`, `name`, and `description`. The other fields
are optional, but their shapes are normative. Unknown unnamespaced fields are
errors; `x-*` fields are inert extensions. Frontmatter uses the JSON data model
subset of YAML 1.2. Duplicate keys, tags, aliases, anchors, merge keys, and
implementation-specific scalar types are rejected.

Each portable `uses` entry is the exact contract URI/version/digest triple and
may set `binding: dynamic` only for a Service dependency; static is the
default. A project-only package may instead mark a slot `local: true`, which is
an explicit non-portability claim. These forms are mutually exclusive. Every
`provides` entry is a safe package-relative path to one exact descriptor.

A package with `service: 1` is Service-capable and requires an exact
implementation. A package without it is Run-capable. V1 has no dual-mode
package and does not interpret a Service from Markdown. One Binding records the
mode derived from the exact package and cannot reinterpret it.

`name` is a 1–64 character ASCII slug matching
`[a-z0-9]+(?:-[a-z0-9]+)*` and is a friendly local label, not global identity.
Global package identity is source provenance plus content digest.

The Markdown body has two roles:

- for an instruction-only implementation, it is the executable procedure;
- for an exact implementation, it is its public semantic description and
  documentation, while the root implementation is operational authority.

Jig cannot prove that prose and code are behaviorally equivalent. Tests and
review are evidence, not proof.

### 3.3 Instruction and exact implementations

A `FLOW.md`-only package runs through an Agent-backed instruction runtime. If no
suitable Agent is configured, invocation fails before work with
`IMPLEMENTATION_UNAVAILABLE`.

When an exact implementation exists, it is the default. Missing executable
runtime support is a compatibility failure. Jig may use the instruction body
instead only when:

1. `fallback: instruction` is present; and
2. the selected Binding explicitly allows it.

Fallback is selected before launch and receives a distinct implementation
identity. Jig never falls back after code starts, crashes, times out, or emits
an effect.

### 3.4 Schemas are values, not shared files

The three conventional schema files describe per-Run input, per-Binding
settings, and final output. They are never shared runtime mailboxes.

Schema use is concrete:

- validate the actual input sent to a candidate;
- validate one complete settings value at Binding activation;
- validate a returned output.

Jig does not infer general schema subtyping. It does not apply JSON Schema
`default`; `default` is rejected in `settings.schema.json` in v1. Static
defaults belong to package code or instructions.

### 3.5 Canonical package snapshot

Portability requires one tree identity independent of Git, npm, OCI, or a local
directory. Package/1 therefore defines a canonical snapshot:

- relative UTF-8 NFC paths separated by `/`;
- regular files only in v1; symlinks and special files are rejected;
- exact file bytes, with no line-ending normalization;
- all source permission and executable bits are ignored;
- lexicographically sorted path/content records;
- rejection of traversal, absolute paths, case-fold collisions, Unicode
  normalization collisions, decompression bombs, and resource-limit excess;
- no ambient dependency cache, `.git`, source-adapter metadata, or generated
  preparation layer in the package digest.

`FLOW.md`, `flow`, and `flow.<suffix>` must have exactly that case and be
regular files. `flow.d.ts` is not a valid single-suffix entrypoint. File bytes
which differ, including CRLF versus LF, intentionally produce different
digests. A Runtime Provider materializes any executable mode required by its
prepared layer under the exact Runtime Contract and records that mode in
Runtime provenance, never in package identity.

An installed revision is identified by:

```text
resolved source URI + component subpath + source revision + package digest
```

Git, npm, OCI, local folders, and indexes are source adapters. An index helps
discovery; it is neither a namespace authority nor a trust root.

## 4. FLOW Runtime/1

### 4.1 Why a runtime contract exists

A file suffix cannot distinguish Deno semantics from Bun or Node-with-tsx.
A shebang is not the portable answer: POSIX leaves files beginning with `#!`
unspecified, and a shebang reintroduces package-controlled launcher arguments,
PATH lookup, and host-specific behavior.

The package therefore declares one **exact Runtime Contract**. It does not
declare a binary, command, argv array, shell string, or runner profile.

### 4.2 Runtime Contract contents

Each immutable Runtime Contract revision is one content-addressed bundle whose
root manifest commits to every normative artifact. It has:

```text
owner-qualified contract URI
exact interface version
canonical root-manifest digest and authority evidence
admitted root suffix/artifact forms and platform targets
runtime binary/version probe rules
package root, entrypoint, cwd, stdio, environment, and argument semantics
dependency preparation and lock/cache/network rules
permission-to-runtime mapping obligations
cancellation, process-tree, exit, and diagnostic behavior
required Run/1 or Service/1 framing
black-box conformance fixtures and expected results
```

The root digest covers the descriptor, schemas, normative behavioral text,
fixtures, expected results, and any normative referenced profile. Informative
documentation is explicitly non-normative. No mutable URL is followed for
normative meaning without a pinned digest. Thus two providers claiming the same
Runtime revision necessarily receive the same contract bytes before their
behavior is tested.

`FLOW.md runtime.digest`, Runtime Provider claims, activation records, locks,
and conformance fixtures always name that canonical root-manifest digest. The
descriptor and other member digests are internal Merkle entries and are never
accepted as Runtime Contract revision identity. The exact version is metadata;
the root digest is immutable identity.

A trusted Runtime Provider implements one or more exact Runtime Contract
revisions. Its host-local planning API produces a shell-free literal launch
plan. The package cannot inject argv.

Dependency preparation is a separate, explicitly authorized phase. It runs in
staging, honors the Runtime Contract's lock and install-script rules, produces
an immutable prepared-layer digest, and never happens opportunistically during
Run launch.

Activation pins:

```text
package and entrypoint digests
Runtime Contract URI/version/digest
Runtime Provider and runtime binary identities/digests/versions
preparation result and provenance
normalized launch-plan digest
platform
effective grant and sandbox enforcement report
```

Runtime versions match exactly in v1. A provider may advertise several exact
versions. Range compatibility can be added only after successive contracts
have explicit compatibility fixtures.

Native platform variants are distinct immutable package revisions in v1. An
index may group their lineage, but a locked package never chooses a mutable
platform face at launch.

## 5. FLOW Run/1

### 5.1 Process and framing

V1 uses one root Run per process. The transport is full-duplex JSON-RPC 2.0
over strict, bounded UTF-8 line framing on stdio:

```text
stdin     protocol frames only
stdout    protocol frames only
stderr    bounded unstructured diagnostics
```

There is one JSON object per LF-terminated frame, no BOM and no JSON-RPC batch.
IDs are strings unique among one sender's live requests. Writes are serialized
and flushed; readers remain active while application code awaits an outbound
call. Frame, outstanding-request, diagnostic, memory, and process limits are
mandatory. EOF closes the channel and every still-open wire request; the owner
phase rules in section 5.7 decide whether an already received terminal result
survives that EOF.

### 5.2 The complete base method surface

```text
host -> component
    flow/run          one pending root request

component -> host
    flow/call         one journaled child-Flow operation
    effect/call       one journaled call through a bound capability slot

either request originator -> receiver
    request/cancel    idempotent cancellation of its own pending request
```

That is Run/1. Structured lossy telemetry may later be an optional
`Telemetry/1` profile; stderr is sufficient for base conformance. Durable
events use the Journal capability described in section 9, not a fifth Run
method.

### 5.3 One live request owns work

Every component-originated `flow/call` and `effect/call` includes:

```text
ownerRequestId
operationId
slot
operation/selector and input
```

The owner must be one live inbound `flow/run`, `service/mount`, or
`service/invoke` request on the current channel incarnation. The host maps that
wire reference to an internal immutable lifetime record. Request IDs are not
durable database identities and cannot be reused after termination.

Every `service/status` names its live owning mount request and status revision.
Every `request/cancel` names a still-pending request originated by its sender.
`service/bindings` is host control and owns no component work. Only
`flow/run`, `service/mount`, and `service/invoke` may own operations.

There is no public `scopeId`, `scope/open`, Mount handle, or reconnect/resume
capability in v1. Internally Jig still has a Scope tree because cleanup needs
one. V1 deliberately says EOF loses the live continuation.

### 5.4 Run input

`flow/run` supplies one immutable invocation environment:

```text
Run identity and parent relation
input
complete Binding settings
trigger/correlation reference
visible effect bindings
named attached roots and access modes
private scratch root
effective grants and enforcement report
deadline and allocated budget
protocol limits
```

These are ordinary fields. “Coeffect” is useful theory but not a public FLOW or
Jig authoring concept. Time, randomness, secrets, network access, Agent work,
Git, and other observable environment interactions use explicit effect slots
when mediation matters.

### 5.5 Child Flows and effects

`flow/call` names a consumer-local slot, optional discovery intent, and input.
Jig resolves and pins one exact child Binding, atomically creates its child
record with the parent operation, and returns its public result. This is nested
execution, not graph merging. Parent settings, roots, and permissions do not
inherit implicitly.

`effect/call` names a slot declared in `uses` (or explicitly local in project
configuration), one method, and input. A slot may be backed by a host-native
provider or an exact mounted Service registration. The caller never sees or
selects an endpoint. Jig validates the owner, binding, contract, method,
schemas, authority, deadline, budget, and provider generation before dispatch.

### 5.6 Operation ledger and uncertainty

The durable operation key is:

```text
(activation digest, internal owner lifetime ID, operationId)
```

The host commits two distinct immutable records:

```text
caller request digest
    RFC 8785 canonical JSON over the caller-supplied method, slot,
    operation/selector, input, and caller-visible attachment identities

resolution
    one exact selected Binding/provider revision, initially absent when
    waiting and filled exactly once by compare-and-set
```

Transport request IDs, wait deadlines, diagnostics, and the not-yet-known
resolution are excluded from the caller request digest. Same operation key and
same caller digest joins the existing record; changed caller content fails
before dispatch. An exact prebinding may commit the resolution with `INTENT`.
Semantic or repaired resolution may fill it once later. Dispatch requires a
resolution and atomically commits it with child/lease creation. A retry never
reruns resolution after that field is filled.

```text
INTENT -> DISPATCHED -> SUCCEEDED | FAILED | CANCELLED | UNCERTAIN
   `----------------> CANCELLED  (before dispatch)
```

Intent commits before dispatch. Child allocation and dispatch admission commit
atomically. A terminal result commits before response. Cancellation after
external dispatch yields `UNCERTAIN` unless the provider proves a terminal
result. An intentional new attempt has a new `operationId`.

FLOW promises neither exactly-once external execution nor arbitrary live
continuation recovery. It promises that ambiguity is visible and never
silently replayed.

### 5.7 Cancellation and results

Cancellation is symmetric: each peer may cancel a still-pending request it
originated. Sending cancellation records `CANCEL_REQUESTED`; a normal response
may still win if the receiver completed first. Cancellation is established by
the terminal response or enforced process loss, and dispatched child effects
retain their own terminal or uncertain states.

On any cancellation Jig closes new admission, cancels descendants child-first,
runs host-owned cleanup, waits a bounded grace period, then kills the sandbox
process tree. Owner completion has explicit phases:

```text
OPEN -> RESPONSE_RECEIVED -> QUIESCING -> SUCCEEDED | FAILED | LOST
```

A complete valid terminal frame atomically leaves `OPEN` before later channel
input is handled and closes new admission. EOF in `OPEN` makes the owner
`LOST`; EOF after `RESPONSE_RECEIVED` closes other wire requests but does not
itself overwrite the buffered result. Trailing frames cannot create new owned
work, even when read in the same OS buffer.

For each component-originated request still pending during `QUIESCING`, the
host returns `OWNER_CLOSED`, cancels downstream work, resolves its operation to
a terminal or `UNCERTAIN` record, and completes bounded cleanup before output
validation and owner commit. The host does not send `request/cancel` for a
request it did not originate. No operation is detached, reparented, or
transferred implicitly. A response with owned work outstanding is a lifecycle
violation even if quiescence succeeds. Cleanup failure or hard-deadline expiry
makes the owner `FAILED` or `LOST`; the process tree is terminated. Mount-owned
background work is not silently transferred to an invocation owner.

The normal Run result is:

```json
{
  "outcome": "done",
  "output": {}
}
```

Package outcomes are domain results. Protocol failure, execution failure,
timeout, cancellation, provider loss, host loss, and uncertainty are not
custom outcomes disguised as business results.

Output schema validation occurs before owner success commits.

## 6. FLOW Service/1

### 6.1 Status

Service/1 is an official stable-profile target with an independent conformance
label:

```text
FLOW Service/1 Host
FLOW Service/1 Provider
```

It receives `1.0` only after a plain provider, a Cordis realm, and an
independently implemented host pass the same black-box lifecycle suite. Jig v1
implements it. Run-only hosts do not have to.

### 6.2 Complete method surface

```text
host -> component
    service/mount       pending for the complete Mount lifetime
    service/invoke      invoke one exact export generation
    service/bindings    install a revisioned dynamic-dependency snapshot

component -> host
    service/status      publish a revisioned full availability snapshot

shared with Run/1
    flow/call
    effect/call
    request/cancel
```

There is no `service/unmount`: cancelling the still-pending mount request
initiates shutdown, and its terminal response acknowledges cleanup. There is no
wire Mount ID because v1 has one Mount per process and no channel resumption.
An unsolicited terminal mount response closes admission and runs the same
owner-quiescence rule as Run/1; it cannot report success while Mount-owned work
is live and its provider registrations become lost.

Mount-background work belongs to the live `service/mount` request. Work caused
by an invocation belongs to that narrower `service/invoke` request. Cancelling
one invocation cannot cancel unrelated Mount work.

`service/mount` installs the complete initial dependency snapshot as revision
0 before provider initialization begins. It contains every fixed static Binding
and either the initial Binding or explicit absence for every dynamic slot.
Revision 0 is the first acknowledged dependency revision.

### 6.3 Availability, identity, and loss

Package metadata statically declares the maximum export set. The first accepted
`service/status` snapshot—even an empty one—marks the Mount ready; absence until
the startup deadline fails the Mount. The first ready snapshot names the exact
acknowledged dependency revision under which initialization completed; unknown
or partly installed revisions fail. Each snapshot:

- has a new revision greater than the last accepted revision;
- contains the complete currently available subset;
- is acknowledged by Jig;
- permits retransmission of the last accepted revision only with the same
  canonical digest; a changed or older revision is a protocol error.

`service/status` carries the live Mount owner and uses its revision—not a
separate operation ID—as its idempotency key. Accepting a snapshot atomically
records its digest, assigns fresh host generations to newly available exports,
closes admission for removed generations, marks their bindings lost, and
records cancellation of their admitted invocations. Only then is the snapshot
acknowledged. An invocation racing a removal is therefore either admitted
before the commit and cancelled or rejected after it. Cleanup may finish after
the acknowledgement, but the removed generation is no longer callable. A
status received after Mount cancellation or from a stale channel epoch fails
before mutation.

Re-adding the same export name creates a fresh generation; old consumers never
heal to it. Resolving a consumer slot allocates an internal Binding lease for
the exact provider generation, owned by that consumer Run or Mount dependency
revision. It is released when the owner closes or a dynamic dependency
snapshot replaces it; already admitted invocations keep narrower operation
leases until terminal. Consumer crash/loss releases leases through coordinator
fencing.

An active Mount accepts new Binding leases and invocations. A draining Mount
accepts no new consumer leases, but an existing live lease may start further
invocations; admitted invocations and bounded Mount-background work may
complete. Final lease release or the activation's recorded drain deadline
closes invocation admission, cancels remaining work, and cancels the pending
mount request. The provider cannot choose that deadline. Removing an export by
`service/status` is immediate withdrawal for that generation and overrides
graceful drain. A graceful replacement therefore keeps the old export
available on the old Mount. While draining, status may remove exports but may
not create a new availability transition.

Graceful rollout uses two Mounts. The ready new Mount receives new bindings;
the old Mount remains available to existing leased consumers until they release
or reach the deadline, after which its pending mount request is cancelled. This is much
simpler than an in-Mount distributed generation/drain protocol.

Provider EOF or crash loses all its generations. Restart creates new identities
and never transparently rebinds an existing consumer.

### 6.4 Dependencies

`uses` declares Service dependencies. Static is the default. Required static
dependencies are resolved before Mount and never rebound; their loss cancels
the Mount.

Only explicitly dynamic slots may receive `service/bindings`. Each update is a
complete, revisioned snapshot naming the live Mount owner. A new revision must
be positive and greater than the last accepted one; retransmitting the last revision is
idempotent only with the same canonical digest. It is applied wholly or
rejected wholly, and its successful response means the full snapshot is
installed.

Every later snapshot repeats static entries byte-for-byte; only declared
dynamic entries may change. Mount initialization operations and readiness name
revision 0 unless a complete positive revision was acknowledged first.

Each `service/invoke` carries the exact acknowledged dependency revision fixed
at admission for all its child calls. At operation-intent commit, every
Mount-owned `flow/call` or `effect/call` likewise names and stores the exact
latest acknowledged revision used to resolve its slot. Later snapshots cannot
alter that operation's provider. The host rejects stale, unknown, and partially
installed revisions. No undeclared dependency or export may appear at runtime.

Static dependency cycles fail before mount. Every synchronous Run, effect,
Service, and repair wait is an edge in Jig's wait-for graph. The newest edge
which would create a non-runnable cycle fails instead of deadlocking.

### 6.5 Deliberate v1 limit

Service/1 exchanges bounded ordinary JSON. It has no portable callbacks,
delegated-Service handles, generic resource handles, subscriptions, streams,
or automatic application-resource cleanup.

Services use request/response methods, snapshot plus `changesSince`, bounded
long-poll, or a durable Journal event. Native callbacks may remain inside one
Cordis realm. Host-specific UI bridges remain host-specific.

This is an explicit limitation, not a hidden incomplete feature. A later
`Callable/1` or `Subscription/1` must independently prove token forgery,
delegation, revocation, provider loss, cancellation, replay, ordering,
backpressure, and cleanup across two unrelated ecosystems.

## 7. Service Contract/1

A contract exists only for a structured effect/Service seam. Ordinary child
Flow calls remain contract-free.

The canonical descriptor is deliberately small:

```json
{
  "$schema": "https://flow.dev/schemas/service-contract-1.json",
  "flowServiceContract": 1,
  "id": "https://example.org/contracts/session-store",
  "version": "1.0.0",
  "methods": {
    "read": {
      "input": { "$ref": "#/$defs/ReadInput" },
      "output": { "$ref": "#/$defs/Session" },
      "errors": {
        "not_found": { "$ref": "#/$defs/NotFound" }
      }
    }
  },
  "$defs": {}
}
```

It defines:

```text
owner-controlled absolute contract URI
exact interface version
named methods
input and output JSON schemas
named application errors and error-data schemas
closed local definitions
```

It does not define endpoints, providers, selection, auth, graphs, GUI, Agents,
handles, callbacks, subscriptions, facts, or executable conformance Flows.

Method success and named application failure use exactly one of these tagged
values:

```json
{ "value": {} }
{ "error": { "name": "not_found", "data": {} } }
```

JSON-RPC errors are reserved for protocol, validation, authority, cancellation,
capacity, and provider-loss failures.

The JSON Schema 2020-12 profile fixes required vocabularies, local references,
format behavior, unknown-keyword handling, canonical errors, and evaluation
budgets. Descriptors are inert and resource-bounded before provider code loads.

Contract compatibility in v1 is exact:

```text
contract URI + exact version + exact canonical descriptor digest
```

Providers may advertise several exact versions. Version 1 or 3 does not satisfy
a requirement for version 2. An explicit adapter is an ordinary provider which
consumes one exact interface and provides another.

The digest is RFC 8785 canonical JSON with SHA-256. It identifies descriptor
bytes; it is not publisher identity or behavioral proof. The lock separately
records source/publisher authority evidence and continuity. Different bytes
claiming the same URI/version are quarantined as equivocation. Local edits to a
public descriptor require an authorized new version or an owner-qualified fork.

Descriptions and tests are evidence. Semantic ranking never converts a
nonmatching contract into a compatible one.

### 7.1 Conformance dependency firewall

The profiles compose explicitly rather than by implication:

| Claim | What it requires |
|---|---|
| Package/1 parser | Recognize all closed metadata inertly; no execution or Service support. |
| Run/1 Host | Own, journal, cancel, and dispatch `effect/call`; opaque local effects are sufficient. |
| Service Contract/1 Consumer | Resolve exact descriptors and validate methods, values, and named errors. |
| Typed-effect host | Run/1 Host plus Service Contract/1 Consumer. |
| Service/1 Host | Service lifecycle plus the normatively imported `flow/call`, `effect/call`, and cancellation subset. |

A Run-only host without Contract Consumer support rejects a package requiring a
public `uses` contract before launch with `UNSUPPORTED_PROFILE`; it may still
run a package bound to an explicit opaque local effect. A Service/1 Host tests
the imported host-call subset but need not accept `flow/run`. Merely parsing a
package with `service`/`provides` metadata never makes a minimal host
nonconforming; attempting to mount it produces a deterministic unsupported
profile result.

## 8. Bindings and project configuration

### 8.1 One configured-use abstraction

A package is reusable source. A Binding is one immutable project-local use of
either a Run-capable or Service-capable package:

```ts
const strictReview = bind({
  use: "./flows/review",
  settings: {
    maxRetries: 5,
    threshold: 0.95,
  },
  slots: {
    agent: agents.reviewer,
    research: discover({
      onMissing: "fail",
    }),
  },
  attachments: {
    source: root("./project", "read"),
    output: root("./results", "write"),
  },
  permissions: approveDeclaredPermissions(),
  fallback: "deny",
});
```

The normalized Binding contains:

```text
exact package revision
one complete settings value
exact slot bindings or explicit discovery policies
named attachment mappings and modes
effective grant policy
exact instruction Runtime/Agent Binding when instruction execution is possible
instruction-fallback policy
missing/repair policy
```

Root Runs, `flow/call`, and Hook targets require a Run-capable Binding. Desired
Service activation and provider resolution require a Service-capable Binding.
Normalized desired state has one `bindings` map, not parallel Flow and Service
configuration trees. Every active Service-capable Binding is mounted for that
admission generation; lazy Service activation is deferred. Instruction
fallback is legal only for a Run-capable Binding.

The optional intent carried by the actual `flow/call` is the sole discovery
meaning. A project may exact-bind its slot or choose fail/wait/repair policy,
but it cannot rewrite that intent or select a per-slot semantic engine. One
optional Semantic Resolver module belongs to the complete activation.

Two configurations are two Bindings. There are no roles, profiles, variants,
deep merges, environment fallback, parent inheritance, or per-Run settings
overlays. A one-off value creates an immutable ephemeral Binding revision.

An instruction-only Binding, or an exact Binding which permits instruction
fallback, cannot activate until project policy resolves one exact Agent Service
Binding and instruction-runtime revision. Both are part of the Binding digest;
there is no mutable ambient “default Agent” after activation.

Thus `MAX_RETRIES` is a setting, not an environment convention. If
`settings.schema.json` declares it required, Binding activation fails when it
is absent even if Jig's process has an environment variable of that name. If
the package has no settings schema, its implementation must reject invalid
settings before its first effect; Jig cannot infer an undeclared requirement.

### 8.2 `jig.ts`

The default project frontend is one `jig.ts`, split through ordinary imports as
the project prefers:

```ts
export default defineJig({
  bindings: { strictReview, sessions },
  hooks: [onInboxItem],
  modules: [events, services, agents, semanticRouter],
});
```

This is a trusted authoring frontend, not the runtime source of truth. Jig first
captures an immutable candidate containing the entry source, every statically
resolved local import, the exact dependency lock and selected package
artifacts, and the evaluator/loader Runtime Contract. It copies and hashes that
closed import graph, verifies observed sources did not change during capture,
and retries when they did. Dynamic or ambient module resolution fails. The
candidate—not a claimed simultaneous filesystem snapshot—is the sole input to
restricted evaluation and normalization. Network, process execution, and
secret/environment access are denied unless separately trusted.

`jig inspect` reads inert package and last-normalized state without executing
project code. `jig check`/`apply` require trust for the exact config snapshot.
No command evaluates `jig.ts` merely to browse an unknown repository.

Jig reserves only three project paths:

```text
jig.ts       user-authored desired-state frontend
jig.lock     inert, reviewable resolved package/contract/binding decisions
.jig/        local activations, journals, caches, staging, and runtime state
```

`jig.lock` is suitable for version control. It records portable resolution
choices, source revisions/digests, contract descriptors, and authority
evidence. Host-specific runtime binaries, sandbox reports, and live identities
belong to the immutable local activation under `.jig/`. Projects may create
`agents/`, `hooks/`, `inbox/`, `kanban/`, or any other folders, but Jig does
not assign them implicit semantics.

## 9. Effects, events, Hooks, and Agents

### 9.1 Effects

`effect/call` is the sole portable gateway for host-mediated operations. An
exact Service Contract describes a portable slot. A project-local opaque slot
is allowed only through explicit Binding and makes no portability claim.

The same gateway covers Agent work, Git, databases, secrets, UI host APIs, and
the durable Event Journal. It does not grant raw filesystem, network, process,
or environment access.

### 9.2 Durable events

Events remain first-class Jig semantics, but they use Jig's host-native
canonical Journal through an exact effect slot instead of a special Run
method:

```text
append(type, subject?, schema?, data, occurredAt?) ->
    { eventId, committedAt, journalPosition }

query(...)
wait(...)
```

The committed envelope is exact and bounded:

```text
eventId, type, source, committedAt, journalPosition
data
optional subject, schema, occurredAt, causedBy, correlationId, Run reference
```

The caller supplies `type`, `data`, and the optional occurrence fields.
`occurredAt` is an untrusted domain assertion. The Journal supplies the stable
ID, authenticated source, commit time, ordering position, and owner/operation
correlation.

The caller cannot choose protected producer, Run, operation, or commit fields.
Jig stamps authenticated producer identity, owner correlation, commit time,
and the stable event ID. Canonical append, Event, receipt, outer operation
result, and Hook-selection outbox commit in one Jig kernel transaction. A
retry of the same outer operation therefore returns its ledger result without
redispatch. There is no exceptional replay rule for external providers.

The Journal method descriptor defines the JSON values accepted by its slot;
this section defines Jig's host behavior. A package cannot mount a replacement
canonical Journal in v1. External stores may mirror committed Events or expose
ordinary Service methods, but cannot acknowledge canonical append or drive
Hooks. Another FLOW host may provide analogous host-native behavior without
acquiring a `Journal/1` conformance claim from this Jig-specific facility.

The Journal contract's `Event` value schema is strict. A CloudEvents view may
be generated, but CloudEvents terminology does not replace Jig's ownership,
namespace, durability, or ordering rules. V1 has one canonical ordered Journal
per Jig project; `journalPosition` is monotonic only within that project, and
no distributed global order is claimed.

Jig-owned lifecycle events are committed directly through the kernel outbox.
For example, normalized `https://jig.dev/events/agent-completed` commits in the same transaction as
the successful Agent effect result. A provider-native completion observed
earlier is a differently named provider observation and cannot masquerade as
the Jig lifecycle fact. Jig lifecycle namespaces are nondelegable. An Event
effect Binding may attenuate its publisher to an exact finite set of bounded,
owner-qualified type identifiers, which the kernel validates before commit.

### 9.3 Hooks

A v1 Hook is intentionally inert:

```text
one exact (authenticated source selector, event type)
    -> one exact Run-capable Binding
```

It is not arbitrary callback code, middleware, or a portable package type.
The source selector resolves at activation to one exact project Binding/kernel
producer identity or an explicit inert allowlist of exact identities. There is
no authority-bearing `any` source. Source is host-stamped and text similarity
never grants publication authority.

Each Hook revision owns a half-open interval in the project's Journal:

```text
[startPosition, endPosition)
```

The activation transaction orders Hook publication at one Journal boundary.
Adding a Hook starts at the next position; replacing or removing one closes the
old interval and opens any replacement at that same boundary. No historical
Event is selected implicitly. An Event selects every exact-type Hook revision
whose source selector matches and whose interval contains its position.

For each selected `(Hook revision digest, event ID)`, one database transaction
inserts or returns one derived Run record. Delivery is complete when that
record exists; it may remain `PENDING` or `BLOCKED`, or later fail, without
creating another Run. Multiple Hooks provide fan-out. Filtering, debounce,
conditional, multi-step, and external logic belongs in the producer or target
Flow, where effects and uncertainty are explicit.

Activation verifies only that the selector is authorized and the exact target
Binding exists and is Run-capable. When a concrete selected Event commits, Jig
creates or recovers the unique derived Run and applies ordinary input
validation to that actual, unaltered Event. Validation failure makes the same
Run terminal with `INVALID_INPUT` and a durable Hook diagnostic; it never
selects again, transforms the value, or creates a second Run. Jig performs no
schema-containment inference. A high-volume producer coalesces occurrences
before committing the coarse event; Hook does not grow a debounce or
expression language.

Hooks cannot veto, consume, delay, or rewrite the event. Delivery may be
retried, but the derived Run identity is stable. V1 has no Hook replay mode. An
operator wanting another execution starts an ordinary new Run with an archived
Event as input; that is not Hook redelivery.

A short `Journal.wait` may remain pending within a Run deadline. Long human or
external waits end with a domain outcome such as `waiting`; a later Hook starts
a new Run. FLOW v1 does not persist an arbitrary graph continuation.

### 9.4 Agents

FLOW is Agent-neutral. Jig supplies official Agent Service Contracts and
project-owned providers. One-shot work is an ordinary `agent.run` effect;
session operations may use application-level opaque session IDs and explicit
close methods. Those IDs do not acquire universal FLOW handle semantics.

Codex, Claude Code, ACP, and command adapters are providers, not core Agent
subclasses. A Starter may generate editable local provider packages so users
own their flavors. ACP is a preferred open integration where it fits; native
providers may expose additional exact contracts.

Instruction execution, semantic ranking, missing-Flow generation, and Agent
update repair require an Agent. Exact Flows, explicit resolution, inspection,
checking, clean updates, and rollback do not.

## 10. Resolution and fault tolerance

The deterministic Resolver is a Jig kernel mechanism. A Semantic Resolver is
an optional, powerless ranking module. Child-Flow candidates are already
configured, approved Run-capable Binding revisions—not raw packages. Package
descriptions may support catalogue retrieval, but an installed package without
settings, attachments, slot policy, and grants is never executable by
discovery alone.

For a child Flow or provider slot, Jig performs:

1. exact project binding;
2. valid locked selection;
3. deterministic filtering by exact protocol/contract, actual input
   validation, platform/runtime availability, trust, permissions, budget,
   recursion, and current liveness;
4. direct selection when one candidate remains;
5. optional semantic ranking among only those allowlisted candidates;
6. otherwise `BINDING_MISSING` or `BINDING_AMBIGUOUS` with complete reasons;
7. atomic binding commit and child/lease creation before dispatch.

Candidate descriptions are untrusted model input. The ranker has no mutation,
installation, network, filesystem, or grant authority, receives bounded IDs
and descriptions in a fixed envelope, and may return only an allowlisted ID.
Jig records the candidate set, evidence, model/provider, and result.

Unresolved dependency handling is mandatory even when semantic reasoning is
absent. The default is a durable diagnostic and failure. A Binding may opt a
not-yet-dispatched `flow/call` into a bounded `WAITING_BINDING` state. Search,
installation, generation, tests, approval, and activation occur in a separate
repair Run/staging transaction. A compare-and-set dispatches at most one child
only if the original owner is still live and the operation's resolution field
is still absent. Once filled, retries reuse it and never ask either Resolver
again. The owner retains its original admission generation; repair records the
single provider revision as an explicit extension of that owner's binding
table rather than changing its catalogue or policy generation.

This enables a user-owned `create-missing-flow` maintenance Flow without
letting synthesized code appear and run invisibly in the blocked operation.
Long repairs should normally fail and start a new attempt rather than retain an
unbounded population of sleeping processes.

Caskada's local `Router` is different: it is a graph Node choosing among its
declared successors. Jig's Resolver chooses external packages/providers at a
component boundary. Neither should impersonate the other.

## 11. Security and trust

### 11.1 Trust classes

Jig distinguishes:

```text
untrusted package implementation/instruction
trusted project configuration and host extensions
trusted Runtime Provider and sandbox backend
bound external capabilities with explicit contracts/grants
```

Trust is always attached to an exact digest and recorded. Discovery is inert.
Indexes and friendly names never grant trust.

### 11.2 Deno-like authoring, backend-honest enforcement

Package permissions name minimum attachment authority. Bindings approve the request;
they cannot silently widen it. The implicit baseline is read-only package
bytes, private scratch, and protocol stdio.

The base permission vocabulary contains only named attachment `read`/`write`.
Filesystem permissions never contain host paths. Component-visible environment
is empty except for fixed `FLOW_*` protocol entries defined by its exact Runtime
Contract. Configuration uses Binding settings; secrets and changing
configuration use an explicitly bound capability. V1 has no ambient
environment import.

Every named attachment request must resolve to a Binding attachment with equal
or stronger mode before launch. For untrusted portable v1 packages, raw network
and child-process authority is always denied; Agent, Git, HTTP, database,
secret, and tool work crosses mediated effect slots. There is no
`true`/unrestricted shorthand. Wider authority requires a trusted exact-digest
local override, is displayed as excess authority, and is explicitly
nonportable and not sandboxed.

Every Sandbox Backend implements:

```text
probe immutable launch plan + permission plan
prepare containment
spawn and supervise
terminate the complete process tree
dispose and report cleanup
```

Runtime planning expands the complete permission plan into a closed predicate
set covering package/root visibility, writes, environment, inherited file
descriptors, network denial, process/descendant denial, resource
limits, and termination control wherever applicable. Each predicate must be
`enforced` or `mediated` for an untrusted launch; any `advisory` or
`unavailable` predicate rejects it. Preparation/install authority is a
separate immutable permission plan and enforcement report. It never inherits the
host's or Runtime Provider's wider ambient authority merely because provider
code is trusted.

For every authority dimension it reports:

```text
enforced | mediated | advisory | unavailable
```

Untrusted activation fails if a required restriction is advisory or
unavailable. An exact-digest trusted override records the wider authority and
must not be described as sandboxed.

There is no dishonest “universal cross-platform sandbox.” A reference Linux
backend can combine namespaces/container isolation, read-only/bind mounts,
Landlock or equivalent filesystem restriction, cgroups/resource controls,
syscall policy, and a mediated network namespace. Other platforms either prove
the complete required predicate set or report incompatibility.

The instruction runner receives the same effective grants and a tool-limited
Agent session with no ambient project, secrets, plugins, or provider session.
If an Agent provider cannot be constrained, instruction execution is trusted or
unavailable, never falsely isolated.

### 11.3 Authority and fencing

One Jig coordinator owns an exclusive project lease and monotonic epoch. Runs,
Mounts, registrations, operations, and sandboxes are fenced to it. After a
host crash Jig marks old live owners/registrations lost, classifies unresolved
dispatched effects uncertain, kills or quarantines old process groups, and
admits replacements only after stale authority is fenced.

Service invocation additionally validates the exact live consumer binding,
registration generation, contract/method, schemas, grants, deadline, and
budget before provider application code sees it.

## 12. Scheduler and lifecycle correctness

Jig maintains separate limits for:

```text
root admission
runnable process/provider capacity
resident waiting processes
child depth/fanout
outstanding requests/effects
time/token/money/resource budgets
```

A parent awaiting a child may release a scheduler execution token, but it does
not cease consuming memory/PID/sandbox quotas. If no legal descendant capacity
exists, Jig returns `RESOURCE_EXHAUSTED` instead of deadlocking.

Every synchronous wait edge is recorded before blocking. No registry or
database lock is held across an external call. The newest edge which closes a
non-runnable cycle fails explicitly.

Cleanup is child-first, bounded, and continues after individual disposer
errors. Jig guarantees cleanup of resources it owns. It does not pretend that
arbitrary external effects have inverses.

## 13. Desired state, direct editing, and updates

“File-based” describes Jig's default ownership UX, not its application model.
Packages, project configuration, prompts, skills, and local customizations are
ordinary files. A Jig application may use databases, GUIs, queues, or no task
files at all.

The visible component tree is always the complete effective source. There is no
persistent patch stack and no runtime patch overlay.

```text
jig inspect    inert package/normalized-state inspection
jig check      snapshot, parse, resolve, validate, and probe
jig apply      publish one valid immutable activation
jig status     compare authored, active, and running revisions
```

Saving a file never mutates a live Run. `apply` captures and validates one
immutable candidate as described in section 8, then publishes one durable
**admission generation**. Every new root Run, binding resolution, Hook interval,
and Service-consumer Binding is admitted against exactly one generation;
existing owners retain theirs. A Run's later unresolved discovery uses its
pinned catalogue and policy generation. A successful repair may extend only
that owner's binding table with the one recorded provider revision; it does not
switch project generation.

Jig may start candidate Services before publication, but “shadow” means only
that they receive no consumer bindings. Their outbound effects are real,
grant-checked, operation-journaled, attributed to the candidate, and may be
irreversible. Projects requiring side-effect-free preflight must use checks
which need no external authority, or accept a post-publication readiness
window. Abandoning a candidate cancels its Mounts and reports every committed
or uncertain startup effect; it never claims to restore the external world.

Imported-source update is a staged three-way merge:

```text
BASE        pristine revision previously adopted
LOCAL       current directly edited visible source
UPSTREAM    new pristine revision
```

Deterministic tree merge runs first. Conflicts or failed checks leave the old
activation and visible source safe. An optional maintenance Flow may repair
textual conflicts or semantic drift using BASE/LOCAL/UPSTREAM, release notes,
tests, and diagnostics. Agent output remains only a staged candidate subject to
the same checks and approval.

Visible-source replacement and database publication use a recoverable update
state machine rather than claiming one cross-medium transaction:

```text
PREPARED -> SOURCE_SWITCHED -> ADMISSION_SWITCHED -> COMMITTED
```

Before either switch, old source and activation remain authoritative. New
admission is blocked while a switch transaction is incomplete. Each transition
records both digests; directory replacement uses same-filesystem atomic rename
or fails. On restart Jig verifies the recorded source and activation and
deterministically rolls forward or back before reopening admission. The
admission switch and Hook interval boundary share one Jig database
transaction. `jig rollback` uses the same state machine with old/new reversed.
A distinct runtime-only activation command may pin an old activation while
reporting source drift and never edits visible source.

Patch files remain useful export/review artifacts, not a second source of truth.

## 14. Jig decomposition and reference integrations

### 14.1 Kernel

The smallest credible Jig kernel owns:

```text
immutable activation and coordinator epoch
internal lifetime tree, scheduler, cancellation, and process supervision
Run/1 hosting and generic Service dispatch hooks
deterministic binding resolver and wait graph
operation ledger and transactional lifecycle-event outbox
grant evaluation and Sandbox Backend interface
atomic child/Hook scheduling and admission-generation publication
durable identity, provenance, and uncertainty records
```

### 14.2 Official modules

Jig ships separately initialized facilities for:

```text
Service/1 hosting
Event Journal, queries, and inert Hooks
Agent providers and instruction execution
Semantic Resolver ranking
source/install/update tooling
Runtime Providers
sandbox backends
ingress/watchers
```

A module is trusted Jig implementation code, not another public package
standard. Where possible, project-customizable behavior is a Flow or Service
behind the ordinary boundaries.

### 14.3 Starters

Starters own application policy:

```text
inbox, Task, Kanban, WorkItem
Git repositories, branches, and worktrees
GUI/HTTP layout
approval/checkpoint policy
specific Agent adapters
semantic/missing-Flow repair policy
```

Core supports:

```text
jig init --bare
jig init --from <starter>
```

A selected Starter may run its own reviewed initializer and ask whether to add
an Agent, Semantic Resolver, `create-missing-flow`, Git/worktrees, an inbox, or
a GUI. The resulting files are copied once and fully user-owned. Jig has no
universal feature matrix, Starter inheritance, or hidden ongoing dependency.

`init --from` is itself a staged trust transaction:

1. resolve the Starter to an inert canonical snapshot and record provenance,
   revision, digest, and authority evidence without evaluating it;
2. preview the exact tree and destination, then copy into staging with source
   hooks and install scripts disabled;
3. atomically materialize it only after acceptance;
4. if it declares an initializer, expose that initializer as an ordinary Flow
   and require a second approval of its exact Binding, Runtime, Agent use,
   attachments, and grants;
5. on failure, retain a diagnosable staging transaction or restore the original
   destination—never a half-initialized active project.

The initializer receives no installer-only authority. Declining it still leaves
the copied project inspectable, and the materialized project has no continuing
Starter dependency.

### 14.4 Caskada

Caskada is a first-party external graph runtime and reference Run/1 component,
not a Jig executor. It gets no in-process bypass.

Its own authoring model can remain:

```text
Node
Flow
Router (specialized Node)
Agent (useful specialized Node)
```

Graph definition and inspection remain Caskada concerns. Runtime visit/retry
state is per Run, host operations await `flow/call`/`effect/call`, and terminal
graph results become FLOW outcomes. Jig never mirrors its nodes or continuation.

### 14.5 Cordis and DSH

One Cordis realm maps to one pending Service Mount. Declared external injections
map to exact dependency slots; declared serializable exports map to static
Service descriptors; availability maps to `service/status`; root disposal maps
to cancellation of the mount request.

Cordis Fibers, closures, symbols, local events, and arbitrary objects remain in
the realm. Service/1 v1 proves a host-side serializable seam, not transparent
portability for arbitrary DSH browser plugins, React components, slots, or
callbacks. A Jig-specific UI compatibility Service is valid, but it is not a
universal FLOW GUI standard.

A small independent Python component proves that Run/1 is neither TypeScript-
nor graph-specific.

## 15. Conformance and release gates

No prose-only boundary receives a stable label. FLOW publishes machine-readable
schemas, state machines, framing rules, canonicalization algorithms, an error
registry, and black-box fixtures usable without Jig libraries.

The base error registry distinguishes at least:

```text
IMPLEMENTATION_UNAVAILABLE   RUNTIME_UNAVAILABLE
BINDING_MISSING              BINDING_AMBIGUOUS
INVALID_INPUT                INVALID_SETTINGS
PERMISSION_UNENFORCEABLE     UNSUPPORTED_PROFILE
PROVIDER_LOST                REQUEST_CANCELLED
DEADLINE_EXCEEDED            RESOURCE_EXHAUSTED
WAIT_CYCLE                   OPERATION_UNCERTAIN
OWNER_CLOSED                 OWNER_LOST
PROTOCOL_ERROR
```

Required behavior is fail-closed and observable:

| Situation | Required result |
|---|---|
| Instruction Flow without an Agent | Discoverable; fails before work. |
| Deno package on a Bun-only host | Runtime mismatch; no preparation or launch. |
| Several eligible children without a ranker | Explicit ambiguity with candidates and reasons. |
| Missing child | Durable diagnostic; optional staged bounded repair; never invisible generation. |
| External success cannot be established after crash | `OPERATION_UNCERTAIN`; no automatic replay. |
| Owner returns with a live child | Admission closes; child receives `OWNER_CLOSED`; owner cannot succeed before bounded quiescence. |
| Root cancellation | New authority closes, descendants cancel, process tree is bounded and killed. |
| Provider disappears and returns | Old binding is lost; return has a new generation; no healing. |
| Backend cannot enforce requested confinement | Untrusted activation fails; trusted override states wider authority. |
| Hook delivery repeats | It resolves to the same derived Run. |
| Upstream conflicts with local edits | Candidate stays staged and old source/activation remain usable. |
| Required setting is absent | Binding or implementation validation fails; environment cannot fill it. |
| Package requires callbacks/subscriptions | `UNSUPPORTED_PROFILE` before launch. |

Release order:

1. **Package/1:** safe metadata parser and identical canonical tree digest from
   Git/npm/OCI/local fixtures.
2. **Runtime/1:** two independent providers for at least one exact Runtime
   Contract produce equivalent preparation, launch, permission, cancellation,
   and exit behavior.
3. **Run/1:** a Jig host, an independent host, Caskada, and a non-TypeScript
   component agree on framing, child/effect calls, cancellation, duplicate
   operations, uncertainty, and outcomes.
4. **Security:** package/config extraction attacks, instruction-Agent attacks,
   direct and transitive I/O escapes, orphan processes, forged owner IDs,
   stale coordinator epochs, ambient environment/module-cache variation,
   inherited descriptors, undeclared descendants, attachment/grant widening,
   and false enforcement reports fail closed.
5. **Service Contract/1:** independent TypeScript and Python clients/providers
   agree from the descriptor alone on methods, values, errors, validation,
   canonicalization, and equivocation.
6. **Service/1:** a plain provider, Cordis realm, Jig host, and independent host
   agree on pending-Mount ownership, owner-return quiescence, readiness,
   concurrent invoke/removal races, status retransmission, exact dynamic
   binding snapshots, loss/reappearance, update drain, cycles, cancellation,
   EOF, and crash fencing.
7. **Events/Hooks:** two independently implemented hosts' native canonical
   Journals survive kill injection at every append/receipt boundary with one
   Event and outer operation result; external effects retain generic
   uncertainty and are never replayed; protected sources/types cannot be
   forged; Hook revision intervals remain exact across concurrent Event commits
   and activation, and each selected pair creates one derived Run record—even
   `INVALID_INPUT`—when dispatch cannot succeed.
8. **Reconciliation:** kill injection at capture, preparation, candidate Mount,
   source switch, admission switch, update merge, and rollback recovers one
   matching visible-source/admission generation before new work; committed or
   uncertain candidate effects remain explicitly visible rather than being
   described as rolled back.

The standard makes separate claims:

```text
FLOW Package/1
FLOW Runtime/<id>/<version> Provider
FLOW Run/1 Host or Component
FLOW Service Contract/1 Descriptor/Provider/Consumer
FLOW Service/1 Host or Provider
```

“FLOW compatible” alone is not a sufficient conformance claim.

## 16. Explicit removals and deferrals

Removed from v1:

```text
package-owned command/argv and shebang authority
multiple implementation faces
automatic executable-to-instruction fallback
public Scope/Context/Mount objects
immediate mount result and service/unmount
callback/delegated/resource handles
generic subscriptions/signals/streams
SemVer range inference for Runtime or Service contracts
event/append as a dedicated Run method
arbitrary Hook callback code
settings overlays and environment fallback
portable raw network/process permissions and Grant Profiles
universal graph schema or graph continuation persistence
in-process Caskada privilege
Task/Git/worktree/GUI ontology in Jig core
persistent patch overlays
mandatory central registry
false exactly-once or universal-sandbox claims
```

Deferred behind evidence, not merely time:

- `Callable/1` or `Subscription/1`, after two ecosystems converge on authority,
  replay, cancellation, backpressure, and cleanup;
- compatible contract ranges, after real version lineages and compatibility
  fixtures exist;
- structured `Telemetry/1`, after Caskada and Agent integrations establish the
  minimum useful common envelope;
- channel resumption or durable runner continuation, after an epoch/fencing
  model survives crash tests;
- multiple native/platform implementations per package, after separate
  revisions become a measured ecosystem burden.
- raw-authority Grant Profiles, only after a real package cannot use mediated
  effects and two Sandbox Backends pass one immutable direct/transitive escape
  corpus on their claimed platforms.

## 17. Final evaluation

This architecture is scalable because Run processes are finite and supervised,
Services amortize genuinely long-lived state, waits/capacity are explicitly
bounded, and semantic selection occurs at binding time rather than every call.

It is portable because packages do not encode host commands, runners retain
their internal model, runtime semantics and Service APIs have exact identities,
and every portable claim has an independent conformance surface.

It is minimalist because Run/1 has four methods, Service/1 adds only the state
needed for a pending provider with changing availability, one Binding holds all
configuration, and Flow remains the unit for complex logic—including repair,
Hook reactions, and Starter setup.

It is future-proof because the hard extensions—callbacks, streams, resumption,
compatible ranges, richer telemetry—have explicit profile boundaries instead
of half-implemented placeholders in v1.

Its most important limitation is intentional: FLOW v1 is not transparent
distributed JavaScript and not a universal graph runtime. It is a small,
precise boundary through which graph runners, imperative programs, Agent
procedures, and long-lived JSON Services can participate in the same host
without surrendering their internal architecture.

The design can be summarized in one line:

> **FLOW makes independently owned work portable; Jig resolves, constrains,
> observes, and safely evolves it; runners keep control of how the work is
> actually done.**

## Standards intentionally reused

- [Agent Skills specification](https://agentskills.io/specification) for the
  minimal Markdown-package and progressive-disclosure precedent.
- [JSON-RPC 2.0](https://www.jsonrpc.org/specification) for request, response,
  notification, correlation, and error framing semantics.
- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-core)
  for inert value schemas.
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) for canonical JSON used in
  descriptor and operation digests.
- [CloudEvents](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md)
  as an event-data interoperability view, not as Jig's delivery or durability
  model.
- [Deno's permission model](https://docs.deno.com/runtime/fundamentals/security/)
  as authoring inspiration, with outer isolation still required.
- [bubblewrap](https://github.com/containers/bubblewrap) and
  [Landlock](https://docs.kernel.org/userspace-api/landlock.html) as useful
  Linux enforcement building blocks, not universal sandbox guarantees.
- [Agent Client Protocol](https://agentclientprotocol.com/protocol/v1/overview)
  as a preferred open Agent-provider transport where applicable.
- [Cordis](https://github.com/cordiverse/cordis) as the reference pressure test
  for dynamic service lifetimes and cleanup at one realm boundary.
- [POSIX Shell Command Language](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html)
  for the explicit fact that `#!` input has unspecified results, which is why a
  shebang is not FLOW's portable runtime selector.
