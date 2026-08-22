# Minimalist adjudication ballot

This ballot optimizes for the smallest boundary that two independent
implementations can obey safely. It does not optimize for the fewest lines of
prose. A concept earns a place only when removing it causes a named failure at
the FLOW boundary.

## Ballot summary

| Dispute | Vote |
|---|---|
| Mount ownership | Keep `service/mount` pending for the Mount lifetime; do not add `mountId` in v1 |
| Contract/1 | Methods, values, and named application errors only |
| Durable facts | Remove `event/append` from Run/1; use a bound Events operation through `effect/call` |
| Service/1 status | Stable optional FLOW profile, required for Jig v1's service-portability claim |
| Runtime Contract/1 | An immutable semantic launch standard plus a black-box conformance corpus, never package-owned argv |
| Semantic resolution | Deterministic Resolver in the Jig kernel; semantic ranker as an optional powerless module |
| User configuration | One trusted `jig.ts`; one immutable Flow Binding abstraction; no settings overlays |

The cuts are related. A pending request is already a lifetime. An effect slot is
already a mediated operation gateway. An ordinary Service method is already a
typed cross-boundary call. FLOW should not add a second noun for any of those
jobs.

---

## 1. Mount ownership

### Vote

In Service/1 v1, `service/mount` remains pending for the complete Mount
lifetime. Its host-created request ID is the owner for Mount-background work.
The first acknowledged `service/status` snapshot establishes readiness.
Bidirectional `request/cancel` initiates shutdown. The final mount response
reports clean termination or initialization failure.

Delete `service/unmount`. Do not add `mountId`.

This is intentionally tied to the v1 rule of one Mount per process. The
request's authority is valid only on its authenticated process/transport and
only while that request remains live. A pending protocol request is a ledger
record, not a scheduler worker or execution token; it may live for months
without consuming dispatch capacity.

### Decisive invariant

> One long-lived component has one root lifetime and one terminal event.

The pending request already supplies identity, authority, cancellation,
failure, and completion. Immediate mount response plus `mountId` creates a
second state machine solely to reconstruct the lifetime that the response just
ended.

### Exact v1 lifecycle

1. The host sends one `service/mount` request.
2. Initialization-time and later background outbound calls name that live
   request as owner.
3. The provider publishes a monotonically versioned full status snapshot.
   Before the first accepted ready snapshot, no invocation is admitted.
4. Individual `service/invoke` requests are narrower owners for work caused by
   those invocations. Cancelling one invocation does not cancel Mount work.
5. To stop the Mount, the host stops ingress and sends `request/cancel` for the
   mount request. Already admitted work drains or is cancelled under the
   declared deadline; no new outbound work is admitted after revocation.
6. The provider performs local cleanup and answers the mount request. EOF,
   process death, deadline, or an unsolicited terminal response ends the Mount
   and loses every registration.

`service/status` has one authority: the status stream. The mount response does
not also report availability. Snapshot omission means immediate loss, never an
inferred drain. Graceful upgrades use two Mounts: the old Mount continues to
advertise its old registrations while its pinned consumers drain; the new
Mount serves new bindings.

### Rejected choice: host-minted `mountId`

It can be made correct, but no required v1 scenario needs it. Its smallest new
failure is the split terminal race:

```text
service/mount replies "initialized"
    || host records/activates mountId
    || provider exits or unmount races a background call
```

The specification must then define which of response, Mount record, process,
and unmount request is authoritative, and it must make that transition durable.
The pending model has only one live-to-terminal transition. A transport that
pools several Mounts may justify an explicit lifetime handle in Service/2; v1
must not pay for that hypothetical transport.

### Minimum specification and tests

Specify reentrant duplex RPC, bidirectional cancellation, first-terminal-wins,
status readiness, owner validation, shutdown admission, and EOF behavior.

Tests must cover:

- background dependency call after readiness;
- concurrent background work and two invocations;
- cancellation of one invocation without affecting the Mount;
- graceful mount cancellation and forced deadline;
- forged, completed, cross-process, and cross-Mount owner request IDs;
- cancellation/response/EOF/background-dispatch races at every transition;
- provider crash and restart, proving that no old registration heals;
- two-Mount rollout, proving that old consumers remain pinned while new ones
  bind the new Mount.

