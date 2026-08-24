# Final adversarial decision record

**Status:** architecture freeze after three specialist drafts, reciprocal
critique, a focused court round, and a final whole-system blocker audit.

This record explains the decisions which changed or became precise after the
round-two baseline. It is not a parallel specification. The normative design is
[`60-reviewed-architecture.md`](60-reviewed-architecture.md) plus the focused
documents under [`../spec/`](../spec/).

## 1. Runtime selection became smaller

FLOW does not own or approve Python, Deno, Bun, Node, `tsx`, or community
runtime profiles. A package contains zero or one obvious root implementation:

```text
flow.<suffix>
```

It may begin with one strictly parsed selector:

```text
#!/usr/bin/env <opaque-adapter-token>
```

Jig parses the line itself and never executes `/usr/bin/env`, searches `PATH`,
or accepts flags. The token only narrows explicitly installed host Adapter
mappings. Without it, suffix, inert native metadata, and explicit host policy
must yield one Adapter or fail unavailable/ambiguous.

There is no FLOW `runtime` field, Runtime Profile/Interface, runtime URI,
profile revision, author toolchain range, runtime digest, command, or argv.
Native ecosystems own their version/dependency metadata. For example, Python
3.13 belongs in `requires-python`, not `FLOW.md`.

This was the only decision on which the critics initially split. The structured
URI/revision proposal lost because, without mandatory retrieval, signed
descriptors, and governance, it enforced no more than an opaque token while
creating another version axis. FLOW makes the narrower, honest claim: Run/1 is
portable; source runs where an explicitly installed Adapter can prepare it.

The Adapter plans. The Sandbox Backend alone executes package-influenced
preparation and code. Exact Adapter, toolchain, preparation, and enforcement
hashes remain local evidence rather than package authoring requirements.

See [`../spec/runtime-adapters.md`](../spec/runtime-adapters.md).

Package identity is separately fixed by
[`../spec/package-format.md`](../spec/package-format.md): every regular file in
the exact selected source tree participates in one length-prefixed,
domain-separated digest. There are no source-specific ignore rules or magical
dependency-cache exclusions.

## 2. Schema files keep three exact seams

FLOW reserves:

```text
input.schema.json      actual Run input
settings.schema.json   complete immutable Binding settings
result.schema.json     complete { outcome, output } Run result
```

`result.schema.json` is intentionally not `output.schema.json`: an outcome may
change the legal output shape, so validation needs their correlation.

The files are schemas, never shared runtime paths or mailboxes. Settings are
the reusable-variable seam. `MAX_RETRIES` belongs in one Binding's `settings`,
validated as a complete value; there is no environment fallback, interpolation,
merge inheritance, or giant global variable namespace.

See [`../spec/schema-files.md`](../spec/schema-files.md).

## 3. Contracts are strict, rare, and progressive

Ordinary Flow composition remains contract-free. Contracts exist only for a
stable machine API which generic `flow/call` cannot adequately express.

The renamed **Capability Contract/1** is lifecycle-neutral: a host-native
effect or a mounted FLOW Service can implement it. One self-contained JSON
descriptor defines exact methods, values, and named errors. Boolean `true`
schemas allow an interface to begin with a fixed method vocabulary and tighten
later without inventing a second “loose contract” format.

Compatibility is the exact triple:

```text
owner URI + exact SemVer + full descriptor digest
```

The digest is domain-separated SHA-256 over the complete RFC 8785 canonical
descriptor. It prevents same-ID/version descriptor equivocation; it does not
prove publisher authority, provider behavior, or quality. It is intentionally
different from internal package, CAS, preparation, and activation hashes.

Authors do not copy that digest into `FLOW.md`. A portable consumer carries the
self-contained descriptor it expects and references its package-relative path;
Jig derives and locks the triple. This preserves first-resolution exactness
without handwritten hash ceremony. Ordinary Flows still carry no descriptor.

