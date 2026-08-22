# Jig + FLOW: reviewed architecture

**Status:** architecture freeze passed two independent adversarial review
rounds after their release blockers were incorporated. Public `1.0` labels
remain conditional on the conformance gates in section 15.

This design is the result of repeated adversarial review and refutation. It deliberately
keeps the ambitious parts of Jig, but it refuses to make a portable claim for a
mechanism that does not yet have a complete ownership, failure, and authority
model.

## 1. The architecture in one view

```text
FLOW Package/1
    inert, inspectable package: FLOW.md plus zero or one implementation

FLOW Runtime Profile/<id>
    immutable FLOW-owned semantics for preparing and launching one implementation

FLOW Run/1
    small finite-invocation protocol

FLOW Service/1 + Service Contract/1
    official, separately conforming profile for long-lived JSON services

Jig
    project host: activation, resolution, scheduling, effects, security,
    journals, reconciliation, and user-owned policy
```

`Package/1`, each Runtime Profile, `Run/1`, `Service/1`, and Service
`Contract/1` have separate conformance labels. `Service/1` is official rather
than experimental, but it is not a tax on a Run-only host. Jig implements it;
a small third-party host may implement only Package, Run, and the Runtime
Profiles it actually supports.

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
| **Runtime Profile** | One immutable, versioned, FLOW-owned launch contract such as `deno@1`. |
| **Runtime Runner** | Trusted host code which plans one or more exact Runtime Profiles. |

There is no public `Task`, `Work`, `Worktree`, remote `Context`, arbitrary
`Scope`, runtime-binary range, graph schema, callback handle, or distributed object
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
├── result.schema.json      optional fixed convention
├── contracts/              optional Service descriptors
├── prompts/
├── skills/
├── references/
├── scripts/
└── assets/
```

`flow.ts` is visually obvious, but `.ts` never chooses Deno, Bun, or Node. The
declared Runtime Profile does.

### 3.2 Closed frontmatter

The common Run-capable form is:

```yaml
---
flow: 1
name: gauntlet-loop
description: >
  Build and improve an inspectable artifact through implementation,
  evaluation, and revision.

# Required only when a root implementation exists. This is a FLOW profile,
# not a requested Deno binary version or version range.
runtime: deno@1

# Valid only when both package and project explicitly permit instruction mode.
fallback: instruction

# Structured capabilities consumed through effect/call.
uses:
  agent:
    contract: https://flow.dev/contracts/agent
    version: 1.0.0
    digest: sha256:...

outcomes:
  blocked: Progress requires external input.

# Exact logical filesystem need and ceiling. Host paths belong to Bindings.
attachments:
  source: read
  output: read-write
---
```

A Service-capable package uses the same small vocabulary, adds `service` and
`provides`, and omits Run-only `fallback` and `outcomes`:

```yaml
---
flow: 1
name: session-store
description: Provide long-lived structured access to stored Agent sessions.
runtime: node@1
service: 1
uses:
  database:
    contract: https://example.org/contracts/database
    version: 1.0.0
    digest: sha256:...
provides:
  sessions: ./contracts/session-store.flow-service.json
attachments:
  state: read-write
