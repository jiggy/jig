# Returning to Jig and FLOW: a maintainer pre-mortem

- **Status:** Historical, non-normative field note
- **Recorded:** 2026-09-24 UTC
- **Recorder:** Primary Codex maintainer; session/thread
  `01a0d06c-bf2e-7f21-b166-20f1a697ae80`
- **Evidence window:** Pushed history through
  `ab254db3054f8ed9356d4f0cb95a77a391aafbfc`, including the alpha.21 candidate
  work through `36da2a95003c515559cd6feb733a08218f5ac368`
- **Scope:** Product intent, failure patterns, and return-to-project guidance
  drawn from the installed-alpha, release-latency, repair, software-factory,
  release-supersession, and installed-client work of 2026-09-23–24

The alpha.21 candidate was qualified at `36da2a95` before that work went
through the protected release path. Commits `d8ee4248` and `ab254db3` later
clarified npm publisher messages and aligned the release-graph test with its
two-phase full-set preflight and ordered publish pass. Controlled assertions
cover missing, older, and newer channel tags. A retained candidate from the
earlier revision does not by itself qualify a later revision's archive.
Recheck current runs and registry state before relying on release results.

This note collects first-person judgment and causal lessons from one period of
work. It is deliberately not a second project guide. The
[product compass](../product-compass.md),
[doctrine](../doctrine/purpose.md), relevant FLOW and Jig doctrine, the
[maintainer guide](../maintainer-guide.md), current specifications, code,
roadmap, and executable evidence take precedence. The note must not establish
present release status or create a new contract.

## The deepest intent

Jig and FLOW are meant to help people achieve useful outcomes by making
capability reusable while keeping its use under meaningful direction. FLOW
gives methods a portable, composable meaning. Jig lets people and software run
those methods with powers that an operator has reviewed and granted. Their
boundary is part of the product: Agent behavior belongs in ordinary,
replaceable Flows; authority, resources, and cleanup belong to the host.

The measure of progress is not how much infrastructure exists or how many
tests pass in isolation. It is whether someone can use public artifacts to
make something useful, understand what happened, and remain in control. A
portable method should accumulate value beyond its first author. A capable
host should expand what people can accomplish without letting the method,
model, or implementation authorize itself.

Current explanations of that purpose and the commitments it implies live in
the [shared purpose](../doctrine/purpose.md),
[FLOW doctrine](../doctrine/flow.md),
[Jig doctrine](../doctrine/jig.md), and
[cross-product design judgment](../doctrine/design-judgment.md). Use those
owners to resolve decisions; use this retrospective only to remember why
certain tempting shortcuts have failed before.

## Promises that are easy to simplify away

### Source proposes; approval applies to captured meaning

Editable source is not executable authority. Capture the meaning to review,
admit one complete proposal against its expected base, and execute only the
resulting immutable generation. A digest, parse result, package identity, or
model response cannot grant permission. A source edit proposes new work; it
does not silently change an already admitted generation.

This exactness matters at both the local execution boundary and the release
boundary. A candidate must be tied to its source revision, and publication
must consume the retained bytes that passed qualification. A commit hash alone
does not establish archive identity when dependency resolution can vary.

### The operator owns powers; the host owns their lifecycle

Operators supply credentials, grants, limits, and execution policy. Agents
return ordinary data through replaceable Flows. Flows own prompts, dialogue,
domain interpretation, and application choices; they cannot grant themselves
more authority. Jig owns admission, dispatch under reviewed grants, execution
ownership, fencing, and cleanup. FLOW remains independently useful outside
Jig and does not acquire Jig policy for convenience.

The ownership boundary is easy to blur while building a compelling example.
Keep application semantics in the application, method semantics in Flows,
portable invocation meaning in FLOW, and host-enforced powers and lifetimes in
Jig. A useful example may reveal a product gap; it does not by itself justify
making the application's concepts host vocabulary.