If an implementation cannot keep an RPC request pending without tying up a
worker, that implementation is defective; FLOW should not add protocol state
to accommodate it.

---

## 2. Service Contract/1 surface

### Vote

Contract/1 v1 defines only:

```text
canonical owner-qualified identity
exact interface version
method names
method input and output schemas
named application errors and error-data schemas
closed JSON Schema definitions
```

Values are ordinary bounded JSON. Protocol failures are distinct from tagged
application errors. There are no portable resource handles, delegated-Service
handles, callback handles, facts, signals, subscriptions, streams, or embedded
conformance executables in the stable meta-schema.

A contract-owned opaque string ID is legal application data. Its release and
validity are that contract's method semantics; FLOW makes no bearer-capability,
automatic-cleanup, or delegation claim about it.

### Decisive invariant

> A Contract describes values accepted by a named operation; it does not create
> a distributed object system.

Methods and errors can be implemented independently from a static descriptor.
A delegated callback handle cannot. It requires minting, nominal type proof,
delegation, routing, attenuation, transfer, revocation, release, provider-loss,
cycle, and finite-Run lifetime rules. That is a separate protocol, not one more
JSON Schema annotation.

### Rejected choice: delegated callback Service handles now

The smallest failure is a finite Run registering a callback and then ending
before the callback arrives. A host must decide whether the receiver borrowed,
shared, or extended that authority, which provider generation receives the
call, and whether a replay after owner closure is forged or merely late. None
of those answers follows from a method schema.

The Cordis v1 gate does not prove callbacks are required. It requires one realm
to export and consume declared serializable services, react to dependency
appearance/loss, and clean up. Those cross through ordinary Service methods and
binding snapshots. A Jig-specific UI bridge may remain host-specific in v1.
It must not smuggle a universal delegated-object model into FLOW to make a UI
registration API look generic.

If a future portable UI or second independent ecosystem proves dynamic reverse
calls indispensable, define and version a separate Handle/1 or Callback/1
profile. Do not mutate Contract/1 silently.

### Rejected choice: generic subscriptions now

The smallest failure is disconnect between delivery and cursor commit. Without
choosing snapshot, replay, ordering, backpressure, acknowledgement, retention,
and owner-transfer semantics, two conforming-looking providers lose or
duplicate different notifications. `subscribe()` is not a generic method; it
is a bundle of lifecycle promises.

V1 alternatives are explicit and honest:

- a bounded request remains pending until one change;
- a snapshot plus `changesSince(cursor)` method;
- polling;
- a durable fact observed by project policy which starts a new Run;
- a host-specific adapter kept inside one realm.

### Minimum specification and tests

Freeze one closed descriptor meta-schema, JSON Schema dialect/profile and
resource limits, canonical JSON digest, identity/version equivocation rule,
application-result envelope, protocol error registry, and SemVer compatibility
guidance.

From the descriptor alone, independent TypeScript and Python clients/providers
must agree on:

- valid and invalid input/output;
- every named application error;
- undeclared method/error rejection;
- cancellation and provider loss as protocol/lifecycle failures;
- schema depth, external-reference, unknown-keyword, and resource limits;
- descriptor canonicalization and same-ID/version equivocation.

The rejected features may enter only after two unrelated ecosystems implement
the adversarial cross-process lifetime suite, including forgery, replay,
delegation, owner cancellation, release race, provider loss, and synchronous
wait-cycle detection.

---

## 3. Durable facts in Run/1

### Vote

Remove `event/append` from Run/1. A component appends a durable public fact by
calling a bound Events provider through the existing `effect/call` gateway:

```text
slot: events
operation: append
input: { type, subject?, schema?, data, causation?, correlation? }
```

The Events contract and Jig Events module define the exact Fact envelope,
producer/type authority, durable acknowledgement, retention disclosure, and
query/wait operations. A Run-only host need not implement or pretend to
implement it. A package that depends on durable facts declares the Events
effect slot and fails activation when it cannot be bound.

Host lifecycle facts such as Run completion are committed directly by the host.
An effect provider may return authenticated lifecycle facts alongside its
result so Jig can commit result and facts in one operation-ledger transaction.
That internal provider envelope is not a component-facing second append API.

