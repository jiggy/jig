# Jig project policy and admission/1

**Status:** reviewed host semantics. The first package-only TypeScript authoring,
capture, static-import evaluation, retention, and pure-link aggregate are
implemented privately. One Journal-specific publisher declaration is also a
closed candidate. An explicitly experimental Hook authoring overlay now proves
inert capture/link evidence, while Hook runtime/admission, generic
host-capability registration, Agent, and open-candidate slices remain
release-gated.

Project files express desired state. They do not become live authority merely
because a watcher observed them. Jig captures one candidate, resolves it,
shows its semantic and authority delta, and atomically admits that exact
candidate after local consent.

The core rule is:

> Source proposes; one aggregate compare-and-set admits; immutable generations
> execute; emergency revocation only narrows.

Authored helper values, the captured project aggregate, and the resolved
admission candidate are different records. Resolution consumes only protected
captured artifacts, and apply never rediscovers or rereads visible source. The
capture and admission identities are deliberately distinct; see
[`108-project-capture-boundary.md`](../design-review/108-project-capture-boundary.md).

## 1. Default project convention

A generated project uses ordinary files:

```text
jig.ts
flows/
bindings/
jig.lock
.jig/          host-owned and uncommitted
```

The generated `jig.ts` opts into the conventions explicitly once:

```ts
import {
  defineJig,
  discover,
} from "@jigging/jig";

export default defineJig({
  flows: discover("./flows"),
  bindings: discover("./bindings"),
});
```

The private Hook experiment adds `hooks/` only through its separately named
overlay:

```ts
import { defineJig, discover } from "@jigging/jig/experimental/hooks";

export default defineJig({
  flows: discover("./flows"),
  bindings: discover("./bindings"),
  hooks: discover("./hooks"),
});
```

`discover()` has exactly one meaning: capture shallow source membership under
one or more configured project-relative directory roots. It does not use
minimatch, globstar, brace expansion, negation, or a host matcher dialect.
The ASCII characters `*`, `?`, `[`, `]`, `{`, and `}` are invalid in a
discovery root rather than being interpreted. The containing field supplies
the member kind:

```text
flows       immediate child directories containing exact-case FLOW.md
bindings    immediate regular *.ts declaration files
hooks       immediate regular *.ts declaration files
```

This common authoring primitive deliberately hides an internal distinction:
Flow members are inert package catalogue entries, while Binding and Hook
members are desired-state declarations evaluated later. Their normalization,
authority, and admission rules remain different.

Jig has no kernel-wide magic paths. A project may choose other roots or pass
several roots explicitly:

```ts
flows: discover(["./flows", "./vendor-flows"]),
```

The roots form an unordered union and confer no precedence. Overlapping or
duplicate canonical membership is an error.

Each root is resolved from the directory containing `jig.ts`. One leading
`./` is accepted as authoring convenience and stripped before validation. The
remaining path uses `/` separators, is already NFC, is project-confined, and
contains no absolute, empty, `.`, `..`, backslash, symlink, or glob-bearing
segment. Source adapters privately stage members; they never follow a symlink
in a root or member path. A missing valid discovery root contributes an empty
set. Members are normalized and ordered by canonical UTF-8 path bytes before
capture, hashing, or diagnostics; case-fold or NFC collisions reject the
complete candidate.

A careful project may replace a discovered source with an exact closed member
list:

```ts
bindings: [
  "./bindings/build.ts",
  "./bindings/review.ts",
],
```

For `flows`, an exact member is a package directory; for `bindings` and the
experimental `hooks` field, it is a declaration file. Discovery and exact-list
forms are mutually exclusive for one field. Neither profile mixes them or adds
an `include()` wrapper.
Both forms change membership only; declarations keep the same format and
admission rules. One optional leading `./` is normalized as above. Unlike a
missing discovery root, any missing, duplicate, wrong-kind, escaping,
symlinked, NFC-colliding, or case-fold-colliding exact member invalidates the
complete aggregate candidate.

`flows` and `bindings` are independently optional in SDK/1; `hooks` is likewise
optional only in the experimental overlay. Omission means no source of that
kind, never implicit directory discovery. References to an omitted or empty
source still fail normally. A project which wants semantic
ranking after deterministic `flow/call` filtering may additionally name one
exact Binding directly. This field belongs to a later authoring slice and is
not part of the first package-only `@jigging/jig` surface:

```ts
semanticChoice: bindingRef("semantic-choice"),
```

That field does not replace Jig's deterministic Resolver. It supplies only the
optional ranker used after deterministic filtering leaves several eligible
candidates. Omission leaves such a call `BINDING_AMBIGUOUS`. A runner-local
Router still consumes its own explicit capability slot. A missing,
incompatible, or dangling `semanticChoice` reference invalidates the project
candidate. A valid referenced Binding may nevertheless be admitted
`UNAVAILABLE`; before any chooser dispatch, that leaves the call
`BINDING_AMBIGUOUS` with ranker-unavailable evidence. Only a chooser operation
which was actually dispatched but has no provable result can make its parent
operation `UNCERTAIN`.

For example, suppose a closed `flow/call` slot admits both `reference-fast` and
`reference-deep`, and both survive deterministic filtering. With
`semanticChoice: bindingRef("semantic-choice")`, Jig asks that exact Binding to
rank those two IDs. Removing the field makes the same call terminate
`BINDING_AMBIGUOUS`; it does not affect a graph Router, a call with zero
candidates, or a call with exactly one candidate. The reference may name any
local Binding ID—such as `offline-choice` or `company-choice`—whose exact export
implements the Semantic Choice contract. It is never a strategy name, Flow ID,
model name, prompt, or algorithm literal.