### Every launched effect has an owner through terminal cleanup

Success, failure, cancellation, deadlines, peer failure, and coordinator loss
all need accounted-for work. A cancellation request is not proof that work
stopped. A terminal result and successful cleanup are different facts. Retain
healthy peer results when another branch fails, and do not invent a verdict or
deliverable for work that did not finish. Failed cleanup remains visible.

### Evidence only proves the claim it actually exercised

These are distinct evidence levels, not interchangeable badges:

| Evidence | What it can establish | What it cannot establish by itself |
| --- | --- | --- |
| Deterministic unit or application test | Behavior for its controlled inputs | Host containment, publication, or consumer usability |
| Source workspace run | Composition against the checked-out source | Installability from a registry |
| Packed artifact test | Behavior of the exact tested archive | Registry convergence or a real native-client session |
| Host conformance | The gates and threat model exercised on that host | Behavior under every deployment environment or app policy |
| Registry installation | That ordinary distribution path resolved the published package | Native-agent quality or application acceptance |
| Independent consumer | Usability from the inputs and access actually given | A platform decision or broad generality beyond that task |

Likewise, an installed native-client conversation, saved-state restoration,
protocol fixture, library import, and summary handoff prove different
behaviors. Advertise only the behavior qualified through the relevant installed
client and host path. A successful Run means execution completed; it does not
prove the application objective was met.

### Human acceptance and review remain outside proposed edits

For repair work, reproduce the issue before asking for a proposal. Keep
acceptance policy outside candidate source; execute the named checks; preserve
candidate identity, command output, and independent acceptance results; and
leave originals unchanged. A passing proposal is review-ready evidence, not
permission to apply or merge. A person retains merge and release authority.

## Historical failure patterns

### Mechanisms gained architectural scope before a useful installed path

This project has previously explored platform graphs, services, events,
provider frameworks, persistence, and other cross-cutting mechanisms before
an ordinary user could complete the basic installed path. Some experiments
held useful ideas; that did not mean they belonged in the product. The
recurring correction was to name one user outcome, prove the smallest missing
seam, and let the responsible layer own it. A technically elegant local
mechanism does not earn a new product concept without a real consumer and a
clear failure it prevents.

The earlier detailed causal landmarks are in
[`2026-09-04-platform-course-corrections.md`](2026-09-04-platform-course-corrections.md).
That note records, among other things, the Jig graph layer removed after
direct component-runtime use proved sufficient, host-specific Nix retention
ideas that outgrew the product need, and coupling that made simple delivery
harder. Do not reconstruct deleted experiments unless their stated
reconsideration condition is met.

### A probe contaminated its own evidence

When the evaluator can change the platform while trying to consume it, a
passing probe does not prove an independent builder can use a fixed public
interface. Freeze the candidate. Give an independent consumer only the public
packages, documentation, project, and access that an ordinary user would have.
Keep platform-edit authority out of that exercise. Treat adaptation burden,
confusion, and failure as data; do not hide them with private helpers,
injected dependencies, or extra setup that consumers would need to reinvent.

### Convenience obscured the owner of a responsibility

Modeling a development gateway as a provider, bundling sibling code into each
Flow, or moving prompts and application policy into Jig can make one local
example easier while increasing consumer burden or weakening separation.
Trace friction to its owner before fixing it. Prefer ordinary ecosystem
mechanisms and a small correction at that layer; do not turn a product gap
into an example-only workaround.

Exact version strings in published examples are not inherently stale design:
they are the reproducible public dependency a consumer will install. The
examples now have a test that compares their `@jigging/*` versions to package
manifests. Keep `workspace:*` for app-local unpublished workspace packages;
do not use it to mask a missing registry dependency. When a published version
advances, let the dependency check reveal every consumer that needs an update.

### One evidence layer was mistaken for another