Keep disposable `telemetry/emit` only if operational progress without semantic
consequence has demonstrated value. It must never drive Hooks or completion.

### Decisive invariant

> Run/1 needs one gateway for host-mediated operations, not one top-level method
> per important Jig service.

Durable append needs exactly the same owner, operation ID, canonical request
digest, grants, provider binding, cancellation, uncertainty, and ledger rules
as every other effect. A separate method duplicates those rules and makes an
optional Jig facility appear to be part of the universal runner ABI.

### Rejected choice: `event/append` as a Run/1 primitive

The smallest failure is a minimal host with no durable journal. The method is
present in its protocol but can only fail `EVENT_JOURNAL_UNAVAILABLE`, possibly
after a package has already performed work. Required-facility metadata can move
that failure earlier, but then it has recreated an effect dependency outside
the normal slot/binding system.

The more serious failure is semantic drift: a crash after event commit but
before reply must replay by owner, operation ID, and digest exactly like
`effect/call`. Two ledgers or two subtly different deduplication specifications
can produce a duplicated Hook fact even when the external effect result was
replayed.

### Minimum specification and tests

The Events service must define an exact inert Fact envelope. Jig stamps event
ID, producer identity, commit time, Run/operation correlation, and protected
namespaces; untrusted code supplies only granted fields. Append success means
the fact and operation result are committed before acknowledgement.

Tests must cover:

- crash before intent, after intent, after fact commit, and before response;
- retry with same ID/same digest and same ID/different digest;
- unauthorized producer/type namespace and forged lifecycle facts;
- effect result plus authenticated facts committed both-or-neither;
- Hook redelivery without duplicate derived Run scheduling;
- host lacking the Events provider, rejected before launch;
- dropped telemetry having no effect on any result, fact, or Hook.

If a second non-Jig host later proves durable facts are universal enough to be
mandatory for all Run implementations, `event/append` can become a future
required Run facility. Optional-but-top-level is the least coherent position.

---

## 4. Service/1 release status

### Vote

Service/1 is an official, stable, **optional conformance profile** in the FLOW
v1 family. It is not required to claim Package/1 + Run/1 conformance. Jig v1
must ship it and must not claim stable service portability until its independent
release gates pass.

This is a release dependency, not a license to freeze unfinished prose. The
profile receives a `1.0` identifier only after the plain provider, Cordis realm,
and independent host interoperate from the published schemas and state machine.
Before that point it is a release candidate, not a user-facing experimental API
on which Jig quietly builds permanent modules.

### Decisive invariant

> Optionality protects small hosts; stability protects portable services.

Jig's stated ambition includes long-lived, multi-operation providers and a
Cordis boundary. Calling that boundary experimental while shipping Jig v1
would push real Agent, UI, session, and compatibility providers onto private
Jig APIs. Those private APIs would become the actual standard and make the
later FLOW profile a migration project.

### Rejected choice: experimental Service support in stable Jig v1

The smallest failure is the same session provider mounted by two Jig projects.
One project treats disappearance as immediate loss; the other silently rebinds
after restart. Both can claim to use “experimental Services,” but a consumer
pinned to a provider observes different correctness. Once packages and locks
encode either behavior, changing it is breaking.

### Rejected choice: make Service/1 mandatory for every FLOW host

The smallest failure is the required plain Python Run-only implementation. It
would have to implement mounting, registrations, dynamic dependency snapshots,
draining, and provider loss despite executing only one finite request. That is
pure tax and would weaken the language-neutral conformance proof.

### Minimum stable Service/1

The profile needs only:

```text
host -> component
    service/mount       one pending lifetime request
    service/invoke      one exact registration operation
    service/bindings    monotonic full snapshot for declared dynamic imports
    request/cancel      bidirectional cancellation of an originated request

component -> host
    service/status      monotonic full export-availability snapshot
    flow/call           inherited Run operation
    effect/call         inherited Run operation
    telemetry/emit      optional non-semantic observation
```

There is no `service/unmount`, callback call, generic signal, subscription,
resource handle, or Service-specific event primitive. Static imports never
change. Dynamic snapshots are opt-in. Status removal means lost. Cross-version
graceful rollout is a Jig operation over two Mounts, not an in-Mount wire mode.