The reviewed later authoring shape permits one explicit changing source in a
Flow-call slot. It remains private rather than part of Project Authoring SDK/1:

```ts
slots: {
  work: projectRunTargets(),
},
```

Planning expands this marker against the complete immutable project candidate
to every direct-eligible Run Flow and Run-capable package Binding, including
structurally valid unavailable targets. It retains the source kind beside the
exact canonical target set. Services, Journal publishers, host capabilities,
and invalid declarations never enter it. An unmapped slot remains missing.

The private retained pipeline commits that source and complete expansion into
Lock/3 and Activation Request/2. `exact`, `candidates`, and
`project-run-targets` are distinct semantic sources: a fixed candidate list
and changing source have different identities even when their exact target
sets currently coincide. The strict Lock decoder recomputes the complete
structural Run catalogue from the retained packages and Bindings and rejects a
changing slot whose expansion is a subset, superset, duplicate, or otherwise
noncanonical value. Admission requires each activation request to be the exact
projection of its retained lock entry.

The existing aggregate ceiling is 4,096 activation targets across every
package Binding, including Service Bindings, plus every direct Run Flow. It is
checked during linking, strict Lock decoding, and activation-request creation;
no source may be truncated to fit it. An empty complete expansion is valid for
`project-run-targets`; `exact` requires one target and `candidates` requires at
least two.

Expansion includes the consuming Run Binding itself. The first private
invocation-local checkpoint removes the active parent, rejects unavailable and
unsupported target kinds, revalidates retained direct-Flow package projection,
and applies actual input compatibility for broad sources over the complete
admitted frozen set. Exact calls preserve the existing durable
allocation-before-input-validation order. Configured Bindings, a persisted
complete ancestor chain, and current authority, resource, liveness, and
wait-graph filters remain later integration gates. One selected direct Flow
now enters the existing single-child durable lifecycle; zero or several
survivors close before allocation as `UNAVAILABLE` on the current Run/1 wire.
The same private lifecycle accepts one configuration-only Bun Run Binding
whose exact retained settings validate, while both its request and locked
package declare no attachments, capability uses, or slots. Other configured
child shapes remain unsupported.
V1 has no recursive cross-Flow calls. Source additions, removals, and
same-identity meaning or disposition changes require a new reviewed Plan and
apply; existing operations never re-expand.

This uses the existing project work, activation-target, retained-capture,
candidate-identity, lock, and admission machinery. It adds no named view,
query language, independent universe digest, live catalogue handle, or silent
limit. A TypeScript constant can reuse the inert marker.

## 2. One closed normalized Binding union

A Binding is one immutable admitted project-local configured use. It has
exactly one implementation branch:

```text
package
    exact FLOW Package revision, derived as Run-capable or Service-capable

host-capability
    one export of an exact already-installed trusted host provider registration
```

A package Binding uses a package reference. A relative local package reference
is resolved from the directory containing `jig.ts`, not from the declaration
file. It must be a normalized confined path within the captured project tree,
contain no escape or symlink traversal, and identify one exact package entry in
a configured catalogue snapshot. Moving a Binding file therefore cannot
retarget it. Other source adapters use explicit inert reference forms rather
than overloading this path syntax.

A host-capability Binding uses an inert reference. The authoring API must make
the registration's origin visible without loading, starting, installing, or
trusting provider code during project evaluation. The exact registration-token
and provider-module ABI remains a release gate; normative examples must not
invent package names or exports before it exists. The project declares the
logical Binding, settings, attachments, and authority ceiling, while the
host/operator installs the concrete integration. Resolution pins:

```text
provider module artifact and revision
one export LocalName
exact public contract URI/version/digest or explicit local effect identity
complete settings object and the registration snapshot's exact schema location
declared dependency slots and attachment projection
mediated and raw authority ceiling
project admission generation
```

The trusted registration declares its exports, settings schema, attachment and
dependency vocabulary, and maximum authority. Only this host-capability branch
may contain `grants`, whose closed shape is defined and Schema/1-validated by
that exact registration. Those values attenuate but never exceed the
registration and host-policy ceiling; they are not a generic host-permission
DSL. Omitted `grants` normalizes to the complete object `{}`, meaning the
registration's least optional authority—never its maximum—and that object must
validate against the registration's exact grants schema. A registration which
cannot operate at `{}` rejects it during normalization and requires explicit
attenuation. A package Binding has no `grants` field: its requested authority is
derived from package attachments and dependency contracts, then bounded by
project mappings and host policy. Package-only runtime, fallback, outcomes, and Mount
fields are invalid on the host-capability branch. Project source cannot install
or approve a missing registration. A missing or ambiguous registration leaves
the reference unresolved and invalidates the candidate; `jig check` reports
it. A resolved registration may separately be operationally unavailable after
its schemas, ceiling, artifact, and export have been pinned.

A host-capability provider is trusted host machinery, not package-controlled
code made safe by this Binding. The Binding limits what the project can request
and which projections Jig supplies, but it does not turn a compromised
in-process provider into a sandboxed principal. An untrusted or independently
distributed provider should run as a FLOW Service package behind the Sandbox
Backend.

Run roots, Hook targets, and `flow/call` candidates accept only exact admitted
Run targets. An authored Run package Binding is one such target. A narrowly
eligible zero-configuration Run package is another: an explicit direct admitted
Flow target named with a tagged Flow reference, never a hidden Binding. Service
activation accepts only Service package Bindings.
`effect/call` accepts an exact Service export or host-capability Binding. Both
branches use the same source discovery, aggregate admission, digest, locking,
generation pinning, and revocation rules. This avoids a second Agent/provider
profile system.

A host-capability Binding is honestly only conditionally portable. A provider
intended for portable distribution should be a FLOW Service package.