Source success was sometimes allowed to sound like installed support; a
protocol fixture could be mistaken for native-client qualification; and a
large test count could distract from the one failing user path. Choose the
evidence before making the claim. Report what passed, what failed, what was
skipped, and what remains unknown. A tied comparison is a completed result,
not proof of superiority and not permission to move the metric afterward.

### Immutable release bytes exposed a versioning omission

During the 2026-09-24 release work, Jig source changed after `0.1.0-alpha.19`
had been published, but the package manifest still named that immutable
version. The trusted publisher correctly refused the candidate when its bytes
did not match the registry archive. The correction advanced Jig to
`0.1.0-alpha.20`; it did not weaken digest checks, rebuild during publication,
or replace the old archive. CI, Linux host conformance, and npm publication
then succeeded for commit `c69548dd` (workflow runs `36003053685`,
`36003053671`, and `36003867976`).

This incident is a reminder to inspect package manifests whenever package
source changes, and to verify exact artifacts and registry state instead of
inferring availability from a successful build or Git tag. New package names
also need their own trusted-publisher setup. Protected publication authority
and immutable-version rules are part of the release contract, not friction to
bypass.

A later Jig source change required advancing alpha.20 to alpha.21 rather than
replacing immutable bytes. The retained alpha.21 candidate was built from
local commit `36da2a95` and passed its package, operational, installed-hostile,
and CLI gates. At the time, npm still served alpha.20 and the new commits had
not run through protected publication. Treat this as dated candidate
qualification, not a release claim.

The publisher had a separate ordering defect: source and host gates for two
revisions can finish out of order. A delayed older version could move the
`alpha` tag backward, while retrying an already-published older version could
wait for its version to become the newest tag. Controlled tests now cover
numeric prerelease ordering, older absent versions, prompt verification of
older exact versions, partial publication, missing tags, and byte mismatch
before mutation. Publication still uses retained archives and protected
authority. A missing or lagging dist-tag on an existing immutable archive
cannot be repaired by the documented npm trusted-publisher OIDC path; do not
add credentials or mutate tags outside release authority to hide that limit.
The controlled tests do not qualify the real protected publisher. Use the
same-revision run and its retained candidate receipt before making a release
claim.

### Verification consumed too much time without enough user-visible pacing

During the handoff work, I ran broad and optional checks after the main
outcome was established and did not keep the user informed about duration and
purpose. That imposed avoidable waiting and blurred release-critical evidence
with exploratory follow-up. Verification should have a stated question, a
bounded scope, and a likely duration. Begin with the changed boundary and
required integration gate. Give progress during sustained runs. Stop optional
work when its expected value no longer justifies its cost, while preserving
the result and limitation. The test suite is not a goal in itself.

## Evidence that shaped this judgment

These examples are dated observations, not fresh qualification. Some detailed
receipts were held in transient reports that may no longer exist; use live
sources to establish today's state.

### Release speed improved only after measuring the whole critical path

The measured baseline host gate took 966 seconds wall time. Splitting its
independent host groups onto separately provisioned runners reduced a passing
gate to 446 seconds, about 520 seconds faster, at a cost of 133 more aggregate
runner seconds. A prior split attempt failed because exact-version workspace
dependencies were not captured correctly; that run was not counted as a speed
win. The correction had to preserve all suite coverage, isolate containment
workloads, and fail the aggregate when any required shard failed, was skipped,
or was cancelled.

Registry availability took a different measure: one passing revision reached
Jig alpha.19 about 640 seconds after its push-triggered run began. Queueing was
usually seconds in those observations, but one run waited about 8.5 hours.
That outlier shows why workflow execution time alone cannot promise delivery
time. Retained candidate bytes, authorization waits, queue delay, registry
visibility, and tag/release completion belong in the end-to-end account.