---
```

Required fields are only `flow`, `name`, and `description`. The other fields
are optional, but their shapes are normative. Unknown unnamespaced fields are
errors; `x-*` fields are inert extensions. Frontmatter uses the JSON data model
subset of YAML 1.2. Duplicate keys, tags, aliases, anchors, merge keys, and
implementation-specific scalar types are rejected.

These two forms comprise the complete v1 field vocabulary. Each portable
`uses` entry is the exact contract URI/version/digest triple. Only a
Service-capable consumer may set `binding: dynamic`; static is the default. A
project-only package may instead mark a slot `local: true`, which is an
explicit non-portability claim. These forms are mutually exclusive. Every
`provides` entry is a safe package-relative path to one exact descriptor.

A code-backed package names exactly one immutable FLOW-owned Runtime Profile.
The profile is a closed scalar, not a URI bundle, binary version, command,
arguments array, or alternatives list. An instruction-only package has no
`runtime` field. Its token matches
`[a-z][a-z0-9-]{0,31}@[1-9][0-9]{0,8}`. A malformed token is an invalid
package; a well-formed profile which the local host does not know or implement
remains inertly discoverable and fails activation with `RUNTIME_UNAVAILABLE`.

A package with `service: 1` is Service-capable and requires an exact
implementation. A package without it is Run-capable. V1 has no dual-mode
package and does not interpret a Service from Markdown. One Binding records the
mode derived from the exact package and cannot reinterpret it. `fallback` and
`outcomes` are Run-only; `service` and `provides` are Service-only.

`name` and every authority- or protocol-bearing local key—`uses`, `provides`,
`attachments`, custom `outcomes`, catalogue IDs, Binding IDs, Service methods,
and named Service errors—use `LocalName`: a 1–64 character lower-ASCII slug
matching `[a-z0-9]+(?:-[a-z0-9]+)*`. Custom outcomes may not use the reserved
`done`, `failed`, `cancelled`, or `error` names. Local names are opaque keys;
hosts assign mount paths and internal IDs instead of concatenating them into a
filesystem path. Package `name` remains a friendly label, not global identity.
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
identity. It may be selected only before dependency preparation. Jig never
falls back because a schema, lock, preparation, launch, protocol exchange, or
effect failed, nor after exact code started.

### 3.4 Schemas are values, not shared files

The three conventional schema files describe per-Run input, per-Binding
settings, and the complete normal Run result. They are never shared runtime
mailboxes.

Schema use is concrete:

- validate the actual input sent to a candidate;
- validate one complete settings value at Binding activation;
- validate the returned `{ outcome, output }` value as one correlated result.

Run-capable packages may contain all three files. Service-capable packages may
contain only `settings.schema.json`; `input.schema.json` or
`result.schema.json` is a package error because Service Contract/1 owns method
values. Their exact absence semantics, closed Schema/1 dialect, evaluation
limits, error form, and examples are specified in
[`../spec/schema-files.md`](../spec/schema-files.md). Jig performs no schema
subtyping, coercion, default insertion, property stripping, or remote schema
resolution.

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
digests. A Runtime Runner records any executable mode needed by its prepared
layer in activation provenance, never in package identity. Source executable
bits and a shebang, if present, are inert package bytes and never select or
parameterize the portable launcher.

An installed revision is identified by:

```text
resolved source URI + component subpath + source revision + package digest
```

Git, npm, OCI, local folders, and indexes are source adapters. An index helps
discovery; it is neither a namespace authority nor a trust root.

## 4. FLOW Runtime Profiles

### 4.1 Why one small runtime declaration exists

A file suffix cannot distinguish Deno semantics from Bun or Node-with-tsx.
A shebang is not the portable answer: POSIX leaves files beginning with `#!`
unspecified, and a shebang reintroduces package-controlled launcher arguments,
PATH lookup, and host-specific behavior.

The package therefore declares one **exact Runtime Profile** such as
`deno@1`. It does not declare a binary, binary-version range, command, argv
array, shell string, provider, or alternatives list.

### 4.2 Immutable profiles, native locks, and exact local activation

A Runtime Profile revision is a small FLOW-owned conformance target. The
initial intended registry is `deno@1`, `bun@1`, `node@1`, `node-tsx@1`,
`python@1`, and `native@1`; a profile enters the standard only with its
normative fixtures. The suffix is the profile revision—not a Deno, Node,
Python, or package-manager version. Profile revisions are immutable except for
non-semantic errata.

Each profile fixes only observable portable behavior:

```text
admitted root suffix/artifact and native manifest/lock forms
minimum language, module-resolution, runtime API, and flag surface
candidate binary/toolchain probe and eligibility algorithm
entrypoint, package root, cwd, argv, environment, stdio, and framing
dependency fetch/preparation and offline-launch rules
runtime-level defense-in-depth permission mapping
cancellation, descendants, exit status, and diagnostics
black-box fixtures and expected results
```

An observable addition that an older Runner could reject requires a new
profile revision. A newer Runner may also claim an older profile only by
passing that older profile's complete fixtures. A candidate host toolchain is
eligible only when the profile's probe and fixture suite establish the exact
baseline; a Runner cannot substitute “some Deno” or “some Python.” Package
tooling checks implementations against that same target. This provides a
stable authoring surface without asking authors to guess host binary versions.
A host may support any subset and returns `RUNTIME_UNAVAILABLE` for the rest.

Dependency resolution belongs to native committed files, not FLOW metadata.
Every profile admits a closed set of manifests and exactly one lock form for a
package revision. When external dependencies exist, the admitted lock is
required and launch is offline/frozen. In the intended `@1` profiles:

```text
deno       deno.json or deno.jsonc when needed + deno.lock
bun        package.json + bun.lock
node       package.json + package-lock.json
node-tsx   package.json + package-lock.json, with local locked tsx
python     pyproject.toml when needed + pylock.toml
native     one prebuilt platform-specific root artifact; no activation build
```

