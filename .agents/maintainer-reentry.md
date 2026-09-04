# Maintainer re-entry guide

This is shared engineering memory for a maintainer who remembers nothing about
Jig or FLOW. Every maintainer edits it in place when a durable mental model
changes. Delete obsolete text instead of appending corrections or chronology.

This guide is not a specification, roadmap, release record, task list, or
substitute for executable evidence. It explains how the pieces fit and why the
important boundaries exist. Follow the applicable `AGENTS.md` files for binding
work rules and the public documentation for current product behavior.

Read the [`product compass`](product-compass.md) first when the product's
purpose, audience, differentiation, or end state is not already clear.

## The one-minute model

Jig is a small, local, fail-closed host for reviewed FLOW packages:

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

FLOW defines portable package and invocation meaning. Jig owns admission,
authority, containment, provider selection, and durable host state. A Flow
owns application logic. Sley or another component library may own live
in-process graph execution inside a Flow. Models return data; only admitted Jig
policy grants authority.

The recurring architectural risk is promoting machinery needed to prove one
case into permanent product structure. The reliable working pattern is:

```text
freeze one concrete outcome
    -> let an independent consumer expose the smallest missing seam
    -> implement only that seam
    -> prove authority, failure, cancellation, and cleanup
    -> delete the superseded path
    -> return to external evidence
```

## Find current truth

Use the narrowest canonical owner instead of copying mutable facts here:

| Question | Canonical source |
| --- | --- |
| Why does this product exist? | [`product-compass.md`](product-compass.md) |
| What rules bind this edit? | Root and nearest applicable `AGENTS.md` files |
| What can a user do now? | [`README.md`](../README.md) and public documentation under [`docs/`](../docs/) |
| What does FLOW mean? | Normative material under [`docs/flow/spec/`](../docs/flow/spec/) |
| What does Jig currently promise? | [`docs/jig/`](../docs/jig/) and package READMEs |
| What is the security boundary? | [`SECURITY.md`](../SECURITY.md) and the nearest implementation `AGENTS.md` |
| How is a release built and published? | [`RELEASING.md`](../RELEASING.md), manifests, and [`.github/AGENTS.md`](../.github/AGENTS.md) |
| What outcomes come later? | [`ROADMAP.md`](ROADMAP.md) |
| Where can deleted proof work be recovered? | [`suspended-experiments.md`](suspended-experiments.md) |
| What is happening right now? | Git, current automation, and disposable `.tmp/` notes |

On return, inspect the worktree and recent commits before acting. Compare the
checkout with relevant remotes, package registries, tags, and automation rather
than trusting an old report. Treat existing changes as someone else's until
their ownership is understood. Read only the specifications relevant to the
selected work; the re-entry path should not require loading the entire archive.

## Ownership boundaries

| Layer | Owns | Must not own |
| --- | --- | --- |
| FLOW | Portable packages, JSON and schema rules, the Run process protocol, SDK ergonomics, capability descriptors | Jig admission, providers, sandboxes, persistence, project configuration, or graph policy |
| Jig | Capture, review, admission, exact resolution, host authority, durable lifecycle, containment, and credentials | General workflow semantics, an application ontology, or universal provider/runtime/backend frameworks |
| Flow package | Application logic, validation, Agent instructions, package-local skills, and optional internal libraries or graphs | Host credentials, open-ended target authority, or containment policy |
| Component runtime | Live graph or control-flow advancement inside one component process | FLOW/Jig meaning, durable orchestration, admission, or provider policy |
| Application or Starter | Domain rules, prompts, user experience, repository policy, and professional oversight | New Jig core concepts merely because one application needs them |

FLOW's process boundary deliberately excludes host records, resolution,
authority evidence, provider identity, persistence, and application ontology.
Runtimes, sandboxes, Bindings, dependency preparation, and Agent clients are
Jig or application facts, never FLOW vocabulary.

Sley remains an independent component runtime. A Flow may use it directly
behind Run/1. Jig should not fork its scheduler, subclass its elements, or put
Jig domain state inside Sley objects. A Jig-specific graph layer is justified
only by a real stored-graph consumer that direct Sley cannot express clearly.

## Product simplicity boundary

The product should feel like one finite path: initialize a local project,
review it, run one exact admitted target, receive one terminal result, and
leave no execution residue. Users should not manage setup phases, plan digests,
coordinator epochs, runtime recipes, sandbox selection, or another lock
protocol.

Project authoring values are inert. They describe membership and configuration
but do not read, install, approve, or execute anything. FLOW metadata remains
small and portable; host runtimes, commands, credentials, dependency locks,
and sandbox policy do not belong in `FLOW.md`.

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
not evidence for a plugin system or public SPI.

## Admission and lifecycle laws

These invariants protect authority and uncertainty. Simplifying them away is
not product simplification.