The later pushed checkpoint `c69548dd` completed the full host gate in 362
seconds against the same 966-second baseline. CI wall time changed only from
449 to 438 seconds, and CI runner time rose from 738 to 1,064 seconds. Host
runner time fell slightly from 962 to 935 seconds; combined CI-plus-host runner
time therefore rose from 1,700 to 1,999 seconds. This is a measured latency
versus compute tradeoff: the host path improved, aggregate compute did not.
One observed trigger-to-npm completion was 10 minutes 43 seconds; another run
waited 8.5 hours in GitHub's queue. The earlier 446-second host result above
was an intermediate stage, not the later checkpoint result. Parallelism alone
does not guarantee push-to-install time.

Workflow splitting also exposed a source-test dependency-closure failure:
tests imported `@jigging/agent-method` before its workspace runtime closure had
been built. Build the source closure before source tests, while keeping packed
candidate and installed checks as separate gates. A source workspace that
imports correctly does not prove the tarball contains or resolves its declared
dependencies.

### Public installation proved useful paths, with a native limit

A fresh npm install outside the repository ran the public greeting Flow and
reported a matching installed environment. A separate ordinary HTTP Agent
returned a useful result through its published package and a reviewed grant.
The same exercise selected a native ACP client, but that live Run timed out;
the interrupted Run reported cancellation. Neither event proves successful
native conversation or restoration.

A separate public-package repair probe started from the tested-patch example
and a different Bun project. It reproduced a whitespace bug, retained exact
candidate identity and command evidence, produced a patch that passed the
repository tests and four independent cases, and confirmed the original files
were unchanged. During manual checking, I once applied the patch to the original
temporary fixture; I reversed it immediately, rechecked hashes, and applied it
only to a disposable copy afterward. The Jig Run had not edited that fixture.
That mistake and recovery are recorded so future readers do not confuse manual
verification with product mutation. The original detailed report was
transient and may no longer be available.

### The software-factory comparison did not establish superiority

The frozen source comparison used one batch command and a direct capable
coding Agent with repository tests and human review. The factory accepted one
of two issues while the direct arm accepted both. Counting a direct-arm CLI
submission typo made the primary operator-action metric look better for the
factory; excluding that unrelated typo made the metric a tie. The evidence
supports a predefined evidence packet and healthy-peer retention when one
worker fails, not better patch quality or lower operator effort.

A later independent builder adapted the application to two different Bun
projects. The first run produced no review-ready patch: one native request
failed, and another child saw empty files despite the root's nonempty captured
manifest. A size/digest guard correctly prevented that child from running,
but detection alone did not complete the user's task. A deterministic Flow
reproduced the exact 24-file case and traced the divergence to descriptor
remapping: initial child stdio targets 6 onward collided with sealed input file
descriptors in those same slots. The host now duplicates sealed inputs above
the child-target range before spawn, then closes them after use. The
inner-launcher identity guard remains. The example-specific read-offset
workarounds were removed; ordinary `FileHandle.readFile()` now works. The exact
replay returned all 24 expected digests and sizes, and a scrambled
descriptor-order regression exercises the collision.

The same builder reran its frozen invoice-total and word-frequency issues on
the local alpha.21 candidate. Both real defects were reproduced; each first
proposal passed its repository tests and all four independent cases, then
passed again in separate disposable copies. The original 24 files remained
unchanged. A separate selected cancellation recorded a cancelled invoice
without a patch and preserved the healthy word-frequency patch. This is a
bounded candidate-consumer success, not proof of public registry alpha.21,
broad repair quality, or comparative advantage. The builder report was stored
in a host temporary directory and may no longer be available; verify any
archive, receipts, and registry state before making a current claim.

Factory jobs also gained an explicit method preference. `single-pass` and
`checked-correction` dispatch directly; omission uses checked correction; only
`auto` invokes the semantic router. Tests establish that known choices make
zero router calls and invalid input prevents dispatch. That moved budget choice
to the application input without creating host selection policy. The earlier
direct-Agent comparison and later routed comparison remain tied or
unfavorable on their selected measures. Twelve frozen router calls chose the
expected candidate set 10/12 times. A two-issue routed factory and fixed-method
baseline each accepted two patches, but took about 128 and 96 seconds. In the
earlier direct-Agent comparison, after excluding a direct-arm CLI typo, the
preselected operator-action measure tied while the direct Agent accepted 2/2
patches versus the factory's 1/2. These are completed results, not experiments
to tune until they favor the factory. The detailed reports were transient and
may no longer be available.

