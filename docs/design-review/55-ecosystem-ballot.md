# Ecosystem ballot: the smallest FLOW that deserves adoption

This ballot adjudicates release boundaries. It is deliberately narrower than a
complete architecture: the question is not whether a feature is useful, but
whether every independent implementation must carry it before FLOW can make a
credible v1 claim.

## Ballot

| Question | Ruling |
|---|---|
| Run and Service | Freeze Package/1 and Run/1 independently. Make Service a separately versioned, official conformance profile, not part of base FLOW conformance. Jig should implement it, but Run/1 must not wait for an unproved Service/1. |
| Callbacks and subscriptions | Do not freeze portable callback/resource handles or generic subscriptions in v1. Service v1 exchanges ordinary JSON. Use methods, durable facts, and bounded polling/long-poll where adequate, and state the limitation plainly. |
| Durable events | Remove `event/append` from Run/1. Publish durable facts through an official journal effect contract via `effect/call`; Jig commits its own lifecycle facts directly. Keep best-effort telemetry distinct. |
| Executable selection | Keep one root `flow` or `flow.<suffix>`. The package declares one exact Runtime Contract. Freeze Runtime/1 before executable Package/1; no package-authored argv and no suffix inference. |
| Public contract identity | Owner-controlled absolute contract URI, exact interface version, immutable descriptor digest, separate provider/package identity, authority evidence in the lock. No version ranges in v1. |
| Starters and repair | Core offers `init --bare` and `init --from <one starter>`. Semantic binding, generated repair, and Agent-assisted update are explicit policy, never bare defaults. |
| Adoption story | Prove a portable finite Flow, not a universal plugin platform: the same Markdown/code package runs under Jig and one independent host/runtime, calls one effect and one child Flow, and survives direct local edits plus a source update. |

The combination is intentionally asymmetric:

```text
FLOW Package/1 + Run/1
    small universal execution boundary

FLOW Service/<version>
    official optional profile for long-lived providers

Jig
    implements both, but does not redefine either as mandatory
```

That is not relegating Service to an unofficial experiment. It is refusing to
make every small host implement mounting, generations, reverse invocation, and
draining merely to run a finite Flow.

---

## 1. Must Service be part of base FLOW v1?

### Strongest case for making Service base

The motivating ecosystem is larger than a prompt runner. Cordis and DSH derive
much of their power from long-lived services, late dependency availability,
reactive providers, and application extensions. If FLOW launches only finite
work, adopters may reasonably see it as another task protocol beside MCP,
Skills, and framework-specific subprocess APIs. A later Service standard could
fragment after hosts have already invented incompatible mounting APIs.

A single headline version is also easier to explain:

```text
FLOW/1 host
    can run Flows and mount Services
```

### Strongest case for separate conformance

The implementation burden is qualitatively different. Run needs one bounded
invocation, child calls/effects, cancellation, and one terminal result. Service
needs a lifetime after initialization, export registration, availability
generations, reverse invocation, provider loss, binding leases, replacement,
and draining. Requiring that state machine blocks small Python, shell, embedded,
and serverless hosts from claiming conformance even when their Run behavior is
perfect.

The current Service design has already exposed unresolved ownership and drain
semantics. Freezing those because the Run ABI is ready would make the standard
less credible, not more competitive.

### Ruling

**Service is an official, separately versioned conformance profile. It is not a
base requirement of FLOW Package/1 or Run/1.**

Conformance labels must be literal:

```text
FLOW Package/1
FLOW Run/1 Host
FLOW Run/1 Component
FLOW Service/1 Host
FLOW Service/1 Provider
```

“FLOW/1 compatible” by itself is not a sufficient product claim.

Service may normatively reuse the Run wire schemas for cancellation,
`flow/call`, `effect/call`, and telemetry. Its own suite must test those imported
schemas; a Service host does not need to claim full Run-host conformance.

Jig should implement Service because Jig wants Cordis/DSH-class extensibility.
That is a Jig product commitment, not a tax on every FLOW adopter. If the plain
provider and Cordis-realm prototypes pass the complete lifecycle suite before
the first public release, publish Service/1 alongside Run/1. If they do not,
publish Service/0.x as an official preview without delaying Run/1.

FLOW may claim parity with service/plugin systems only after Service/1 is stable
and independently implemented. Until then its honest claim is portable finite
work plus an official path toward mounted services.

### Rejection test

Reverse this ruling only if either is demonstrated:

1. a genuinely small independent Run host can implement the full Service state
   machine with negligible additional surface; or
