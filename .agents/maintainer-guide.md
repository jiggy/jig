# Maintainer guide

Jig and FLOW make reusable methods useful under meaningful direction. FLOW is
the portable package and invocation standard. A **Flow** is a package containing
one method. **Jig** is a small local host that reviews these packages and runs
accepted work with powers supplied by its operator. A person, application, or
software subsystem can consume that work. The
[product compass](product-compass.md) explains the purpose: FLOW serves
capability compounding, and Jig serves agency through power under control.

This guide explains the engineering principles that protect those promises, then
the responsibilities, invariants, and working method that follow from them. It
assumes no project history. The root `AGENTS.md` requires this guide's
repository-wide engineering workflow. Child `AGENTS.md` files refine scoped work
rules, and public specifications contain exact contracts. This guide refines the
product doctrine and cannot override it. The root instructions govern conflicts.

It does not establish release state or replace executable evidence. Update it in
place when a durable model changes and remove obsolete guidance.

## Three engineering principles

The engineering model develops the product promises through three principles.
Each owns a branch of the more detailed guidance below.

1. **Preserve exact portable meaning.** FLOW owns portable package and
   invocation meaning, independently of a host or internal runtime. Jig executes
   exactly the source and configuration that were accepted. Editing source
   proposes new work without silently authorizing it.
2. **Keep powers with their responsible owner.** The operator supplies local
   authority, credentials, and limits. A Flow uses only its granted powers.
   Models return data and cannot grant themselves more authority.
3. **Account for effects and evidence.** Every launched activity must have an
   owner through completion, failure, cancellation, and cleanup. Product and
   engineering claims require evidence of the particular outcome they assert.

These principles organize the detailed boundaries below. They are reasons to
keep the product small, while preserving the machinery required to make its
promises true.

## Preserve exact portable meaning

Portability requires a clear division between what a method means and how a host
authorizes it. Exact execution then preserves that meaning across review, source
changes, and process boundaries.

### From source to exact execution

Jig separates editable source from accepted execution. **Capture** retains an
immutable copy for evaluation and review. **Admission** records local approval
of the complete reviewed meaning. An **admitted generation** is the immutable
set of packages, configuration, and execution choices that can run together.
**Fencing** revokes the ability of owned work to continue. Cleanup accounts for
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
base still matches. Authority therefore changes as one complete state, never as
independently updated pieces.

The product should feel like one finite path:

1. Initialize a local project.
2. Review it.
3. Run one exact admitted target.
4. Receive one terminal result.
5. Leave no execution residue.

Users should not manage setup phases, plan digests, coordinator epochs, runtime
recipes, sandbox selection, or another lock protocol. Do not add `jig setup` or
a framework merely for private implementation convenience.

Project authoring values are inert. They describe membership and configuration
but do not read, install, approve, or execute anything. FLOW metadata remains
small and portable. Host runtimes, commands, credentials, dependency locks, and
sandbox policy do not belong in portable package metadata. Reviewed meaning may
include an explicitly supplied, retained review operand as well as captured
source. Keep its effective policy and origin visible across candidate, lock,
admission and inspection.

Later review starts from source and its own arguments. Do not turn a review
operand into a remembered preference or Run-time overlay.

### Responsibility boundaries

**Run/0** is FLOW's protocol for one finite invocation across a process
boundary. A component runtime advances a program or graph inside a Flow process.
An application gives the work its domain purpose. A **Starter** is a coherent
application copied and owned by its user. Neither needs to become host policy.
Jig supplies **containment**, the resource and process boundary around untrusted
work, and selects the providers that supply local powers.

| Layer | Owns | Must not own |
| --- | --- | --- |
| FLOW | Portable packages, JSON and schema rules, the Run process protocol, SDK ergonomics, invocation and channel contracts | Jig admission, providers, sandboxes, persistence, project configuration, or graph policy |
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
Run/0. Jig should not fork its scheduler, subclass its elements, or put Jig
domain state inside Sley objects. A Jig-specific graph layer is justified only
by a real stored-graph consumer that direct Sley cannot express clearly.

### Orthogonal components and explicit dependencies

Give each component one cohesive responsibility and a small explicit interface.
Changes to one mechanism should not require unrelated consumers to understand
its implementation. Package separation earns its place through independent use,
replacement, or verification. Moving files alone does not remove coupling.