### Installed native behavior and FLOW independence remain bounded

Follow-up probes using public Jig alpha.20, Agent ACP alpha.3, and installed
Codex on a rootless Nix development host completed a one-shot task, a
two-turn conversation, and a separate retained-state restore. These are
distinct successes; none proves that every client or supported deployment
behaves the same.

An interrupt immediately after prompt acceptance still produced uncertain
unfinished-turn diagnostics. Repeating after a 1.5-second delay produced a
clean cancelled turn and settlement. The startup-race cause was not assigned
confidently to helper, client, or host, so no retry workaround was added. The
Nix host is not the documented supported Ubuntu environment. Existing Ubuntu
CI lifecycle tests lack live Codex subscription authentication. Keep this host
limit and early-interrupt uncertainty visible until a bounded installed-client
run on an authorized supported host addresses them.

A separate probe built a small Node/Bun host around published
`@jigging/flow@0.1.0-alpha.12` and six unchanged files from an existing Flow.
It invoked the package through public Package/0, Run/0, and JSON/0 contracts,
classified three valid inputs, and rejected malformed and duplicate-member
JSON. It imported no Jig implementation. The copied source directory had an
ambient `node_modules` symlink, so the probe staged only the six regular files
byte-for-byte. This establishes bounded outside-Jig consumption, not full host
conformance, channels/attachments, containment, or production readiness.
Tool-level isolation from the repository was unavailable even though the
probe was given public-only inputs; preserve that qualification.

## Pre-mortem: ways the next delivery could go wrong

These are failure modes I would check early when resuming work. They do not
replace current gates or grant permission to broaden scope.

- **Source moves ahead of what users can install.** A source edit may change a
  package while its manifest still names immutable published bytes, as the
  alpha.19 incident showed. Compare every changed package's manifest and
  candidate receipt to its registry version and digest. Never “fix” a mismatch
  by weakening byte comparison or rebuilding during publication.
- **A shorter workflow hides an incomplete gate.** Parallelism can make a
  required check disappear from the aggregate or put conflicting containment
  workloads on one host. Inspect the dependency graph and cancellation,
  timeout, and skip behavior; verify the aggregate fails closed and all shards
  use the retained artifacts for that exact revision.
- **A speed claim measures only runner execution.** A queue, authorization,
  convergence, or release-tag wait may dominate the user's push-to-install
  time. Record wall time, queue time, critical path, aggregate runner seconds,
  and registry time separately. A single successful run is an observation,
  not a stable percentile.
- **An example works only in the repository workspace.** `workspace:*`, local
  package links, or private tools can hide a missing published dependency or
  setup step. Repeat the public path from a clean external project using
  documented packages and ordinary instructions. Keep public pins exact and
  compare them mechanically to package manifests; state clearly if an example
  remains source-workspace-only.
- **A feature declaration gets promoted into a user promise.** Imports,
  fixtures, and protocol conformance do not prove an installed live-client
  behavior. Qualify the particular client, lifecycle, and restoration behavior
  through its installed path or keep the claim narrow.
- **A Run finishes while the useful task did not.** Preserve the difference
  between execution status, application result, command/acceptance evidence,
  and cleanup. A failed or cancelled peer must not erase a healthy result or
  turn incomplete work into a patch.
- **A specific application need grows into a host subsystem.** Before adding a
  router, scheduler, provider framework, event bus, persistence layer, or other
  general mechanism, identify the named failure it prevents, who owns it, and
  the strongest simpler alternative. Keep policy in the application when the
  host does not need to enforce it.