1. **Planning is authority-neutral, not read-only.** Checking may capture,
   evaluate, prepare, and retain evidence. Before confirmation it must not
   modify visible project meaning, grant execution authority, or run package
   code.
2. **Capture precedes authority.** Mutable visible source is neither evaluated
   nor executed directly.
3. **Parsed and hashed does not mean authorized.** Validation, a digest, or a
   portable lock cannot grant host-local execution authority.
4. **Portable meaning and local consent differ.** Reproducible project meaning
   can be shared; consent to run it cannot.
5. **One project identity has one owner.** A finite session cannot create
   competing coordinators or authority issuers for the same project.
6. **Approval consumes retained meaning.** It reopens reviewed bytes and never
   silently evaluates newer visible source.
7. **One admitted generation executes.** Root and child resolution never use a
   live directory or mutable catalogue.
8. **Validate both sides.** Validate input before package code runs and validate
   the declared outcome and result before success.
9. **Intent precedes dispatch.** Durable request identity and content exist
   before package or provider effects begin. Changed reuse conflicts.
10. **Unknown dispatch stays unknown.** Possibly dispatched work is fenced, not
    guessed successful or automatically sent again.
11. **Support and launch authority differ.** Reproducible mechanism support may
    be reviewed; ephemeral execution authority is reacquired and revalidated
    immediately before use.
12. **Success follows fencing.** A valid response is insufficient until the
    complete descendant tree is fenced, reaped, cleaned, and the result is
    admitted.
13. **Cleanup outlives the coordinator.** A bounded owner must settle possibly
    launched work even when the coordinating process disappears.
14. **Close revokes authority.** Closing a project session prevents new starts,
    settles owned work, releases exclusive ownership, and preserves durable
    records.
15. **Executable failure stays failure.** Missing runtime or provider support
    never turns prose into equivalent executable behavior.
16. **Public failures are bounded.** Credentials and private host, store,
    runtime, sandbox, and coordinator details never cross the user boundary.

Durable machinery is justified by an observed authority, crash, uncertainty,
or cleanup invariant. It is not justified by hypothetical reuse. Delete
machinery coupled only to a removed feature, but do not trade away a proved
invariant to reduce line or table count.

## Containment boundary

Jig has one private supported containment mechanism. Its observable contract
matters more than its implementation vocabulary:

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

## Dependency preparation and local development

`jig check` is the authority-neutral point where exact locked production
dependencies may be downloaded and prepared after relevant source changes.
`jig run` performs no installation, network lookup, lifecycle script, or
ambient runtime discovery; it consumes only retained admitted bytes.

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

## Composition boundary

Exact child slots let a Binding name a closed set of targets from the same
admitted generation. At runtime, a Flow can call only those slots; it cannot
search a catalogue, invent targets, or acquire scheduler authority. Child and
Agent scopes inherit the remaining root deadline and cannot extend it.

Run/1 owns request identity, join, conflict, cancellation, deadline, and
uncertainty behavior across the process boundary. Internal graphs remain
ordinary Flow implementation. Add recursive orchestration, selection
languages, or child-history products only when a real application cannot be
expressed with exact slots and ordinary structured values.

## Agent boundary

Agent Run is a Jig-owned Capability Contract consumed through ordinary Run/1
`effect/call`. It is not a new FLOW method, model authority, or public provider
framework. The public value contract belongs in
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

Native clients share one bounded ACP lifecycle while retaining thin,
client-specific launch and authentication adapters. They begin without
filesystem, terminal, MCP, or arbitrary tool authority unless a future
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

## Probe and evidence discipline

Design probes are disposable clean-room API experiments. Their binding rules
live in the root [`AGENTS.md`](../AGENTS.md). The durable method is:

- freeze or publish the candidate interface first;
- give an independent builder only public artifacts, public documentation, the
  requested outcome, and explicit limits;
- prohibit changes to the platform while it is being consumed;
- include a malformed or failure case; and
- deliberate separately before changing Jig or FLOW.

A good probe shows that published pieces compose and exposes concrete usability
gaps. It does not establish domain accuracy, privacy suitability, provider
fitness, professional benefit, or ecosystem value without an evaluation built
for those claims. A failed probe is valid evidence; do not weaken a boundary or
prompt-tune indefinitely to manufacture success.

Tracked Starters are deliberately authored examples, not preserved probe
snapshots. Exact recovery landmarks for deleted implementation experiments
belong only in [`suspended-experiments.md`](suspended-experiments.md).

## Decision method

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
choice is.

Completing a phase proves its bounded outcome; it does not select the next
phase. The long-term ordering lives in [`ROADMAP.md`](ROADMAP.md). Current
tasks and blockers are disposable operational state, not additions to this
guide.

## Claim discipline

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

## Final note

Protect the boundaries and the method more fiercely than any individual
implementation. Honest refusal and a small interface are more valuable than
uninterrupted forward motion. If the environment is missing a capability,
name it exactly. If a probe fails, preserve the result honestly. If code is
superseded, remove it.
