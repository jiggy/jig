# Jig + FLOW: reviewed architecture

**Status:** reviewed architecture draft. Stable labels and implementation
claims remain conditional on the interface and
conformance gates in section 15.

This design is the result of repeated adversarial review and refutation. It deliberately
keeps the ambitious parts of Jig, but it refuses to make a portable claim for a
mechanism that does not yet have a complete ownership, failure, and authority
model.

## 1. The architecture in one view

```text
FLOW Package/1
    inert, inspectable package: FLOW.md plus zero or one implementation

FLOW Run/1
    small finite-invocation protocol

FLOW Service/1 + Capability Contract/1
    separately conforming lifecycle target for long-lived JSON services

Jig
    project host: activation, resolution, scheduling, effects, security,
    journals, reconciliation, and user-owned policy

Jig Runtime Adapter + Sandbox Backend
    trusted host machinery which plans and confines source execution
```

`Package/1`, `Run/1`, `Capability Contract/1`, and `Service/1` are intended to
have separate conformance labels. `Service/1` is a first-class design target,
not a tax on a Run-only host; its stable label awaits closed wire schemas and
independent conformance.

Sley, Cordis, an imperative Python program, and an Agent instruction runner
are intended reference integration shapes behind these boundaries. None would
receive a privileged Jig execution path.

The intended implementation package names are deliberately not protocol
identities:

```text
Jig TypeScript package       @jigging/jig
Sley TypeScript runtime      @jigging/sley
Sley Python dist./import     sley
FLOW TypeScript SDK          @flowmd/sdk
FLOW Python distribution     flowmd-sdk
FLOW Python import           flowmd_sdk
```

TypeScript and Python SDKs project Run/1 and will eventually project Service/1
without creating another wire layer. Run/1 now has private `0.0.0` candidate
declarations and implementations under the selected minimal semantic
vocabulary; they are not published or stable until the remaining conformance
gates close. Service/1's SDK remains unclosed. Earlier design drafts used
Caskada v3 and then Spindle for the graph runtime. The current name is Sley.

The governing laws are:

1. A runtime owns its private control flow and continuation.
2. Jig owns external authority, binding, durable host state, and process
   lifetime.
3. FLOW standardizes the component boundary, not graphs, plugins, tasks, GUIs,
   Git, or an application ontology.
4. A Flow performs finite work. A Service supplies a stable multi-operation
   interface.
5. Flows may be selected by intent; public capabilities match exact contracts.
6. Semantic reasoning may rank eligible candidates. It may not establish
   compatibility, trust, permission, or completion.
7. Every component operation belongs to one live inbound lifetime; Run/1 has
   one implicit root, while a multiplexed profile must define attribution.
8. Request IDs correlate wire exchanges only; host-internal lifetime IDs own
   durable records and cleanup.
9. Every Run and Mount pins immutable package, configuration,
   Adapter/toolchain, provider, and authority revisions.
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
| **Binding** | One immutable admitted project-local use of an exact package or host-capability implementation. |
| **Event** | An immutable fact committed to a durable journal. |
| **Hook** | Inert Jig policy selecting one exact authenticated producer/type pair and starting one Flow from each committed fact. |
| **Scope** | Jig's internal lifetime/cleanup tree; not an authored or wire object. |
| **Runtime Adapter** | Explicitly installed trusted host code which validates and plans one source runtime. |
| **Sandbox Backend** | Host mechanism which alone prepares, spawns, supervises, and confines package-controlled processes. |

There is no public `Task`, `Work`, `Worktree`, remote `Context`, arbitrary
`Scope`, runtime-binary range, graph schema, callback handle, or distributed object
model in v1.

The author-facing ownership is deliberately asymmetric:

| Layer | Owns | Does not own |
|---|---|---|
| **FLOW** | Package, finite Flow Run, long-lived Service, effect/Flow calls, optional Capability Contract | Agent, graph, Hook, provider choice, application ontology |
| **Jig** | Project admission, Binding, Event Journal, Hook admission, deterministic resolution, Agent contracts, Runtime Adapter and Sandbox coordination | A Flow's private control graph or application entities such as tickets and boards |
| **Sley** | Function nodes, links, Flows, shared state, branch input, emit/end, fan-out/combine, retries, recovery, and graph inspection | Semantic route contracts, Agent policy, durable Journal, package installation, or sandbox policy |
| **Starter/application** | Concrete Flows, logical Agent roles, Bindings and authority, Hooks, inbox/Kanban/Git/GUI policy | New privileged kernel semantics |
| **Host/operator** | Installed Agent/source/provider integrations, Runtime Adapters, Sandbox Backends, trust and machine preference | Application routing or Flow procedure |

The host supplies a concrete Agent integration; the Starter declares logical
Agent Bindings and their ceilings; Jig pins and mediates them; Jig Graph
compiles Agent use and semantic routing to ordinary Sley nodes. Producers such
as watchers, webhooks, and timers live in application code, protected host
machinery, or FLOW Services and publish through the Journal. Hooks only admit
their facts into Runs.

The candidate [`Run SDK/1`](../spec/run-sdk.md) exposes the fixed `flow/run`
projection and only its two outbound call operations. It is not a service
locator or remote object.

## 3. FLOW Package/1

### 3.1 Package shape

Only `FLOW.md` is required. An exact implementation adds exactly one regular
root file named `flow.<single-suffix>`, where the suffix is one 1–16 character
lower-ASCII alphanumeric segment.

```text
gauntlet-loop/
├── FLOW.md
├── flow.ts                 optional; exactly one root implementation
├── input.schema.json       optional fixed convention
├── settings.schema.json    optional fixed convention
├── result.schema.json      optional fixed convention
├── contracts/              optional consumed/provided capability descriptors
├── prompts/
├── skills/
├── references/
├── scripts/
└── assets/
```

`flow.ts` is visually obvious, but `.ts` never chooses Deno, Bun, or Node. A
trusted host Runtime Adapter does.

### 3.2 Closed frontmatter

The common Run-capable form is:

```yaml
---
name: gauntlet-loop
description: >
  Build and improve an inspectable artifact through implementation,
  evaluation, and revision.

# Valid only when both package and project explicitly permit instruction mode.
fallback: instruction

# Structured capabilities consumed through effect/call.
uses:
  agent:
    contract: ./contracts/agent-run.capability.json

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
name: session-store
description: Provide long-lived structured access to stored Agent sessions.
service: 1
provides:
  sessions: ./contracts/session-store.capability.json
attachments:
  state: read-write
---
```

Required fields are only `name` and `description`. The exact-case `FLOW.md`
entrypoint already identifies Metadata/1, so v1 has no redundant `flow: 1`
field. Every document valid today retains Metadata/1 semantics permanently;
any future core vocabulary or semantic change must introduce a discriminator
which old closed parsers reject. The other fields are optional, but their
shapes, UTF-8/frontmatter grammar, and parser ceilings are normative. Unknown
unnamespaced fields are errors; exact `x-<LocalName>` fields are inert
extensions and can never gain Metadata/1 core meaning.

These two forms comprise the complete v1 field vocabulary. Each portable
`uses` entry points to the consumer's exact package-local Capability Contract/1
descriptor. The descriptor carries its URI and exact version; Jig derives and
locks its digest rather than asking authors to copy hashes into `FLOW.md`.
Every Service dependency is fixed before initialization for the complete Mount
lifetime. A project-only package may instead mark a slot `local: true`, which is an
explicit non-portability claim. These forms are mutually exclusive. Every
contract reference uses exact `./` author syntax and resolves by exact case to
one regular descriptor file in the staged package. The closed grammar and
evolution rules are normative in
[`../spec/package-format.md`](../spec/package-format.md).

A code-backed package has no FLOW runtime declaration. FLOW does not own a
runtime registry, runtime-version grammar, command, arguments array, or
toolchain digest. Runtime constraints and dependencies remain in native
ecosystem metadata where one exists. The exact Adapter and toolchain are
host-local activation evidence.

The implementation may begin with the strictly parsed one-token selector:

```text
#!/usr/bin/env <adapter-token>
```

Jig parses it; the operating system does not. It narrows explicitly installed
host Adapter mappings and never invokes `env`, searches `PATH`, accepts flags,
installs an Adapter, or grants authority. Without it, suffix, inert native
metadata, and explicit host policy leave exactly one eligible Adapter or fail
as unavailable/ambiguous. The complete rules are in
[`../spec/runtime-adapters.md`](../spec/runtime-adapters.md).

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

Candidate planning first attempts to build exactly one complete exact-code
recipe. Only when zero qualify may both opt-ins select and pin a distinct
instruction recipe containing the exact instruction runtime, conductor, Agent
provider Binding/export/contract, per-Run projection support, and authority
envelope. Static Mount authority alone cannot qualify; the exact host-provider
or future Service-profile ABI remains a release gate. Exact ambiguity remains
unavailable and never falls back. An instruction-only package requires the
instruction recipe directly.
Run dependency admission later acquires one live provider-generation lease for
that exact Agent export or fails without rebinding. A Run never chooses the
branch: after an exact recipe is pinned, Jig never falls back because machinery
disappeared or because schema, lock, preparation, launch, protocol exchange, or
effect failed.

An instruction recipe is a Jig realization over the existing Run owner and
Agent Run contract, not another FLOW protocol. After input/settings validation
it creates one conductor child owner with the pinned Agent generation. The
integration projects immutable logical resources for the exact package tree,
canonical input/settings, declared outcomes, logical attachment/slot
descriptions, and result schema—never host paths. Owner-scoped provider tools
expose only the admitted attachments, skills, and existing
`flow/call`/`effect/call` view. One small runtime-fixed Agent instruction refers
to those resources; it never interpolates package or invocation content and is
validated before dispatch. The Agent is called once with the complete
`result.schema.json`, or a synthesized closed base-result schema. Only
`completed` plus a valid structured `{ outcome, output }` becomes a provisional
Flow result; Agent text is diagnostic, and Agent `blocked`/`limit` or missing
structured data fails the implementation. Exact-code owner quiescence and
result validation then apply unchanged. The focused Agent specification makes
this mapping testable without standardizing prompt bytes.

### 3.4 Schemas are values, not shared files

The three conventional schema files describe per-Run input, per-Binding
settings, and the complete normal Run result. They are never shared runtime
mailboxes.

Schema use is concrete:

- validate the actual input sent to a candidate;
- validate one complete settings object at Binding activation;
- validate the returned `{ outcome, output }` value as one correlated result.

Run-capable packages may contain all three files. Service-capable packages may
contain only `settings.schema.json`; `input.schema.json` or
`result.schema.json` is a package error because Capability Contract/1 owns method
values. Their exact absence semantics, closed Schema/1 dialect, evaluation
limits, error form, and examples are specified in
[`../spec/schema-files.md`](../spec/schema-files.md). Jig performs no schema
subtyping, coercion, default insertion, property stripping, or remote schema
resolution.

### 3.5 Canonical package snapshot