No registry or URI dereference is mandatory. Ranges, subtyping, callbacks,
streams, and external references are deferred.

See [`../spec/capability-contracts.md`](../spec/capability-contracts.md).

## 4. Service support stays first-class but separately conforming

Jig v1 implements both Run/1 and Service/1. A smaller FLOW host may implement
Run/1 only. Service/1 is neither experimental nor a tax on every Flow.

It remains bounded request/response JSON with a pending Mount, one fixed
dependency set, one fixed declared export set, exact provider generations,
draining, loss, and cancellation. Multiple invocations on one Mount may be
outstanding and answer out of order; each has a separate owner. FLOW does not
infer serialization, linearizability, or transaction isolation. Dynamic
dependency snapshots and post-readiness export mutation were removed after the
stateful and Cordis probes found no boundary need which justified them.

SDKs project Mount-owned and invocation-owned cancellation and Flow/effect
clients separately without exporting a public Scope object. Shadow-first
replacement is permitted only
when both Mounts' complete resource leases can coexist and no affected Hook
selects the Service as its Event source. A conflicting lease or selected Event
source instead requires drain, fencing, proven lease release, and then an
admission/Hook-boundary switch before replacement startup, with an honest
unavailable interval.

The design probes additionally share one candidate SDK convenience where
Service setup receives the Mount projection and returns its fixed export table
plus an optional disposer; every method receives its invocation projection.
The SDK, rather than every component wrapper, owns `service/ready`, the pending
Mount wait, and cancellation cleanup. This remains a conformance candidate and
an authoring projection over the wire lifecycle, not another FLOW method.

No framework is a normative conformance participant. Independent Hosts and
Providers establish Service/1. Cordis is a useful reference integration only.
DeepSeek Harness was only a conceptual stress test: DSH plugin portability and
a DSH compatibility layer are not roadmap goals.

## 5. Project discovery no longer requires per-item imports

Generated `jig.ts` explicitly opts into shallow `flows/`, `bindings/`, and
`hooks/` sources once through the same `discover("./root")` primitive. The
containing field supplies the member convention; `discover()` is deliberately
not a minimatch/glob language. Adding a Binding or Hook file does not require
another manual import. Projects preferring closed membership may list exact
paths instead of using directory discovery.

The optional project field `semanticChoice: bindingRef("<binding>")` names only the ranker
used after deterministic open-ended resolution leaves several candidates. It
does not replace the Resolver or configure a runner-local Router.

Flow-call candidate authority is explicit. A slot uses one exact
`bindingRef()`, a closed `candidates([...])`, or `allRuns()` for the reviewed
snapshot of every other normalized Run Binding in the aggregate candidate.
Apply atomically admits the snapshot with the generation. An unmapped slot is
missing rather than implicitly catalogue-wide. Snapshot identities/digests are
locked, its finite fixed-point transitive authority is reviewed, active
ancestors are filtered to prevent implicit recursion, and changes require
aggregate apply before use. More than 256 eligible survivors is explicit
ambiguity rather than silent truncation.

One leading `./` in a discovery root or exact member path is authoring sugar
and is stripped before confined segment validation. A missing discovery root
is empty; a missing or invalid exact-list member fails the candidate.

Jig does not require an authored Binding file for every ordinary Flow. It
derives one normal Run Binding when an exact-code package has no FLOW
capability dependencies (`uses`) or attachments, is instruction-free, accepts
`{}` settings, has a matching
directory basename and `FLOW.md` name, no authored Binding owns that ID, and
exactly one eligible member proposes it.
The derived value has empty settings/slots/attachments and only baseline
authority. An authored Binding always owns its ID and suppresses any proposed
default for it; another ID is a variant. Several eligible members proposing
one unowned ID derive none and require an explicit Binding. Source order and
semantic choice never break that ambiguity.
Services and packages needing configuration, FLOW capability dependencies,
attachments, or an Agent never derive defaults. Derivation changes authoring
ceremony, not the
Binding-based runtime, admission, Hook, lock, or revocation model.

