# Returning to Jig and FLOW: a maintainer pre-mortem

- **Status:** Historical, non-normative field note
- **Recorded:** 2026-09-24 UTC
- **Recorder:** Primary Codex maintainer; session/thread
  `01a0d06c-bf2e-7f21-b166-20f1a697ae80`
- **Evidence window:** Repository history through `c69548dd345b1abc19862385fc966fe912d96d37`
- **Scope:** Product intent, failure patterns, and return-to-project guidance
  drawn from the installed-alpha, release-latency, repair, and software-factory
  work of 2026-09-23–24

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

These examples are dated observations, not fresh qualification. Their detailed
receipts are in the linked transient reports; use live sources to establish
today's state.

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
visibility, and tag/release completion belong in the end-to-end account. See
[`delivery-latency-evidence.md`](../../.tmp/delivery-latency-evidence.md).

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
verification with product mutation. See
[`public-alpha-probe.md`](../../.tmp/public-alpha-probe.md).

### The software-factory comparison did not establish superiority

The frozen source comparison used one batch command and a direct capable
coding Agent with repository tests and human review. The factory accepted one
of two issues while the direct arm accepted both. Counting a direct-arm CLI
submission typo made the primary operator-action metric look better for the
factory; excluding that unrelated typo made the metric a tie. The evidence
supports a predefined evidence packet and healthy-peer retention when one
worker fails, not better patch quality or lower operator effort.

A later independent builder adapted the application to two different Bun
projects. That run produced no review-ready patch: one native request failed,
and another child saw empty files despite the root's nonempty captured
manifest. A guard was added so the same mismatched projection fails before
worker dispatch; a separate nested projection test passed, so the root cause
was not generalized. Subsequent source commits changed the factory's
composition and delivery path. The recorded failed adaptation is important
negative evidence, but it does not describe every later implementation or
qualify current public-package use. Revisit the current application and its
independent evidence before making a present claim. Reports:
[`software-factory-comparison.md`](../../.tmp/software-factory-comparison.md)
and [`software-factory-builder.md`](../../.tmp/software-factory-builder.md).

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
  documented packages and ordinary instructions; state clearly if the example
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
   [roadmap](../ROADMAP.md). Then read every applicable subtree `AGENTS.md`
   and the owning current specification before changing a contract or claim.
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
5. State the user outcome, the particular evidence needed, the expected
   duration of sustained checks, and what result would change the next action.
   Record dated execution detail in `.tmp/`; keep only stable causal lessons
   here. A blocker in one outcome does not stop independent authorized work.

Living truth is in the product docs, specs, code, workflows, and passing
evidence. This note is optional historical context, not a task queue or status
report. Contemporary evidence from this window was kept separately in
`.tmp/delivery-latency-evidence.md`, `.tmp/public-alpha-probe.md`,
`.tmp/software-factory-comparison.md`, and `.tmp/software-factory-builder.md`;
those execution reports can be stale or absent and must be rechecked against
the repository and services before reuse.