On the package branch, an optional `instruction` object names one exact Agent
Binding. Its optional `fallback` member has only the literal value
`"instruction"`; absence denies exact-to-instruction fallback. The value is
legal only when the package itself declares `fallback: instruction`.
Instruction-only packages require the Agent reference without a fallback
member. There is no redundant `"deny"` value.

### 2.1 Authority derivation and the portable baseline

Authority has four deliberately distinct stages:

```text
requested
    authority implied by FLOW metadata, contracts, and configured resources

wouldGrant
    the candidate's reviewed project/host-policy attenuation; not yet live

planned
    the closed predicates the selected enforcement boundary commits to
    enforcing for one immutable activation or mediated operation

realized
    immutable receipts from those boundaries for what the activation or
    mediated operation actually received
```

Project evaluation and planning cannot truthfully call `wouldGrant` granted
authority. Only aggregate apply admits it, and only execution produces
`realized` evidence. Package containment is realized by a Sandbox Backend
receipt. Authority-bearing host-capability calls are realized separately by
immutable provider-projection receipts naming the Binding/provider
generations, method, attenuation, and projected resources. Such a receipt
proves Jig's mediation; it does not claim that trusted provider code is
sandboxed. A provider unable to produce and enforce its registered projection
is unavailable. Inspection retains all four views and identifies the enforcing
boundary rather than collapsing requested authority, policy intent, and
enforcement fact.

Every package execution starts from the portable baseline: its exact privately
prepared package closure and pinned Runtime Support Closure are read-only, one
private scratch Space is read-write, and protocol stdio is available.
Environment variables, network, extra filesystem roots, inherited descriptors,
and ambient host IPC are denied unless the admitted package and Binding
explicitly obtain the corresponding authority and host policy allows it. This
baseline is a closed Jig guarantee, not ambient operating-system behavior.

One admitted Adapter recipe may additionally require exact Backend-owned
process views or runtime devices. They are host runtime mechanisms, not package
authority or author-selectable fields. A process view is generated inside the
activation's PID/cgroup namespaces, is read-only, hides host processes and
controls, and resolves per-process paths correctly for descendants. Runtime
devices are fresh least-mode projections; existing host device nodes and
unrelated devices remain hidden and unchanged. The Backend receipts and cleans
up the exact realization. Inability to prove it makes the recipe unavailable.

Package code may create descendant processes, but doing so never creates a new
Jig owner or grants new authority. Every descendant remains inside the same or
a strictly narrower filesystem, network, IPC, identity/capability,
environment, descriptor, and enforcement envelope. The Sandbox Backend charges
the complete tree to the activation's finite CPU, memory, PID, output, scratch,
and deadline bounds, prevents it from weakening or migrating outside that
envelope, and fences and reaps the complete tree on success, cancellation,
failure, deadline, or cleanup. If it cannot enforce those predicates, the
activation is unavailable. V1 has no package-facing process or spawn grant.

### 2.2 Admission and operational readiness

Aggregate admission separates structural validity from this host's current
ability to execute a Binding:

```text
ADMITTED + READY(exact selected implementation recipe)
ADMITTED + UNAVAILABLE(exact reason and evidence)
```

Package shape, settings, schemas, references, contract compatibility, and
requested authority must be valid before either state can be admitted. Such a
failure invalidates the aggregate candidate. A structurally valid Binding may
instead be `UNAVAILABLE` because zero or several Runtime Adapters qualify, a
native constraint is unsatisfied, no Sandbox Backend can realize its authority
envelope, or a fully resolved provider registration is temporarily unable to
operate. A missing or ambiguous trusted host registration is unresolved rather
than `UNAVAILABLE`. An unavailable Binding does not block independent `READY`
Bindings, but it is excluded from child/provider candidate resolution and
cannot spawn or mount.

Planning records either one exact selected implementation recipe or the exact
unavailable reason. An exact-code package recipe pins the Adapter and toolchain
evidence, closed preparation plan, launch-planner identity, Sandbox Backend,
Backend preparation and launch-envelope plans, and authority envelope. Its
concrete launch plan is derived only after its Run or Service Mount owner
executes that pinned preparation and obtains its immutable prepared snapshot.
An instruction recipe instead pins the exact instruction runtime, conductor,
one qualifying Agent provider Binding revision, export and contract, and
authority envelope. Its provider must support the exact per-Run logical
resource/tool projection. The provider registration/profile ABI remains a
release gate. Planning does not claim that a live provider generation exists
yet. A host-capability recipe pins its fully resolved registration and
operational provider evidence.

For a code-backed Run package, deterministic planning selects the exact-code
recipe when exactly one qualifies. Only when zero complete exact recipes
qualify and both package and Binding explicitly permit instruction fallback may
it select and pin a complete instruction recipe. Ambiguous exact selection
remains unavailable and never falls back. An instruction-only package requires
the instruction recipe directly. No failure or machinery loss after an exact
recipe was pinned can switch the Run to instruction mode.

Before dispatching an instruction conductor, Run dependency admission acquires
and pins a live provider-generation lease for the recipe's exact Agent Binding
and export. If that exact dependency is not live, the Run fails
`IMPLEMENTATION_UNAVAILABLE`; it never resolves or rebinds to another Agent.

Apply pins the selected branch in the new admission generation. A Run or
Service Mount never selects runtime machinery, and any derived exact launch
must remain inside the recipe. Installing, removing, or preferring host
machinery creates a new candidate and requires ordinary review/apply before an
unavailable Binding can become ready or a ready Binding can use a different
recipe. Existing generations never heal or reselect silently.

`READY` means that the selected recipe was complete and realizable against the
admission-time host-policy snapshot; it is not a continuing liveness promise.
If pinned machinery later disappears or changes, the activation fails against
that pin without substitution. A later plan may propose another recipe or
`UNAVAILABLE`.