Binding is one closed union rather than a package-only type plus separate Agent
profiles: it configures either an exact FLOW package revision or one export of
an already-installed trusted host capability provider. Both branches share
admission, locking, and revocation. Package Bindings have no generic `grants`:
their authority comes from declared attachments/dependencies and project/host
attenuation. A host-capability Binding alone may carry the closed `grants`
shape declared by its exact trusted registration, capped by that registration
and host policy. Omission means `{}`/the registration's least optional
authority, never its ceiling, and still must validate. Only package Bindings
may run or mount; host-capability
Bindings satisfy effects and are conditionally portable.

Binding and Hook TypeScript is captured and evaluated once in a bounded,
authority-free config sandbox. The design does not call arbitrary TypeScript
provably deterministic. The exact normalized result is persisted; publication
never reevaluates approved source.

One aggregate candidate contains the complete policy/reference graph. A
watcher may report it, but no file activates itself and there is no per-file
prompt storm.

See [`../spec/project-policy.md`](../spec/project-policy.md).

## 6. Consent is local atomic admission

`jig apply` reviews one semantic and authority delta and performs a
compare-and-set over the exact candidate digest and active generation. Any edit
or relevant resolution/policy change while review is open returns
`STALE_PLAN`. The Hook Journal boundary and admission generation publish
atomically.

The project source and committed `jig.lock` express desired state and portable
resolution evidence; neither transfers host consent. Local approval receipts
and emergency tombstones live under `.jig/`, outside normal component authority.

Adds, edits, renames, removals, package/provider changes, and behavior changes
all remain pending. A pending deletion leaves the old immutable generation
active to survive editor-save races. `jig revoke` is the separate immediate
deny path; it closes admission before cancellation and never claims to undo an
already dispatched external effect.

This is Deno-like consent UX, not a claim that confirmation protects against a
malicious unsandboxed process running as the same OS principal.

## 7. Events, effects, Hooks, and coeffects remain separate

```text
Run input/settings/attachments/host deadline    immutable environment
flow/call and effect/call                       requested operations
Journal Event                                  durable immutable fact
Hook                                           inert Event-source-to-Flow admission
stderr                                         bounded diagnostic text
```

“Coeffect” remains useful theory, not a second public API. Durable facts are
still called Events because applications may intentionally react to them;
telemetry, if added later, is a separate lossy observation seam.

Jig's public Journal capability is append-only in v1. It returns the strict
committed Event; querying, waiting, replay, and subscription are deliberately
absent. Exact behavior and the canonical descriptor are in
[`../spec/journal-and-hooks.md`](../spec/journal-and-hooks.md).

Hooks do not consume, veto, rewrite, filter, or hide continuation. They either
select an existing exact producer/type or own one registered host Event Source
use, then target one exact Run Binding. Both forms create revision intervals
aligned to the Journal boundary. A registered source may own bounded
observation settings such as settling; complex reaction logic belongs in the
target Flow. Custom portable or reusable producers remain Services.

## 8. Agents have exact, owner-scoped contracts

Jig publishes three ordinary Capability Contract/1 descriptors:

```text
Agent Run          finite self-contained work
Agent Session      persistent sequential turns
Agent Interactive  Session plus live-turn steer
```

The Session contract survives because iterative workflows often need persistent
provider state but not mid-turn steering. Interactive repeats the complete
Session surface rather than using optional feature negotiation.

Session identity includes the consumer owner lifetime and exact provider
generation. IDs are nontransferable; one turn is active; caller turn/message
IDs make steering addressable and idempotent; provider loss never heals. A
successful open installs a host-owned disposer, so owner success cannot commit
until every unclosed session is closed or fenced. The host integration's
per-owner workspace projection and lease end with that owner. A remote close
may only prove local admission closure and the recorded close attempt; Jig does
not claim provider-side erasure it cannot observe.