The normative profile fixtures, rather than this overview, settle each file's
exact optionality and supported format revision. A manifest is not a lock.
Ambient caches, global packages, version-manager state, and a lock generated at
activation are never portable dependency resolution.

A trusted Runtime Runner implements one or more exact profile revisions. It
may probe trusted host toolchains and parse package metadata, but it only emits
bounded validation, preparation, and shell-free launch plans. It never spawns
a process which consumes package-controlled bytes. The package cannot inject
argv or select the Runner.

Portable preparation has two fixed phases:

```text
FETCH
    a trusted host fetcher accepts only profile-admitted schemes/registries,
    uses no ambient credentials, rejects local/private redirects, verifies
    every lock integrity/content digest, and stores only bounded verified
    opaque blobs in CAS

BUILD
    the Sandbox Backend performs archive extraction, dependency-tree
    materialization, and every package-influenced preparation tool with
    package/blobs read-only, staging write-only, and no Run roots, secrets,
    raw network, ambient environment, or effect slots
```

Package lifecycle scripts, source builds, native-addon builds, and Python build
backends are disabled in portable v1. A package needing one fails with
`PREPARATION_AUTHORITY_REQUIRED`; a separately trusted exact-digest local path
may exist but makes no portable claim. Preparation follows
`PREP_INTENT -> FETCHING -> BUILDING -> VERIFIED -> PUBLISHED`, uses atomic
content-addressed publication, and never launches from a partial or
indeterminate layer. Extraction rejects absolute/traversal paths, unsafe
symlink or hard-link behavior, case/Unicode collisions, expansion bombs, and
special files. Before `VERIFIED`, the complete prepared closure passes the
same canonical safe-tree and regular-tree checks as package attachments,
except for an exact artifact type explicitly admitted by the Runtime Profile.

Activation pins local facts which the author neither knows nor controls:

```text
package, entrypoint, native manifest, and lock digests
Runtime Profile and exact Runner module/code identity
actual runtime binary/toolchain path, version, fingerprint, and probe result
platform and relevant version-manager selection inputs
preparation policy, transaction, provenance, and prepared-layer digest
normalized preparation and launch-plan digests
completed preparation receipts
Run/Service authority and launch plans plus selected Sandbox Backend revision
```

Future Run and Mount receipts cannot exist at apply time. Each owner records
its own realized receipt only after `SPAWN_INTENT`, seal, and containment, and
revalidates every pinned launch input. A missing kernel feature or changed root
therefore fails that owner rather than reusing historical enforcement evidence.

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

Every frame and portable value uses the bounded
[`FLOW JSON/1 model`](../spec/json-values.md).

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
execution, not graph merging. Parent settings, attachments, slots, and grants
do not inherit implicitly.

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

`result.schema.json` validation occurs before owner success commits.

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

Services use request/response methods, snapshot plus `changes-since`, bounded
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
        "not-found": { "$ref": "#/$defs/NotFound" }
      }
    }
  },
  "$defs": {
    "ReadInput": {
      "type": "object",
      "properties": {
        "sessionId": { "type": "string", "minLength": 1, "maxLength": 128 }
      },
      "required": ["sessionId"],
      "additionalProperties": false
    },
    "Session": {
      "type": "object",
      "properties": {
        "sessionId": { "type": "string", "minLength": 1, "maxLength": 128 },
        "title": { "type": "string", "maxLength": 4096 }
      },
      "required": ["sessionId", "title"],
      "additionalProperties": false
    },
    "NotFound": {
      "type": "object",
      "properties": {
        "sessionId": { "type": "string", "minLength": 1, "maxLength": 128 }
      },
      "required": ["sessionId"],
      "additionalProperties": false
    }
  }
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
{ "value": { "sessionId": "s-1", "title": "Example" } }
{ "error": { "name": "not-found", "data": { "sessionId": "s-1" } } }
```

JSON-RPC errors are reserved for protocol, validation, authority, cancellation,
capacity, and provider-loss failures.

Embedded value schemas use the closed Schema/1 keyword and evaluation profile
specified in [`../spec/schema-files.md`](../spec/schema-files.md), except that
an embedded schema does not repeat the file-root `$schema` declaration.
Descriptors are inert and resource-bounded before provider code loads.

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
      from: factoryCandidates,
      onMissing: "fail",
    }),
  },
  attachments: {
    source: root("./project"),
    output: root("./results"),
  },
  fallback: "deny",
});
```