An explicit root submission to an admitted unavailable Run Binding still
allocates its idempotent Run after JSON/1 boundary validation and Binding pin,
then performs input-schema validation and terminates with its pinned
`RUNTIME_*`, `SANDBOX_*`, or `IMPLEMENTATION_UNAVAILABLE` reason before
preparation or spawn. Retrying the same submission key after a later generation
becomes ready returns the old terminal Run; a deliberate new attempt uses a new
key.

## 3. Declaration files

For a Binding or Hook source, directory discovery inspects only immediate
regular `*.ts` files. A missing directory is empty. It does not recurse or
follow symlinks. Other files and subdirectories have no discovery meaning.

```text
bindings/review.ts       -> Binding ID `review`
hooks/on-inbox.ts        -> Hook ID `on-inbox`
```

The basename is the `LocalName` identity. There is no duplicate `id` field. A
rename is one removal plus one addition.

A Binding file default-exports exactly one inert Binding declaration. A Hook
file default-exports exactly one inert Hook declaration. The private
pre-release authoring projection is deliberately separate from the frozen
Project Authoring SDK/1. Hook-bearing sources import the explicitly unstable
`@jigging/jig/experimental/hooks` overlay, whose shape is checked by
`machine/private-project-authoring-hooks-1.schema.json`. It is deliberately
limited to:

```ts
import { bindingRef, defineHook, flowRef } from "@jigging/jig/experimental/hooks";

export default defineHook({
  on: {
    publisher: bindingRef("work-events"),
    type: "https://example.org/events/work-created",
  },
  run: flowRef("./flows/triage"), // or one exact Run bindingRef(...)
});
```

The package root, `defineJig`, and `project-authoring-1.schema.json` remain
unchanged and reject Hook fields. The experimental overlay earns no public
compatibility promise until Hook admission/runtime and an independent consumer
close a later profile.

It must identify one exact producer, one exact
1–512 character Event type, and one exact admitted Run target without
importing a live object. Flow and Binding target references are explicitly
tagged; no namespace precedence resolves a raw string.
Wrong kinds, multiple/default-export errors, duplicate IDs, case or Unicode
collisions, and dangling targets invalidate the complete candidate.

Producers may be protected host machinery, application code, or FLOW Services
which publish through the Journal; a Hook neither constructs nor owns them.
The relation is specified in
[`journal-and-hooks.md`](journal-and-hooks.md). There are no source lists,
wildcards, input mappings, open filters, callbacks, or action names.

Binding dependencies are likewise inert local references:
`bindingRef("name")` selects a host-capability Binding or the compatible export
set of a package Binding, while `serviceExportRef("name", "export")` selects one
explicit Service export. A `flow/call` slot may instead use
`candidates([flowRef("./flows/fast"), bindingRef("deep")])` to declare a closed
allowlist of Run targets. `candidates()` performs no discovery, filtering, or
semantic choice during configuration. An unmapped slot is `BINDING_MISSING`;
it never means catalogue-wide. `discover()` is invalid in a Binding slot.
Resolution replaces every reference with exact admitted revision identities;
none of these helpers imports or captures a live provider object.

An ordinary zero-configuration discovered Run Flow is now a tagged direct
admitted target and enters the same execution path as an admitted Run Binding.
The reviewed changing-universe direction is the explicit per-slot
`projectRunTargets()` marker described above and in the
[target and routing disposition](../design-review/101-default-targets-and-open-routing-candidate.md).
It remains outside the first authoring slice. Its private evaluation, complete
expansion, Lock/3, Activation Request/2, and v18 admission retention are now
implemented; public authoring, caller-specific filtering, Resolver use, and
runtime dispatch remain separately gated.

Aggregate normalization also computes the transitive authority reachable
through those exact dependencies. Provider-owned attachments and effect
ceilings appear in the consuming Binding's authority delta even though they do
not become direct caller views. This is especially important for Agent slots:
reviewing only the runner's own attachments would hide the work it can request
through its configured Agent.

Imported FLOW packages cannot contribute to project policy roots. Installers
place packages only in configured catalogues unless a separate project-source
operation explicitly changes policy files.

There is no `BINDING.md`, `HOOK.md`, YAML policy language, precedence,
inheritance, override directory, or per-file activation.

## 4. Captured evaluation, not a determinism claim

Binding and Hook sources are TypeScript authoring conveniences. Jig does not
claim arbitrary TypeScript is mathematically deterministic.

For one candidate Jig:

1. privately stages `jig.ts`, configured memberships, declaration bytes, the
   complete statically resolved import closure, exact allowed dependencies,
   evaluator, and toolchain;
2. rejects dynamic import/require, symlinks, resolution outside the project,
   unproved multiply linked source inodes, ambient/global module lookup, native
   addons, and source changes it detects while staging;
3. evaluates the immutable capture once in a bounded config sandbox with no
   visible project or host filesystem, network, environment, secret, Agent,
   Service, Journal, or host-runtime authority; the evaluator's exact sealed
   runtime support and scratch are implementation inputs, not project grants;
4. accepts only closed serializable Binding/Hook intermediate values; and
5. persists the exact normalized result as the sole input to resolution and
   approval.

The evaluator removes ambient nondeterministic APIs where its proven runtime
allows and always bounds CPU, memory, imports, source, and output. It does not
claim arbitrary TypeScript evaluation is deterministic: exact normalized
output is captured and reviewed. Functions, getters, class instances,
callbacks, and handles cannot cross normalization. Proxy traps may run inside
the sandbox while a value is copied, but no live Proxy crosses the process
boundary.