The stable gate requires:

- a plain long-lived provider and a Cordis realm;
- readiness, invocation, concurrent calls, dynamic dependency change,
  dependency loss, provider crash, and cleanup;
- strict pinning with no transparent replacement;
- static and runtime wait-cycle rejection;
- bounded scheduler capacity which excludes lifetime-wait records;
- two-Mount activation, drain, and rollback;
- a second implementation written without importing Jig internals.

The gate claims a host-side Cordis service seam, not arbitrary DSH browser/UI
portability.

---

## 5. Runtime Contract/1 exact minimum

### Vote

A Runtime Contract is an immutable, owner-qualified **semantic launch
standard**, not a command template, a filename association, or a provider
advertisement. A package names its required contract and compatible version
range in `FLOW.md`; activation resolves and locks one exact contract revision
and one conforming Runtime Provider.

The package still contains exactly one obvious root implementation,
`flow` or `flow.<single-suffix>`. The suffix is informative and must be admitted
by the selected Runtime Contract, but never selects a runtime. A `flow.ts`
declared for Deno must not run under Bun merely because both read TypeScript.
The host never executes through a shell, OS file association, `PATH` ordering,
or package-controlled argv. A shebang may exist for local convenience but has
no portable authority.

### Decisive invariant

> Two providers claiming one Runtime Contract must make the same immutable
package observably equivalent at the FLOW boundary.

A URI label and SemVer number do not establish that. A generic `argv` field
also does not establish it; it merely moves runtime-specific policy into every
package.

### Normative Runtime Contract artifact

Each exact Runtime Contract revision consists of:

1. an owner-qualified ID, exact SemVer version, canonical descriptor digest,
   authority evidence, and immutable normative text;
2. admitted implementation name/suffix forms and platform limits;
3. the runtime binary/version probe rule;
4. exact package-root, entry-path, working-directory, stdio, environment, and
   argument semantics;
5. dependency preparation and lock/cache/network rules, including what occurs
   before sandbox entry;
6. mapping obligations from FLOW grants to runtime flags and the enforcement
   report;
7. Run/1 framing, cancellation/signal, exit, and diagnostic behavior;
8. a digest-pinned black-box conformance corpus.

The descriptor is metadata for identity and discovery, not a universal launch
DSL. Normative text and fixtures define behavior which cannot honestly be
reduced to fields. A Runtime Provider is host code that claims an exact
contract revision. Its local API is not standardized in FLOW v1. Activation
pins provider identity/digest, runtime binary identity/version/digest, platform,
preparation result, launch-plan digest, and sandbox enforcement report.

Native platform variants are distinct immutable package revisions in v1. An
index may group their source lineage; it may not choose a mutable binary after
the package digest is locked.

### Rejected choice: identity label without a standard and fixtures

The smallest failure is Python launched from different working directories:
one provider imports a sibling package from the immutable component; another
imports an ambient project module through `PYTHONPATH`. Both claim the same
runtime URI/version but execute different programs with different authority.

Equivalent failures arise from Deno dependency fetching, Bun lock handling,
Windows signal mapping, inherited environment, and permission flags. Recording
different launch-plan digests diagnoses the divergence after the fact; it does
not provide portability.

### Rejected choice: package-owned argv or suffix/shebang inference

The smallest argv failure is a package containing flags for one provider's
binary layout which another conforming host cannot satisfy without rewriting
the command. The smallest inference failure is Deno-specific `flow.ts` launched
by a Bun-only host. POSIX does not standardize shebang parsing, Windows does not
provide equivalent behavior, and `/usr/bin/env -S` is not a portable contract.

### Minimum specification and tests

Publish initial contracts only for runtimes whose behavior can be tested; do
not reserve vague “TypeScript” or “native” semantics. At least one contract must
have two independent Runtime Provider implementations.

The corpus compares cwd, entry identity, args, env, import resolution, locked
dependency preparation, network denial, stdio framing, cancellation, exit,
signals, source maps, grants, and platform rejection. It also tests contract
descriptor equivocation, unsupported exact revisions, wrong suffix, Deno-only
on Bun-only, Python ambient-import attacks, and Windows launch without shell or
file association.