2. three target adopters cannot use FLOW at all without mounting during their
   first integration.

Conversely, reject Service/1 stability if a plain provider and a Cordis realm do
not agree under tests for mount ownership, status ordering, provider loss,
generation replacement, static dependency loss, drain, cancellation, and
process death.

---

## 2. Callback handles now, facts and polling, or generic subscriptions?

### Strongest case for callback handles now

Callbacks-as-Services are an elegant reduction: instead of inventing an event
subscription protocol, pass a contracted callback capability and invoke it
through the same Service machinery. UI registration, streaming observations,
and Cordis-style reactive components become expressible. Deferring callbacks
means FLOW Service/1 cannot honestly import many client-oriented DSH plugins.

### Strongest case against them

A JSON string is not a capability. Portable callback handles require normative
answers for minting, attenuation, routing to an exact provider generation,
delegation to children, replay, revocation, owner cancellation, release races,
provider loss, and finite-Run publication. Neither `effect/call` to a static
slot nor ordinary Service invocation currently supplies those semantics.

Generic resource handles bring the same problem plus cleanup transfer. Freezing
an attractive type name without its authority protocol guarantees incompatible
implementations and security bugs.

### Ruling

**Contract/1 and Service/1 v1 exchange ordinary JSON values only.** A contract
may define an opaque application ID and explicit `close`, `release`, `poll`, or
`readSince` methods, but FLOW gives that ID no universal bearer authority or
cleanup guarantee.

For v1, portable reactive behavior is deliberately bounded:

- a Service can expose query, poll, and bounded long-poll methods;
- providers and consumers can append durable facts to a bound journal;
- a Jig Hook can react to a fact and start a new finite Run;
- application-local realms may use native callbacks internally;
- host-specific UI contracts may use host-specific callback machinery, but do
  not become generally portable by doing so.

Do **not** add a generic subscription stream to compensate. It immediately
introduces subscription ownership, backpressure, cursoring, disconnect/replay,
and cancellation semantics that Run/1 otherwise avoids.

The specification must publish the limitation, not hide it:

> Service/1 v1 does not carry portable live callback capabilities or unbounded
> subscriptions. Components requiring them are host-local, use bounded polling
> or durable facts, or require a future separately conforming extension.

This means Service/1 v1 supports useful session stores, command registries,
indexes, databases, and many host APIs. It does **not** yet establish full DSH
GUI/plugin portability.

### Rejection test

Add a Handle/1 or Subscription/1 profile only after two independent providers
and two consumers demonstrate the same semantics for:

```text
forge
delegate
narrow lifetime
cancel owner
release twice
race release with invoke
lose provider generation
reconnect/replay
backpressure
```

If two real priority integrations cannot meet acceptable latency/resource use
with methods, facts, and bounded polling—and independently converge on the same
missing abstraction—the deferral is falsified. “A callback would be nicer” is
not enough.

---

## 3. Is durable append a Run primitive?

### Strongest case for `event/append`

Jig is file- and event-native. Reliable facts drive Hooks, audit, recovery, and
Agent completion. A named protocol method visibly distinguishes acknowledged
durable publication from disposable telemetry and prevents projects from
binding semantically incompatible “event” providers. It also lets the host
authenticate the publisher and stamp correlation metadata.

### Strongest case for a journal effect

`effect/call` already exists to request an acknowledged, schema-checked,
binding-scoped host operation with an operation ID and durable result. A second
wire method duplicates that machinery and taxes every small Run host, even one
which has no journal. Query and wait were already going to be ordinary journal
operations, so special-casing only append creates a split API.

### Ruling

**Remove `event/append` from Run/1. Publish durable facts through an official
Durable Journal effect contract using `effect/call`.**

Conceptually:

```text
effect/call(slot = "facts", operation = "append", input = ...)
effect/call(slot = "facts", operation = "query", input = ...)
effect/call(slot = "facts", operation = "wait", input = ...)
```

The package declares that exact effect requirement. A host without it rejects
the binding before launch; it does not pretend to support events and fail
mid-Run. The host authenticates the bound owner and supplies protected fields:

```text
fact id
committed time
producer identity
Scope and Run correlation
operation identity
```

The caller supplies only an allowed type/subject, optional schema identity, and
data. The journal contract defines size limits and append idempotency. A
CloudEvents mapping is informative, not normative.

Jig-owned lifecycle facts are different. Jig commits them directly through its
kernel outbox, including `agent.completed` in the same transaction as the Agent
effect result. Components do not forge those namespaces.

