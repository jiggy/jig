# Maintainer guide

Jig and FLOW make reusable methods useful under meaningful direction. FLOW is
the portable package and invocation standard; a **Flow** is a package containing
one method. **Jig** is a small local host that reviews these packages and runs
accepted work with powers supplied by its operator. A person, application, or
software subsystem can consume that work. The [product compass](product-compass.md)
explains the purpose: FLOW serves capability compounding, and Jig serves agency
through power under control.

This guide explains the engineering principles that protect those promises,
then the responsibilities, invariants, and working method that follow from
them. It assumes no project history. The root `AGENTS.md` requires this guide's
repository-wide engineering workflow; child `AGENTS.md` files refine scoped
work rules, and public specifications contain exact contracts. This guide
refines the product doctrine and cannot override it; the root instructions
govern conflicts. It does not establish release state or replace executable
evidence. Update it in place when a durable model changes and remove obsolete
guidance.

## Three engineering principles

The engineering model develops the product promises through three principles.
Each owns a branch of the more detailed guidance below.

1. **Preserve exact portable meaning.** FLOW owns portable package and
   invocation meaning, independently of a host or internal runtime. Jig
   executes exactly the source and configuration that were accepted; editing
   source proposes new work without silently authorizing it.
2. **Keep powers with their responsible owner.** The operator supplies local
   authority, credentials, and limits. A Flow uses only its granted powers;
   models return data and cannot grant themselves more authority.
3. **Account for effects and evidence.** Every launched activity must have an
   owner through completion, failure, cancellation, and cleanup. Product and
   engineering claims require evidence of the particular outcome they assert.

These principles organize the detailed boundaries below. They are reasons to
keep the product small, while preserving the machinery required to make its
promises true.

## Preserve exact portable meaning

Portability requires a clear division between what a method means and how a
host authorizes it. Exact execution then preserves that meaning across review,
source changes, and process boundaries.

### From source to exact execution

Jig separates editable source from accepted execution. **Capture** retains an
immutable copy for evaluation and review. **Admission** records local approval
of the complete reviewed meaning. An **admitted generation** is the immutable
set of packages, configuration, and execution choices that can run together.
**Fencing** revokes the ability of owned work to continue; cleanup accounts for
and removes its remaining execution resources.

```text
editable source
    -> immutable capture
    -> review
    -> admission
    -> exact execution
    -> complete fencing and cleanup
```

The governing law is:

> Source proposes. One aggregate compare-and-set admits. Immutable generations
> execute.

The compare-and-set admits the complete reviewed proposal only if its expected
base still matches. Authority therefore changes as one complete state, never
as independently updated pieces.

The product should feel like one finite path: initialize a local project,
review it, run one exact admitted target, receive one terminal result, and
leave no execution residue. Users should not manage setup phases, plan digests,
coordinator epochs, runtime recipes, sandbox selection, or another lock
protocol. Do not add `jig setup` or a framework merely for private
implementation convenience.

Project authoring values are inert. They describe membership and configuration
but do not read, install, approve, or execute anything. FLOW metadata remains
small and portable; host runtimes, commands, credentials, dependency locks,
and sandbox policy do not belong in `FLOW.md`.

### Responsibility boundaries

**Run/1** is FLOW's protocol for one finite invocation across a process
boundary. A component runtime advances a program or graph inside a Flow
process. An application gives the work its domain purpose; a **Starter** is a
coherent application copied and owned by its user. Neither needs to become
host policy. Jig supplies **containment**, the resource and process boundary
around untrusted work, and selects the providers that supply local powers.

| Layer | Owns | Must not own |
| --- | --- | --- |
| FLOW | Portable packages, JSON and schema rules, the Run process protocol, SDK ergonomics, capability descriptors | Jig admission, providers, sandboxes, persistence, project configuration, or graph policy |
| Jig | Capture, review, admission, exact resolution, host authority, durable lifecycle, containment, and credentials | General workflow semantics, an application ontology, or universal provider/runtime/backend frameworks |
| Flow package | Application logic, validation, Agent instructions, package-local skills, and optional internal libraries or graphs | Host credentials, open-ended target authority, or containment policy |
| Component runtime | Live graph or control-flow advancement inside one component process | FLOW/Jig meaning, durable orchestration, admission, or provider policy |
| Application or Starter | Domain rules, prompts, user experience, repository policy, and professional oversight | New Jig core concepts merely because one application needs them |