Until this corpus exists, runtime labels are local project bindings, not public
portability claims.

---

## 6. Resolver and SemanticRouter boundary

### Vote

The deterministic **Resolver** is a Jig kernel mechanism. Semantic resolution
is not. The kernel exposes one narrow ranking extension point; a
`SemanticRouter` is an optional module implementing it.

For each child Flow slot, the kernel alone performs:

1. exact project binding;
2. valid locked/pinned selection;
3. deterministic eligibility filtering by package/runtime availability,
   platform, trust, grants, recursion/budget, and declared value constraints;
4. direct selection when exactly one candidate remains;
5. optional rank request over only the remaining allowlisted IDs;
6. `BINDING_MISSING` or `BINDING_AMBIGUOUS` otherwise;
7. atomic binding commit plus child-lifetime creation before dispatch.

The semantic module receives bounded untrusted descriptions and external
evidence, has no filesystem/network/install/grant authority through the ranking
call, and returns only an allowlisted ID and evidence. It cannot make an
incompatible candidate eligible.

Missing-dependency diagnosis and a cancellable pre-dispatch wait state belong
to the kernel because they are states of `flow/call`. Search, installation,
generation, review, and approval are optional modules or maintenance Flows. A
repaired provider may satisfy the waiting call only through compare-and-swap
from `unbound` to one exact binding before any child has been created.

### Decisive invariant

> Determinism establishes the candidate set and commits identity; semantics may
> rank but may not authorize.

### Rejected choice: SemanticRouter in the kernel

The smallest failure is two eligible review Flows on a project with no Agent
configured. A kernel which requires semantic choice cannot either start or
return a complete deterministic ambiguity diagnostic. If it guesses, Jig is no
longer usable without an Agent and identical projects can dispatch different
code without an explicit module or lock change.

### Rejected choice: move the complete resolver into a module

The smallest failure is cancellation racing a repair result. A module installs
and selects a candidate while the waiting parent is cancelled; without a
kernel-owned binding-and-child-creation transaction, the child can dispatch
after cancellation or dispatch twice on redelivery. Trust, grants, pinning, and
recursion are host authority and cannot be delegated to an LLM-oriented plugin.

### Minimum specification and tests

Test exact binding, valid lock reuse, exactly one candidate, no candidates,
several candidates without a semantic module, several with a deterministic
fake ranker, model timeout/malformed/forged ID, prompt injection in candidate
descriptions, and changed catalogue during ranking. No ranking result may alter
grants or compatibility.

For repair, kill and cancel at each point from missing diagnostic through
install, validation, activation, binding CAS, child creation, and dispatch.
There must be at most one child and none after cancellation. Repair dependency
cycles and unbounded waiting processes must fail without exhausting scheduler
admission.

---

## 7. Minimal project configuration and Flow Binding

### Vote

Jig has one trusted authoring entrypoint, `jig.ts`, and one reserved generated
directory, `.jig/`. `jig apply` evaluates the trusted source once, snapshots its
complete import graph, and emits an inert content-addressed desired-state
record. Read-only package inspection never evaluates it.

The complete public project shape is:

```ts
export default defineJig({
  modules: [/* trusted host facilities */],
  flows: { /* named immutable Flow Bindings */ },
  hooks: [/* optional local fact reactions */],
});
```

`modules` and `hooks` may be absent. There are no mandatory `agents/`,
`bindings/`, `hooks/`, `policies/`, `inbox/`, `kanban/`, or `worktrees/`
directories. A Starter may create ordinary files and imports for readability.

One Flow Binding has exactly these author-controlled fields:

```ts
const review = bind({
  use: "./flows/review",       // resolves to one exact package snapshot
  settings: {},                // complete immutable JSON value
  slots: {},                   // exact targets or explicit discovery policy
  attachments: {},             // named roots/resources and access modes
  grants: {},                  // requested host authority ceiling
});
```

Empty fields may be omitted. Package metadata and implementation are not copied
into the Binding. A slot value is either an exact Binding/provider reference or
an explicit `discover(...)` policy. For an unbound `flow/call`, the default is
deterministic discovery with `onMissing: fail`; waiting/repair must be opted in
at that slot. Effect and Service slots must be exact or contract-compatible
before activation and are never selected from prose during a live operation.