Evaluation and publication never reopen project source: both consume the same
private immutable staged closure. A host may serialize project writes or use an
atomic filesystem snapshot to claim one source revision. Without that support,
capture remains exact but does not claim detection of malicious
mutate-and-revert races or that every staged path version existed
simultaneously. A later observed source or resolution-input change creates a
different candidate.

`jig inspect` can inspect inert packages and the last normalized state without
evaluating an unknown repository. `jig plan` and `jig apply` require trust for
the exact captured config evaluator and source closure.

## 5. Candidate and active generation

Jig maintains:

- zero or one immutable locally approved **active admission generation**; and
- at most one latest **candidate** derived from current source and resolution.

Later edits supersede the previous candidate; there is no per-file approval
queue. Invalid source has diagnostics and cannot be applied. The active
generation remains usable while editing.

A semantic delta includes every:

```text
Binding or Hook add, edit, rename, or removal
target, source selector, or candidate-set change
package, provider, Adapter, toolchain, or contract change
settings, fallback, or Agent change
attachment, effect, or sandbox-authority change
lock resolution change
```

Formatting, comments, or helper rewrites which produce an identical normalized
and resolved value are no-ops. A referenced package byte change is not.

## 6. Approval is one digest-bound CAS

The admission operation semantics are summarized as:

```text
plan() -> {
  state: "unchanged" | "applicable",
  planDigest?
}

apply(planDigest) ->
  admissionReceipt | lockRepairReceipt | STALE_PLAN | INVALID_CANDIDATE
```

The retained Plan itself binds its base generation, exact candidate, proposed
lock, final activation meaning, and visible-lock observation. A renderer may
derive capture, before/after, delta, and authority views from that immutable
Plan and its bound base; those views are not separate policy truths. These
names are explanatory. Authentication, transport, closed result schemas, and
the public host SDK/CLI remain release gates.

Three domain-separated identities answer different questions:

```text
captureDigest
    Which exact retained source, membership, evaluator, and toolchain
    observation produced this result?

observedSemanticDigest
    Which normalized behavior and observed planning dispositions produced the
    proposal before final recipe selection?

activationMeaningDigest
    Which normalized behavior, exact final READY recipes or UNAVAILABLE
    evidence, provider edges, settings, and requested authority would be
    admitted?

planDigest
    Which exact capture, semantic result, resolution-input snapshot, proposed
    portable lock, and active-generation base was reviewed?
```

The final activation-meaning digest excludes declaration spelling, comments,
root inode, and per-evaluation enforcement counters. It includes exact
executable artifacts and final dispositions, so an implementation byte change
is never formatting-only. The plan digest commits to `captureDigest`, both
semantic identities, the complete immutable resolution-input snapshot,
proposed lock, exact visible-lock observation, final targets, and base
generation. All four are internal Jig evidence, not FLOW metadata.

`jig apply` displays one aggregate semantic and authority review. A UI may
notify that watched changes are pending and offer Apply, but the watcher never
blocks on stdin and never activates them. Multiple edits naturally coalesce
into one plan.

Before an authority-changing admission commit, Jig verifies that the plan is
still the latest published candidate, its base generation and complete
resolution-input snapshot still match, every retained artifact remains
available, the proposed lock bytes are durable, and the relevant revocation
state is unchanged. Any mismatch returns `STALE_PLAN` or
`INVALID_CANDIDATE` as appropriate. A lock-only repair instead remains rooted
in the exact active admission and proposed lock; a later inert candidate-head
publication does not stale it, while an active-admission change does. Apply
never reopens visible source, reevaluates declarations, rediscovers members,
or reruns resolution. Admission publication and the Hook Journal boundary
commit atomically in Jig state.

The admission record is one canonical immutable record. Its digest names the
new generation, and returning that same stored record is the idempotent
admission receipt. V1 does not persist a second nominal approval receipt which
would duplicate the plan and generation without proving an authenticated
actor. A future authenticated approval boundary may add its own evidence.

Replay checks whether the exact plan already committed before applying stale
head tests. A committed replay returns its immutable historical receipt even
when a later generation is now active, and never moves the active pointer. An
uncommitted plan whose candidate or base generation is no longer current is
stale. This resolves a lost response without making old policy current again.

A visible edit becomes admission-CAS-relevant when capture publishes a
replacement candidate. Filesystem notification is a liveness mechanism which
schedules that capture, not an atomicity oracle. An edit not yet captured
cannot alter the reviewed immutable bytes which apply admits. Once the
replacement is published, every admission Plan for the prior latest-candidate
pointer is stale. A lock-repair Plan is different: candidate movement grants
no authority and does not retarget the repair, whose validity remains bound to
the exact active admission and exact proposed portable lock.

When a newer capture has the same activation-meaning digest and exact proposed
lock as the active generation, Jig may record it as an equivalent observation
without new consent, without replacing active artifacts, and without
advancing the generation. An exact visible lock normalizes to `unchanged` and
creates no applicable Plan. In update mode, an absent or drifted visible lock
creates only a lock-repair Plan; locked mode rejects it. Jig never retargets an
outstanding Plan for an older capture.

Headless use supplies the exact reviewed Plan identity, for example:

```text
jig apply --plan <digest> --yes
```

The Plan supplies the compare-and-set base. Without an exact retained Plan,
the candidate remains pending.

## 7. Consent and the lock

Committed policy source expresses team-owned desired state. `jig.lock` records
portable resolution evidence. Neither is local execution consent.

A fresh project may omit `jig.lock` in unlocked mode. Planning then proposes a
complete lock alongside the candidate. `--locked` fails when the file or any
required entry is absent or would change. Runtime Adapter binaries,
toolchain probes, Sandbox Backend choices, and realized enforcement receipts
are host-local activation evidence and never portable lock entries. The exact
lock serialization remains a required focused specification and schema before
implementation or public Starter release.