The normalized Binding contains:

```text
exact package revision
one complete settings value
exact slot bindings or explicit discovery policies
exact mappings for every package-declared attachment name
derived attachment grant and mediated-effect authority
exact instruction-runtime and Agent Bindings when instruction execution is possible
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
optional Semantic Resolver implementation, its complete configuration, and
every Agent/effect Binding it uses belong to normalized project desired state
and the activation digest. No active resolver acquires a host-default Agent.

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
the package has no settings schema, only `{}` is legal. Packages do not gain an
undeclared configuration channel.

### 8.2 `jig.ts`

The default project frontend is one `jig.ts`, split through ordinary imports as
the project prefers. A bare generated project explicitly opts into the
progressive-disclosure convention instead of relying on kernel magic:

```ts
import { catalogue, defineJig } from "jig";

const flows = catalogue.directory("./flows");

export default defineJig({
  catalogues: { flows },
});
```

A larger application may add exact Bindings, Hooks, and trusted modules:

```ts
export default defineJig({
  catalogues: { flows },
  bindings: {
    "strict-review": strictReview,
    sessions,
  },
  hooks: [onInboxItem],
  modules: [events, services, agents, semanticRouter],
});
```

This is a trusted authoring frontend, not the runtime source of truth. Jig first
captures an immutable candidate containing the entry source, every statically
resolved local import, the exact dependency lock and selected package
artifacts, and the trusted evaluator/loader module and toolchain. It copies and
hashes that closed import graph, verifies observed sources did not change during capture,
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
choices, source revisions/digests, contract descriptors, candidate-set
snapshots and their exact members, and authority evidence. Host-specific
runtime binaries, sandbox reports, and live identities belong to the immutable
local activation under `.jig/`. Projects may create
`agents/`, `hooks/`, `inbox/`, `kanban/`, or any other folders, but Jig does
not assign them implicit semantics.

### 8.3 Inert catalogues and reviewed bulk materialization

`catalogue.directory("./flows")` inspects only immediate child directories
containing exact-case `FLOW.md`. The scan is bounded, stable-snapshot based,
and does not follow symlinks. It **parses** only Package/1 metadata and schema
files, but the canonical snapshotter streams and hashes every admitted regular
file—including implementation, prompt, skill, reference, script, and asset
bytes—before an entry identity exists. Mutation during capture retries; an
unread or provisional digest can never become a candidate. Discovery never
imports code, resolves dependencies, prepares, binds, grants, mounts, or runs a
package.

Catalogue entry identity is:

```text
(catalogue root ID, canonical safe relative package path, package digest)
```

Friendly `name` and `description` are display and model input only. Duplicate
names may coexist and are always shown with path and digest. A root change,
path move, or content change creates a different entry; a path move is removal
plus addition.

Explicit Bindings remain the simplest and safest default. For a large,
structurally uniform collection, a configuration helper may expand one inert
catalogue snapshot and one closed recipe into ordinary exact Bindings:

```ts
const factoryCandidates = bindings.fromCatalogue(flows, {
  mode: "run",
  membership: "review",
  settings: {},
  satisfy: {
    "https://flow.dev/contracts/agent@1.0.0#sha256:...":
      agents.factoryWorker,
  },
  allowedAttachments: {
    workspace: {
      root: root("./workspace"),
      maxAccess: "read-write",
    },
  },
  instruction: {
    agent: agents.factoryWorker,
    fallback: "deny",
  },
});
```

This helper is an authoring-time materializer, not a runtime Binding type,
profile, inheritance layer, or permission grant. For each exact member:

1. the package declaration determines the exact attachment and `uses` names;
2. the recipe may supply a root/provider only for a requested name and only
   within its stated ceiling;
3. the emitted Binding exposes exactly the requested access mode and declared
   slots—never a surplus recipe entry or stronger/weaker access;
4. an instruction Agent or fallback is emitted only when that exact member's
   selected implementation requires or declares it, never merely because the
   recipe can supply one;
5. settings, fallback, instruction Agent, repair policy, and budgets must be
   complete and valid; otherwise that member remains pending.

The expansion proposes a finite immutable **candidate-set snapshot** recording
the recipe digest, catalogue snapshot, every accepted entry identity, every
complete materialized Binding digest, and explicit exclusions. It is contained
in the project's one admission generation rather than creating another
lifecycle-generation concept. Review may be batched, but it shows every member
and authority delta. Additions, removals, moves, digest changes, requirement
changes, and recipe changes are all pending deltas; `check --locked` and
`apply --locked` reject any delta.

Until an accepted apply, the old project admission generation, candidate-set
snapshot, and immutable package snapshots remain active. After apply, new
owners pin the new project generation while existing owners retain the old
one. Runtime resolution reads only the candidate-set snapshot reached through
its owner's pinned project generation—never the live catalogue. This lets an
approved workflow collection grow without editing each parent Flow, while
ensuring that dropping a file into `flows/` grants no authority by itself.

## 9. Effects, events, Hooks, and Agents

These terms are deliberately not interchangeable:

| Boundary | Meaning |
|---|---|
| Run input, Binding settings, attachment handles, deadline, and budget | Immutable invocation environment; “coeffects” in theory, but not a second public API. |
| `effect/call` and `flow/call` | Explicit requested operations whose results influence execution. |
| Journal Event | Durable immutable fact which may trigger later work. |
| Hook | Inert exact Event-to-Flow admission policy. |
| `stderr` diagnostic | Bounded operational text which never drives portable behavior. |

This is why Run/1 has no ambiguous `flow/event` method and why durable facts
were not renamed “telemetry.” Telemetry, if standardized later, remains lossy
observation; an Event is something applications may intentionally react to.

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
an optional, powerless ranking module. Fault tolerance does not depend on an
LLM: missing, incompatible, unavailable, and ambiguous dependencies always
have explicit durable states. Semantic reasoning improves open-ended choice;
it does not create those states or authority.

Child-Flow candidates are configured, approved Run-capable Binding
revisions—not raw packages. Package descriptions may support inert catalogue
retrieval, but an installed package without settings, attachments, slot
policy, grants, and admission never becomes executable by discovery alone.

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
installation, network, filesystem, or grant authority, receives bounded exact
Binding IDs and descriptions in a fixed envelope, and may return only an
allowlisted ID. Its implementation revision, configuration, and exact Agent or
effect Bindings are activation-pinned project state. Jig records the candidate
set, evidence, model/provider, and result.

Semantic ranking is itself a journaled child operation, never invisible
middleware. Resolution intent freezes the exact ordered candidate IDs and
their digest. The ranker operation key is deterministically derived from the
parent operation and that digest; its dispatch and result use the same
operation ledger and uncertainty rules as any external effect. The terminal
ranker result commits before, or transactionally with, the parent's one
resolution compare-and-set. After a crash:

```text
ranker never dispatched       dispatch that recorded operation once
ranker result committed       finish selection with that exact allowlisted ID
dispatch happened but result cannot be proven
                              mark the parent operation UNCERTAIN; never rerank