- **Verification outlasts its value and leaves the user guessing.** State why
  each sustained check is running, its likely duration, and what passing or
  failing will decide. Start with the changed boundary; keep the full release
  gates at their integration point; report a stopped or timed-out check as
  incomplete, not passing.

## Returning to the work

When coming back after time away, use this order to rebuild context quickly:

1. Inspect `git status`, current branch, recent commits, and the diff before
   editing. Another contributor may have advanced the tree. Do not assume a
   previous handoff's HEAD, registry state, workflow status, or clean worktree
   remains true.
2. Read the root `AGENTS.md`, [product compass](../product-compass.md),
   [shared purpose](../doctrine/purpose.md), relevant FLOW and Jig doctrine,
   [design judgment](../doctrine/design-judgment.md),
   [maintainer guide](../maintainer-guide.md), and
   [roadmap](../coordination/ROADMAP.md). Then read every applicable subtree
   `AGENTS.md` and the owning current specification before changing a contract
   or claim.
3. For release work, inspect `RELEASING.md`, `.github/AGENTS.md`, the
   workflows, package manifests, registry dist-tags, immutable archive hashes,
   exact CI and host run conclusions, retained candidate receipts, and source
   releases. An old green run may not authorize a new revision. Build jobs,
   trusted publishing credentials, and Git-write authority must remain
   separated as documented.
4. For consumer work, use current public package versions and public docs in a
   project outside the repository. Distinguish source workspaces from
   installed packages. For repair, inspect the current interfaces in
   `examples/tested-patch/` and `docs/jig/guide/tested-patch.md`; for factory
   work, inspect its current application contract and independent evidence.
   If present, read `.tmp/handoff-tasks-reply.md` for the most recent execution
   summary, then verify its claims from current run receipts, packages, and
   registry state. `.tmp` is transient and is not an authority source.
5. State the user outcome, the particular evidence needed, the expected
   duration of sustained checks, and what result would change the next action.
   Record dated execution detail in `.tmp/`; keep only stable causal lessons
   here. A blocker in one outcome does not stop independent authorized work.

Living truth is in the product docs, specs, code, workflows, and passing
evidence. This note is optional historical context, not a task queue or status
report. Some contemporary evidence from its original window was kept in
transient `.tmp/` reports; those reports may no longer exist. Recheck the
repository and services before relying on any such result.

## Supplement: a succession note from the project-purpose discussion

- **Recorded:** 2026-09-25 UTC
- **Recorder:** Primary Codex maintainer; session/thread
  `01a0ca92-73e5-76a0-b2d1-54c1bb21c0bd`
- **Evidence window:** The purpose and design discussion in this session,
  through beta commit `ab1db6b6`.
- **Scope:** The deepest product intent, fragile invariants, recurring
  mistakes, and a compact way for a future maintainer to regain useful context.

This supplement deliberately extends the existing return-to-project note
instead of creating a second competing guide. It records the conclusions of
this particular discussion; the original evidence window and dated observations
above remain intact. It is optional, historical context. The
[product compass](../product-compass.md), relevant
[doctrine](../doctrine/purpose.md),
[FLOW](../doctrine/flow.md) and [Jig](../doctrine/jig.md) branches,
[design judgment](../doctrine/design-judgment.md),
[maintainer guide](../maintainer-guide.md), specifications, code, and current
evidence remain authoritative.

### The reason beneath the architecture

The shared aspiration is **expand human possibility**. It is not a promise
that more automation, more software, or more technical power is intrinsically
good. The products' more specific ideas are:

- **FLOW — capability compounding.** Make executable know-how something a
  specialist can contribute and another builder can apply, evaluate, adapt,
  combine, and share. Packaging or portability alone does not show that
  capability has grown; it must make useful work achievable or give the next
  builder a better starting point.