There are no profiles, roles, variants, inheritance, environment fallback,
deep merge, schema-default application, expression language, or implicit
parent-to-child setting flow. Secrets are capability bindings, not settings.
Run input is the only ordinary per-invocation variation.

Settings cannot be overridden per Run. If a CLI or GUI needs a one-off settings
value, Jig materializes, validates, journals, and targets a distinct ephemeral
Binding revision. It does not mutate a named Binding or merge an overlay.

Hooks are optional project policy registered by the Events module. Agents,
SemanticRouter, Services, Git, UI, and ingress are modules/providers, not new
top-level project languages. A Hook may schedule a Flow through the kernel but
cannot intercept or rewrite facts. Its derived action identity is allocated by
the host delivery ledger, not left to timestamps or random user keys.

### Decisive invariant

> Every Run can name one immutable package, configuration, dependency map,
> attachment map, and authority grant as a single activation identity.

This is the minimum needed to run the same package twice with different
configuration without shared files or ambient state.

### Rejected additions and their smallest failures

- **Per-Run settings overlays:** a retry after crash can resolve a different
  environment/default stack and no longer name the same execution. Materialize
  an ephemeral Binding instead.
- **Environment fallback:** `MAX_RETRIES` present in one daemon but not another
  silently changes behavior outside the activation digest.
- **Profiles/roles/variants:** two names can select overlapping settings and
  provider rules, recreating precedence. Two configured uses are two Bindings.
- **Magic folders:** a Flow moved between Starters changes behavior because the
  host starts interpreting a directory convention absent from project code.
- **Semantic selection for effect slots:** a method call can reach a different
  stateful provider mid-Scope. Contract compatibility and pinning must precede
  execution.
- **Raw Flow-authored grants becoming effective grants:** an imported package
  escalates its authority. Package declarations are minima/requests; the
  Binding and host policy may only narrow or explicitly approve them.

### Minimum specification and tests

Specify the normalized inert schema, content digest, trust gate for evaluating
`jig.ts`, immutable Binding identity, settings validation point, exact slot
reference grammar, attachment path/symlink rules, grant intersection, and
activation/rollback transaction.

Tests must cover:

- two Bindings over one package with distinct settings and no shared runtime
  state;
- missing required setting with an ambient environment value and schema
  `default`, neither of which satisfies it;
- one-off ephemeral Binding and exact replay;
- Flow child receiving input but no inherited parent settings, roots, or grants;
- edited `jig.ts` during snapshot creation;
- untrusted repository inspection without config evaluation;
- activation crash and rollback preserving one exact source/config generation;
- forged attachment paths, symlink swaps, and grant widening;
- Hook redelivery scheduling one derived Run;
- no Agent, Services, Events, or SemanticRouter modules in a valid Run-only
  project.

---

## Final release ruling

The smallest coherent v1 family is:

```text
Package/1
    FLOW.md plus zero or one obvious implementation

Run/1
    flow/run, flow/call, effect/call, bidirectional request/cancel,
    and optional non-semantic telemetry

Runtime Contract/1
    immutable semantic launch standard plus conformance corpus

Service/1                 optional profile, stable before Jig v1 claim
    one pending Mount request, invoke, dynamic binding snapshot, status

Service Contract/1       optional profile
    JSON methods, results, and named errors only

Jig kernel
    lifetimes, immutable activation, scheduler, deterministic resolver,
    operation ledger, process supervision, and atomic publication

Jig modules
    Events/fact journal and Hooks, Services, Agents, SemanticRouter,
    Runtime Providers, ingress, UI, Git, and application policy
```

One qualification is important: if crash-safe effects and Hook scheduling are
advertised by Jig, the operation ledger and the commit transaction they depend
on are kernel mechanisms. The public Events catalogue/query/Hook machinery may
remain a bundled module. A module boundary must not split one atomic commit
across two authorities.

Do not add callback handles to rescue a GUI scenario FLOW has not standardized.
Do not add an event method to advertise a Jig module as universal. Do not add a
Mount identity after choosing a request-per-lifetime process model. Each of
those is an attractive local convenience that becomes a permanent distributed
systems obligation at the portable boundary.