The lock's portable authority evidence means only package/project-derived
**requested** authority: exact attachment requests and exact capability
dependencies. Host-policy `wouldGrant`, Backend/provider `planned` authority,
realized receipts, approval, and revocation are local activation state. Binding
settings remain authored desired state and participate in semantic admission;
the lock does not duplicate them merely to become a second project file.

Ordinary apply does not need a fictional atomic transaction across the visible
lock file and protected Jig state because the lock grants no authority. Under
one host-serialized administration operation Jig:

1. atomically publishes and durably synchronizes the exact proposed canonical
   lock bytes, or in `--locked` mode verifies the existing bytes without
   changing them; then
2. performs one local admission transaction which rechecks the complete CAS,
   inserts one immutable admission record whose digest names the generation,
   advances the active pointer, and publishes the Hook Journal boundary.

Jig never commits step 2 before lock durability. A crash after step 1 leaves a
new inert desired-state lock and the complete old active generation; recovery
reports the unapplied delta. A crash during step 2 exposes either the old or
new complete local generation. The immutable active generation retains its own
lock digest and complete activation record, so a later lock edit cannot mutate
already admitted behavior.

When final activation meaning and the proposed portable lock already equal the
active admission, update-mode apply may only converge the inert visible lock
and record an immutable receipt keyed by `planDigest`. It creates no admission
generation, Hook interval, Service work, or authority. Replay uses that one
Plan digest alone. Distinct explicitly reviewed repair Plans for the same
active admission and proposed lock commute and may each record a receipt;
candidate-head changes do not stale them, while an active-admission change
does. Exact lock bytes without a receipt after a crash never imply approval or
automatic repair—only explicit replay of a retained Plan completes it.

The active generation and its stored admission receipt, emergency tombstones,
and realized host authority live under `.jig/`, outside ordinary Flow/Agent
authority and outside version control. A clone with identical source and lock
must approve once on that host. Pulling another host's lock never activates it.

`.jig/`, host configuration, approval databases, tombstones, Adapter/Sandbox
state, and credentials are protected host state. A sandboxed attachment view
never contains them, even when an approved logical attachment maps an ancestor
such as the project root. The Backend must omit protected descendants through
an immutable snapshot or race-safe filtered view, or reject the mapping as
unenforceable. Project-authored policy source may remain ordinary editable
files because editing it creates only a pending candidate; it does not confer
admission.

The view also must not expose protected bytes through a regular-file hardlink.
Before materialization the Backend rejects a multiply linked source inode
unless it proves every alias belongs to the same admitted nonprotected view.
Writable views additionally need private copy/copy-on-write isolation or
continuous mediation of inode, link, rename, and writeback boundaries. A raw
mutable bind plus pathname filtering is not enforcement.

If the same unsandboxed operating-system principal can edit both project source
and `.jig`, approval is confirmation and audit, not a security boundary against
that principal. Its security value is preventing discovered, imported, or
sandboxed component bytes from silently becoming authority.

If apply chooses new portable resolutions, it uses the same ordered durable
lock-publication and local-admission sequence. `--locked` rejects any
resolution change.

## 8. Edit, delete, and revoke

- **Add or semantic edit:** pending until aggregate apply. No Run, Mount,
  provider registration, Hook interval, semantic candidate, or Agent call may
  use it first.
- **Delete:** a pending removal. The immutable old definition remains active
  until apply, avoiding editor-save races. Approved removal closes new
  admission while pinned owners drain normally.
- **Rename:** removal plus addition in one candidate. References must change in
  the same candidate.

Emergency control is separate:

```text
jig revoke binding <id>
jig revoke hook <id>
```

One revocation transaction writes the local tombstone, advances the active
admission generation, closes the Binding/root/provider or Hook admission gate,
and closes every directly or dependently affected Hook interval at that exact
Journal boundary. Only after that commit does cancellation/fencing proceed
child-first. Every plan based on the prior generation therefore becomes
`STALE_PLAN` and cannot restore the revoked authority. Dispatched effects
remain terminal or `UNCERTAIN`; revocation is not rollback.

The authored definition then appears as desired but locally revoked. Restoring
it requires a fresh aggregate apply. Reusing the same name or digest cannot
bypass the tombstone, and missed Events are never replayed.

V1 has no semantic auto-apply, remembered path trust, glob trust, committed
consent, or project-controlled `autoApply` switch.

## 9. Flow sources

In the `flows` field, `discover("./flows")` discovers immediate child
directories with exact-case `FLOW.md` inertly. It does not evaluate or activate
them. Each canonical configured root path is an internal catalogue-source
identity; the public project surface does not need a named `catalogues` map in
v1.

Dropping a package into `flows/` grants no live authority. Runtime resolution
reads only exact admitted targets, never the live Flow source. A structurally
eligible Run package may become a direct target only when the aggregate
candidate containing that exact package revision is applied. It is eligible
when `{}` satisfies settings, it declares no required capability use or
attachment, and no Agent or instruction mapping is required. It receives an
empty Flow-call slot map; an attempted undeclared child call ends
`BINDING_MISSING`. Runtime or sandbox availability does not
change structural eligibility: the admitted target may be `UNAVAILABLE`.
Services always require explicit Bindings.

## 10. Root Run admission

Jig exposes one host-local operation for a person, CLI, GUI, or trusted
host-side module outside every FLOW activation to request root work:

```text
startRun(target, input, submissionId) -> durable Run identity
```

`startRun` is projected by the closed Root Administration/1 in-process
candidate and its machine value schema. Publication, project-authority
issuance, transport, authentication, and exact CLI spelling remain
host-interface release gates.