Package/1 hashes one exact logical file tree, not a source mechanism or a
prepared runtime. It includes every regular file beneath the source-adapter-
selected component root and has no ignore rules; symlinks and special files
reject. Paths are bounded UTF-8 NFC relative names, ordered by unsigned path
bytes. Exact file bytes participate while directory entries, metadata, modes,
and host paths do not.

The digest is domain-separated SHA-256 over a file count and unambiguous
length-prefixed path/content records. Therefore two Git, npm, OCI, or local
sources agree only when their selected logical trees actually agree. The exact
capture, path, limit, digest, and mutation rules are in
[`../spec/package-format.md`](../spec/package-format.md); this document does
not maintain a second serialization algorithm.

An installed revision is identified by:

```text
resolved source URI + component subpath + source revision + package digest
```

Git, npm, OCI, local folders, and indexes are source adapters. An index helps
discovery; it is neither a namespace authority nor a trust root.

## 4. Jig Runtime Adapters and preparation

Runtime launch is host machinery, not a FLOW-owned language catalogue. A code
package contains one obvious `flow.<suffix>` and may add the strict one-token
selector described above. It contains no FLOW runtime profile, URI, revision,
binary range, command, argv, or digest.

An explicitly installed trusted Runtime Adapter recognizes suffixes, optional
selector tokens, and inert native metadata. It validates native runtime and
dependency constraints, consumes host-verified toolchain probes, and returns
bounded shell-free probe, preparation, and launch plans. It never executes
package bytes or spawns. The Sandbox Backend alone executes every package-influenced
preparation tool and the final implementation.

Selection is deterministic for one package and host-policy snapshot:

```text
suffix and optional selector token
    -> installed candidate Adapters
    -> native-metadata/toolchain eligibility
    -> explicit host preference, if needed
    -> exactly one Adapter or unavailable/ambiguous
```

Semantic reasoning, installation order, ambient `PATH`, source guessing, and
previous success never select an Adapter. Unknown tokens never trigger
installation. A package cannot select the Adapter artifact, toolchain,
Sandbox Backend, argv, environment, or any future trusted-code mode.

Selection occurs while planning one candidate admission generation. Apply pins
either one exact staged activation recipe or one exact unavailable reason for
every structurally valid Binding. The recipe contains the Adapter/toolchain
evidence, closed preparation plan, launch-planner identity, Sandbox Backend,
Backend preparation and launch-envelope plans, and authority envelope. Because
the concrete launch plan depends on the prepared snapshot, its Run or Service
Mount owner derives it only after Backend-supervised pinned preparation, then
validates and seals it inside that recipe. It never probes or reselects
machinery. An unavailable Binding may coexist with independent ready Bindings,
but cannot be chosen by resolution or start work. `READY` records
admission-time realizability, not continuing liveness; machinery loss fails
against the pin, while any replacement requires a new reviewed generation.

Native manifests and lockfiles own runtime/dependency constraints where their
ecosystem provides such a seam. FLOW does not duplicate `requires-python`,
Node `engines`, or package-manager dependency declarations, and it does not
claim universal locking across them. The Adapter reports preparation
reproducibility and authority; project/host policy decides what is admissible.

Preparation runs under a separate independently minimized Sandbox plan from
the final Run or Service Mount and sees no owner attachments, secrets, policy
roots, or effect slots. It may contain preparation-only authority, such as
policy-approved package retrieval, which the final component does not receive;
the two envelopes are not ordered or inherited.
Atomic prepared snapshots, safe extraction, and internal
Adapter/toolchain/plan/tree evidence prevent partial or changed preparation
from becoming live. Those digests are local consistency records, never
author-facing runtime requirements.

The reviewed Adapter, selector, preparation, and selection
conformance semantics are specified in
[`../spec/runtime-adapters.md`](../spec/runtime-adapters.md).
Closed registration, planning, receipt, and error data models remain release
gates.

## 5. FLOW Run/1

### 5.1 Closed candidate boundary

The focused [`FLOW Run/1 specification`](../spec/run-protocol.md), its
[`message schema`](../spec/machine/run-1.schema.json), and its
[`error registry`](../spec/machine/run-1-errors.json) are normative for the
finite executable boundary. This whole-system document records only Jig's
policy around that boundary; it does not restate a second wire protocol.

Run/1 is a closed candidate rather than a stable conformance label until two
independent Hosts and Components pass the common corpus. It uses one root Run
per process and bounded full-duplex JSON-RPC 2.0 over LF-framed UTF-8 stdio.
Standard input and output contain protocol frames only; standard error contains
unstructured diagnostics. Readers remain active during outbound calls, writes
are serialized and flushed, and the focused specification fixes frame, ID,
pending-request, fatal-channel, EOF, and exit behavior.

The complete method vocabulary is:

```text
host -> component
    flow/run          one pending root request

component -> host
    flow/call         one child-Flow operation
    effect/call       one call through a bound capability slot

either request originator -> receiver
    request/cancel    idempotent JSON-RPC notification cancelling its own
                      pending request; it has no id and receives no response
```

There is no version handshake: the exact `run/1` literal in the root request is
an activation-mismatch guard. Structured lossy telemetry may later be a
separate profile; stderr is sufficient for base conformance. Durable Events
use the Journal capability in section 9, not a fifth Run method.

### 5.2 One root implicitly owns work

Because one Run/1 process serves exactly one root request, every
component-originated call is implicitly owned by that root. `flow/call` and
`effect/call` therefore carry no `ownerRequestId`, Run ID, Scope ID, or public
lifetime handle. Their JSON-RPC IDs correlate live exchanges only;
`operationId` supplies caller-chosen semantic identity within the root.

Jig maps the root request to its own durable Run and lifetime records, owns the
child tree, and stamps correlation and authority evidence without exposing
those records to the component. There is no reconnect or live-continuation
resume in Run/1; EOF before a complete root response loses the continuation.
Service/1 multiplexes several possible owners on one channel and must close its
own attribution model before publication rather than changing Run/1's call
shape retroactively.

### 5.3 Exact invocation projection

The root request supplies exactly six fields:

```text
protocol = run/1
input
complete Binding settings object
named attachment paths and read/read-write modes
private read-write scratch path
deadlineUnixMs
```

There is no root or parent identity, trigger/correlation field, slot inventory,
provider identity, grant, enforcement receipt, negotiated limits object, or
universal budget on the wire. Triggering application data belongs in `input`;
Jig's durable identity, provenance, authority, and enforcement evidence remain
host inspection state. The fixed protocol limits live in Run/1 itself.

The deadline is a finite host-authoritative UTC Unix epoch allocated before
dispatch. Packages and Bindings cannot select or widen it, and child/effect
calls inherit its remaining time. Provider-specific token, money, turn, or
resource ceilings belong to that provider's registered settings/grants
contract. “Coeffect” remains useful theory, not another public API.

The candidate language SDKs project the six fields as one stable local context.
Named attachments are sandbox-local paths with their exact mode; native code
performs ordinary filesystem I/O and the Sandbox Backend remains the
enforcement boundary. SDK packages remain ordinary native dependencies rather
than Adapter-injected ambient libraries.

### 5.4 Child Flows and effects

`flow/call` contains exactly `operationId`, consumer-local `slot`, `input`, and
an optional bounded `intent` string. Jig resolves and pins one exact child
Binding, atomically creates its child record with the operation, and returns
the complete `{ outcome, output }` result. This is nested execution, not graph
merging. Parent settings, attachments, slots, and authority do not inherit
implicitly. An absent intent never grants catalogue-wide discovery.

Generic Flow composition proves only the common Run envelope and that the
child satisfied its own result declaration. It does not create a consumer-side
output contract, and Semantic Choice cannot turn prose similarity into type
compatibility. An exact caller receives bounded JSON/1 and validates any shape
on which its next operation depends using ordinary code. An instruction caller
interprets the value under its procedure and still must fail visibly rather
than assume missing fields. A stable machine-verifiable API shared by several
operations belongs behind a Capability Contract instead.

`effect/call` contains exactly `operationId`, a slot declared in `uses` (or
explicitly local in project configuration), `method`, and `input`. A slot may
be backed by a host-native provider or an exact mounted Service registration.
The caller never sees or selects an endpoint. Jig validates the root owner,
binding, contract, method, schemas, authority, inherited deadline, and provider
generation before dispatch.

Capability Contract/1 wire success is tagged `{ "value": ... }`; the candidate
language SDKs return that validated value directly and turn a
declared `{ "error": { "name", "data" } }` into a catchable typed capability
error. JSON-RPC, authority, cancellation, capacity, and provider-loss failures
remain operation failures and are never presented as declared application
errors. This unwrapping is ergonomic projection, not a different wire shape.

Generic component code supplies one stable root-local `operationId` for each
semantic call; the SDK privately generates wire request IDs. How Sley-based
components derive stable semantic operation IDs is a Jig Graph/SDK interface
question, not a Sley runtime invariant. Neither mechanism may weaken the
operation rules below.

### 5.5 Operation identity and Jig durability

Run/1 standardizes only observable operation behavior:

```text
same operationId + same canonical method/params
    join or return the same operation result

same operationId + different canonical method/params
    OPERATION_CONFLICT before another dispatch
```

The comparison includes the call method, slot, effect method or optional Flow
intent when present, and input. Transport IDs and timing are excluded. FLOW
does not standardize a host database, activation digest, internal lifetime ID,
or recovery schema; this keeps a small non-Jig Host conforming.

Jig supplies a stronger durable implementation. It maps the live root to an
internal immutable owner, commits intent before dispatch, fills one exact
Binding/provider resolution at most once, atomically links child allocation or
provider lease with dispatch admission, and commits a terminal record before
responding. Those are Jig lifecycle guarantees rather than extra wire fields.

Cancellation after unprovable external dispatch yields `UNCERTAIN` unless the
provider proves a terminal result. No uncertain operation is automatically
replayed, and an intentional new attempt uses a new `operationId`. FLOW
promises neither exactly-once external execution nor arbitrary live
continuation recovery; ambiguity remains visible.

### 5.6 Cancellation, errors, and completion

Cancellation is symmetric: the originator of a pending request may send the
notification-only `request/cancel` naming that request's wire ID. It receives
no response, and the original request's eventual result/error or channel loss
settles the race. Duplicate, stale, already-terminal, unknown, and
opposite-direction targets are harmless no-ops; a malformed cancellation frame
is fatal because its sender cannot safely assume cancellation occurred.

Cancellation closes new admission for the target, propagates through its owned
subtree, and starts bounded cleanup. It never proves a dispatched external
effect was undone. Root cancellation closes the complete Run subtree, and the
Sandbox Backend terminates an uncooperative process under private host grace
policy no later than the fixed owner deadline.