FLOW's process boundary deliberately excludes host records, resolution,
authority evidence, provider identity, persistence, and application ontology.
Runtimes, sandboxes, project-local configurations called **Bindings**,
dependency preparation, and Agent clients are Jig or application facts, never
FLOW vocabulary.

Sley is an independent component runtime that a Flow may use directly behind
Run/1. Jig should not fork its scheduler, subclass its elements, or put Jig
domain state inside Sley objects. A Jig-specific graph layer is justified only
by a real stored-graph consumer that direct Sley cannot express clearly.

### Capture, review, and admission

These laws make the accepted work independent of later edits. The portable
lock records reproducible project choices; local admission grants consent to
execute those choices on this host.

- **Planning is authority-neutral, not read-only.** Review may capture,
  evaluate, prepare, and retain evidence. Before confirmation it must not
  modify visible project meaning, grant execution authority, or run package
  code.
- **Capture precedes authority.** Mutable visible source is neither evaluated
  nor executed directly.
- **Parsed and hashed does not mean authorized.** Validation, a digest, or a
  portable lock cannot grant host-local execution authority.
- **Approval consumes retained meaning.** It reopens reviewed bytes and never
  silently evaluates newer visible source.
- **Visible lock publication precedes admission.** A crash between writing
  the durable portable lock and the admission compare-and-set leaves the old
  complete authority plus an inert lock. Replaying the retained proposal may
  converge it; mixed authority is never exposed.
- **One admitted generation executes.** Root and child resolution never use a
  live directory or mutable catalogue.

### Dependency preparation and local development

Review is the authority-neutral point where exact locked artifacts may be
fetched and a private execution snapshot materialized after relevant source
changes. This is not an installation into the project or host. `jig run`
performs no fetching, dependency materialization, lifecycle script, or ambient
runtime discovery; it consumes only retained admitted bytes.

The supported preparation is deliberately narrower than a general package
manager. It accepts exact integrity-bearing packages from the fixed default npm
registry under script-disabled, contained policy. The detailed source
rules and limits belong in
[`project-policy.md`](../docs/jig/spec/project-policy.md).

Unreleased code is not forced through a public registry. Package-local source
modules can be imported directly. Shared unreleased code can be materialized as
ordinary files within the finished Flow package by the author's development
process. Workspace, file, Git, or symlink dependencies are not execution-time
escape hatches, and Jig does not turn that author-side materialization into a
universal build protocol.

If normal independent development cannot remain practical without workspace or
additional source semantics, gather evidence from clean-room authors before
changing the preparation boundary. Do not grow one narrow preparation into a
package-manager abstraction one exception at a time.

### Ordinary invocation and private implementation

Finite invocation should remain simple for authors as well as consumers.

The FLOW SDK's `handle()` operation serves one Run request and exits; it does
not declare a resident server. Run/1 reserves standard output for protocol
frames. `handle()` captures its protocol writer before replacing the global
console with a standard-error-backed console, so ordinary library logging that
uses the current global console after `handle()` begins cannot corrupt the
wire. Top-level import logging, cached earlier console methods, raw writes to
file descriptor 1, and child processes inheriting stdout remain unsafe. The
full contract belongs in the [Run SDK specification](../docs/flow/spec/run-sdk.md).

Internal exported symbols remain private machinery unless an independent
consumer has exercised and earned a public interface. One implementation is
not evidence for a plugin system or public service-provider interface (SPI).

## Keep powers with their responsible owner

Sharing executable meaning does not transfer permission to run it. Jig's local
authority controls which work can start, which powers it can use, and the
limits within which it can continue.

### Local consent and ownership

A project session has one coordinator responsible for its local authority.
Review can establish that a mechanism is supported without establishing that
every later launch is still authorized.

- **Portable meaning and local consent differ.** Reproducible project meaning
  can be shared; consent to run it cannot.
- **One project identity has one owner.** A finite session cannot create
  competing coordinators or authority issuers for the same project.
- **Support and launch authority differ.** Reproducible mechanism support may
  be reviewed; ephemeral execution authority is reacquired and revalidated
  immediately before use.
- **Close revokes authority.** Closing a project session prevents new starts,
  settles owned work, releases exclusive ownership, and preserves durable
  records.

### Containment

Jig has one private supported containment mechanism. Its observable resource
and process contract matters more than its implementation vocabulary:

- aggregate CPU, memory, and process ownership exists before untrusted bytes
  execute;