- Keep dependency directions explicit and acyclic. Shared meaning belongs below
  its consumers. A reusable component must not import its host's private source.
- Pass the data and narrowly scoped effects a component needs. Do not pass a
  coordinator, mutable global state, or an entire internal model for
  convenience.
- Keep internal identities separate from supplied identifiers. A reusable
  component must not depend on callers avoiding its private names.
- Separate observations from decisions and presentation from execution
  authority. A consumer interprets supplied facts without acquiring the
  producer's powers.
- Keep side effects, resource limits, cancellation and cleanup with an explicit
  owner. Inject bounded access rather than rediscovering ambient resources.
- Compose packages through declared exports and ordinary dependencies. Avoid
  sibling-source imports, build-output paths, duplicated contracts and hidden
  initialization order that bypass the intended boundary.
- Prove independence by building and testing components with representative
  fixtures outside their host. Test the installed composition separately.
- Extract only demonstrated common meaning. Preserve distinct implementations
  where their responsibilities differ. Do not replace coupling with a universal
  framework or a proliferation of configuration and adapters.

### Create focused, composable Flows

**High modularity is the default for Flow creation.** Build an application by
composing focused, independently callable Flows. Each Flow owns one cohesive
capability, with understandable inputs, results, outcomes and required powers.
An introductory example must teach this practice as clearly as production code.
A short coordinator can compose substantial work without implementing every
stage itself.

Keep each Flow small enough to understand as a whole, with one orthogonal
responsibility. Give it a self-explaining verb-and-object name, narrow inputs
and an explicit result. Judge size by what a reader must hold in their head,
not a line-count target.

When a workflow stage has a meaningful input and result, extract it as an
independent Flow. Grouping captions, creating a contact sheet, finding duplicate
images and applying a checked copy plan are examples of distinct capabilities.
Independent responsibility, testing, replacement and narrower powers justify
these boundaries. A second application using the method is not a prerequisite.
Do not impose an arbitrary Flow-count ceiling or retain a monolithic method
merely to make an example look small.

- Make the coordinator's sequence and outcome handling easy to read. Invoke
  child methods through declared slots and `run.call()`, and inspect their
  complete results. Never compose Flows by importing their private source.
- Give each child only the data, attachments and powers needed for its task.
  Keep application acceptance policy explicit. An Agent proposal does not become
  an accepted plan merely by crossing a Flow boundary.
- Give each extracted method a clear invocation contract and focused tests.
  Verify the composed application separately, including failure, cancellation
  and any output already produced before a later step fails.
- Keep mechanical parsing, escaping and formatting helpers as ordinary modules
  inside their owning Flow when they do not form a meaningful callable method.
  Moving helpers into files complements Flow composition. It does not replace
  decomposition of independent capabilities.
- Prefer explicit, readable composition over generic frameworks, hidden state or
  configurable orchestration layers. Modularity should make responsibilities
  easier to understand and methods easier to use separately.

### Give applications their own presentation

A coordinator owns the application's purpose and state. Project that state
into one cohesive root landing view through the portable reporting agreement,
with presentation in a focused ordinary module. Update it as work advances or
stops. Show proposals as provisional and accepted results only after
application checks.

Child Flows retain their own independently useful views and callable
contracts. Jig supplies the run shell, inspection tools, observed host facts
and evidence access. Rendering a domain page never makes an application claim
a host verdict.

Keep dashboard code equally simple. Use a small typed application state and
plain projection functions. Name sections after the user's task and keep
validation and effects in their owning methods. Avoid a generic page framework
or a second workflow hidden inside presentation.

### Capture, review, and admission

These laws make the accepted work independent of later edits. The portable lock
records reproducible project choices. Local admission grants consent to execute
those choices on this host.

- **Planning is Run-admission-neutral, not read-only.** Review may capture,
  evaluate, prepare, and retain evidence. Before confirmation it must not modify
  visible project meaning without separate authoring consent, grant execution
  authority, or run package code. Explicit `--generate-contracts` authorizes
  bounded contract publication before the separate Run approval. It is not a
  general build hook. Ordinary review remains compiler-free.
- **Capture precedes authority.** Mutable visible source is neither evaluated
  nor executed directly.