Normal `flow/run` and `flow/call` results contain exactly one domain `outcome`
and required `output`. `effect/call` returns exactly one tagged `{ value }` or
declared `{ error: { name, data } }`. Standard JSON-RPC failures retain their
standard codes; portable operational failures use `-32000` plus one code from
the closed Run/1 registry. Protocol, execution, deadline, cancellation,
provider, authority, capacity, invalid-result, and uncertainty failures never
masquerade as package outcomes or declared capability errors.

The component must settle every outbound call before returning its root result
or error. The terminal frame closes new admission; no call is detached,
reparented, or transferred. Outstanding owned work, invalid output, nonzero
exit, failed cleanup, or deadline kill prevents success. A complete valid root
response followed by clean exit survives EOF; EOF before a complete response
is channel loss. Jig validates `result.schema.json` only after bounded
quiescence and before owner success commits.

## 6. FLOW Service/1

### 6.1 Status

Service/1 is a reviewed first-class target intended to receive an independent
conformance label:

```text
FLOW Service/1 Host
FLOW Service/1 Provider
```

It receives `1.0` only after its closed wire models exist and independently
implemented Hosts and Providers pass the same black-box lifecycle suite. No
named framework is a normative release participant. Run-only hosts do not have
to implement it.

### 6.2 Reviewed method vocabulary

```text
host -> component
    service/mount       pending for the complete Mount lifetime
    service/invoke      invoke one exact export generation

component -> host
    service/ready       acknowledge that every declared export is callable

reuses Run/1 semantics, with Service-owned attribution still to be closed
    flow/call
    effect/call
    request/cancel
```

Run/1's call params contain no `ownerRequestId` because its process has one
implicit root owner. A Service channel has Mount-background work and concurrent
invocation owners, so Service/1 cannot import those params unchanged. Its
closed wire model must define cooperative owner attribution for its calls and
readiness without altering Run/1. That model remains a Service/1 release gate.

There is no `service/unmount`: cancelling the still-pending mount request
initiates shutdown, and its terminal response acknowledges cleanup. There is no
wire Mount ID because v1 has one Mount per process and no channel resumption.
An unsolicited terminal mount response closes admission and runs the same
owner-quiescence rule as Run/1; it cannot report success while Mount-owned work
is live and its provider registrations become lost.

Mount-background work belongs to the live `service/mount` request. Work caused
by an invocation belongs to that narrower `service/invoke` request. Cancelling
one invocation cannot cancel unrelated Mount work.

A future language SDK must preserve that distinction. A provided method handler
receives an invocation-scoped projection of cancellation and `flow/call` /
`effect/call`; Mount initialization and recovery use the separate Mount-scoped
projection. Both are views over the Mount's already-pinned dependency set, not
public `Scope`, `Context`, or transferable handles. Calling a
Mount-scoped client from an invocation must not silently reattribute child work
to that invocation, or vice versa.

The future SDK must preserve fixed exports, readiness only after they are
callable, distinct Mount-background versus invocation-owned work, and bounded
cleanup. No setup return shape, disposer convention, helper name, or signature
is normative until the SDK interface is specified; mutable export registration
remains excluded.

Host and Provider support multiple outstanding `service/invoke` requests on
one Mount and out-of-order responses. Each invocation separately pins its
consumer Binding, provider generation, contract/method, host-allocated
deadline, and
operation key. Concurrency promises separate cooperative
lifecycle accounting and admission, not hostile sibling isolation,
serialization, linearizability, or transaction isolation. The hard security
ceiling is Mount-scoped. A provider that needs different security principals
or authority ceilings runs in separate Mount processes/channels.

`service/mount` installs the complete dependency set before provider
initialization begins. Every declared slot resolves to one exact Binding and
provider generation. The set never changes for that Mount; losing a required
dependency cancels the Mount rather than healing it in place.

Conceptually, `service/ready` identifies the live owning Mount request and the
complete declared export LocalNames in canonical UTF-8 order. It has no
operation identity and owns no work. The exact owner field and request shape
remain part of the unclosed Service/1 wire model. Unknown, duplicate, missing,
extra, unsorted, stale-owner, or post-cancellation values are protocol errors.

### 6.3 Readiness, identity, and loss

Package metadata declares the complete export set. After registering every
declared export locally, the Provider sends exactly one `service/ready` request
naming the live Mount owner. Jig validates that the set exactly equals
`provides`; a missing, extra, or duplicate export fails the Mount. No invocation
is admitted before the readiness acknowledgement, and absence until the
startup deadline fails the Mount.

Accepting readiness atomically assigns one fresh provider generation to every
declared export. Jig serializes and flushes the successful readiness response
before opening consumer-lease admission or dispatching an invocation on that
channel. A failed response write loses the Mount and opens no admission. A
second readiness request, partial readiness, or later export addition/removal
is a protocol error. If the Provider receives no acknowledgement before its
fixed deadline, it terminates the Mount rather than continuing under an
assumed state.

Exports remain callable as one fixed set until the Mount drains, is cancelled,
or is lost. A provider needing optional or independently changing public
capabilities uses separate Service packages/Mounts. Internal plugins and local
services may still appear or disappear, but loss of anything required to
implement a declared public export terminates this Mount.

Resolving a consumer slot allocates an internal Binding lease for the exact
provider generation, owned by that consumer Run or dependent Mount. It is
released when the owner closes; already admitted invocations keep narrower
operation leases until terminal. Consumer crash/loss releases leases through
coordinator fencing.

An active Mount accepts new Binding leases and invocations. A draining Mount
accepts no new consumer leases, but an existing live lease may start further
invocations; admitted invocations and bounded Mount-background work may
complete. Final lease release or the activation's recorded drain deadline
closes invocation admission, cancels remaining work, and cancels the pending
mount request. The provider cannot choose that deadline. Removing an export by
provider choice is impossible; graceful replacement keeps the old fixed export
set available on the old Mount until its leases drain or the deadline fences
it. Provider failure instead loses the complete set immediately.

Graceful shadow-first rollout uses two Mounts only when their complete planned
resource and attachment leases can coexist. The ready new Mount then receives
new bindings; the old Mount remains available to existing leased consumers
until they release or reach the deadline, after which its pending mount request
is cancelled.

When complete planned resource leases cannot coexist—most importantly, when
two providers request the same exclusive writable attachment—Jig closes new
leases to the old generation, drains and fences it, proves cleanup and lease
release, switches admission, and only then starts the replacement. New
consumers observe an explicit unavailable interval. Failure of the replacement
does not resurrect the fenced owner; rollback is another admitted activation
with a new provider identity. FLOW defines no generic migration callback.

Provider EOF or crash loses all its generations. Restart creates new identities
and never transparently rebinds an existing consumer.

### 6.4 Dependencies

`uses` declares the complete dependency set. Every slot resolves before Mount
initialization and remains pinned to one exact Binding/provider generation for
the complete Mount lifetime. Initialization, invocation-owned child calls, and
Mount-background calls all use that same set. No undeclared dependency may
appear at runtime, no provider may be replaced in place, and dependency loss
cancels the Mount.

Static dependency cycles fail before mount. Every synchronous Run, effect, and
Service wait is an edge in Jig's wait-for graph. The newest edge which would
create a non-runnable cycle fails instead of deadlocking.

This fixed rule is intentionally less expressive than Cordis inside one realm.
A Cordis adapter may keep plugins pending and react to local service changes,
but the realm crosses FLOW only after its declared external dependencies and
exports are ready. If that public seam can no longer be implemented, the Mount
ends and a deliberate later activation creates new provider generations.

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

## 7. Capability Contract/1

A contract exists only for a structured effect/Service seam. Ordinary child
Flow calls remain contract-free.

The canonical descriptor is deliberately small. The normative shape and one
parseable session-store example live in
[`../spec/capability-contracts.md`](../spec/capability-contracts.md); this
whole-system document does not duplicate the descriptor under the same public
identity.

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
{ "value": { "sessionId": "s-1" } }
{ "error": { "name": "not-found", "data": { "sessionId": "s-1" } } }
```

JSON-RPC errors are reserved for protocol, validation, authority, cancellation,
capacity, and provider-loss failures.

Embedded value schemas use the closed Schema/1 keyword and evaluation dialect
specified in [`../spec/schema-files.md`](../spec/schema-files.md), except that
an embedded schema does not repeat the file-root `$schema` declaration.
Descriptors are inert and resource-bounded before provider code loads.

Any method value schema may be boolean `true`, meaning any bounded FLOW JSON/1
value. This supports progressive formalization without creating a second loose
contract format; changing it to a strict schema changes the interface.

Contract compatibility in v1 is exact. A portable consumer and provider each
carry the self-contained descriptor bytes they claim:

```text
contract URI + exact version + exact canonical descriptor digest
```

Providers may advertise several exact versions. Version 1 or 3 does not satisfy
a requirement for version 2. An explicit adapter is an ordinary provider which
consumes one exact interface and provides another.

The digest is SHA-256 over the domain separator
`FLOW-Capability-Contract/1\0` followed by RFC 8785 canonical JSON for the
complete descriptor. It identifies the exact descriptor; it is not publisher
identity or behavioral proof. `FLOW.md` references the consumer's package-local
descriptor path; Jig derives the triple and records it in the lock instead of
requiring a copied hash. The lock separately records source/publisher authority
evidence and continuity. Different bytes claiming the same URI/version do not
match. A publisher or trusted source claiming both is diagnosed as
equivocation, while an unrelated untrusted conflicting claimant cannot
globally quarantine an exact trusted match. Local edits to a public descriptor
require an authorized new version or an owner-qualified fork.

Descriptions and tests are evidence. Semantic ranking never converts a
nonmatching contract into a compatible one.

The normative descriptor, loading, digest, and conformance rules are in
[`../spec/capability-contracts.md`](../spec/capability-contracts.md).

### 7.1 Conformance dependency firewall

The conformance claims compose explicitly rather than by implication:

| Claim | What it requires |
|---|---|
| Package/1 parser | Recognize all closed metadata inertly; no execution or Service support. |
| Run/1 Host | Own, journal, cancel, and dispatch `effect/call`; opaque local effects are sufficient. |
| Capability Contract/1 Consumer | Resolve exact descriptors and validate methods, values, and named errors. |
| Typed-effect host | Run/1 Host plus Capability Contract/1 Consumer. |
| Service/1 Host | Service lifecycle plus the normatively imported `flow/call`, `effect/call`, and cancellation subset. |

A Run-only host without Contract Consumer support rejects a package requiring a
public `uses` contract before launch with `FEATURE_UNSUPPORTED`; it may still
run a package bound to an explicit opaque local effect. A Service/1 Host tests
the imported host-call subset but need not accept `flow/run`. Merely parsing a
package with `service`/`provides` metadata never makes a minimal host
nonconforming; attempting to mount it produces deterministic
`FEATURE_UNSUPPORTED`.

## 8. Bindings and project configuration

### 8.1 One configured-use abstraction

A Binding is one immutable admitted project-local configured use of exactly
one implementation. It is a closed union:

```text
package
    exact FLOW Package revision, with derived Run or Service mode