```

Provider loss after selection but before child dispatch fails that parent
operation and does not choose a replacement under the same `operationId`.
Thus a retry neither double-spends an Agent turn nor changes the selected
authority-bearing Binding.

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

There are two intentionally different semantic-choice patterns:

```text
local Router
    one runner-owned decision among a finite allowlisted route table;
    the model returns only a local route ID and code maps it to an edge or
    exact child slot; it may decide again on a later graph visit

open-ended flow/call
    one stable discovery slot backed by a candidate-set snapshot in the
    owner's project admission generation;
    the kernel filters its exact approved Bindings, the optional Semantic
    Resolver ranks them, and the operation pins one result once
```

A software factory can therefore route a new ticket among Gauntlet,
Majority-Vote, or any later reviewed member without hard-coded keywords. It
uses a local Router when that choice is part of its internal topology, or an
open-ended `flow/call` when any approved implementation may satisfy an intent.
Caskada's `Router` owns the first problem; Jig's Resolver owns the component
boundary. Neither impersonates the other.

## 11. Security and trust

### 11.1 Trust classes

Jig distinguishes:

```text
untrusted package implementation/instruction
trusted project configuration and host extensions
trusted Runtime Runner and Sandbox Backend
bound external capabilities with explicit contracts/grants
```

Trust is always attached to an exact digest and recorded. Discovery is inert.
Indexes and friendly names never grant trust.

### 11.2 Deno-like authoring, backend-honest enforcement

Package `attachments` declare the complete portable filesystem need and its
ceiling using only logical names and `read` or `read-write`. A Binding must map
exactly those names to approved roots. It may neither omit one, add an
undeclared root, nor alter the mode. `read-write` includes read; there is no
write-only mode, optional raw attachment, wildcard, or unrestricted shorthand.

The implicit portable baseline is:

```text
exact package and prepared runtime closure      read-only
private per-owner scratch                       read-write
protocol stdio                                  open
application environment                         empty except fixed FLOW fields
extra file descriptors and host IPC             denied
raw network and child-process authority         denied
```

Agent, Git, HTTP, database, secrets, tools, and changing configuration cross
separately bound mediated `effect/call` slots. Settings are inert Binding data.
Runtime-native permission flags, such as Deno's, are generated from the same
plan as defense in depth; the outer Sandbox Backend remains authoritative.

An attached `root()` is normatively a **regular-tree view**: regular files and
directories, plus symlinks which resolve inside that root. It contains no
device nodes, pathname sockets, or host-connected FIFOs. A one-time scan plus a
mutable bind is insufficient. A Backend must use an immutable snapshot,
filtering broker, or race-safe MAC mediation; otherwise the Binding is
incompatible. This prevents a “read-only” tree from becoming an undeclared IPC
or device channel.

Authority is visible in four separate records:

```text
requested   exact package attachment names/modes and declared effect slots
granted     exact Binding root mappings and provider bindings
planned     closed Runtime/Sandbox predicate plan before preparation or spawn
realized    immutable per-owner enforcement receipt after containment
```

The planned and realized records cover package/root visibility, write access,
regular-tree realization, environment, inherited descriptors, network and
local IPC denial, descendants, resource limits, cancellation, containment
persistence, and cleanup/fencing support. Raw containment predicates have only
these live states:

```text
plan       enforceable | unavailable
receipt    enforced
```

`advisory` may appear only in a rejected diagnostic. `mediated` belongs only
to the separate exact effect-slot/provider list; a FUSE broker, namespace,
seccomp rule, or runtime-native restriction is enforcement evidence rather
than a weaker status. Every raw predicate in an untrusted live receipt must be
`enforced`, or launch fails `PERMISSION_UNENFORCEABLE`.

The Sandbox Backend is trusted host infrastructure, not a Flow, Starter
feature, Binding choice, or Runtime Runner. It alone executes and supervises
every process which may consume package-controlled bytes—including exact Flow
and Service code, instruction conductors, Starter initializers, restricted
configuration evaluators, and preparation tools. Its interface is:

```text
probe/plan    prove whether one immutable authority and launch plan is realizable
seal          establish a single-use containment target and fixed inputs
spawn         start exactly that target and return enforcement evidence
terminate     fence and end the complete target tree
dispose       clean host-owned resources and report failures
```

The Runner plans; the Backend spawns. Trusted pure host parsing and bounded
opaque-blob fetching may occur without a child process, but remain journaled
preparation steps. Archive extraction and materialization of attacker-chosen
bytes occur only in sandboxed BUILD and undergo the safe-tree checks in section
4. Preparation has its own narrower plan and receipt and can never widen the
later Run grant.

There is no dishonest universal multi-platform sandbox. A Linux Backend may
compose bubblewrap, namespaces, Landlock, seccomp, cgroups, pidfds, and a
regular-tree broker. Those names are mechanisms, not proof. A different
platform either satisfies the same black-box predicates or rejects the
untrusted activation. An exact-digest trusted local override records every
wider authority and is explicitly nonportable and unconfined.

The instruction conductor receives the same outer grant plus a tool-limited,
fresh Agent session with no ambient project, secrets, plugins, or provider
session. If the provider cannot be constrained, instruction execution is
trusted or unavailable, never falsely isolated.

### 11.3 Authority and fencing

One Jig coordinator owns an exclusive project lease and monotonic epoch. Runs,
Mounts, registrations, operations, sandboxes, and attachment write leases are
fenced to it.

Before any OS spawn, Jig atomically commits:

```text
owner lifetime ID
coordinator epoch
deterministic Backend container ID
SPAWN_INTENT
all conflicting attachment write leases
```

The Backend then creates only that single-use container. It must either die
with the coordinator or remain durably enumerable by that exact container,
cgroup, job, or service-manager identity—never a reusable bare PID. After
containment succeeds Jig commits the per-owner receipt and transitions
`SPAWN_INTENT -> LIVE`; only then may it send `flow/run`, admit Service traffic,
or release preparation output.

Confinement must persist if Jig or the protocol channel dies; immediate
parent-death termination is an optional stronger Backend feature. On restart,
admission stays closed while Jig reconciles database spawn intents with every
old-epoch Backend container, revokes effect channels, classifies unresolved
dispatched effects as uncertain, and kills or quarantines stale trees. Write
leases remain closed until cleanup is proven. An unknown container blocks
recovery instead of being assumed dead.

Service invocation additionally validates the exact live consumer binding,
registration generation, contract/method, schemas, grants, deadline, and
budget before provider application code sees it.

### 11.4 Host policy and inspection

Machine mechanism preferences live in one optional, closed, inert JSON file at
the platform's normal Jig user-config location, outside every project:

```json
{
  "jigHost": 1,
  "sandboxBackends": ["org.jig.linux-bwrap-landlock"],
  "runners": {
    "deno@1": ["org.jig.deno-system"],
    "node-tsx@1": ["org.jig.node-tsx"]
  },
  "initAgent": "local.codex"
}
```

There are no includes, merges, environment substitutions, project overlays,
or partial CLI overrides. Unknown fields fail. Unknown operational module IDs
in `runners` or `sandboxBackends` fail the command which needs them. For one
profile, Jig tries the listed installed conforming Runners in order. If no list
is present, exactly one installed conforming Runner may be selected; zero is
`RUNTIME_UNAVAILABLE` and more than one is `RUNTIME_AMBIGUOUS`. Selection is
never semantic. Activation pins the exact Runner module, binary, probe, and all
selection inputs.

`sandboxBackends` similarly orders only trusted installed mechanisms capable
of realizing the fixed plan. If the field is absent, exactly one installed
conforming Backend may qualify; zero is `SANDBOX_UNAVAILABLE` and more than one
is `SANDBOX_AMBIGUOUS`. A Starter cannot select or weaken one. Wrapping all
Flows with bubblewrap/Landlock is therefore a normal Backend policy, not a
wrapper Flow which would be too late to confine its own parent.

`initAgent` is merely a suggestion shown during `jig init`. If accepted, the
exact Agent becomes reviewed project Binding state. It is never consulted by
`check`, `apply`, a Semantic Resolver, or an active Run. The activation-policy
digest includes operational Runner and Sandbox choices which affected it, but
excludes `initAgent`. An unknown or unavailable suggestion is reported only by
`jig init` and cannot invalidate unrelated inspection, checking, or execution.

Inspection is part of the security interface:

```text
jig apply --plan --json
jig inspect binding <id> --authority --json
jig status run <id> --authority --json
jig status service <id> --authority --json
```

Their structured output separates requested, granted, mediated, planned, and
realized authority so users and policy tooling can see what a component asked
for, what was mapped, and what the host actually enforced.

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
Runtime Runners
Sandbox Backends
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
application Agent roles, limits, and selection policy
semantic/missing-Flow repair policy
```