`telemetry/emit` may remain a separate optional notification because its
contract is expressly best-effort, lossy, bounded, droppable, and not a basis
for Hooks or correctness. It may also be omitted entirely by minimal hosts.

Short journal waits may remain live within the Run deadline. Long external
waits return a domain outcome such as `waiting`; a Hook starts another Run.
FLOW v1 does not persist an arbitrary graph continuation.

### Rejection test

Restore a base append method only if the generic effect route cannot satisfy
all of these in two independent hosts:

- authenticated producer stamping;
- atomic operation-result and fact commit where promised;
- idempotent retry;
- preflighted availability;
- bounded payloads; and
- a single ordering definition for append/query/wait.

If an implementation bypasses the bound journal to gain those properties, the
effect abstraction is insufficient.

---

## 4. Runtime Contract/1 and the root executable convention

### Strongest case for a package launch descriptor

An explicit executable plus literal argv is familiar, independently
implementable, and easy to inspect. It avoids a new runtime registry. A package
can launch an unusual runtime without waiting for a standard Runtime Contract.

### Strongest case for a runtime-owned launch contract

Package-authored argv is the beginning of a runner-profile language. It repeats
runtime flags across packages, creates quoting and portability risks, lets
untrusted packages alter launch semantics, and makes hosts disagree over
preparation. Suffix inference is equally weak: `.ts` does not determine Deno,
Bun, Node, permissions, dependency preparation, or protocol behavior.

The source tree also needs one obvious executable. Multiple runtime faces make
the installed package's behavior host-dependent and complicate local edits and
updates.

### Ruling

**A Package has exactly one root executable named `flow` or
`flow.<single-suffix>`, and exactly one declared Runtime Contract.**

The suffix is an authoring and tooling hint. It never selects the runtime. A
native build for another target is another package revision, not a second face
inside the package.

Freeze executable Package/1 only after Runtime/1 defines an independently
testable provider interface. At minimum a Runtime Contract artifact declares:

- owner-controlled identity, exact contract version, immutable digest;
- accepted artifact kind(s) and platform tuples;
- a deterministic, shell-free `plan(entryPath, packageSnapshot, grants)`;
- provider-owned literal launcher argv and bounded environment policy;
- preparation inputs, outputs, provenance, and cache key;
- cwd, stdio framing, exit, cancellation, and process-tree behavior;
- how the component is required to speak Run/1 or Service/1; and
- a provider conformance suite.

The activation lock records the exact Runtime Contract descriptor, provider
revision, preparation result, launch-plan digest, package snapshot digest,
platform, and effective grant report. Runtime provider configuration may pick
an implementation but may not silently change contract semantics.

Package metadata declares the exact Runtime Contract version for v1, not a
SemVer range. Runtime evolution is an ABI decision; compatibility should be
earned by conformance evidence before range matching is standardized.

There is no package-authored `argv`, shell command, shebang dependency, or
runner-profile filename. Runtime-specific configuration belongs in ordinary
runtime-owned config files defined by that Runtime Contract.

### Rejection test

Before freeze, build two providers for one Runtime Contract and require
byte-equivalent normalized launch plans for the same snapshot/grants, plus the
same preparation and cancellation results. Also run two package revisions with
the same root suffix but different declared runtimes and require no inference.

Reconsider constrained package arguments only if a representative corpus shows
that more than a small minority of packages cannot be expressed through source
and runtime-owned configuration. Any future argument facility must be typed by
the Runtime Contract, not be an arbitrary string array.

---

## 5. Minimum governance and identity for public contracts

### Strongest case for SemVer ranges and semantic discovery

Exact interfaces can create dependency lockstep. Public packages are familiar
with `^2`, and compatible minor versions should not require adapters. Semantic
selection among implementations is one of Jig's differentiators.

### Strongest case for exact matching first

SemVer does not prove behavioral or schema compatibility. A public contract
with no authority rule can be squatted or equivocated. Natural-language intent
does not establish wire compatibility. Adding ranges, signatures, executable
conformance Flows, quality scoring, and registries at once turns Contract/1
into a package manager and trust framework before a single stable interface
exists.

### Ruling

The minimum public identity tuple is:

```text
contract family: owner-controlled absolute URI
interface version: exact
descriptor digest: exact immutable content digest
```

The provider/package identity is separate:

```text
source locator
resolved revision
package content digest
provider registration generation
```

And authority evidence is separate again:

```text
resolved owner/source authority
signature or configured trust root when available
TOFU/key continuity when explicitly selected
recorded rotation evidence
```

Rules for v1:

1. Contract descriptors are immutable. Same family/version with a different
   digest is equivocation and is quarantined.
2. Consumers require an exact interface version. Providers may implement more
   than one exact version.
3. No mandatory central registry owns identities. Indexes advertise signed or
   source-verifiable claims and are never compatibility authorities.
4. SemanticRouter may rank only providers already matching the exact contract.
5. Contract descriptions, examples, and conformance fixtures are evidence, not
   identity. An executable conformance Flow is optional, never automatically
   trusted or recursively mandatory.
6. Local opaque Services remain valid and are explicitly marked non-portable.
7. A compatibility adapter is an ordinary provider with exact `uses` and
   `provides`; generated adapters are staged, tested, and approved before bind.

Thus a consumer requiring `review` interface version 2 does not match providers
for versions 1 or 3. It needs a v2 provider, an explicit adapter, a consumer
update, or remains unresolved. “Newer” and “semantically close” have no role.

Add compatible ranges only after real successive interface versions provide a
normative compatibility rule and cross-version fixtures. Version syntax should
then constrain deterministic filtering; the SemanticRouter still must not
override it.

### Rejection test

Attempt dependency confusion with the same friendly name from two sources,
contract equivocation under one URI/version, an index takeover, signer rotation,
and a provider claiming a contract without its exact digest. Every host must
make the same compatibility decision and preserve the evidence used.

If exact matching in a real corpus causes adapter proliferation for genuinely
backward-compatible minor revisions, quantify that cost and standardize ranges
with explicit compatibility fixtures. Do not preemptively promise it.

---

## 6. Starter, initialization, and semantic repair defaults

### Strongest case for a guided default

A bare microkernel is not a usable product. New users expect an inbox, Agent
selection, a visible board or output path, and a working Flow. Requiring them to
understand Scopes, bindings, Runtime Contracts, and grants before the first Run
will kill adoption. Agent-native repair is a compelling advantage and should
feel automatic.

### Strongest case for explicit policy

Every guided choice encodes an application model. A universal feature matrix
inside `jig init` recreates a framework and makes generated projects depend on
hidden installer history. Automatic semantic binding or generated providers can
silently change authority and execute newly synthesized code. Automatic Agent
merge repair can plausibly preserve the wrong local intent.

### Ruling

Core has only:

```text
jig init --bare
jig init --from <one-starter>
```

A Starter is copied once and becomes ordinary user-owned source. It may run its
own questions or setup Flow after inspection/approval, but Jig has no universal
feature algebra, inheritance, or ongoing starter dependency.

A project may designate one recommended starter in documentation or CLI UX;
that does not make its Task/Kanban/Git model kernel behavior.

Bare defaults are conservative:

- exact explicit bindings first;
- deterministic compatibility and grant checks;
- ambiguity and absence fail with durable diagnostics;
- SemanticRouter is opt-in per binding policy;
- missing-provider generation is off;
- Agent-assisted source update is off;
- executable packages receive no undeclared authority;
- instruction mode requires an explicitly configured Agent and effective
  sandbox/grant policy.

A Starter can deliberately enable semantic selection among compatible
candidates. It should still persist the chosen provider and evidence before
use. Missing-dependency repair is an explicit command or event policy:

```text
search -> stage -> inspect -> test -> approve -> install -> bind
```

Never “generate and execute in the blocked Run.” The Run becomes pending or
fails according to declared policy; repaired desired state is reconciled and a
new attempt starts.

Source updates remain deterministic first:

```text
base + local + upstream -> isolated three-way merge -> checks
```

An Agent may repair only unresolved textual/semantic conflicts when explicitly
requested. The visible component remains the complete directly editable source;
no persistent runtime patch overlay exists.

### Rejection test

Run usability studies separately for `--bare` and the recommended Starter. If
most intended first-time users cannot complete the advertised first workflow,
improve the Starter, diagnostics, or project-owned setup Flow—not the kernel
defaults. Reject any default that installs, generates, rebinds, or executes code
without leaving a reviewable staged revision and durable decision record.

---

## 7. The smallest credible v1 adoption story

### Strongest case for a broader launch

The vision includes graph runners, Cordis realms, coding Agents, public Flow
discovery, long-lived Services, Hooks, updates, and repair. A tiny demo risks
making FLOW look indistinguishable from “Markdown plus JSON-RPC.” Ecosystem
builders need confidence that the architecture reaches their advanced use
cases.