host-capability
    one exact export of an already installed trusted host provider registration
```

The authoring model must avoid routine Binding boilerplate for an ordinary
discovered Run without creating a second, unreviewed execution path. The exact
mapping from a simple catalogue member to an admitted root target is not yet
settled; a hidden Binding derivation algorithm is not normative.
Discovery itself never activates code or grants authority.

A relative package reference is resolved from the project root containing
`jig.ts`, not from the Binding declaration's directory. It must be a normalized
confined path in the captured project tree, cannot traverse a symlink or escape
the root, and must resolve to one exact configured catalogue member. Moving a
Binding file therefore cannot retarget its package.

The host-capability case does not let project code install or trust host
machinery. Jig resolves it to one provider module artifact/revision, export,
exact public contract triple or explicit local identity, and provider-declared
settings and authority schemas. Missing or ambiguous registrations leave the
candidate unresolved; only a fully resolved registration may then be
operationally unavailable.

For example, a package Binding in `bindings/strict-review.ts` may contain the
following intended authoring projection. Its helper names, including `root`,
remain provisional until the project SDK is published:

```ts
export default bind({
  use: "./flows/review",
  settings: {
    maxRetries: 5,
    threshold: 0.95,
  },
  slots: {
    agent: bindingRef("reviewer-agent"),
    research: candidates([
      bindingRef("research-fast"),
      bindingRef("research-deep"),
    ]),
  },
  attachments: {
    source: root("./project"),
    output: root("./results"),
  },
});
```

A host-native provider uses the same admission semantics. The precise inert
registration token, module export, and authoring helper remain release gates;
the architecture does not invent a provider package name to illustrate them.

The normalized Binding always contains:

```text
kind and exact implementation revision
one complete settings object
exact declared dependency slots and attachment mappings, when supported
derived attachment and mediated-effect authority
project admission generation
```

Admission distinguishes validity from operational readiness. Invalid package,
settings, schema, reference, contract, or authority data rejects the aggregate
candidate. Each otherwise valid Binding is admitted as either ready with one
exact selected implementation recipe or unavailable with one exact reason and
evidence. `READY` records admission-time realizability rather than continuing
liveness. An unavailable Binding does not block independent ready Bindings,
but it cannot spawn, mount, or enter a Resolver candidate set. An explicit root
submission still allocates its idempotent Run and terminates before spawn with
the pinned unavailability reason; later host repair requires a new key and
generation.

A package Binding additionally contains its exact Package/1/source identity,
mode, package-declared interface metadata, configured dependency slots and
attachment mappings, and any legal instruction fallback.
A host-capability Binding contains the trusted
provider registration artifact/revision and one exact export. Package-only
runtime, fallback, outcomes, and Service-mount fields are illegal on that
branch. Its settings, attachments, dependencies, and authority cannot exceed
the closed schemas and ceilings in the trusted registration. Only this branch
may expose a `grants` field, and that field is the exact registration-defined,
Schema/1-validated attenuation object—not a generic permission language.
Omission normalizes to `{}`, the registration's least optional authority and
never its maximum; `{}` must itself validate. A
package Binding has no `grants` field; package authority is derived from its
declared attachments and dependency contracts, then attenuated by project
mapping and host policy.

A package Binding's optional `instruction` object names the exact conductor
Agent Binding. Its optional `fallback` member has one legal value,
`"instruction"`, and enables fallback only when the package also declares
`fallback: instruction`. Absence denies exact-to-instruction fallback;
`fallback: "deny"` is not another state. An instruction-only package requires
the Agent reference but no fallback opt-in.

Root Runs, `flow/call`, and Hook targets require an exact admitted Run target.
An authored Run-capable Binding supplies one such target; the zero-boilerplate
representation for a simple discovered Flow remains an open interface seam.
Desired Service activation requires a Service-capable Binding. `effect/call` slots
resolve only to one exact Service export or host-capability Binding. A
host-capability Binding is neither runnable nor mountable. Normalized desired
state has one `bindings` map, not parallel Flow, Service, Agent, and provider
configuration trees. Every admitted `READY` Service-capable Binding is mounted
for that admission generation; an `UNAVAILABLE` Service Binding remains
unmounted and makes its dependents unavailable. Lazy Service activation is
deferred. Instruction fallback is legal only for a Run-capable Binding.

Project portability is explicit: package Bindings retain FLOW portability;
host-capability Bindings are conditionally portable to hosts with the exact
trusted registration. A provider intended for portable distribution ships as
a FLOW Service package instead.

The optional intent carried by the actual `flow/call` is its discovery meaning.
A project may exact-bind its slot or configure a closed approved
`candidates()` snapshot. An unmapped slot is always missing; it never opens the
catalogue implicitly. Applications still need an intentional, reviewable way
to admit a changing catalogue-wide candidate universe, but its declaration and
normalization are unresolved. The project cannot rewrite call intent or select a
per-slot semantic engine. Missing or ambiguous resolution fails the operation.
One optional
Semantic Choice Binding, selected by the project's `semanticChoice` field, and
every Agent/effect Binding it uses belong to normalized project desired state
and the activation digest. It ranks only after deterministic filtering leaves
several eligible candidates. No active ranker acquires a host-default Agent.
A dangling or contract-incompatible project reference invalidates the
candidate. If the exact ranker Binding is admitted `UNAVAILABLE`, an ambiguous
call stays `BINDING_AMBIGUOUS` with that evidence until a chooser is actually
dispatched; only loss of a dispatched result can make the operation
`UNCERTAIN`.

Two configurations are two ordinary admitted Bindings. There are no roles,
profiles, variants, deep merges, environment fallback, parent inheritance,
ephemeral Binding path, or per-Run settings overlays.

An instruction-only Binding, or an exact Binding which permits instruction
fallback, cannot activate until project policy resolves one exact
projection-capable Agent provider and instruction-runtime revision. Both exact
revisions are part of the Binding digest; there is no mutable ambient “default
Agent” after activation. The qualifying provider ABI remains release-gated.

Thus `MAX_RETRIES` is a setting, not an environment convention. If
`settings.schema.json` declares it required, Binding activation fails when it
is absent even if Jig's process has an environment variable of that name. If
the package has no settings schema, only `{}` is legal. Packages do not gain an
undeclared configuration channel. Values which vary per invocation belong in
Run input; durable working data belongs in attachments or bound capabilities.

### 8.2 `jig.ts`

The intended project frontend is one `jig.ts`. A generated project opts into
three progressive-disclosure directories once instead of importing each new
item manually:

```ts
import {
  defineJig,
  discover,
} from "@jigging/jig";

export default defineJig({
  flows: discover("./flows"),
  bindings: discover("./bindings"),
  hooks: discover("./hooks"),
});
```

A software factory which wants semantic ranking for ambiguous open-ended
`flow/call` resolution adds one direct Binding reference:

```ts
semanticChoice: bindingRef("semantic-choice"),
```

This does not replace Jig's deterministic Resolver and does not configure a
runner-local Router. It is only the optional ranker invoked after deterministic
filtering leaves several eligible candidates.

These snippets record desired ergonomics, not a published `@jigging/jig`
interface. The complete TypeScript declarations and captured-value schema must
be specified before an external consumer may rely on them.

`discover()` accepts one project-relative directory root, or an explicit array
of roots, and has no glob or minimatch semantics. The containing field supplies
the shallow member convention. One leading `./` is accepted and normalized
away before confined segment validation. A project wanting closed membership
replaces a discovered source with a plain exact list:

```ts
bindings: [
  "./bindings/build.ts",
  "./bindings/review.ts",
]
```

Directory and exact-list forms are mutually exclusive for one field. Flow
members are package directories; Binding and Hook members are declaration
files. Each immediate `bindings/<LocalName>.ts` or
`hooks/<LocalName>.ts` default-exports one serializable declaration; the
basename is its ID. Discovery is shallow, bounded, symlink-free, and without
source-order precedence. A missing discovery root is empty, but a missing,
duplicate, wrong-kind, escaping, symlinked, or canonically colliding exact-list
member invalidates the candidate. Imported packages can never add policy files
to these project roots automatically.

Jig captures `jig.ts`, configured memberships, and the complete static import
closure before evaluating it once in a bounded authority-free config sandbox.
It removes ambient filesystem, process, network, environment, clock,
randomness, secrets, Agents, and dynamic/native loading. The exact normalized
result—not a claim that arbitrary TypeScript is mathematically deterministic—
is persisted as the sole resolution and approval input. Publication never
reevaluates approved source.

`jig inspect` reads inert package and last-normalized state without executing
project code. `jig plan`/`apply` require trust for the exact captured config
snapshot. No command evaluates `jig.ts` merely to browse an unknown repository.

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
local activation under `.jig/`. The lock is evidence, not execution consent;
consent and revocation tombstones are host-local under `.jig/`.

A fresh unlocked project may omit `jig.lock`; planning then proposes its first
lock as part of the reviewed aggregate delta. Locked checking or applying
rejects a missing or stale lock. The exact lock serialization remains a focused
specification prerequisite for implementation and public Starters.

The configured `flows/`, `bindings/`, and `hooks/` locations are generated
conventions rather than kernel magic. `agents/`, `inbox/`, `kanban/`, or any
other directories remain application conventions unless `jig.ts` explicitly
references them.

Watched edits create one inert aggregate candidate. They do not activate it or
prompt once per file. `jig apply` reviews the complete semantic and authority
delta and commits only the displayed candidate digest against the displayed
base generation; an intervening edit returns `STALE_PLAN`. Adds, edits,
renames, removals, provider changes, and authority-neutral behavior changes all
need aggregate consent. A pending deletion leaves the old immutable generation
active; emergency `jig revoke` is the separate immediate deny operation.

The complete project-source, captured-evaluation, admission, consent, removal,
and revocation rules are in
[`../spec/project-policy.md`](../spec/project-policy.md).

### 8.3 Inert Flow sources

In the `flows` field, `discover("./flows")` inspects only immediate child
directories containing exact-case `FLOW.md`. The public authoring surface uses
the same primitive for all three source kinds; normalized state still treats
Flow packages as inert catalogue entries and Binding/Hook modules as
desired-state declarations. The scan is bounded, private-staging based,
and does not follow symlinks. It **parses** only Package/1 metadata and schema
files, but the canonical snapshotter privately stages and hashes every admitted
regular file—including implementation, prompt, skill, reference, script, and
asset bytes—before an entry identity exists. Mutable sources retry detectable
changes but claim atomic revision fidelity only when their source adapter
actually supplies it. An unread or provisional staged tree never becomes a
candidate. Discovery never
imports code, resolves dependencies, prepares, binds, grants, mounts, or runs a
package.

Catalogue entry identity is:

```text
(canonical configured root identity, safe relative package path, package digest)
```

Friendly `name` and `description` are display and model input only. Duplicate
names may coexist and are always shown with path and digest. A root change,
path move, or content change creates a different entry; a path move is removal
plus addition.

Runtime execution always uses one exact target revision from the immutable
admission generation—never a live catalogue package. Authored Bindings already
supply configured Run targets. Jig still needs a zero-boilerplate target for a
simple discovered Flow, but whether that normalizes to an internal default
Binding or a distinct admitted Flow target remains intentionally open. Either
design must use the same admission, authority, revocation, idempotency, and
locking path. See
[`101-default-targets-and-open-routing-candidate.md`](101-default-targets-and-open-routing-candidate.md).

## 9. Effects, events, Hooks, and Agents

These terms are deliberately not interchangeable:

| Boundary | Meaning |
|---|---|
| Run input, Binding settings, attachment handles, and host deadline | Immutable invocation environment; “coeffects” in theory, but not a second public API. |
| `effect/call` and `flow/call` | Explicit requested operations whose results influence execution. |
| Journal Event | Durable immutable fact which may trigger later work. |
| Hook | Inert exact Event-source-to-Flow admission policy. |
| `stderr` diagnostic | Bounded operational text which never drives portable behavior. |

This is why Run/1 has no ambiguous `flow/event` method and why durable facts
were not renamed “telemetry.” Telemetry, if standardized later, remains lossy
observation; an Event is something applications may intentionally react to.

### 9.1 Effects

`effect/call` is the sole portable gateway for host-mediated operations. An
exact Capability Contract describes a portable slot. A project-local opaque slot
is allowed only through explicit Binding and makes no portability claim.

The same gateway covers Agent work, Git, databases, secrets, UI host APIs, and
the durable Event Journal. It does not grant raw filesystem, network, process,
or environment access.

### 9.2 Durable events

Events remain first-class Jig semantics, but publication uses Jig's host-native
canonical Journal through one exact effect slot instead of a special Run
method. Its reviewed method surface is deliberately append-only:

```text
append({ type, data, subject?, occurredAtUnixMs? }) -> Event
```

The exact Capability Contract/1 identity is:

```text
https://jig.dev/contracts/journal
1.0.0
sha256:dd749f53de3a5f80e02386699355e28c1fd7e707b2b12bdf2d5c725eb436ddf9
```

The strict committed Event contains:

```text
eventId, journalPosition, type, source, committedAtUnixMs, data
optional subject, occurredAtUnixMs, causedBy, correlationId, runId
```

The caller supplies only `type`, `data`, `subject`, and the untrusted domain
assertion `occurredAtUnixMs`. Jig supplies the stable ID, authenticated source,
host-observed commit time, project-local ordering position, and available
owner/operation correlation.

The caller cannot choose protected producer, Run, operation, or commit fields.
Jig stamps authenticated producer identity, owner correlation, commit time,
and the stable event ID. Canonical append, Event, outer operation
result, and Hook-selection outbox commit in one Jig kernel transaction. A
retry of the same outer operation therefore returns its ledger result without
redispatch. There is no exceptional replay rule for external providers.

The exact descriptor defines the wire values; the host behavior, Hook
intervals, and omission of public read/query/wait/replay/subscription methods
are specified in
[`../spec/journal-and-hooks.md`](../spec/journal-and-hooks.md). A package cannot
mount a replacement canonical Journal in v1. External stores may mirror
committed Events or expose ordinary Service methods, but cannot acknowledge
canonical append or drive Hooks. Implementing the value contract does not
confer a `Journal/1` claim. A CloudEvents view may be generated, but it does not
replace Jig's ownership, namespace, durability, or project-local ordering.

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
one exact authenticated producer and Event type
    -> one exact admitted Run target
```