- placement has no attach-after-exec window;
- package code cannot acquire host control or migrate out of its owner;
- cancellation and deadlines fence the complete descendant tree;
- cleanup waits for emptiness, removes owned resources, and surfaces failure;
- cleanup ownership survives coordinator loss; and
- no weaker compatibility fallback is selected when the contract is absent.

The concrete host requirements, limits, threat ceiling, and unsupported threats
belong in [`SECURITY.md`](../SECURITY.md). Implementation-specific controls and
hostile-test procedure belong in
[`packages/jig/src/internal/AGENTS.md`](../packages/jig/src/internal/AGENTS.md).

Development sandboxes and CI provisioning are separate trust boundaries. They
may provide generic capabilities needed to test Jig, but their names,
credentials, package managers, and helper mechanisms never become Jig or FLOW
semantics. If a required generic capability is absent, report it precisely;
do not weaken the product or turn the development host into architecture.

A second containment implementation may eventually reveal a stable public
Backend boundary. One mechanism alone has not earned it.

### Composition

A Binding gives one Flow package a reusable project-local configuration.
Its **child slots** name a closed set of exact `flow:<path>` or `binding:<id>`
targets from the same admitted generation. A child uses its selected target's
settings and Agent capability; parent configuration is not inherited. Selected
child Bindings are leaves with no further Flow slots. At runtime, a Flow can
call only its slots; it cannot search a catalogue, invent targets, or acquire
scheduler authority. Child and Agent scopes inherit the remaining root deadline
and cannot extend it. One active operation per context permits a parent to
await a specialist while that specialist awaits its Agent. Their operation
identities and durable ownership remain distinct; cleanup drains the Agent
before releasing its specialist owner.

Run/1 owns request identity, join, conflict, cancellation, deadline, and
uncertainty behavior across the process boundary. Internal graphs remain
ordinary Flow implementation. Add recursive orchestration, selection
languages, or child-history products only when a real application cannot be
expressed with exact slots and ordinary structured values.

### Agent calls

A **Capability Contract** describes an exact interface for independently
maintained consumers and implementations. **Agent Run** is the Jig-owned
contract for bounded Agent work, consumed through ordinary Run/1 `effect/call`.
It is not a new FLOW method, model authority, or public provider framework.
The public value contract belongs in
[`agent-run.md`](../docs/jig/spec/agent-run.md).

The Flow supplies bounded instructions, an optional exact package-local skill
selection, and an optional bounded result schema. It cannot select the Agent
client, endpoint, model, executable, credential, or network policy. Those are
trusted host choices. Skills are immutable guidance for one call, not tools,
filesystem authority, or provider configuration.

A direct OpenAI client is configured by the wire API it uses, an explicit base
URL, credential, and model. Compatible endpoints are endpoint configuration,
not new provider abstractions. Compatibility must be claimed against the
selected protocol: an endpoint compatible with Chat Completions does not
thereby implement Responses. Credential-mode names describe the actual API and
authentication seam, never a development gateway.

Secrets never enter FLOW input, Bindings, artifacts, plans, diagnostics, or
retained Run identity. Non-secret API, endpoint, and model choices may affect
reviewed provider identity. Rotating only a credential must not change project
meaning.

Native clients share one bounded Agent Client Protocol (ACP) lifecycle while
retaining thin, client-specific launch and authentication adapters. They begin
without filesystem, terminal, MCP, or arbitrary tool authority unless a future
admitted capability explicitly grants it. Product code never fixes a model for
the sake of a development test; omission uses the selected client's own
operator configuration or default. Test credentials, endpoints, and low-cost
models remain test inputs.

A future native Agent client should require a thin host adapter, not a FLOW
change. Publish a provider or ACP SPI only after independent integrations show
that the common boundary is real and stable.

Local readiness proves admitted configuration and support, not future remote
reachability, data-retention policy, model truthfulness, or suitability for
sensitive records. Structured output constrains shape; deterministic
application code still owns evidence, source links, arithmetic, and domain
rules.

## Account for effects and evidence

A result must describe what happened honestly, including what remains
uncertain. The same discipline governs runtime completion and the claims used
to justify engineering changes.

### Dispatch and completion

Dispatch is the point at which package or provider effects can begin. An
operation that may have crossed that point needs durable identity and a
bounded owner until its work is settled. A complete descendant tree includes
all processes launched beneath the owned work.

- **Validate both sides.** Validate input before package code runs and validate
  the declared outcome and result before success.
- **Intent precedes dispatch.** Durable request identity and content exist
  before package or provider effects begin. Reusing an identity with changed
  content conflicts.