Core supports:

```text
jig init --bare
jig init --from <starter>
```

A selected Starter may run its own reviewed initializer and ask whether to add
an Agent Binding, Semantic Resolver, `create-missing-flow`, Git/worktrees, an
inbox, or a GUI. Those are application choices. Runtime Runner and Sandbox
Backend preferences remain in host policy and never become Starter output.
`jig init` may report whether the copied project is satisfiable on this host and
offer the host's `initAgent` suggestion, but acceptance materializes an exact
project Binding in the staged diff. The resulting files are copied once and
fully user-owned. Jig has no universal feature matrix, Starter composition,
inheritance, host overlay, or hidden ongoing dependency.

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
RUNTIME_AMBIGUOUS            PREPARATION_AUTHORITY_REQUIRED
SANDBOX_UNAVAILABLE          SANDBOX_AMBIGUOUS
BINDING_MISSING              BINDING_AMBIGUOUS
INVALID_JSON                 INVALID_PACKAGE
INVALID_INPUT                INVALID_SETTINGS
INVALID_RESULT               SCHEMA_LIMIT_EXCEEDED
SCHEMA_INVALID_JSON          SCHEMA_KEYWORD_UNSUPPORTED
SCHEMA_REFERENCE_INVALID
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
| `deno@1` package on a Bun-only host | Runtime mismatch; no preparation or launch. |
| Package requires `deno@2`; host claims only `deno@1` | `RUNTIME_UNAVAILABLE`; no closest-profile substitution. |
| Two Runners qualify without a host preference | `RUNTIME_AMBIGUOUS`; enumeration order is irrelevant. |
| Lock is absent, mutable, or needs a lifecycle/source-build script | Preparation fails before launch; no ambient package manager is used. |
| Several eligible children without a ranker | Explicit ambiguity with candidates and reasons. |
| New package appears in a live catalogue | It is inert and pending; no active semantic candidate until reviewed apply. |
| Missing child | Durable diagnostic; optional staged bounded repair; never invisible generation. |
| External success cannot be established after crash | `OPERATION_UNCERTAIN`; no automatic replay. |
| Owner returns with a live child | Admission closes; child receives `OWNER_CLOSED`; owner cannot succeed before bounded quiescence. |
| Root cancellation | New authority closes, descendants cancel, process tree is bounded and killed. |
| Provider disappears and returns | Old binding is lost; return has a new generation; no healing. |
| Backend cannot enforce requested confinement | Untrusted activation fails; trusted override states wider authority. |
| Attached root contains or gains a socket, FIFO, or device | Backend filters/snapshots it or rejects the Binding; a mutable raw bind is insufficient. |
| Hook delivery repeats | It resolves to the same derived Run. |
| Upstream conflicts with local edits | Candidate stays staged and old source/activation remain usable. |
| Required setting is absent | Binding normalization fails; implementation never starts and environment cannot fill it. |
| Package requires callbacks/subscriptions | `UNSUPPORTED_PROFILE` before launch. |