It is not arbitrary callback code, middleware, or a portable package type.
The selector resolves to one exact producer identity and exact type; there is
no source list or authority-bearing wildcard. Watchers, webhooks, timers, and
other producers are application code, protected host machinery, or FLOW
Services which publish through the Journal. A Hook neither creates nor owns
their lifetimes.
Source is host-stamped and text similarity never grants publication authority.
The normalized Hook semantics are specified in
[`../spec/journal-and-hooks.md`](../spec/journal-and-hooks.md).
The TypeScript helper spelling remains part of the unpublished project SDK.

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
creating another Run. Multiple Hooks provide fan-out. Filtering, conditional,
multi-step, settling, and coalescing logic belongs in the producer or target
Flow, where effects and uncertainty are explicit.

Activation verifies the exact selector and that the target revision exists and
is Run-capable. When a concrete selected Event commits, Jig
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

A human or external wait ends with a domain outcome such as `waiting`; a later
Event and Hook start a new Run. The public Journal has no wait method, and FLOW
v1 does not persist an arbitrary graph continuation.

### 9.4 Agents

FLOW is Agent-neutral. This repository defines three exact Capability
Contract/1 descriptors; projects are intended to bind installed providers:

```text
Agent Run          finite self-contained work
Agent Session      persistent sequential turns
Agent Interactive  complete Session surface plus live-turn steering
```

They remain separate because a provider which can retain a session need not be
able to steer a pending turn. All are ordinary typed effects; they add no
Agent-specific FLOW/1 method or second contract format.

A session is owned by the exact consumer lifetime and provider export
generation. Its opaque ID cannot cross owners or generations. Exactly one
prompt turn is active; `events` and Interactive `steer` may run concurrently
while that prompt remains pending. Turn/message IDs make steering linearizable
against turn completion and idempotent. Session events form one consecutive,
bounded observation log; admitted-turn events commit before the prompt
terminates and never appear afterward. Successful open also installs a
host-owned disposer retaining the exact provider-generation cleanup lease, so
owner success cannot commit until an unclosed session is closed or fenced.
Close, owner cancellation, or provider loss closes session admission; provider
loss never heals or rebinds it. The integration revokes the per-owner
projection with that owner. Jig does not claim remote data erasure it cannot
observe.

Each immediate package-root `skills/<LocalName>/SKILL.md` subtree is opaque
Flow-local Agent skill source. Agent Run calls select an explicit subset,
defaulting to none; Session/Interactive calls fix their subset at `open`; the
single instruction-conductor call selects all immediate package skills. Jig
supplies only the selected subtrees as a read-only owner-scoped provider
projection and revokes them with the owner. A child Flow receives its own tree,
never implicit inheritance from its parent.
Jig does not parse Skill identities or dependencies, overwrite provider-native
skill directories, or define global shadowing, precedence, a root skill
catalogue, an override tree, or a skill dependency resolver. An integration
unable to expose the exact tree without mutation or collision is ineligible.
Static Mount files never impersonate an owner-scoped skill projection. Any
qualifying Agent integration, whether host-native or a future Service profile,
remains responsible for exact projection, revocation, and contract
conformance. The provider ABI is release-gated.
Projection proves availability, not Agent selection or compliance. A Flow
which relies on a bundled Skill explicitly requests it in the relevant Agent
instructions and keeps deterministic safety/validation separate. The focused
Agent specification defines the bounded LocalName selection while keeping
skill bytes, paths, and authority out of the Agent wire contracts.

Agent requests never carry raw host paths or permission overrides. An Agent
Binding fixes provider, settings, its own attachment projection, tool/effect
ceiling, and approval gate. Host policy allocates a finite deadline to each
operation; provider-specific resource ceilings are ordinary validated provider
settings or grants. Binding that Agent slot exposes
this transitive authority in the aggregate project plan; caller attachments,
effects, and scratch neither inherit nor remap into the Agent operation. A
host-native operation owns its exact projection and leases. Independently
configured caller/provider read-write roots may not overlap, and concurrent
writers require enforced exclusion or isolation rather than an assumption that
the graph is sequential. An instruction conductor instead realizes the Run
itself and receives that instruction Run Binding's declared component view;
there is no concurrently live component runner and no caller inheritance. For
a gated effect Jig—not the Agent provider—obtains
and transactionally consumes one decision bound to the exact call before
dispatch. Approval can release only authority already inside that ceiling.

Codex, Claude Code, ACP, and command adapters are providers, not core Agent
subclasses. A Starter may copy editable FLOW Service integration source or
project Bindings, but it cannot install or trust a host-native provider
registration; that remains a separate host/operator action. ACP is a preferred
open integration where it fits; native providers may expose additional exact
contracts.

Instruction execution, semantic ranking, missing-Flow generation, and Agent
update repair require an Agent. Exact Flows, explicit resolution, inspection,
checking, clean updates, and rollback do not.

The reviewed descriptor methods, state machine, ownership, workspace, and
approval semantics are in
[`../spec/agents-and-semantic-choice.md`](../spec/agents-and-semantic-choice.md).

## 10. Resolution and fault tolerance

The deterministic Resolver is a Jig kernel mechanism. A Semantic Choice
ranker is an optional, powerless module selected by one exact project Binding.
Fault tolerance does not depend on an
LLM: missing, incompatible, unavailable, and ambiguous dependencies always
have explicit durable states. Semantic reasoning improves open-ended choice;
it does not create those states or authority.

Child-Flow candidates are approved Run-capable target revisions—not raw
packages. Nothing becomes executable by discovery alone: it must appear in the
reviewed aggregate and be admitted. Package descriptions may support inert
catalogue retrieval; they do not grant authority or bypass target pinning.

For a child Flow or provider slot, Jig performs:

1. exact project binding;
2. valid locked selection;
3. deterministic filtering by exact protocol/contract, actual input
   validation, platform/runtime availability, trust, permissions, host
   resource ceilings,
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

Jig's optional Semantic Choice Capability Contract accepts an objective,
bounded context, and decision-local `{ id, description }` candidates. It
returns one allowlisted ID or abstains. It returns no route arguments, plan,
confidence-based authority, installation request, or generated code. A graph
Router and Jig's open-ended Resolver may intentionally use the same contract
without becoming the same control-flow mechanism.

The candidate set is finite and completely frozen before ranking. A host limit
may reject an oversized set explicitly, but v1 does not standardize an
arbitrary universal count or permit silent truncation, sampling, or batching.

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
absent. No eligible candidate commits terminal `BINDING_MISSING` with the
pinned generation, slot, actual intent, candidate-snapshot evidence, and
rejection reasons. Ambiguity likewise commits terminal
`BINDING_AMBIGUOUS`. A later catalogue or admission generation never fills that
operation's resolution, ranks it again, or creates its child.

A user-owned `create-missing-flow` maintenance Flow is an independent admitted
root Run. It may search, generate, test, and stage a proposal, but its output
remains inert until ordinary plan, review, and apply admit a new generation.
After admission, a person or application deliberately starts new root work
with a new submission key. The prior Run is never resumed, retargeted, or
replayed. This is less seamless than retaining an opaque live runner, but it is
durable across crashes, releases resident capacity, and keeps one recovery
model in v1.

There are two intentionally different semantic-choice patterns:

```text
local Router
    one runner-owned decision among a finite allowlisted route table;
    the model returns only a local route ID and code maps it to an edge or
    exact child slot; it may decide again on a later graph visit

open-ended flow/call
    one stable slot backed by a finite candidate-set snapshot atomically
    admitted with the owner's project generation;
    the kernel filters its exact approved Bindings, the optional Semantic
    Resolver ranks them, and the operation pins one result once
```