- **Unknown dispatch stays unknown.** Possibly dispatched work is fenced, not
  guessed successful or automatically sent again.
- **Success follows fencing.** A valid response is insufficient until the
  complete descendant tree is fenced, reaped, cleaned, and the result is
  admitted.
- **Cleanup outlives the coordinator.** A bounded owner must settle possibly
  launched work even when the coordinating process disappears.
- **Executable failure stays failure.** Missing runtime or provider support
  never turns prose into equivalent executable behavior. Jig fails closed when
  required support is absent.
- **Public failures are bounded.** Credentials and private host, store,
  runtime, sandbox, and coordinator details never cross the user boundary.

Durable machinery is justified by an observed authority, crash, uncertainty,
or cleanup invariant. It is not justified by hypothetical reuse. Delete
machinery coupled only to a removed feature, but do not trade away a proved
invariant to reduce line or table count.

### Independent probes

Building an interface while consuming it can hide the missing pieces an
unfamiliar consumer would encounter. Keep consumer evidence separate from
implementation so that each change answers a concrete demonstrated need:

```text
freeze one concrete outcome
    -> let an independent consumer expose the smallest missing seam
    -> implement only that seam
    -> prove authority, failure, cancellation, and cleanup
    -> delete the superseded path
    -> test the next candidate independently
```

Design probes are disposable clean-room API experiments under `design-probes/`;
leave them uncommitted unless the owner explicitly asks otherwise. Their working rules are:

- freeze or publish the candidate interface first;
- delegate creation to a fresh sub-agent with no inherited project conversation
  (`fork_turns: "none"` where supported), not a platform contributor or a reused
  reviewer who has already read the internals;
- supply only public documentation and ordinary consumer artifacts/examples as
  project knowledge, plus the requested outcome, acceptance criteria, and safety
  and resource limits—not internal guides, source, roadmaps, old probes, or a
  maintainer-designed implementation plan;
- give the consumer write authority only over its probe. Use a separate
  workspace containing those public inputs, withholding the platform checkout
  and privileged host-control access. No Jig/FLOW, specification, or SDK edits
  are permitted. If the tools cannot enforce that separation, record the
  limitation; a written prohibition is not technical isolation;
- keep the coordinator responsible for the brief, frozen artifacts and trusted
  operations, not authoring or repairing the consumer's implementation. Record
  assistance and unavoidable injected guidance. Answer interface questions
  through public documentation; missing explanations are probe findings, not
  occasions for private implementation hints;
- record exact artifacts, public documents, commands, failed attempts, elapsed
  time, bounded diagnostics, cleanup, and the claims proved or not proved;
- include a malformed or failure case; and
- deliberate separately before changing Jig or FLOW.

Maintainer-authored examples and co-designed comparisons remain useful, but
are not independent design-probe evidence. A directory name or sub-agent label
does not establish independence: report the consumer's actual prior context,
inputs, assistance, and access boundaries.

A good probe shows that published pieces compose and exposes concrete usability
gaps. It does not establish domain accuracy, privacy suitability, provider
fitness, professional benefit, or ecosystem value without an evaluation built
for those claims. A failed probe is valid evidence; do not weaken a boundary or
prompt-tune indefinitely to manufacture success.

Tracked Starters are deliberately authored examples, not preserved probe
snapshots. Exact recovery landmarks for deleted implementation experiments
belong only in [`suspended-experiments.md`](suspended-experiments.md).

### Bounded engineering decisions

Before a checkpoint, identify the user-visible outcome, smallest observable
proof, missing seam, public vocabulary, exclusions, and stop condition.

Ask whether the apparent solution requires setup ceremony, a daemon for a
finite command, another lock or admission protocol, a registry or plugin
framework, host-global package-manager ownership, private implementation
details in public values, weaker containment, replay of uncertain work, a
compatibility path, a development-host concept, or an abstraction inferred
from one mechanism.

First search for a smaller solution inside the approved outcome. Escalate only
when the remaining choice materially changes product meaning, authority, cost,
risk, or external ownership. Difficulty alone is not a blocker. A precise
missing credential, infrastructure capability, external authority, or product
choice is. Stop for owner direction before materially expanding product
concepts or choosing between genuinely different product directions.

An owner-actionable blocker must name the unavailable prerequisite or decision,
the safe alternatives already exhausted, and the specific owner action that
unlocks the affected work. A fixable harness error, failed experiment, or
agent-chosen freeze is not such a blocker. Preserve the old evidence, correct
the agent-owned problem in a separately recorded run within existing authority
and budgets, and continue. Escalate a real budget increase or missing permission,
not the ordinary engineering work needed to use what is already authorized.