### Strongest case for a narrow proof

Standards gain adoption through one repeatable interchange, not through the
number of future facilities in their document. A broad demo can hide Jig-only
assumptions and call them portable. The first release must prove that an
independent implementer can build the boundary without importing Jig.

### Ruling: the v1 story

The credible first story is:

1. Install Jig and create one project from a user-owned starter.
2. Add a FLOW package containing `FLOW.md` and either no executable or one root
   `flow.<ext>` with an exact Runtime Contract.
3. Configure one Agent/effect provider and one explicit child-Flow binding.
4. The Starter submits ordinary input and allocates a private Space.
5. Jig snapshots the package and config, resolves grants and exact bindings,
   and launches it out of process through Run/1.
6. The component uses one `effect/call`, one `flow/call`, emits disposable
   telemetry if desired, and returns `{ outcome, output }`.
7. A durable fact, when used, goes through the explicitly bound journal effect
   and triggers a local Hook/new Run—not a suspended continuation.
8. The same executable package runs under a second independently implemented
   Run/1 host or SDK in another language.
9. The user edits the installed files directly; `jig check` validates an
   immutable snapshot; `jig update` preserves the edit with an isolated
   deterministic three-way merge and atomic activation.
10. Caskada is demonstrated as one external graph runtime using exactly this
    path, with no in-process exception.

That is enough to establish genuine value over Agent Skills:

```text
Skill
    portable instructions loaded into an Agent

FLOW
    portable independently invoked package with a bounded runtime/effect
    boundary, outcome, cancellation, and optional executable
```

It is also enough to establish value over a framework-local graph: the package
does not require the host to understand its internal graph.

Service/1 should have a separate launch proof: one plain provider and one Cordis
realm expose the same small session-store-style contract, survive provider
loss/replacement, and pass the same host suite. It does not need to block the
finite-Run story.

### Claims FLOW/Jig v1 must not make

Do not claim:

- universal graph portability, inspection, or crash resumption;
- arbitrary live continuation across process/host restart;
- exactly-once external effects or Hook delivery;
- portable callbacks, live subscriptions, or generic resource cleanup;
- transparent import of DSH/Cordis GUI plugins;
- universal Service support from every FLOW host;
- that JSON Schema proves behavioral compatibility;
- that a SemVer range proves interface compatibility;
- that semantic routing can repair an incompatible contract;
- that `FLOW.md` and an executable are semantically equivalent by construction;
- that every OS can enforce every grant equally;
- that instruction-only execution is safe without an appropriately constrained
  Agent; or
- that a public index is a trust root or mandatory registry.

The supportable claims are narrower and stronger:

- a predictable package can be inspected without executing it;
- finite components can run across conforming Run/1 hosts;
- host effects and child Flows cross one explicit, cancellable boundary;
- packages can remain graph-, language-, and Agent-provider-neutral;
- compatibility decisions are deterministic before semantic ranking;
- exact selected sources, runtimes, grants, bindings, and operations are
  journaled; and
- local edits remain ordinary source and survive updates through a reviewable
  transaction.

### Rejection test

Do not call Run/1 stable until an independent team, using only the published
specification and fixtures, can implement a host or SDK and run the same package
with the same outcomes, cancellation, duplicate-operation, and failure
behavior. The reference test must include a non-TypeScript implementation and a
Caskada package that receives no privileged path.

Do not call the ecosystem portable if successful execution still requires
Jig-specific imports, an undocumented `jig.ts` convention, a hidden default
Agent, a particular registry, or a runtime provider unavailable outside Jig.

---

## Release verdict

The architecture is adoptable if it resists two equal and opposite failures:

```text
too little specification
    "portable" packages launch differently, lose ownership, or trust strings
    as capabilities

too much specification
    every host must implement Cordis-class services, subscriptions, package
    management, semantic repair, and Jig policy merely to run one Flow
```

The correct v1 boundary is therefore:

```text
stable now
    Package/1
    Runtime/1
    Run/1
    exact effects and bindings needed by a package

official but independently gated
    Service/1
    Contract/1 for ordinary JSON request/response methods

deferred until independently proved
    portable callback/delegated handles
    generic resource handles
    generic subscriptions
    SemVer range compatibility
    durable live graph continuation
```

This lets FLOW compete immediately where its design is strongest—portable,
file-native, finite agentic work—without abandoning the long-lived Service path
required for Jig to grow into a serious application host. Minimalism here is
not feature deletion. It is making every stable claim independently true.