The declaration which produces that changing reviewed snapshot and any
resource ceiling are not yet specified; alternatives are tracked in the open
routing candidate note.

A software factory design may route a new ticket among an explicitly admitted
finite set such as Gauntlet and Majority-Vote without keyword gates. Routing to
later catalogue members automatically remains conditional on closing the open
candidate-universe interface. It uses a local Router when that choice is part
of its internal topology, or an open-ended `flow/call` when an admitted
implementation may satisfy an intent.
Jig Graph compiles the first problem to an ordinary Sley node and named links;
Jig's Resolver owns the component boundary. Sley itself owns neither semantic
contracts nor decision policy.

The exact Semantic Choice contract and both routing lifecycles are specified in
[`../spec/agents-and-semantic-choice.md`](../spec/agents-and-semantic-choice.md).

## 11. Security and trust

### 11.1 Trust classes

Jig distinguishes:

```text
untrusted package implementation/instruction
captured and locally approved project configuration
trusted Runtime Adapter and Sandbox Backend host extensions
bound external capabilities with explicit contracts and authority
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
application environment                         empty
extra file descriptors and host IPC             denied
raw network and child-process authority         denied
```

Agent, Git, HTTP, database, secrets, tools, and changing configuration cross
separately bound mediated `effect/call` slots. Settings are inert Binding data.
Runtime-native permission flags, such as Deno's, are generated from the same
plan as defense in depth; the outer Sandbox Backend remains authoritative.

A filesystem attachment root is normatively a **regular-tree view**. The
provisional authoring examples spell this `root()`, but the invariant does not
depend on that helper name. The view contains regular files and directories,
plus symlinks which resolve inside that root. It contains no
device nodes, pathname sockets, host-connected FIFOs, or unproved host-inode
aliases. A one-time scan plus a mutable bind is insufficient. In particular, a
visible hardlink to a protected or out-of-view inode must not expose that
inode's contents or writable identity. Before copying or mounting, the Backend
rejects a multiply linked source inode unless it can prove that every alias is
inside the same admitted nonprotected view. Writable views additionally use a
private copy/copy-on-write layer or a broker which continuously mediates path
and inode confinement. Hardlink and rename operations cannot cross view or
writeback boundaries. If the Backend cannot enforce those predicates, the
Binding is incompatible.

Protected host state—including `.jig/`, host configuration, approval receipts,
revocation tombstones, Adapter/Sandbox state, and credentials—is never part of
a sandboxed attachment view. Mapping an ancestor does not override this rule:
the Backend must omit protected descendants through an immutable snapshot or
race-safe filtered view, or reject the mapping as unenforceable. Project policy
source may remain editable because a source edit creates only a pending
candidate and cannot activate itself.

Authority is visible in four separate records:

```text
requested   package or provider resource/effect authority requested
wouldGrant  candidate project mappings and host-policy attenuation; not live
planned     closed predicates committed by the selected enforcing boundary
realized    immutable per-owner receipt after containment or projection
```

Aggregate apply admits `wouldGrant`; it does not manufacture a realized
permission receipt. Runtime planning closes the requested, admitted ceiling
into enforceable predicates, and only execution can produce `realized`
evidence. A Sandbox Backend receipts package containment. An
authority-bearing trusted host provider separately receipts the exact
Binding/provider generations, method, attenuation, and projected resources;
that proves Jig's mediation, not provider sandboxing. A provider unable to
enforce and receipt its registered projection is unavailable. Every package
execution starts with the portable baseline above: read-only prepared package
bytes and pinned Runtime Support Closure, private read-write scratch, and
protocol stdio. Ambient environment, network, extra filesystem roots or
descriptors, and host IPC remain denied until explicitly admitted. Descendant
processes are implementation details of that same owner: they receive no
independent authority, remain inside the same or a narrower envelope, share
finite resource bounds, and quiesce or are fenced before owner completion. V1
has no package-facing process or spawn grant.

The planned and realized records cover package/root visibility, write access,
regular-tree realization, environment, inherited descriptors, network and
local IPC denial, descendants, resource limits, cancellation, containment
persistence, and cleanup/fencing support. Raw containment predicates have only
these live states:

```text
plan       enforceable | unavailable
receipt    enforced
```

`advisory` may appear only in a rejected diagnostic. Mediated authority is
reported with its provider-projection receipt rather than confused with raw
process containment; a FUSE broker, namespace, seccomp rule, or runtime-native
restriction is containment evidence rather than a weaker status. Every raw
predicate in an untrusted live receipt must be
`enforced`, or launch fails `PERMISSION_UNENFORCEABLE`.

V1 admits one narrowly closed live kernel-file predicate outside the immutable
Runtime Support Closure. `root-process-mappings` is one read-only,
non-traversable view generated for the activation root, preserved across final
`exec`, and pinned to that same root when read by descendants. Its plan and
receipt prove the exact path and mechanism. It grants no pseudo-filesystem
root, host-process visibility, mutable control, or other kernel file; inability
to prove those bounds makes the recipe unavailable.

The Sandbox Backend is trusted host infrastructure, not a Flow, Starter
feature, Binding choice, or Runtime Adapter. It alone executes and supervises
every process which may consume package-controlled bytes—including exact Flow
and Service code, instruction conductors, Starter initializers, restricted
configuration evaluators, and preparation tools. Its reviewed conceptual
operation vocabulary is:

```text
probe/plan    prove whether a pinned preparation plan or launch-authority
              envelope is realizable
seal          establish a single-use containment target and fixed inputs
spawn         start exactly that target and return enforcement evidence
terminate     fence and end the complete target tree
dispose       clean host-owned resources and report failures
```

The closed request, result, receipt, registration, and error models are release
gates; these verbs are not yet a published callable SDK.

The Adapter plans; the Backend spawns. Trusted pure host parsing and bounded
opaque-blob fetching may occur without a child process, but remain journaled
preparation steps. Archive extraction and materialization of attacker-chosen
bytes occur only in sandboxed BUILD and undergo the safe-tree checks in section
4. Every host-dispatched preparation activation uses its own durable spawn
intent, Backend seal/spawn, enforcement receipt, bounded child owner, and
cleanup/fencing. One activation owns its complete descendant process tree; it
does not mint a Jig owner for each package-manager or compiler subprocess. Jig
accepts the immutable prepared snapshot only after that owner quiesces
successfully and safe-tree validation passes. The final Run or Service Mount
then receives a separate spawn intent, seal, receipt, and cleanup. Preparation
and final authority are independent minimized envelopes: preparation-only
authority is never inherited by or used to widen the final owner.

Exact execution may expose one finite immutable read-only Runtime Support
Closure containing only its pinned interpreter, loader, libraries,
standard-library data, and fixed startup files. The Adapter/toolchain recipe,
not the package or Starter, selects it. Its identity and mount map are planned
and receipted; mutable host paths, home/config, credentials, caches, project
state, IPC endpoints, and unrelated runtime trees remain outside it. Package
dependencies belong to the separately prepared tree. A Backend unable to
enumerate and seal the closure without broader visibility reports the target
unavailable.

There is no dishonest universal multi-platform sandbox. A Linux Backend may
compose bubblewrap, namespaces, Landlock, seccomp, cgroups, pidfds, and a
regular-tree broker. Those names are mechanisms, not proof. A different
platform either satisfies the same black-box predicates or rejects the
untrusted activation. V1 has no trusted-package override: a host which cannot
realize the required predicates reports the package unavailable. Trusted
host-capability providers are separately installed machinery, not a way to
execute package-controlled bytes outside the Backend.

The instruction conductor receives the same outer grant plus a tool-limited,
fresh Agent session with no ambient project, secrets, plugins, or provider
session. If the integration cannot enforce that exact per-owner projection,
instruction execution is unavailable. Trust in host-provider code does not
substitute for enforcement of the authority promised to the package.

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
registration generation, contract/method, schemas, authority, and
host-allocated deadline before provider application code sees it.

### 11.4 Host policy and inspection

Machine mechanism preferences live in one optional, closed, inert host-policy
document at the platform's normal Jig user-config location, outside every
project. It must be able to order installed Sandbox Backends, map strict
adapter selector tokens, choose suffix defaults, supply finite operation-class
deadlines, and optionally suggest an initialization Agent. The exact JSON
schema, module IDs, registration lookup, and CLI are release gates; examples
must not make hypothetical `org.jig.*` or provider aliases normative.

The effective host policy also supplies a finite positive duration in
milliseconds for every preparation, Run, Mount startup, Service invocation,
semantic choice, cancellation grace, and cleanup class. Implementations may
ship documented defaults or let the operator replace the complete local
table; a missing/unbounded effective value makes that operation class
unavailable. Jig allocates and records the chosen duration before owner
dispatch and enforces it with a monotonic clock. It is invocation evidence,
not Binding data, Starter output, or a portable Flow override. Run/1 projects
its host-authoritative cutoff through the frozen `deadlineUnixMs` field;
Service/1 deadline encoding remains a release gate.

There are no includes, merges, environment substitutions, project overlays,
or partial CLI overrides. Unknown fields fail. Unknown operational module IDs
fail only the command which needs them. A selector token narrows through its
explicit local mapping; a suffix
default is an explicit host preference when no token exists. Without a usable
preference, zero eligible Adapters is `RUNTIME_UNAVAILABLE` and more than one
is `RUNTIME_AMBIGUOUS`. Selection is never semantic. Activation pins the exact
Adapter artifact, toolchain, probe, and all selection inputs.

The Backend preference similarly orders only trusted installed mechanisms capable
of realizing the pinned preparation plan and launch-authority envelope. If the
field is absent, exactly one installed conforming Backend may qualify; zero is
`SANDBOX_UNAVAILABLE` and more than one is `SANDBOX_AMBIGUOUS`. A Starter cannot
select or weaken one. Wrapping all Flows with bubblewrap/Landlock is therefore
a normal Backend policy, not a wrapper Flow which would be too late to confine
its own parent.

The initialization Agent is merely a suggestion shown during `jig init`. If accepted, the
exact Agent becomes reviewed project Binding state. It is never consulted by
`check`, `apply`, a Semantic Choice ranker, or an active Run. The activation-policy
digest includes operational Adapter and Sandbox choices which affected it, but
excludes that suggestion. An unknown or unavailable suggestion is reported only by
`jig init` and cannot invalidate unrelated inspection, checking, or execution.

`jig init` may offer a separate host-setup step for a Runtime Adapter or
Sandbox Backend, but that step writes host policy after its own confirmation;
it is not Starter output. Bubblewrap, Landlock, or another system mechanism is
therefore a host choice applied outside every Flow, not a wrapper Flow and not
portable project policy.

Inspection is a required security capability. A future CLI may project it as:

```text
jig plan --json
jig inspect binding <id> --authority --json
jig status run <id> --authority --json
jig status service <id> --authority --json
```