- **Parsed and hashed does not mean authorized.** Validation, a digest, or a
  portable lock cannot grant host-local execution authority.
- **Approval consumes retained meaning.** It reopens reviewed bytes and never
  silently evaluates newer visible source.
- **Visible lock publication precedes admission.** A crash between writing the
  durable portable lock and the admission compare-and-set leaves the old
  complete authority plus an inert lock. Replaying the retained proposal may
  converge it. Mixed authority is never exposed.
- **One admitted generation executes.** Root and child resolution never use a
  live directory or mutable catalogue.

### Dependency preparation and local development

Review captures exact dependencies and prepares retained execution bytes. Run
consumes admitted bytes without fetching, installation, lifecycle scripts, or
ambient runtime discovery. For preparation changes, read
[project policy](../docs/jig/spec/project-policy.md#4-flow-members-and-direct-targets).
It owns source restrictions, locks, resolution-network permission, workspace
capture, reuse, and preparation limits.

Keep workspace development connected to current source through declared
workspace dependencies and ordinary explicit builds. Do not pack and unpack
sibling archives, vendor dependency copies, or rewrite consumer manifests to
wire local packages together. Do not embed dependency archives inside another
package as a substitute for normal dependency declarations. Fix a preparation or
packaging gap at its responsible layer instead of adding example-only delivery
machinery.

Package archives belong at distribution and isolated installed-artifact test
boundaries. Retained test archives are evidence for those exact bytes, not live
workspace dependencies. Rebuild the candidate before testing changed source.

### Ordinary invocation and private implementation

Finite invocation should remain simple for authors as well as consumers.

The FLOW SDK's `handle()` operation serves one Run request and exits. It does
not declare a resident server. Run/0 reserves standard output for protocol
frames. `handle()` captures its protocol writer before replacing the global
console with a standard-error-backed console. Ordinary library logging through
the current global console after `handle()` begins cannot corrupt the wire.
Top-level import logging, cached earlier console methods, raw writes to file
descriptor 1, and child processes inheriting stdout remain unsafe.

The full contract belongs in the
[Run SDK specification](../docs/flow/spec/run-sdk.md).

Internal exported symbols remain private machinery unless an independent
consumer has exercised and earned a public interface. One implementation is not
evidence for a plugin system or public service-provider interface (SPI).

## Keep powers with their responsible owner

Sharing executable meaning does not transfer permission to run it. Jig's local
authority controls which work can start, which powers it can use, and the limits
within which it can continue.

### Local consent and ownership

A project session has one coordinator responsible for its local authority.
Review can establish that a mechanism is supported without establishing that
every later launch is still authorized.

- **Portable meaning and local consent differ.** Reproducible project meaning
  can be shared. Consent to run it cannot.
- **One project identity has one owner.** A finite session cannot create
  competing coordinators or authority issuers for the same project.
- **Support and launch authority differ.** Reproducible mechanism support may be
  reviewed. Ephemeral execution authority is reacquired and revalidated
  immediately before use.
- **Close revokes authority.** Closing a project session prevents new starts,
  settles owned work, releases exclusive ownership, and preserves durable
  records.

### Containment

Jig has one private supported containment mechanism. Its observable resource and
process contract matters more than its implementation vocabulary:

- aggregate CPU, memory, and process ownership exists before untrusted bytes
  execute.
- placement has no attach-after-exec window.
- package code cannot acquire host control or migrate out of its owner.
- cancellation and deadlines fence the complete descendant tree.
- cleanup waits for emptiness, removes owned resources, and surfaces failure.
- cleanup ownership survives coordinator loss.
- no weaker compatibility fallback is selected when the contract is absent.

The concrete host requirements, limits, threat ceiling, and unsupported threats
belong in [`SECURITY.md`](../SECURITY.md). Implementation-specific controls and
hostile-test procedure belong in
[`packages/jig/src/internal/AGENTS.md`](../packages/jig/src/internal/AGENTS.md).

Development sandboxes and CI provisioning are separate trust boundaries. They
may provide generic capabilities needed to test Jig, but their names,
credentials, package managers, and helper mechanisms never become Jig or FLOW
semantics. If a required generic capability is absent, report it precisely. Do
not weaken the product or turn the development host into architecture.

A second containment implementation may eventually reveal a stable public
Backend boundary. One mechanism alone has not earned it.

Additional hosts preserve native workload parity: ordinary Flows, dependencies,
and native Agent clients need no host-specific rewrites. Keep native workload
compatibility distinct from resource-exhaustion protection. Qualified Macs use
supervised resource accounting and termination with explicit overshoot
limitations instead of Linux-equivalent aggregate hard quotas. Exact admission,
authority isolation, complete descendant ownership and truthful cleanup remain
required. The installed Mac path needs no `sudo`, privileged helper
installation, or managed execution accounts. Exact qualified kernels and their
evidence belong in the host implementation and public guidance.

New kernel profiles require their own qualification before support expands.

### Composition

A Binding configures one Flow package and its exact child slots. Children use
their own admitted settings, routes, grants, and remaining root deadline.
Applications own concurrency through ordinary promises. Jig supplies no queue or
scheduler. Cleanup drains an effect before releasing its specialist owner.

For composition changes, read
[Bindings](../docs/jig/spec/project-policy.md#5-bindings) and
[Direct Run](../docs/jig/spec/project-policy.md#8-direct-run). They own exact
selection, branch reservations, aggregate limits, deadlines, and cleanup.
[Run/0](../docs/flow/spec/run-protocol.md) owns process-boundary identity, join,
conflict, cancellation, deadline, and uncertainty.
[Checkpoints](../docs/jig/spec/run-checkpoint.md) own bounded root evidence
retention while workers remain active.

Internal graphs remain ordinary Flow implementation. Add orchestration,
selection languages, or child-history products only when exact slots and
ordinary structured values cannot express a real application.

Read the responsible contract before changing an effect:

| Effect | Contract | Responsibility boundary |
| --- | --- | --- |
| Project Command | [Project Command](../docs/jig/spec/project-command.md) | The trusted collector returns actual output and termination. Applications own independent assertions. |
| HTTP Request | [HTTP Request](../docs/jig/spec/http-request.md) | The trusted worker holds credentials and network access. Authored methods remain keyless and offline. |

Source proposes resource authority. The existing admission path requires
explicit approval for new or changed authority. An admitted generation does not
change when a grant source file changes. Effect contracts do not grant authored
code raw secrets, arbitrary process delegation, or trusted host status.
Repository test output is not an independent verdict.

### Agent calls

An **Invocation Contract** names an exact interface for independent consumers
and implementations. **Agent Run** is an ordinary Flow interface, called through
an exact Run/0 slot. It creates no FLOW method, model authority, or public
provider framework.

Before changing Agent behavior, read [Agent Run](../docs/jig/spec/agent-run.md),
[HTTP Request](../docs/jig/spec/http-request.md), and
[Finite ACP](../docs/jig/spec/finite-acp.md) as applicable. They own values,
endpoint authority, native grants, credential separation, and settlement.
[Agent setup](../docs/jig/guide/agents.md) owns operator configuration.
[Agent method](../docs/jig/guide/agent-method.md) owns caller inputs and pure
library reuse.

`@jigging/agent-method` owns HTTP preparation, answer interpretation, and its
ordinary Flow entrypoint. `@jigging/agent-acp` reuses that pure code for finite
native conversations and optional channel updates. The host neither prepares
Agent prompts nor reconstructs answers. Consumers validate replacement results
independently.

The Flow supplies bounded instructions, optional explicit Skill contents and
guidance, and an optional bounded result schema. Native calls cannot select the
Agent client, endpoint, model, executable, credential, or network policy. Those
are trusted host choices. Skills are immutable guidance for one call, not tools,
filesystem authority, or provider configuration.

Keep simple ACP policy inline in the ordinary Binding. Named policies earn a
separate file through real reuse or an independently managed responsibility.
Keep a small private Agent reply schema beside its call, and use ordinary
adjacent descriptive files for substantial or reused shapes. Public FLOW result
contracts and private reply shapes stay distinct when their constraints differ.
Optional managed TypeSpec projections retain declaration-owned generation.
Neither placement nor fewer files justify weaker validation or cross-Flow
imports.

A direct OpenAI client is configured by the wire API it uses, an explicit base
URL, credential, and model. Compatible endpoints are endpoint configuration, not
new provider abstractions. Compatibility must be claimed against the selected
protocol: an endpoint compatible with Chat Completions does not thereby
implement Responses. Credential-mode names describe the actual API and
authentication seam, never a development gateway.

Secrets never enter FLOW input, Bindings, artifacts, plans, diagnostics, or
retained Run identity. Non-secret API, endpoint, and model choices may affect
reviewed provider identity. Rotating only a credential must not change project
meaning.

Native clients share one bounded Agent Client Protocol (ACP) lifecycle while
retaining thin, client-specific launch and authentication adapters. They begin
without host filesystem, terminal or MCP client authority. Exact native tool
restrictions are client-specific and remain part of the reviewed trusted
profile, not authority of the editable Agent Flow. Product code never fixes a
model for the sake of a development test. Omission uses the selected client's
own operator configuration or default. Test credentials, endpoints, and low-cost
models remain test inputs.

A future native Agent client should require a thin host adapter, not a FLOW
change. Publish a provider or ACP SPI only after independent integrations show
that the common boundary is real and stable.

Local readiness proves admitted configuration and support, not future remote
reachability, data-retention policy, model truthfulness, or suitability for
sensitive records. Structured output constrains shape. Deterministic application
code still owns evidence, source links, arithmetic, and domain rules.

## Account for effects and evidence

A result must describe what happened honestly, including what remains uncertain.
The same discipline governs runtime completion and the claims used to justify
engineering changes.

### CLI experience is a product gate

Before changing public command output, read the binding
[CLI experience contract](../docs/jig/spec/cli-experience.md). It covers every
command and installed-launcher failure, not only the happy path. Use shared
presentation, preserve machine records and consent details, and check rendered
failure, cancellation, redirected, plain, and narrow-terminal behavior before
closeout. Treat unreadable diagnostics and premature success as product defects.

### Dispatch and completion

Dispatch is the point at which package or provider effects can begin. An
operation that may have crossed that point needs durable identity and a bounded
owner until its work is settled. A complete descendant tree includes all
processes launched beneath the owned work.

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
- **Public failures are bounded.** Credentials and private host, store, runtime,
  sandbox, and coordinator details never cross the user boundary.

Durable machinery is justified by an observed authority, crash, uncertainty, or
cleanup invariant. It is not justified by hypothetical reuse. Delete machinery
coupled only to a removed feature, but do not trade away a proved invariant to
reduce line or table count.

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

Design probes are disposable clean-room API experiments under `design-probes/`.
Leave them uncommitted unless the owner explicitly asks otherwise. Their working
rules are:

- freeze or publish the candidate interface first.
- Delegate creation to a fresh sub-agent with no inherited project conversation
  (`fork_turns: "none"` where supported). Do not use a platform contributor or a
  reused reviewer who already read the internals.
- Supply only public documentation and ordinary consumer artifacts/examples as
  project knowledge. Also supply the requested outcome, acceptance criteria, and
  safety and resource limits. Exclude internal guides, source, roadmaps, old
  probes, and maintainer-designed implementation plans.
- give the consumer write authority only over its probe. Use a separate
  workspace containing those public inputs, withholding the platform checkout
  and privileged host-control access. No Jig/FLOW, specification, or SDK edits
  are permitted. If the tools cannot enforce that separation, record the
  limitation. A written prohibition is not technical isolation.
- keep the coordinator responsible for the brief, frozen artifacts and trusted
  operations, not authoring or repairing the consumer's implementation. Record
  assistance and unavoidable injected guidance. Answer interface questions
  through public documentation. Missing explanations are probe findings, not
  occasions for private implementation hints.
- record exact artifacts, public documents, commands, failed attempts, elapsed
  time, bounded diagnostics, cleanup, and the claims proved or not proved.
- include a malformed or failure case.
- deliberate separately before changing Jig or FLOW.

Maintainer-authored examples and co-designed comparisons remain useful, but are
not independent design-probe evidence. A directory name or sub-agent label does
not establish independence: report the consumer's actual prior context, inputs,
assistance, and access boundaries.

A good probe shows that published pieces compose and exposes concrete usability
gaps. It does not establish domain accuracy, privacy suitability, provider
fitness, professional benefit, or ecosystem value without an evaluation built
for those claims. A failed probe is valid evidence. Do not weaken a boundary or
prompt-tune indefinitely to manufacture success.

Tracked Starters are deliberately authored examples, not preserved probe
snapshots. Exact recovery landmarks for deleted implementation experiments
belong only in [`suspended-experiments.md`](suspended-experiments.md).

### Bounded engineering decisions

Begin design and delivery reviews with the whole consumer task. Identify the
useful work it enables and how the chosen boundaries serve it. Identify what the
author and operator must understand or coordinate. Compare the strongest
credible simpler baseline, including the total burden of learning,
configuration, decisions and recovery, as well as internal dependencies,
indirection, state and coordination. Assess architecture, UX and product impact
before implementation defects and release checks. Passing those checks does not
establish a usable product.

Distinguish current defects from supported limits and future opportunities
rather than making every concern a new gate.

Prefer ordinary data, sensible defaults and corrections at the existing
responsible owner before adding a public command, flag, configuration option or
extension point. Each new public concept must earn its place through
demonstrated consumer needs that generalize beyond one example. An optional
control still adds vocabulary, discovery, documentation and interaction costs.
Hiding it from the ordinary path does not eliminate those costs. Public names
should describe the consumer's intention, not an internal mechanism.

Apply the same standard to internals. First ask whether the mechanism needs to
exist. Prefer removing unnecessary work, reusing a fitting local pattern, or
using standard-library and platform capabilities before writing new
infrastructure. Use installed dependencies when they fit. Do not add a package
for a few clear lines. Keep native values intact unless a boundary requires
conversion.

Each wrapper, abstraction, duplicate representation, lifecycle owner or state
transition must serve a concrete responsibility or invariant. It must make the
whole task easier to reason about. Anticipated reuse alone does not justify it.

Choose the smallest complete, readable implementation, not minimum line count.
Fix the cause at its responsible owner, inspect affected callers, complete the
necessary changes to callers, fixtures, exports, documentation and checks, and
delete obsolete paths. Preserve distinct responsibilities and required
validation, error handling, accessibility and cleanup when simplifying. Fewer
files or shorter code do not justify weaker guarantees.

Apply the doctrine's
[progressive-disclosure obligation](doctrine/design-judgment.md#progressive-disclosure-is-a-design-obligation)
to the before-and-after public usage. Identify configuration, duplicated
declarations and lifecycle code added or removed, not just API names. Prefer
reusable coordination at its responsible layer over boilerplate in every caller.
Check the ordinary path as well as advanced failure handling. Simplification
must preserve authority, truthful results and settlement. Preserve those
invariants, not every existing implementation constraint: revise the mechanism
when it can uphold the same promise with less user burden.

Do not make users manage another concept merely to accommodate the current
implementation.

Before a checkpoint, identify the user-visible outcome, smallest observable
proof, missing seam, public vocabulary, exclusions, and stop condition.

Check whether the apparent solution requires any of these additions or
compromises:

- Setup ceremony or a daemon for a finite command.
- Another lock or admission protocol.
- A registry or plugin framework.
- Host-global package-manager ownership.
- Private implementation details in public values.
- Weaker containment or replay of uncertain work.
- A compatibility path or development-host concept.
- An abstraction inferred from one mechanism.

First search for a smaller solution inside the approved outcome. Escalate only
when the remaining choice materially changes product meaning, authority, cost,
risk, or external ownership. Difficulty alone is not a blocker. A precise
missing credential, infrastructure capability, external authority, or product
choice is. Stop for owner direction before materially expanding product concepts
or choosing between genuinely different product directions.

An owner-actionable blocker must name the unavailable prerequisite or decision,
the safe alternatives already exhausted, and the specific owner action that
unlocks the affected work. A fixable harness error, failed experiment, or
agent-chosen freeze is not such a blocker. Resolve agent-solvable obstacles
within existing authority and budgets. Preserve old evidence and record a
separate run when retrying. Escalate a real budget increase or missing
permission, not the ordinary engineering work needed to use what is already
authorized.

When working on multiple tasks or outcomes, continue available in-scope work
until each task is complete or owner-actionably blocked. A blocker pauses only
the affected task. Keep working on every other task that can progress. Commit
stable in-scope work and retain unstable evidence on a separate experimental
branch only when worth keeping.

Integrate base-branch changes by rebasing the working branch. Do not create
merge commits. For an already published rebased branch, use a force-with-lease
bound to the verified remote head.

Batch related outcomes into a useful review milestone. Keep distinct stable
commits where they help review, but do not make every commit a separate PR or
owner checkpoint. Use `just preflight` before pushing: it builds, runs quick
tooling and portable source checks, and automatically includes Mac-specific
regression files on an exact supported native Mac. Other hosts report the
coverage left to CI. Unsupported Macs refuse. This local regression pass is not
complete host qualification.

Start full CI at the milestone and continue independent work while it runs.
Re-run completed checks only for changed inputs or unresolved failures. Waiting
for CI or review does not by itself pause other authorized work. A push, PR
creation, or missing delivery credential pauses only dependent delivery. Prepare
the next useful approved batch while those actions are pending. A completed
local PR handoff is not a stopping point while other work can advance.

Continue related stable work on the existing open PR branch. CI results qualify
their exact revision. They do not freeze the branch. Use a separate branch for
distinct or unstable work, not merely to preserve a running CI head.

For a blocker requiring owner help, first record it in
`.tmp/current-blockers.md`, including the missing prerequisite or decision,
alternatives already exhausted, and the specific owner action. Then continue
with other available tasks. Report recorded blockers to the owner only when no
remaining task can be advanced without owner help. Do not report an obstacle
that can be resolved within existing authority and budgets. Resolve it and
continue.

Treat legal, commercial, infrastructure, and security questions in proportion to
specific evidence. Do not create a product subsystem to answer an unspecified
concern, and do not ignore a concrete obligation or violation.

Once an outcome boundary is agreed, carry it through implementation, focused
proof, deletion of superseded work, and a stable commit. Own ordinary research,
code, CI, and documentation work rather than handing it to the project owner.
Ask the owner only for actual authority, credentials, external ownership, or a
material product decision. Prefer evidence-backed disagreement and a smaller
alternative to automatic agreement, and stop polishing a vertical once its
first-release proof is sufficient.

Completing a phase proves its bounded outcome. It does not select the next
phase. The roadmap in [`coordination/ROADMAP.md`](coordination/ROADMAP.md) gives
a compact, high-level view of outcome order and the next steps. Keep it small
and direct. Do not expand it to enumerate every upcoming task. Current execution
tasks and blockers are disposable operational state, not additions to this
guide.

When postponing work, add a concise note to
[`coordination/inbox/`](coordination/inbox/). That inbox holds untriaged tasks.
Placement records deferral, not triage, priority, or authorization.

### Proportionate claims

Keep every claim smaller than its evidence. In particular:

- closed Agent-assisted selection is not open semantic discovery.
- a structured delivery packet is not a software factory.
- an SDK runtime test is not a Jig host-runtime claim.
- local readiness is not remote provider health.
- one containment mechanism is not a public Backend SPI.
- private Agent adapters are not a public provider framework.
- a research catalogue is not a roadmap.

External reviewers are useful adversaries, not project authorities. Verify their
claims, accept corrections supported by evidence, explain disagreements, and
never implement a report wholesale.

Use the owner's assigned team identity in external-team correspondence and
reports, not when addressing the owner directly.

A skipped test, filtered hostile case, timed-out aggregate, or interrupted suite
is not a pass. State the exact evidence that completed.

## Write clear technical English

Clear instructions support agency: people and software must understand their
authority, the result, and the next permitted action.
Apply the structural rules below to project technical text.

- Apply these rules to procedures, Agent instructions, prompts, tool
  descriptions, error messages, and operational status reports.
- Apply these rules to technical guides, READMEs, specifications, and
  explanatory prose. Treat dictionary-dependent word choices as advice.
- Preserve the voice of creative and marketing copy. The
  [communication guide](communication.md) owns public positioning and narrative.
- Use active voice. Name the actor when responsibility matters.
- Give one instruction per sentence. Limit instructions to 20 words and
  descriptions to 25 words. Keep each paragraph about one topic, with at most
  six sentences.
- Use lists for three or more steps or conditions. Put conditions before the
  actions they control.
- Use simple verb forms. Replace phrasal verbs and action nouns with direct
  verbs. Do not use semicolons in prose.
- Use one name for each concept. Define necessary technical terms before use.
  Limit noun clusters to three words. Keep subjects, verbs, and articles
  explicit.
- Use the same verb for the same action. Keep different technical actions
  distinct, even if the linter groups their verbs. For example, validate input,
  verify byte identity, and confirm cleanup.
- Preserve every fact, scope, condition, exception, and degree of certainty.
  Keep distinctions between requirements, recommendations, permission, and
  possibility. Preserve exact identifiers, commands, schemas, quotations, and
  license terms.
- If simpler wording loses required meaning, retain that meaning and explain the
  departure. Keep compound verb forms when they carry necessary uncertainty or
  current relevance.
- Check changed technical text with `bun scripts/check-docs.ts`.
  Review findings against the source meaning. The checker enforces sentence
  length, paragraph length, and prose semicolons in changed technical paragraphs.
  Unchanged paragraphs retain their existing findings, including moves between owners.
  Link-only changes do not change the style baseline.
- The checker also validates documentation metadata, local links, and heading
  anchors. CI checks both built sites' routes, assets, and rendered anchors.
- Mechanical checks do not establish complete ASD-STE100 compliance.
  They do not check the official approved-word dictionary.
  Review actors, ambiguity, terminology, modality, and one instruction per sentence manually.

For a focused comparison, select a Git baseline:

```sh
bun scripts/check-docs.ts --base HEAD
```

Use a baseline before your edits. Local checks default to `HEAD`.
CI compares PRs with their base revision and pushes with the preceding revision.
Manual CI uses the checked revision's parent.
New technical paragraphs receive all mechanical style checks.
Do not claim dictionary compliance or certified ASD-STE100 compliance from these checks.

## Find authoritative sources

Use the `jiggy` GitHub organization and npm names under `@jigging/*` until the
owner obtains and selects the npm `@jiggy` scope. Keep FLOW technically and
publicly independent of Jig. Retain the monorepo until separation has concrete
value.

Keep repository tasks in justfiles, not `package.json` scripts. Manifests
declare metadata and dependencies. Just owns build, test, formatting, and
explicit packing tasks. Reuse scripts for substantive orchestration rather than
moving large programs into recipes. Installed products do not require the
development task runner.

Use the narrowest canonical owner for the selected work. This guide teaches the
model. The sources below establish the relevant rules, exact behavior, outcome
order, and current evidence.

| Question | Canonical source |
| --- | --- |
| Why does this product exist? | [`product-compass.md`](product-compass.md) and its doctrine reading map |
| What rules bind this edit? | Root and nearest applicable `AGENTS.md` files, plus this required engineering guide |
| What can a user do now? | [`README.md`](../README.md) and public documentation under [`docs/`](../docs/) |
| What does FLOW mean? | Normative material under [`docs/flow/spec/`](../docs/flow/spec/) |
| What does Jig currently promise? | [`docs/jig/`](../docs/jig/) and package READMEs |
| What is the security boundary? | [`SECURITY.md`](../SECURITY.md) and the nearest implementation `AGENTS.md` |
| How is a release built and published? | [`RELEASING.md`](../RELEASING.md), manifests, and [`.github/AGENTS.md`](../.github/AGENTS.md) |
| How do I install development dependencies and use the checkout's CLI? | [`CONTRIBUTING.md`](../CONTRIBUTING.md#development-shell) and `shell.nix`. Bun generates the ignored workspace lock, never hand-maintained |
| What outcomes come later? | [`coordination/ROADMAP.md`](coordination/ROADMAP.md) |
| Where do postponed, untriaged tasks go? | [`coordination/inbox/`](coordination/inbox/) |
| Where can deleted proof work be recovered? | [`suspended-experiments.md`](suspended-experiments.md) |
| Where is optional first-person historical context? | [`field-notes/`](field-notes/) |
| What is happening right now? | Git, current automation, and disposable `.tmp/` notes |

Before acting, inspect the worktree and recent commits. Compare the checkout
with relevant remotes, package registries, tags, and automation rather than
trusting an old report. Treat existing changes as someone else's until their
ownership is understood. Never reset or clean them to reconstruct the past.
Stage exact paths and inspect `git diff --cached --name-only` before each
commit. Read the specifications relevant to the selected work.

Introductory reading should not require the entire archive or optional field
notes.

Rebase feature branches onto `main` when updating their base, keeping feature
history linear. Push rewritten published history with an explicit
`--force-with-lease` bound to the observed remote revision.