`target` is one explicit tagged Flow or Binding reference. `submissionId` is an
opaque project-local retry key. Jig first validates that
`input` is a bounded FLOW JSON/1 value; invalid JSON/1 creates no Run. For a
valid value, the first request stores its canonical `(target, input)` digest
and resulting Run. Repeating the same key and content returns that Run without
re-resolving current policy, including after later revocation. Reusing it with
changed content fails with `SUBMISSION_CONFLICT` before dispatch. A caller
intending new work uses a new key. A reference CLI may expose the operation as:

```text
jig run <target-id> --input <json-file>
```

The frontend generates and retains the submission key until acknowledgement;
its flag spelling and input transport are host UX. For a previously unseen key,
`startRun` resolves the tagged target against one current active admission
generation. The operation cannot name a raw unadmitted package or ask Jig to
construct a target on demand. In one transaction Jig verifies the root gate and
revocation state, pins the exact admitted Run target revision, and inserts the
root Run.
It then validates the actual value against `input.schema.json` when present.
Schema-invalid JSON/1 makes that allocated Run terminal `INVALID_INPUT`;
implementation never starts.

Hook delivery does not resolve the target LocalName again and does not call the
external operation. It enters the same internal root-admission primitive with
the Hook revision's already-pinned target revision/admission generation, the
committed Event as unmodified input, and `(Hook revision digest, eventId)` as its unique
root key. A selected pair always inserts or returns that derived Run, even if
later revocation closes dispatch admission first. In that race the unique Run
is terminal and non-dispatchable with the revocation recorded; it is never
silently omitted or retargeted. Jig allocates it before schema validation, so
invalid Hook input terminates the same deduplicated Run. Publication of a later
generation cannot retarget an already selected Hook occurrence.

Trigger, producer, Hook, and correlation metadata are authenticated and
attached only by Jig. Ordinary frontends cannot supply them. Neither root path
can name raw package source, select a provider or Runtime Adapter, alter
Binding settings, remap attachments, request wider authority, or inject
environment values. A different reusable configuration requires an authored
Binding revision.

## 11. Required conformance cases

1. Immediate directory and explicit-list membership agree for the same files;
   one leading `./` is normalized away; missing discovery roots are empty;
   nested, unrelated, symlinked, escaping, or colliding entries reject or
   remain inert as specified. Glob metacharacters reject, multiple roots have
   no precedence, and overlapping membership invalidates the candidate. Every
   missing, duplicate, wrong-kind, escaping, symlinked, NFC-colliding, or
   case-fold-colliding exact-list member invalidates the aggregate candidate.
2. Invalid exports and non-serializable values reject the whole candidate.
   Hook `on` selectors and `run` references reject unknown keys, wildcards,
   source lists, and non-Run targets.
3. Filesystem, environment, network, process creation, dynamic import, native
   loading, escape imports, infinite loops, and oversized output fail without
   authority. Clock and randomness may remain language intrinsics; their
   nondeterminism is contained, the exact bounded output is captured, and
   apply never reevaluates it.
4. Evaluation occurs once over the exact privately staged closure; apply never
   reevaluates or rereads project source. Atomic source-revision provenance is
   claimed only when its capture mechanism supplies it.
5. A new Binding, Hook, provider, or changed package creates no work before
   consent.
6. A new Hook and its target Run revision can be admitted together; a dangling target
   blocks the aggregate.
7. A replacement capture or resolution-input snapshot published during review
   returns `STALE_PLAN`; only the exact displayed capture and resolutions may
   publish. A raw filesystem edit has no authority before capture and cannot
   mutate the retained bytes under review.
8. Hook revision intervals align exactly with the admission Journal boundary.
9. Clone/pull of source and lock transfers no local consent.
10. Unapproved deletion leaves old behavior active; approved deletion closes
    only new admission.
11. Emergency revoke survives restart, cannot widen authority, and unchanged
    source cannot restore it.
12. Formatting-only normalized no-ops require no new consent.
13. `discover()` is accepted only for project source fields. `candidates()` is
    accepted only for compatible `flow/call` Binding slots and freezes a
    closed allowlist. An unmapped slot is always missing.
14. Lock publication precedes local admission. A crash between them exposes the
    new inert lock and old complete active generation as a pending delta; a
    crash in local admission exposes either the old or new complete generation,
    never a mixed authority state.
15. A host-capability Binding cannot install/trust a provider, run, or mount;
    missing or ambiguous registrations leave the candidate unresolved, a
    resolved but inoperable provider may be unavailable, and branch-illegal
    fields reject.
16. Revocation closes all affected admission and Hook intervals in the same
    generation-advancing transaction; every prior plan becomes stale.
17. Mapping a project-root ancestor never exposes protected `.jig` or host
    state to a sandboxed component, including under concurrent path mutation.
18. A visible hardlink to protected or out-of-view state, and a hardlink
    inserted during activation, cannot expose or mutate that host state; an
    unenforceable attachment is rejected.
19. External root start accepts an admitted Run target, actual input, and one
    project-local retry key; same-key/same-content acknowledgement loss returns
    one Run without reevaluating later policy, while changed content conflicts
    before dispatch.
20. Root admission pins one generation before dispatch and rejects caller
    trigger metadata, direct source, settings, attachment, provider, Adapter,
    environment, and authority overrides.
21. CLI, GUI, and module frontends use the same external semantics. Hook
    delivery uses its already-pinned target/generation and unique selected-pair
    key through the shared internal primitive rather than resolving the live
    LocalName again.
22. An absent external key either allocates under the admitted gate or loses to
    revocation with no Run. A Hook pair selected before revocation always has
    one derived Run; revocation before dispatch makes it terminal rather than
    suppressing it. Invalid Hook input terminates that one Run after JSON/1
    boundary validation, including after redelivery.