- **Jig — agency.** Put useful power under meaningful control. Jig is used by
  people, applications, and software subsystems; “human possibility” is the
  larger purpose, not a restriction that every consumer or decision must be a
  person. A subsystem can exercise previously delegated authority without
  becoming the authority that grants itself more.

The connection matters: FLOW lets a method travel beyond its author; Jig lets
the recipient put it to work without adopting the author's providers, policy,
or consequences. The intended value is not “portable workflows” but more useful
capability that remains understandable, adaptable, and directed by the party
responsible for using it.

Keep this descent in mind when reviewing a proposal:

```text
Expand human possibility
    FLOW: capability compounds
    Jig: agency through power under control
        useful executable methods become easier to apply and combine
        operators and applications keep direction over delegated power
            standards, host boundaries, APIs, packages, examples
```

The lower levels serve the ones above. “Microkernel-inspired” can help explain
the host's role in communication, but it is not a development target. A smaller
core, an extracted module, a new protocol, or another abstraction has no
priority merely because it is architecturally elegant. The product question is
whether an ordinary consumer can accomplish something useful with less
coordination and lifecycle knowledge while keeping meaningful control.

### Invariants most likely to be simplified away

The preceding note covers source/admission, authority, lifecycle, evidence,
and release identity in detail. These are the shorthand checks I would keep
close at hand:

| Preserve | The tempting but wrong simplification |
| --- | --- |
| FLOW method meaning and Jig host authority remain separate; FLOW must work beyond Jig. | “Jig is the standard because it is the implementation we have.” |
| Editable source proposes; reviewed immutable meaning executes. | “The source was reviewed before, so run whatever is there now.” |
| Models return data and reason only within delegated powers. | “The model chose the target, therefore the target is authorized.” |
| Launched effects have an owner until they are fenced, reaped, and cleaned up. | “Cancellation was requested, so ownership is settled.” |
| Execution, application success, delivery, and cleanup are separate facts. | “A completed Run or delivered patch proves the requested outcome.” |
| Essential distinctions should remain explicit in the system, but their repetitive coordination belongs with the responsible layer. | “Every caller must manually implement the lifecycle” or “remove distinctions to reduce method count.” |
| Evidence is specific to the tested artifact, host, client, and claim. | “A fixture, high test count, or one successful run proves general reliability.” |

Channels, calls, capabilities, Agent updates, logs, results, and checkpoints
can all carry or describe work, but their semantics are not interchangeable.
Message delivery is not completion; a channel ending is not application
success; an Agent answer is not a policy decision. Keep familiar error handling
ordinary where possible. New cross-cutting contracts should not burden channel-
free callers merely to detect every mistake an application could make.

### Additional mistakes not to repeat

The older parts of this note record significant architecture detours. This
discussion added a few product and interaction lessons worth making explicit:

1. **Do not answer “why?” with a feature.** Portability, composability,
   ownership, and observability can be useful means, not the project purpose.
   “Capability compounding” needs its object; “agency” needs its promise of
   power under control. Start with the valuable change for the consumer, then
   descend to the mechanism.
2. **Do not bury product friction inside an example wrapper.** A long setup
   command, confusing `repair.ts`/`snapshot.ts` roles, or a misplaced output
   directory is evidence to inspect the actual Jig experience. Moving flags
   under `./run` would move the burden, not remove it. Example-only helpers are
   appropriate only when they express genuine application policy, not when
   they compensate for a reusable product gap.
3. **Do not turn one use case into a universal subsystem prematurely.** The
   request to see ACP messages was a useful way to expose a general need for
   information across running work. It did not automatically justify a global
   event bus, scheduler, lock manager, remote sink framework, or universal
   workflow language. Raise the abstraction only as far as real consumers and
   failure boundaries require; keep the default path small.
4. **Do not confuse extraction with decoupling.** Making Agent-related
   packages or SDK methods more visible is not enough if Jig still owns the
   meaningful Agent implementation or the ordinary author must understand more
   machinery. Extraction should enable independent replacement, reuse, or a
   simpler consumer path, and remove the superseded seam in the same change.
