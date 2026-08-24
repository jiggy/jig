# Final adversarial decision record

**Status:** adversarial rationale record after probe decontamination. It is not
a stable API or implementation claim.

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

Jig targets both Run/1 and Service/1. A smaller FLOW host may implement Run/1
only. Service/1 is neither a tax on every Flow nor eligible for a stable label
before its closed wire schemas and independent conformance exist.

It remains bounded request/response JSON with a pending Mount, one fixed
dependency set, one fixed declared export set, exact provider generations,
draining, loss, and cancellation. Multiple invocations on one Mount may be
outstanding and answer out of order; each has a separate owner. FLOW does not
infer serialization, linearizability, or transaction isolation. Dynamic
dependency snapshots and post-readiness export mutation remain excluded because
the public Service boundary needs neither.

Future SDKs must project Mount-owned and invocation-owned cancellation and Flow/effect
clients separately without exporting a public Scope object. Shadow-first
replacement is permitted only
when both Mounts' complete resource leases can coexist. A conflicting lease
instead requires drain, fencing, proven lease release, and then an admission
switch before replacement startup, with an honest unavailable interval.

The future SDK must preserve fixed exports, readiness only after they are
callable, distinct Mount-background and invocation-owned work, and bounded
cleanup. Setup return shape, disposer convention, names, and signatures remain
to be specified.

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

Flow-call candidate authority is explicit. The reviewed surface supports one
exact reference or a closed candidate set; an unmapped slot is missing rather
than implicitly catalogue-wide. The ergonomic declaration, normalization, and
resource policy for a changing but reviewed candidate universe remain open.

One leading `./` in a discovery root or exact member path is authoring sugar
and is stripped before confined segment validation. A missing discovery root
is empty; a missing or invalid exact-list member fails the candidate.

Jig still needs zero routine boilerplate for an ordinary discovered Flow while
preserving one reviewed execution path. Whether that target is represented as
an internal default Binding or a distinct admitted Flow target remains open;
the failed probe did not earn a hidden derivation algorithm.

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
Hook                                           inert Event-to-Flow admission
stderr                                         bounded diagnostic text
```

“Coeffect” remains useful theory, not a second public API. Durable facts are
still called Events because applications may intentionally react to them;
telemetry, if added later, is a separate lossy observation seam.

Jig's public Journal capability is append-only in v1. It returns the strict
committed Event; querying, waiting, replay, and subscription are deliberately
absent. Exact behavior and the canonical descriptor are in
[`../spec/journal-and-hooks.md`](../spec/journal-and-hooks.md).

Hooks do not consume, veto, rewrite, filter, or hide continuation. They select
one exact authenticated producer/type and target one exact admitted Run
target.
Revision intervals align to the Journal boundary. Producers—including
watchers—own observation, settling, and coalescing; complex reaction logic
belongs in the producer or target Flow.

## 8. Agents have exact, owner-scoped contracts

This repository defines three ordinary Capability Contract/1 descriptors:

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
projection-capable Agent provider. Immutable logical resources expose the
package, input/settings, declared outcomes, and admitted authority. It requires
a complete structured `{ outcome, output }`; Agent text is diagnostic and
Agent `blocked`/`limit` is an implementation failure. The precise projection
and qualifying provider ABI remain release gates.

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
providers are sandboxed. Every package starts with read-only prepared package
bytes, private read-write scratch, and protocol stdio. Environment, network,
processes, extra filesystem roots/descriptors, and host IPC remain denied until
explicitly admitted.

The Sandbox Backend advertises enforceable predicates rather than pretending
every OS has the same primitives. A Linux implementation may use bubblewrap,
Landlock, namespaces, seccomp, cgroups, pidfds, and a regular-tree broker. A
different host either realizes the same required predicates or refuses
sandboxed activation. V1 has no trusted-package escape path.

The Backend is host infrastructure, never a wrapper Flow or Starter choice,
because it must dominate preparation and launch. Runtime-native permissions
are defense in depth. A future Jig inspection surface must expose the exact
plan and receipt; its command and SDK spelling remain release-gated.

Deadlines follow the same host/project boundary: the effective local host
policy supplies a finite positive millisecond duration for each operation
class, Jig allocates it before dispatch and enforces it monotonically, and a
missing/unbounded class is unavailable. Deadlines are invocation facts, not
Binding fields. Provider-specific turns, tokens, money, or resources remain
provider settings/grants rather than a universal `budget` object.

## 11. Scope, Context, Mount, file ownership, and initialization

Jig still has an internal lifetime tree; removing public Scope/Context/Mount
objects did not remove ownership or cleanup. Wire request ownership is the
portable lifecycle. A future SDK may expose a read-only Run projection, not a
remote object model. Service `mount` is one pending lifecycle request, not a
portable bearer handle.

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

## 13. Remaining interface closure and conformance work

Stable labels require closed public data models and SDK interfaces first, then
executable cross-implementation fixtures for:

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

Sley now supplies function nodes, shared run state, branch-local input,
emit/end, fan-out/combine, retries, recovery, and topology inspection. Jig
Graph must own semantic contracts and compile them to ordinary Sley objects;
it must not recreate or subclass the scheduler. Service methods still need
separate invocation-owned and Mount-background projections, while provider
state plus Journal publication remains an application outbox rather than a Jig
transaction. GUI and HTTP presentation remain application-owned. A Cordis
realm may map to one fixed Service Mount while callbacks and disposers remain
local.

No further v1 abstraction is justified until an independently authored
consumer demonstrates a concrete missing primitive against a published minimal
interface.