Their structured output separates requested, `wouldGrant`, planned, and
realized authority so users and policy tooling can see what a component asked
for, what a candidate would admit, what the enforcing boundary promised, and
what it actually enforced. Each planned and realized record identifies whether
its boundary is a package Sandbox Backend or a mediated host-capability
projection; mediation is a boundary category, not a fifth authority stage.
The exact command spelling, JSON schemas, authentication, and transport remain
host-administration interface release gates.

## 12. Scheduler and lifecycle correctness

Jig maintains separate limits for:

```text
root admission
runnable process/provider capacity
resident waiting processes
child depth/fanout
outstanding requests/effects
host scheduling deadlines and quotas
provider-specific accounted limits
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
pinned catalogue and policy generation. Later maintenance and admission never
extend, heal, or retarget an existing owner's binding table.

Every user, CLI, GUI, or trusted module requests root work through the same
host-local operation: one active admitted Run target ID, actual Run
input, and a project-local idempotency key. Jig validates the FLOW JSON/1
boundary first. An existing same-key/same-content record returns its Run
without consulting newer policy; changed content conflicts. For a previously
unseen key, one transaction resolves and pins the current admission generation
and exact Run target, checks its gate and revocation state, and inserts the root
Run. A
reference CLI is `jig run <target-id> --input <json-file>`; it generates and
retains the key. Schema-invalid JSON/1 then terminates the allocated Run as
`INVALID_INPUT`; invalid JSON/1 allocates nothing.

This specifies admission and idempotency semantics, not a published host API.
Transport, authentication, closed request/result models, and exact CLI spelling
remain release gates.

Hook delivery shares the internal admission primitive but not the external
operation: it supplies the Hook revision's already-pinned target/generation
and `(Hook revision digest, event ID)` key, so a later project generation
cannot retarget delivery. Jig allocates or reuses the root before validating
its schema; invalid input terminates that same Run. A pair selected before
revocation still gets its unique Run, terminal and non-dispatchable when
revocation wins before dispatch. Trigger and correlation metadata are
Jig-stamped and cannot be supplied by ordinary callers. Neither path can accept
raw source, per-Run settings, attachment remapping, provider/Adapter choice,
environment, or grant overrides. The focused project-policy specification
defines this behavior; CLI spelling is not a FLOW protocol method.

Jig may start candidate Services before publication only when their complete
resource leases are compatible with active owners. “Shadow” means only that
they receive no consumer bindings; their outbound effects are real,
grant-checked, operation-journaled, attributed to the candidate, and may be
irreversible. A candidate needing a conflicting exclusive lease uses the
drain/fence/admission-switch/start sequence in section 6.3 and necessarily has
a post-publication readiness window. Projects requiring side-effect-free
preflight must use checks which need no external authority. Abandoning a
candidate cancels its Mounts and reports every committed or uncertain startup
effect; it never claims to restore the external world.

Imported-source update is a staged three-way merge:

```text
BASE        pristine revision previously adopted
LOCAL       current directly edited visible source
UPSTREAM    new pristine revision
```

Deterministic tree merge runs first. Conflicts or failed checks leave the old
activation and visible source safe. An optional maintenance Flow may repair
textual conflicts or semantic drift using BASE/LOCAL/UPSTREAM, release notes,
tests, and diagnostics, but only after an explicit operator request naming this
update transaction and an admitted maintenance Flow. Merely having an Agent
provider or maintenance Flow configured never starts repair. Agent output
remains only a staged candidate subject to the same checks and approval.

A clean deterministic merge and an Agent-repaired candidate both enter the
ordinary aggregate plan/review/apply compare-and-set. Update provenance does
not bypass admission merely because source merging succeeded.

Visible-source replacement and database publication use a recoverable update
state machine rather than claiming one cross-medium transaction:

```text
PREPARED -> SOURCE_SWITCHED -> ADMISSION_SWITCHED -> COMMITTED
```

`PREPARED` records complete old and new tuples:

```text
visible source digest
active admission generation and digest
pristine BASE source provenance, revision, and package digest
```

The new visible source is the validated merge; the new pristine BASE is the
adopted `UPSTREAM`, never that merge. Before either switch, the old tuple
remains authoritative. New admission is blocked while a switch transaction is
incomplete. Directory replacement uses same-filesystem atomic rename or fails.
The admission switch, pristine-BASE pointer, provenance history, and Hook
interval boundary publish in one Jig database transaction. On restart Jig
verifies the recorded tuple and deterministically exposes all old or all new
state before reopening admission.

`jig rollback` uses the same state machine with old/new tuples reversed,
including restoration of the prior pristine BASE. A distinct runtime-only
activation command may pin an old activation while reporting source drift and
never edits visible source or BASE provenance.

After a successful update commits, the adopted pristine `UPSTREAM` snapshot
becomes the next update's `BASE`, while the merged visible tree becomes its
`LOCAL`. Jig retains the prior provenance and update transaction for history
and rollback; it never treats the merged local tree as pristine upstream.

Read-only inspection must expose, without requiring direct access to `.jig`,
the source origin and revision, current pristine `BASE`, local divergence,
candidate `UPSTREAM` and staged merge when present, visible source revision,
active admission revision, and revisions pinned by running owners. Command
names are not normative; this visibility is.

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

### 14.2 Intended modules

The implementation should keep separately initialized facilities for:

```text
Service/1 hosting
Event Journal, inspection, and inert Hooks
Agent providers and instruction execution
Semantic Choice ranking
source/install/update tooling
Runtime Adapters
Sandbox Backends
ingress/watchers
```

A module is trusted Jig implementation code, not another public package
standard. This is intended decomposition, not a claim that these modules ship
today. Where possible, project-customizable behavior is a Flow or Service
behind the ordinary boundaries.

### 14.3 Starters

Starters own application policy:

```text
inbox, Task, Kanban, WorkItem
Git repositories, branches, and worktrees
GUI/HTTP layout
approval/checkpoint policy
application Agent roles, limits, and selection policy
semantic selection, missing-Flow maintenance, and retry policy
```

Core supports:

```text
jig init --bare
jig init --from <starter>
```

A selected Starter may run its own reviewed initializer and ask whether to add
an Agent Binding, Semantic Choice Binding, `create-missing-flow`, Git/worktrees, an
inbox, or a GUI. Those are application choices. Runtime Adapter and Sandbox
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
   and require a second approval of its exact Binding, Adapter/toolchain, Agent use,
   attachments, and authority;
5. on failure, retain a diagnosable staging transaction or restore the original
   destination—never a half-initialized active project.

The initializer receives no installer-only authority. Declining it still leaves
the copied project inspectable, and the materialized project has no continuing
Starter dependency.

### 14.4 Sley

Sley—the graph runtime previously discussed as Caskada v3 and Spindle—is an
independent graph runtime intended for a reference Run/1 component,
not a Jig executor or FLOW implementation by itself. It receives no privileged
in-process Jig path: ordinary component code composes `@flowmd/sdk` around a
Sley graph and speaks Run/1 through the same external boundary. The published
distribution names are `@jigging/sley` for TypeScript and `sley` for Python.
Sley owns and versions those APIs upstream. Exact releases remain native
package dependencies and lock evidence rather than FLOW protocol, Package/1,
or Jig Graph workflow identities.

Sley owns only live graph advancement. A `node` wraps one handler;
`context.state` is run-shared state; `context.input` is branch-local input;
`context.emit(action, input)` continues a branch; repeated emissions fan out;
and `context.end(output)` finishes only the current branch. `Flow` supplies
structured scopes, named exits, concurrency, retries, recovery, terminal
records, and an optional `combine` callback. `links()` and
`compile().describe()` expose topology without leaking internals. Definitions
contain no invocation state; each Run receives isolated bookkeeping and a
shallow copy of the initial top-level state.

Jig Graph owns a separate serializable workflow model: workflow and path
contracts, schemas, route catalogues, reference resolution, and semantic
decision policy. It compiles that model to fresh ordinary Sley nodes, links,
and nested Flows while retaining Jig IDs in Jig traces. It does not subclass
Sley graph elements, attach Jig metadata to them, import Sley internals, or
fork Sley's scheduler.

A semantic router is therefore an ordinary Sley node with an injected decision
engine and named links. Jig Graph validates the selected action and input
against its own contracts before calling `context.emit`. Sley has no Router,
Agent, capability, catalogue, permission, persistence, or provider primitive.

Sley is intentionally not a durable or distributed workflow engine. Jig owns
process lifetime, durable operations, authority, tracing, and recovery across
component loss. The Run/1 adapter and Jig Graph SDK projection—including host
effect calls and stable operation-ID derivation—must be specified outside Sley
and exercised through the same conformance boundary as imperative components.

### 14.5 Cordis as a reference integration

One Cordis realm maps to one pending Service Mount. Declared external injections
map to exact fixed dependency slots; declared serializable exports map to
static Service descriptors; complete boundary readiness maps to
`service/ready`; root disposal maps to cancellation of the mount request. Cordis
may remain reactive internally. Loss of a service needed at the public boundary
ends the Mount rather than mutating its FLOW exports or dependencies in place.

Cordis Fibers, closures, symbols, local events, and arbitrary objects remain in
the realm. Service/1 v1 proves a host-side serializable seam, not transparent
portability for arbitrary plugin objects, React components, slots, or
callbacks. A Jig-specific UI capability is valid, but it is not a universal
FLOW GUI standard. Cordis is a useful reference implementation, never a
normative Service/1 release participant.

DeepSeek Harness was used during design only as a conceptual stress test for a
large service/plugin application. Porting DSH plugins, shipping a DSH
compatibility layer, or claiming DSH portability is explicitly outside the Jig
and FLOW roadmap.

A small independent Python component should prove that Run/1 is neither
TypeScript- nor graph-specific.

## 15. Conformance and release gates

No prose-only boundary receives a stable label. Before a FLOW conformance label
is stable, FLOW must publish the applicable machine-readable schemas, state
machines, framing rules, canonicalization algorithms, closed error registry,
cross-language SDK projection, and black-box fixtures usable without Jig
libraries.

The present design is not yet independently implementable at every boundary.
Release gates apply to the slice which claims a label; unrelated interfaces do
not create a waterfall. Run/1 now has closed candidate method schemas, framing,
limits, an error registry, private TypeScript/Python SDK implementations,
clean package-install evidence, an expanded black-box matrix, and an
independent Python host for the shared golden conversation. A complete
conformance matrix passing under two independent peers still gates a stable
Run/1 label. The remaining repository gap inventory includes:

- exact closed JSON-RPC parameter, result, error-data, version-evolution, owner
  attribution, and numeric limit definitions for every Service/1 method;
- the referenced `schema-1.json` and
  `capability-contract-1.schema.json` meta-schemas;
- closed RuntimeAdapter/1 and Sandbox Backend registration, plan, seal, spawn,
  receipt, and error data models;
- one canonical `jig.lock` data model and schema;
- an authoritative TypeScript project SDK for `@jigging/jig`;
- closed provider-registration, Agent-projection, instruction-runtime,
  host-policy, and host-administration interfaces; and
- a Jig Graph definition/compiler interface which consumes only Sley's public
  API.

The complete gap inventory is
[`102-public-interface-release-gates.md`](102-public-interface-release-gates.md).

Consumer examples and implementations may not invent these interfaces while
attempting to use them. These are release gates, not permission to fill gaps
with incompatible local guesses.

Jig's broader durable diagnostic registry distinguishes at least the following
host states. These names are not the Run/1 wire registry, which is closed and
smaller in [`run-1-errors.json`](../spec/machine/run-1-errors.json):

```text
IMPLEMENTATION_UNAVAILABLE   IMPLEMENTATION_FAILED
RUNTIME_UNAVAILABLE
RUNTIME_AMBIGUOUS            PREPARATION_AUTHORITY_REQUIRED
SANDBOX_UNAVAILABLE          SANDBOX_AMBIGUOUS
BINDING_MISSING              BINDING_AMBIGUOUS
INVALID_JSON                 INVALID_PACKAGE
INVALID_INPUT                INVALID_SETTINGS
INVALID_RESULT               SCHEMA_LIMIT_EXCEEDED
SCHEMA_INVALID_JSON          SCHEMA_KEYWORD_UNSUPPORTED
SCHEMA_REFERENCE_INVALID
SUBMISSION_CONFLICT
PERMISSION_UNENFORCEABLE     FEATURE_UNSUPPORTED
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
| Package selects `bun`; host maps only `deno` | `RUNTIME_UNAVAILABLE`; no preparation or launch. |
| Selector line contains `env -S`, flags, or a path | Invalid portable package; the OS never interprets it. |
| Two Adapters qualify without host preference | `RUNTIME_AMBIGUOUS`; enumeration order is irrelevant. |
| Host requires locked preparation; Adapter reports mutable resolution | Preparation fails before launch; policy is not silently weakened. |
| Several eligible children without a ranker | Explicit ambiguity with candidates and reasons. |
| Flow package appears in a configured source | It remains inert until the project's reviewed target/admission mechanism selects it; discovery alone grants nothing. |
| Missing child | Terminal durable diagnostic. Separate staged maintenance may enable a deliberate new Run; the old operation is never resumed. |
| External success cannot be established after crash | `OPERATION_UNCERTAIN`; no automatic replay. |
| Owner returns with a live child | Admission closes; child receives `OWNER_CLOSED`; owner cannot succeed before bounded quiescence. |
| Root cancellation | New authority closes, descendants cancel, process tree is bounded and killed. |
| One of two sibling requests is cancelled | Only that request's owned subtree closes; the sibling remains live unless an explicitly recorded whole-provider fence becomes necessary. |
| Cancellation names a duplicate, stale, unknown, terminal, or opposite-direction request | Harmless no-op; the original request result or channel loss remains authoritative. A malformed cancellation notification instead closes the channel. |
| A shared Service cannot quiesce one cancelled invocation | The fixed invocation grace/deadline bounds waiting; Jig fences the provider generation and records collateral outcomes honestly. |
| Provider disappears and returns | Old binding is lost; return has a new generation; no healing. |
| Backend cannot enforce requested confinement | Package activation is unavailable; v1 has no weaker or trusted-package override. |
| Attached root contains or gains a socket, FIFO, device, or hardlink alias to protected/out-of-view state | Backend proves a confined private view or rejects the Binding; a mutable raw bind is insufficient. |
| Hook delivery repeats | It resolves to the same derived Run. |
| Upstream conflicts with local edits | Candidate stays staged and old source/activation remain usable. |
| Required setting is absent | Binding normalization fails; implementation never starts and environment cannot fill it. |
| Package requires callbacks/subscriptions | `FEATURE_UNSUPPORTED` before launch. |