5. **Do not make the owner manage solvable research and experiments.** Specialists
   can challenge different dimensions and reveal design gaps. Use them for
   material choices about authority, public contracts, or scope; ask focused
   questions; preserve dissent and failure. Once the proposal is strong, return
   to a user-facing increment rather than seeking another round of agreement.
   Routine engineering details are the maintainer's responsibility.
6. **Do not let prose review or a benchmark become a gate by inertia.** A
   reviewer that rejects valid content is not an approval authority. A tied
   co-designed comparison is a completed result, not superiority and not an
   owner blocker. Preserve the evidence and its limits; do not tune prompts or
   move the metric until the story looks favorable.
7. **Do not dismiss packaging mismatches as flukes.** The Linux artifact
   failure on 2026-09-25 was a concrete stale SRI for the local bundled
   `@jigging/flow-authoring` archive. Updating its authoring source changed the
   packed bytes while the [Jig support lock](../../packages/jig/support/authoring-package-lock.json)
   still pinned the former archive. The matching lock refresh is `ab1db6b6`. A real
   package build and pack path plus the installed-package smoke passed locally;
   the owner subsequently reported CI and Linux host conformance passing after
   push. On future authoring-source changes, qualify the newly packed bytes
   against the generated npm lock, not just the source tests.
8. **Write entrypoints, not documents that require a lost conversation.**
   Current guidance should explain the concept from its top-level purpose and
   route downward. A historical note can point to prior context, but a new
   maintainer must not need that history to understand what the product means
   or which files currently govern it. Keep this note optional rather than
   adding it to root required reading.

### A practical return path

When returning, do not start by reconstructing every experiment or reading
every file in `.tmp/`. Re-establish today's authority and status first:

1. Inspect branch, worktree, recent commits, active changes, and current
   automation. A previous note can only describe its own evidence window.
2. Read the root `AGENTS.md`, product compass, shared purpose, relevant FLOW
   and Jig doctrine, design judgment, and maintainer guide. Then read the
   nearest package instructions and exact specification owning the task.
3. Check the coordination roadmap and inbox to understand ordered outcomes
   and deferred work; neither a field note nor a completed phase selects the
   next project frontier.
4. For a delivery claim, inspect the exact source revision, candidate
   artifacts, dependent package versions and pins, workflow results, host
   qualification, and registry state that actually apply. Do not infer a
   registry result from a green build or a green run on a different revision.
5. Start from an ordinary user task and a simple example. Record what the
   user must configure, decide, coordinate, and recover from. Add machinery
   only for a responsibility Jig must enforce or a consumer has demonstrated
   cannot otherwise be expressed cleanly.
6. Verify the changed seam first, then the installed or host path appropriate
   to the claim. Give sustained checks a clear purpose and keep the user
   informed. Commit stable, authorized work on the correct branch; publishing,
   pushing, or changing release state requires its own authority.

For this supplement's evidence window, local `beta` was at `ab1db6b6` with a
clean worktree. The owner reported both CI and Linux host conformance had
passed for the pushed revision. Those statements are a dated handoff, not
live release state; verify the current branch and run receipts on return.

My final decision test is three questions:

1. **What useful work becomes achievable for an ordinary consumer, and what
   simpler existing approach is the baseline?**
2. **Who owns the method, data, authority, consequences, and lifetime at each
   boundary? Can the consumer understand and direct them?**
3. **What specific evidence would show this increment succeeded, failed, or
   needs a smaller design?**

If those answers are vague, choose a smaller experiment or ask for the missing
material decision. Do not build a universal subsystem to answer a hypothetical,
and do not use the aspiration of agency or simplicity to waive a known
safeguard. The work succeeds when capability is easier to inherit and combine,
and the people and systems using it remain able to understand, direct, adapt,
and stop it.