When several independent outcomes are authorized, a blocker in one does not
stop the others. Commit its stable in-scope work, retain unstable evidence on
a separate experimental branch only when worth keeping, record owner-actionable
blockers in `.tmp/current-blockers`, and continue the other authorized work.

Treat legal, commercial, infrastructure, and security questions in proportion
to specific evidence. Do not create a product subsystem to answer an
unspecified concern, and do not ignore a concrete obligation or violation.

Once an outcome boundary is agreed, carry it through implementation, focused
proof, deletion of superseded work, and a stable commit. Own ordinary research,
code, CI, and documentation work rather than handing it to the project owner.
Ask the owner only for actual authority, credentials, external ownership, or a
material product decision. Prefer evidence-backed disagreement and a smaller
alternative to automatic agreement, and stop polishing a vertical once its
first-release proof is sufficient.

Completing a phase proves its bounded outcome; it does not select the next
phase. The long-term ordering lives in [`ROADMAP.md`](ROADMAP.md). Current
tasks and blockers are disposable operational state, not additions to this
guide.

### Proportionate claims

Keep every claim smaller than its evidence. In particular:

- closed Agent-assisted selection is not open semantic discovery;
- a structured delivery packet is not a software factory;
- an SDK runtime test is not a Jig host-runtime claim;
- local readiness is not remote provider health;
- one containment mechanism is not a public Backend SPI;
- private Agent adapters are not a public provider framework; and
- a research catalogue is not a roadmap.

External reviewers are useful adversaries, not project authorities. Verify
their claims, accept corrections supported by evidence, explain disagreements,
and never implement a report wholesale.

Use the owner's assigned team identity in external-team correspondence and
reports, not when addressing the owner directly.

A skipped test, filtered hostile case, timed-out aggregate, or interrupted
suite is not a pass. State the exact evidence that completed.

## Find authoritative sources

Use the `jiggy` GitHub organization and npm names under `@jigging/*` until the
owner obtains and selects the npm `@jiggy` scope. Keep FLOW technically and
publicly independent of Jig; retain the monorepo until separation has concrete
value.

Keep repository tasks in justfiles, not `package.json` scripts. Manifests
declare metadata and dependencies; Just owns build, test, formatting, and
explicit packing tasks. Reuse scripts for substantive orchestration rather
than moving large programs into recipes. Installed products do not require
the development task runner.

Use the narrowest canonical owner for the selected work. This guide teaches
the model; the sources below establish the relevant rules, exact behavior,
outcome order, and current evidence.

| Question | Canonical source |
| --- | --- |
| Why does this product exist? | [`product-compass.md`](product-compass.md) and its doctrine reading map |
| What rules bind this edit? | Root and nearest applicable `AGENTS.md` files, plus this required engineering guide |
| What can a user do now? | [`README.md`](../README.md) and public documentation under [`docs/`](../docs/) |
| What does FLOW mean? | Normative material under [`docs/flow/spec/`](../docs/flow/spec/) |
| What does Jig currently promise? | [`docs/jig/`](../docs/jig/) and package READMEs |
| What is the security boundary? | [`SECURITY.md`](../SECURITY.md) and the nearest implementation `AGENTS.md` |
| How is a release built and published? | [`RELEASING.md`](../RELEASING.md), manifests, and [`.github/AGENTS.md`](../.github/AGENTS.md) |
| How do I install development dependencies and use the checkout's CLI? | [`CONTRIBUTING.md`](../CONTRIBUTING.md#development-shell) and `shell.nix`; Bun generates the ignored workspace lock, never hand-maintained |
| What outcomes come later? | [`ROADMAP.md`](ROADMAP.md) |
| Where can deleted proof work be recovered? | [`suspended-experiments.md`](suspended-experiments.md) |
| Where is optional first-person historical context? | [`field-notes/`](field-notes/) |
| What is happening right now? | Git, current automation, and disposable `.tmp/` notes |

Before acting, inspect the worktree and recent commits. Compare the checkout
with relevant remotes, package registries, tags, and automation rather than
trusting an old report. Treat existing changes as someone else's until their
ownership is understood. Never reset or clean them to reconstruct the past.
Stage exact paths and inspect `git diff --cached --name-only` before each
commit. Read the specifications relevant to the selected work; introductory
reading should not require the entire archive or optional field notes.