Agent methods cannot pass host paths or widen authority. One Agent Binding
fixes provider, settings, its own attachment projection, tool/effect ceiling,
and approval gate. Host policy allocates the operation deadline, while
provider-specific limits remain validated provider settings or grants. Binding
the slot exposes that transitive
authority during project review; caller resources never inherit or remap into
the Agent operation, and independently configured read-write roots cannot
overlap. An instruction conductor is the Run implementation and therefore gets
that instruction Run Binding's declared component view, not a caller's view.
Jig itself gates configured effects and consumes one decision bound to the
exact call; an Agent cannot self-assert approval.

The conductor uses the existing Agent Run contract once through a
projection-capable host Agent Binding. Immutable logical resources expose the
package, canonical input/settings, declared outcomes, and logical authority;
the small fixed instruction interpolates none of them. It requires a complete
structured `{ outcome, output }` under the package result schema or synthesized
base schema. Agent text is diagnostic; Agent `blocked`/`limit` is an
implementation failure, not a fabricated Flow outcome. Jig Agent Bindings are
host-capability integrations in v1; a direct Service export cannot partially
satisfy the contract merely because one call selects no skills.

See [`../spec/agents-and-semantic-choice.md`](../spec/agents-and-semantic-choice.md).

## 9. Semantic choice is easy to use but powerless

The deterministic Resolver remains a Jig kernel primitive. Missing,
incompatible, unavailable, and ambiguous states exist without an Agent.

The optional Semantic Choice contract ranks only an exact allowlist and may
select or abstain. It cannot add candidates, grant, install, generate, repair,
bind, emit route arguments, or decide compatibility. Its dispatch/result is a
journaled operation; uncertainty never causes reranking.

There are two intentional call sites:

- a runner-local Router presents its finite outgoing edges on each visit; and
- Jig's `flow/call` Resolver ranks approved Binding candidates once and pins
  the result.

Thus a software factory can naturally choose Gauntlet versus Majority-Vote for
a new ticket without keyword gates. A `create-missing-flow` maintenance Flow is
separate and its output still passes normal admission. In v1 the missing
operation terminates; maintenance may enable a deliberate later Run, but never
resumes, retargets, or reranks the original Run.

## 10. Security is predicate-based host enforcement

Bindings map implementation-declared logical attachment names to exact roots
and bind mediated effects. The portable baseline denies ambient environment,
network, child processes, extra descriptors, host IPC, and undeclared files.

Authority is inspectable as:

```text
requested -> wouldGrant -> planned -> realized
```

`wouldGrant` is candidate policy, not live authority. Aggregate apply admits
it; execution planning chooses enforceable predicates. Sandbox Backend
receipts realize package containment; provider-projection receipts separately
realize authority mediated by trusted host capabilities without claiming those
providers are sandboxed. A derived default receives only
read-only prepared package bytes, private read-write scratch, and protocol
stdio. Environment, network, processes, extra filesystem roots/descriptors,
and host IPC remain denied.

The Sandbox Backend advertises enforceable predicates rather than pretending
every OS has the same primitives. A Linux implementation may use bubblewrap,
Landlock, namespaces, seccomp, cgroups, pidfds, and a regular-tree broker. A
different host either realizes the same required predicates or refuses
sandboxed activation. V1 has no trusted-package escape path.

The Backend is host infrastructure, never a wrapper Flow or Starter choice,
because it must dominate preparation and launch. Runtime-native permissions
are defense in depth. `jig inspect/status --authority` exposes the exact plan
and receipt.

Deadlines follow the same host/project boundary: the effective local host
policy supplies a finite positive millisecond duration for each operation
class, Jig allocates it before dispatch and enforces it monotonically, and a
missing/unbounded class is unavailable. Deadlines are invocation facts, not
Binding fields. Provider-specific turns, tokens, money, or resources remain
provider settings/grants rather than a universal `budget` object.