23. Omitting a Flow, Binding, or Hook source means an empty source of that
    kind. Jig never silently enables a conventional directory.
24. Relative local package references resolve from the directory containing
    `jig.ts`, remain confined, and do not change when their declaration file
    moves.
25. One valid Binding may be admitted `UNAVAILABLE` without blocking an
    independent `READY` Binding. Host machinery changes create a reviewed new
    generation; a Run never reselects machinery or implementation branch, and
    retrying an old submission returns its old terminal result.
26. Missing lock is permitted only in unlocked mode and causes planning to
    propose a complete lock; `--locked` rejects absence or drift, and no
    host-local runtime or enforcement receipt enters the portable lock.
27. Retrying the exact `planDigest` after it committed returns its immutable
    historical admission or lock-repair receipt, even when another generation
    is now active; replay never moves the active pointer. An unapplied Plan
    whose bound active admission is no longer current returns `STALE_PLAN` and
    never reruns resolution.
28. A code-backed package with both instruction opt-ins pins instruction only
    when zero exact recipes qualify during planning; exact ambiguity stays
    unavailable. Failure or machinery loss after an exact recipe is pinned
    never activates instruction fallback.
29. An instruction recipe pins one projection-capable Agent dependency during
    planning and acquires its exact live provider-generation lease during Run
    admission; provider absence fails without rebinding. The provider form is
    a release-gated interface question rather than an assumed package API.
30. Applying a candidate after `BINDING_MISSING` never changes the old Run or
    operation. Repeating its root submission key returns the old terminal Run;
    only a new key may select the new admission generation.
31. Redelivering an old Hook/Event pair after maintenance returns the same old
    derived Run. Retrying Hook-triggered work requires a new Event or an
    explicit root submission with a new key; admission never replays the Hook.
32. Equal final activation meaning plus an equal proposed lock and exact
    visible bytes returns `unchanged` without persisting an applicable Plan.
    Update mode creates only a repair Plan for absent or drifted bytes; locked
    mode returns `LOCK_MISMATCH`.
33. A lock repair advances no admission or Hook boundary. Same-Plan replay is
    idempotent; distinct equivalent repair Plans commute and may each record a
    receipt; candidate-head movement does not stale them, while an
    active-admission change does. A lock-written/no-receipt crash state
    converges only through explicit Plan replay.
34. During the current private pre-release schema checkpoint, a v18 admission
    store rejects every other `private-activation-admission-v*.sqlite3`
    database or sidecar, including beside a valid v18 database. It never
    migrates, merges, or silently chooses around mixed protected authority.
35. Aggregate authority inspection includes the fixed attachment and effect
    authority reachable through every exact dependency Binding; it never
    mislabels that authority as a direct caller attachment or omits it because
    invocation is mediated.
36. Every package execution begins with read-only prepared package bytes and
    pinned Runtime Support Closure, private read-write scratch, and protocol
    stdio. Environment, network, extra roots and descriptors, and host IPC stay
    denied until explicitly admitted. Descendants remain in the same bounded
    owner envelope and quiesce before success; inability to enforce the planned
    envelope makes the target unavailable rather than wider. Adapter-selected
    process views and runtime devices remain exact, namespace-local,
    least-mode Backend mechanisms and never become package-selected authority.
37. Package Bindings reject a generic `grants` field. A host-capability
    Binding accepts only the closed registration-specific attenuation shape,
    validates it against that registration, and cannot exceed provider or
    host-policy ceilings. Omission normalizes to `{}`/least optional authority,
    never the registration ceiling. Inspection distinguishes requested,
    `wouldGrant`, planned, and realized authority.
38. A `flow/call` resolves only against the caller's pinned admission
    generation. Missing, wrong-kind, incompatible, unavailable, and ambiguous
    slots fail before child package execution; current visible source, a later
    generation, and semantic similarity cannot retarget the operation.
39. One child operation is durably allocated before package execution. Equal
    operation identity and canonical params join or replay one terminal;
    changed params conflict without redispatch. Cancelling one waiter preserves
    shared work while another remains, and loss of the final waiter requests
    cancellation of the child owner.
40. A parent Run cannot publish its terminal before every allocated child is
    closed behind a confirmed fence. Parent cancellation and deadline bound
    children during both preparation and execution. Coordinator replacement
    reacquires recorded child ownership, never automatically redispatches
    uncertain work, and releases exact backing only after fencing or proved
    non-admission.
40a. For the first private broad-slot integration, deterministic filtering is
    finite but does not yet observe operation cancellation until the complete
    scan ends. No child is dispatched during that scan. Cancellation-aware
    filtering remains required before claiming bounded-latency maximum-set
    routing.
41. An `effect/call` to a Service resolves the exact contract, Provider
    Binding/export, Mount, and acknowledged generation from the owner Run's
    pinned admission. Movement of the current admission head cannot retarget or
    invalidate that live owner lease. Unknown methods and invalid inputs fail
    before Provider dispatch; results and declared application errors are
    schema-validated before their durable terminal is returned.
42. Equal Service operation identity and canonical input join or replay one
    durable invocation terminal; changed reuse is `OPERATION_CONFLICT`. The
    possible-dispatch fact is committed before the first Provider request byte,
    and possibly dispatched work is never automatically sent again.
43. A root using a Service cannot publish its terminal until all of its Service
    invocations are durably closed and its owner-slot leases are released. A
    Mount may be fenced before that settlement, but finalization and protected
    backing release require every linked lease release. The current private
    mixed checkpoint proves this order for normal shutdown; end-to-end Provider
    and coordinator-loss recovery remains an explicit gate.