Release order:

1. **Package/1:** safe metadata parser and identical canonical tree digest from
   Git/npm/OCI/local fixtures.
2. **Schema/1:** at least two validators agree on the complete keyword corpus,
   local references, JSON/1 boundary numbers and Unicode, exact structural and
   work limits, instance validity, and stable error locations for all three
   fixed schema files and Service embedded schemas.
3. **Runtime Profiles:** two independent Runners for at least one exact
   Runtime Profile produce equivalent validation, preparation-plan, launch,
   permission, cancellation, and exit behavior; unsupported profiles fail
   explicitly.
4. **Run/1:** a Jig host, an independent host, Caskada, and a non-TypeScript
   component agree on framing, child/effect calls, cancellation, duplicate
   operations, uncertainty, and outcomes.
5. **Security:** package/config extraction attacks, instruction-Agent attacks,
   direct and transitive I/O escapes, orphan processes, forged owner IDs,
   stale coordinator epochs, ambient environment/module-cache variation,
   inherited descriptors, undeclared descendants, attachment/grant widening,
   special-file insertion, kill injection around spawn-intent/receipt commits,
   preparation archive traversal/links/special files/expansion bombs,
   redirects/scripts/source builds, hostile or colliding LocalNames, and false
   enforcement reports fail closed.