## 11. Scope, Context, Mount, file ownership, and initialization

Jig still has an internal lifetime tree; removing public Scope/Context/Mount
objects did not remove ownership or cleanup. Wire request ownership is the
portable lifecycle. An SDK `RunContext` is a read-only projection, not a remote
object model. Service `mount` is one pending lifecycle request, not a portable
bearer handle.

“File-native” describes user ownership: packages, config, prompts, skills, and
customizations are ordinary files. It does not constrain applications to
inboxes, tasks, Kanban, Git, or even a filesystem-facing UI.

`jig init --bare` or `--from <starter>` copies one user-owned project. A Starter
initializer may offer application features such as an Agent Binding, semantic
choice, repair Flow, inbox, or GUI. Runtime Adapter and Sandbox preferences are
host policy; `jig init` may offer a separate host-setup step but cannot smuggle
those choices into Starter output. There is no Starter algebra.

## 12. Direct editing and updates stay conventional

The visible component is always complete editable source. Jig stores pristine
provenance internally but has no persistent runtime patch overlay.

Update uses:

```text
BASE + LOCAL + UPSTREAM -> deterministic three-way merge
```

Only conflicts and semantic drift need an optional maintenance Agent. Validation
and atomic publication remain deterministic host responsibilities. Agent output
is a staged candidate, never an invisible repair.

## 13. Remaining work is proof, not redesign

Stable labels still require executable cross-implementation fixtures for:

1. package snapshot/path safety, Adapter planning, preparation containment, and
   sandbox enforcement;
2. JSON/1, Schema/1, Run ownership, cancellation, uncertainty, and result
   commit;
3. Capability Contract digests, Service invocation ownership/loss/drain, and
   all three Agent contracts;
4. captured policy evaluation, aggregate admission CAS, Journal/Hook boundaries,
   revocation, and crash recovery; and
5. catalogue resolution, semantic-choice uncertainty, three-way updates,
   rollback, init, and decentralized source distribution.

The Starter probe closed Sley's smallest dataflow rule: immutable root input
plus one immutable JSON/1 state carried across edges, with ordinary Node code
returning the next state and Parallel returning ordered branch results. There
is no runtime result bag, shared mutable memory, Jig mapper, or filesystem
smuggling. Only `Outcome` terminates and propagates unchanged through nested
Flows; an ordinary control-graph leaf without an edge is an error. A Parallel
branch returns its value to the owning Parallel and is not a terminal leaf.
Exact SDK spelling and executable conformance remain implementation work.

The stateful-index probe subsequently closed two Service seams without adding
a portable primitive: method handlers need separate invocation-owned versus
Mount-background child-call projections, and shadow-first replacement is
legal only when leases coexist and no affected Hook selects that Service as
its source. Otherwise Jig drains and fences, switches admission/Hook intervals,
and starts the replacement through an honest unavailable window. Provider
state plus Journal publication remains an application outbox with
cross-generation at-least-once behavior, not a Jig transaction.

The GUI probe then separated application frontends from portable components. A
trusted local GUI uses the same root admission semantics as the CLI plus
bounded Run inspection and idempotent cancellation through a host-local
control surface. Its coordinator, transport, identity, and authorization model
remain a release-blocking candidate seam rather than FLOW or Jig/1. HTTP and
presentation stay application-owned; FLOW gains no GUI, Journal-query,
callback, or raw-network primitive.

The Cordis timer probe reused an existing disposal-aware component unchanged.
One realm maps to one Service Mount, callbacks and disposers remain local, and
root Fiber disposal maps to Mount cancellation. The wrapper exposes one fixed
`delay.wait` method and needs no Journal or Hook. This supplied the final
deletion evidence for dynamic Service dependency and export snapshots.

No further v1 abstraction is justified until one of those tests demonstrates a
concrete missing primitive.