Release order:

1. **Package/1:** safe metadata parser and identical canonical tree digest from
   Git/npm/OCI/local fixtures.
2. **Schema/1:** at least two validators agree on the complete keyword corpus,
   local references, JSON/1 boundary numbers and Unicode, exact structural and
   work limits, instance validity, and stable error locations for all three
   fixed schema files and Service embedded schemas.
3. **Runtime Adapters and sandboxing:** selector parsing, zero/one/many Adapter
   selection, native-constraint validation, closed planning, sandbox-only
   preparation/spawn, permission realization, cancellation, and exit behavior
   pass hostile black-box fixtures. Runtime equivalence across Adapters is not
   claimed.
4. **Run/1:** the frozen candidate schema/error registry and authoritative SDK
   declarations drive one corpus; two independently implemented Hosts and
   Components, including more than one language/runtime, agree on framing,
   child/effect calls, cancellation, duplicate operations, uncertainty,
   outcomes, and process exit.
5. **Security:** package/config extraction attacks, instruction-Agent attacks,
   direct and transitive I/O escapes, orphan processes, nonexistent/stale or
   cross-channel Service owner IDs,
   stale coordinator epochs, ambient environment/module-cache variation,
   inherited descriptors, undeclared descendants, attachment/grant widening,
   special-file and hardlink-alias insertion, kill injection around
   spawn-intent/receipt commits,
   preparation archive traversal/links/special files/expansion bombs,
   redirects/scripts/source builds, hostile or colliding LocalNames, and false
   enforcement reports fail closed.
6. **Resolution:** catalogue collisions, symlink escapes, additions, removals,
   moves, content/recipe changes, candidate-set snapshot changes, semantic
   ranker kill injection before and after external dispatch, reranking retries,
   and later maintenance/admission never change a terminal operation or an
   owner's exact candidates and authority.
7. **Capability Contract/1:** independent TypeScript and Python
   clients/providers agree from the descriptor alone on method names, wire
   value shapes, named errors, canonicalization, and equivocation, and agree
   with each contract's versioned companion specification on cross-field and
   stateful validation.
8. **Service/1:** independently implemented Providers and Hosts agree on
   pending-Mount ownership, owner-return quiescence, readiness,
   Mount-background versus invocation-owned child-call attribution,
   concurrent invocation and out-of-order response, exact fixed dependency and
   export sets, dropped readiness acknowledgement, dependency/provider loss,
   compatible shadow-first update, conflicting-lease
   drain/fence/admission-switch/start, cycles, cancellation, EOF, and crash
   fencing.
9. **Events/Hooks:** two independently implemented hosts' native canonical
   Journals survive kill injection at every append/result boundary with one
   Event and outer operation result; external effects retain generic
   uncertainty and are never replayed; protected sources/types cannot be
   forged; Hook revision intervals remain exact across concurrent Event commits
   and activation, and each selected pair creates one derived Run record—even
   `INVALID_INPUT`—when dispatch cannot succeed.
10. **Reconciliation:** kill injection at capture, preparation, candidate Mount,
   source switch, admission/BASE switch, update merge, and rollback recovers
   one matching visible-source/admission/pristine-BASE tuple before new work;
   clean updates use the ordinary admission CAS, and committed or uncertain
   candidate effects remain explicitly visible rather than being described as
   rolled back.
11. **Root admission and skills:** every frontend starts through the same
    internal admission primitive; every Agent operation selects an exact
    Flow-local skill subset (empty by default), projected owner-scoped without
    provider-directory mutation or implicit precedence; every qualifying
    provider satisfies the complete Agent projection contract.
12. **Cancellation and update provenance:** cancellation is a request-scoped
    notification and duplicate delivery is idempotent; sibling cancellation
    does not kill unrelated work, successful update/rollback atomically changes
    pristine BASE with admission, provenance remains inspectable, and Agent
    repair never starts merely because a provider exists.

The standard makes separate claims:

```text
FLOW Package/1
FLOW Run/1 Host or Component
FLOW Capability Contract/1 Descriptor/Provider/Consumer
FLOW Service/1 Host or Provider
```

“FLOW compatible” alone is not a sufficient conformance claim.

## 16. Explicit removals and deferrals

Removed from v1:

```text
package-owned command/argv, OS shebang execution, and selector arguments
FLOW Runtime Profiles, Runtime Interfaces, and author runtime digests
multiple implementation faces
automatic executable-to-instruction fallback
public Scope/Context/Mount objects
immediate mount result and service/unmount
dynamic Service dependency snapshots and post-readiness export mutation
callback/delegated/resource handles
generic subscriptions/signals/streams
range, subtyping, or closest-match inference for Capability Contracts
event/append as a dedicated Run method
arbitrary Hook callback code
settings overlays and environment fallback
portable raw network/process permissions and Grant Profiles
universal graph schema or graph continuation persistence
in-process Sley privilege
Task/Git/worktree/GUI ontology in Jig core
persistent patch overlays
mandatory central registry
false exactly-once or universal-sandbox claims
provably deterministic arbitrary TypeScript configuration
transparent DSH/plugin/UI portability
```

Deferred behind evidence, not merely time:

- `Callable/1` or `Subscription/1`, after two ecosystems converge on authority,
  replay, cancellation, backpressure, and cleanup;
- compatible contract ranges, after real version lineages and compatibility
  fixtures exist;
- structured `Telemetry/1`, after Sley and Agent integrations establish the
  minimum useful common envelope;
- channel resumption or durable runner continuation, after an epoch/fencing
  model survives crash tests;
- operation-scoped delayed first binding across admission generations, after
  real workloads justify cross-generation entitlements, resident waiters, and
  the required cancellation/activation compare-and-set state machine;
- cross-owner or cross-provider Agent session resume, after leases,
  delegation, revocation, and remote-loss semantics are proven;
- per-invocation resource projection into Service-backed providers, after a
  bounded resource descriptor and owner-scoped revocation model can project
  Skill/assets without exposing host paths or inventing generic handles;
- raw-authority Grant Profiles, only after a real package cannot use mediated
  effects and two Sandbox Backends pass one immutable direct/transitive escape
  corpus on their claimed platforms.

## 17. Final evaluation

This architecture is scalable because Run processes are finite and supervised,
Services amortize genuinely long-lived state, waits/capacity are explicitly
bounded, and semantic selection occurs at binding time rather than every call.

It is portable because packages do not encode host commands, runners retain
their internal model, Capability APIs have exact identities, and Run/1 has an
independent conformance surface. Source execution is honestly conditional on a
host-installed Adapter; FLOW does not claim that different language
toolchains are equivalent.

It is minimalist because Run/1 has four methods, Service/1 adds only one
pending provider lifetime with fixed dependencies and exports, one Binding
holds all configuration, and Flow remains the unit for complex logic—including
repair, Hook reactions, and Starter setup.

It is future-proof because the hard extensions—callbacks, streams, resumption,
compatible ranges, richer telemetry—have explicit conformance boundaries instead
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
  for the explicit fact that `#!` input has unspecified OS results. Jig
  therefore parses only its own strict one-token selector and never delegates
  that decision to OS shebang execution.