6. **Resolution:** catalogue collisions, symlink escapes, additions, removals,
   moves, content/recipe changes, candidate-set snapshot changes, semantic
   ranker kill injection before and after external dispatch, reranking retries,
   and missing repair never change an owner's exact candidates or authority
   without the specified review and atomic commit.
7. **Service Contract/1:** independent TypeScript and Python clients/providers
   agree from the descriptor alone on methods, values, errors, validation,
   canonicalization, and equivocation.
8. **Service/1:** a plain provider, Cordis realm, Jig host, and independent host
   agree on pending-Mount ownership, owner-return quiescence, readiness,
   concurrent invoke/removal races, status retransmission, exact dynamic
   binding snapshots, loss/reappearance, update drain, cycles, cancellation,
   EOF, and crash fencing.
9. **Events/Hooks:** two independently implemented hosts' native canonical
   Journals survive kill injection at every append/receipt boundary with one
   Event and outer operation result; external effects retain generic
   uncertainty and are never replayed; protected sources/types cannot be
   forged; Hook revision intervals remain exact across concurrent Event commits
   and activation, and each selected pair creates one derived Run record—even
   `INVALID_INPUT`—when dispatch cannot succeed.
10. **Reconciliation:** kill injection at capture, preparation, candidate Mount,
   source switch, admission switch, update merge, and rollback recovers one
   matching visible-source/admission generation before new work; committed or
   uncertain candidate effects remain explicitly visible rather than being
   described as rolled back.

The standard makes separate claims:

```text
FLOW Package/1
FLOW Runtime Profile/<id> Runner
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
range or closest-match inference for Runtime Profiles or Service contracts
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
- [Deno configuration and lock documentation](https://docs.deno.com/runtime/fundamentals/configuration/),
  [npm lock/install semantics](https://docs.npmjs.com/cli/install/),
  [Bun's text lockfile](https://bun.sh/docs/pm/lockfile), and
  [Python `pylock.toml`](https://packaging.python.org/en/latest/specifications/pylock-toml/)
  as native dependency-lock inputs rather than a new FLOW package manager.
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
