# Agentic routing product frontier

**Status:** historical milestone rationale, superseded for current ordering by
review 198. Selected on 2026-08-29 after the finite Project Administration
checkpoint and an independent roadmap and probe-evidence review. The Agentic
Routing and software-factory milestone definitions remain valid.

## 1. Product milestones

Jig now has two explicit near-term milestones:

```text
first promotional milestone
    a reviewed independent Agentic Routing campaign

first showcase milestone
    a reviewed independent software-factory campaign
```

The first milestone is enough to begin a public preview and promotion in
developer communities. It must prove a simple, useful Jig + FLOW author and
operator surface: one admitted Agent-backed chooser durably selects only among
exact eligible admitted Flow targets, and a normal FLOW Run executes the
selection. It is not a generic multi-agent framework or provider marketplace.

The software factory follows rather than acting as the routing test. It proves
the larger application composition after the narrower seams are independently
diagnosable. GUI, Cordis reuse, Services, and update reconciliation remain
important later work but do not block either first milestone.

## 2. Gates remain separate

Four exercises answer different questions and cannot substitute for one
another:

| Gate | Question |
|---|---|
| Project Authoring Probe/1 | Can an outsider construct and check the source tree from the public author surface? |
| Operational Baseline/1 | Can an outsider install, acquire, plan, review, apply, run, recover, and close it on a supported host? |
| Agentic Routing/1 | Can one admitted Agent decision durably choose only among exact deterministic survivors? |
| Software Factory/1 | Can the stable pieces compose into a useful event-driven developer application without private glue? |

A successful complex factory cannot prove that the simple project experience
is coherent. A failed complex factory cannot identify which earlier seam is
wrong. The narrower gates run first and are rerun unchanged after later
surfaces land.

## 3. Critical-path dependency graph

```text
finite Project Administration — complete
        |
        +--> Project Authoring Probe/1
        |       |
        |       +--> minimal docs + exact bare project shape
        |                    |
        |                    +--> public acquisition/finite CLI + init --bare
        |
production Linux/Bun trust root -----------------------------+
        |                                                     |
        +--> exact operator-owned Agent Run provider          |
        +--> one host-owned Event Source                      |
                                                              v
public acquisition + trust root --> Operational Baseline/1 --> deterministic alpha

Project Administration --> projectRunTargets() --> dynamic-universe gate

exact Agent Run provider --> private Agent-to-choice composition checkpoint

dynamic universe + Agent-to-choice composition + operational baseline
        --> durable Semantic Choice
        --> Agentic Routing/1
        --> public preview and promotion

Agentic Routing/1 + Event Source + minimal Hook admission
        --> software-factory Starter
        --> Software Factory/1
        --> showcase milestone
```

Host installation, public project operations, and pure changing-universe work
may advance in parallel where their evidence is independent. Dependency order
still governs every join.

## 4. Immediate sequence

### 4.1 Project Authoring Probe/1

Prepare one sealed, checksummed participant packet containing only the
relevant Package/1, JSON/1, Schema/1, Run SDK/1, and Project Authoring SDK/1
documents, machine schemas, exact packed artifacts, host capability facts,
and finite check commands. Do not give authors roadmap reviews, private source,
administration internals, or deferred feature documents.

Two fresh authors independently build:

1. one zero-configuration direct Run package; and
2. one parent/child composition with only the Binding required for its exact
   configured slot.

The authors edit no platform files and invent no missing helper. A private
black-box evaluator may operate copied source afterward, but authorship itself
makes no operational-alpha claim. Friction is recorded separately; platform
changes occur only after review and the unchanged exercise is rerun.

The packet fixes the minimal project shape. `jig init --bare` may then copy
that proven shape; it does not guess a Starter algebra or ask a feature
questionnaire.

### 4.2 Deterministic operational baseline

Join the completed finite Project Session with:

- one administrator-owned production Linux/Bun trust root on a fresh host;
- authenticated descriptor-held project acquisition;
- a finite public install/open, plan/review, digest-only apply, start/status,
  close/reopen surface;
- native dependency preparation for real packed SDK consumers;
- closed sanitized errors and current-to-proposed review evidence; and
- license, version, repository, finite Bun range, and release metadata.

An independent unprivileged operator then runs the authoring subjects through
the complete lifecycle. A separate administrator witness proves launcher and
runtime reacquisition, drift refusal, hostile containment, and zero residue.
Freeze CLI and acquisition spelling only after these consumers pass.

This gate adds no daemon, remote transport, list/watch/cancel API, generic
Runtime Adapter or Sandbox Backend SPI, or background supervisor.

### 4.3 Pure changing Run universe

Implement `projectRunTargets()` through authoring, schema, capture, linking,
portable lock, Plan delta, admission, and deterministic runtime filtering.
Retain the inert marker beside its exact sorted expansion. Additions,
removals, same-identity revisions, unavailable targets, and transitive
authority changes require ordinary review and apply. Existing operations stay
pinned to their admitted generation.

Runtime filtering removes the active owner chain and applies input, readiness,
authority, resource, liveness, and wait-graph checks. Zero survivors is
`BINDING_MISSING`; one runs directly; many are `BINDING_AMBIGUOUS` before an
admitted chooser exists. More than 256 survivors is never sampled, truncated,
retrieved, or batched to fit Semantic Choice.

Named views, filters, tags, query syntax, live catalogue handles, recursive
cross-Flow calls, and a separate universe digest remain absent.

### 4.4 One real Agent Run provider

After the production trust root exists, admit one operator-owned,
restart-reacquirable first-party provider registration. It pins an exact
provider artifact, Agent Run contract, authority ceiling, runtime support, and
containment plan. One supported integration is sufficient for the first
preview; it does not earn a public third-party provider or transport SPI.

Prove one fresh out-of-process Agent Run independently of routing:

- exact request/result and response-schema admission;
- empty and distinct designer/coder Flow-local skill projections;
- operation-scoped attachment and tool attenuation;
- no ambient caller, project, credential, network, or host-control authority;
- durable possible-dispatch and no redispatch after uncertainty;
- cancellation, deadline, complete-tree fencing, and zero residue.

An ambient command, mutable checkout fixture, injected callback, or project
package is not provider evidence.

### 4.5 Agent Run to Semantic Choice composition

The current specifications intentionally do not decide whether Agent-backed
Semantic Choice is realized by host composition, a package wrapper, a Service,
or one registration exposing two contracts. Do not let the campaign silently
choose this architecture.

First prove one private composition between the exact Agent Run and Semantic
Choice contracts. Retain only the smallest mechanism required by that proof.
Do not publish a general composition or provider ABI from one integration.

### 4.6 Durable Semantic Choice and Agentic Routing/1

Add the minimal later authoring slice only after the preceding gates:

```ts
defineJig({
  // existing sources
  semanticChoice: bindingRef("router"),
})

defineBinding({
  package: "./flows/dispatcher",
  slots: {
    work: projectRunTargets(),
  },
})
```

The exact provider Binding must preserve its installed origin in host policy,
the Plan, and the admitted lock. It is not a strategy, model, prompt, or magic
profile string.

The Resolver performs deterministic filtering first. Zero and one survivor do
not call the chooser. Two through 256 may create one journaled decision over
the complete frozen allowlist. A result selects or abstains; an unknown or
malformed result fails. A committed result is reused. Possible dispatch with
no provable result is `UNCERTAIN` and never reranks. Provider unavailability
before dispatch remains deterministic ambiguity with evidence. For the first
Resolver site, abstention also remains explicit ambiguity rather than hidden
fallback.

The independent campaign builds a useful developer-ticket dispatcher which
can route an admitted request among Gauntlet, Majority Vote, and later added
approved workflows without changing router code. It covers zero, one, each
many-candidate selection, abstention, malformed output, unavailable targets,
the over-256 boundary, provider loss before and after possible dispatch,
replay, and a reviewed candidate-set change while old work stays pinned.

Passing this campaign earns the narrow public claim and first promotional
milestone.

## 5. Software-factory showcase

After Agentic Routing/1, prove one host-owned foreground directory watcher or
timer. It owns publisher identity, appends canonical Journal facts, and fences
cleanly. Add only the minimal stable Hook authoring needed for one admitted
Event-to-Run relation. The watcher is an Event Source, never a Hook or
privileged Flow, and one implementation earns no universal Event Source SPI.

Build the factory fresh from the frozen public surfaces:

```text
inbox Event Source
    -> Journal fact
    -> admitted Hook
    -> triage dispatcher
    -> projectRunTargets() and Semantic Choice
    -> role-specific Agent Runs
    -> application-owned Kanban/files
```

Task, ticket, Kanban, Git/worktree, inbox, and GUI semantics remain Starter
policy. Do not introduce a Service unless concrete concurrent state proves
ordinary files and Runs insufficient. Only a reviewed useful implementation
is promoted as a copied Starter; the experimental workspace itself is not.

## 6. Work outside the first-release path

The following do not block the promotional or showcase milestones:

- Agent Session and Interactive;
- portable Service conformance or a general Service supervisor;
- GUI and authenticated remote management clients;
- Cordis integration;
- update reconciliation and Agent-assisted update repair;
- Jig Graph or a Sley compiler;
- daemon, distributed execution, or arbitrary list/watch/cancel APIs;
- generic provider, Event Source, Runtime Adapter, or Sandbox Backend SPIs;
- a second containment mechanism or second Agent provider;
- Windows, Deno, Node-host, or Python-control-plane support; and
- Starter composition, questionnaires, or ongoing Starter dependencies.

They remain demand-gated work and may proceed independently when a real
consumer earns them. They cannot expand the claims of the first release.

## 7. Probe evidence policy

Historical design-probe projects were disposable test-track snapshots. Their
reviewed findings remain in the specifications, tests, and checkpoint records;
their pseudocode, invented APIs, copied artifacts, and generated installations
are removed from the active tree. A future software-factory project must be
rebuilt rather than copied from those experiments.

Future exercises run in ephemeral repositories outside the Jig checkout from
sealed read-only documents and packed artifacts. Probe agents cannot see
siblings or edit the platform. Missing interfaces stop the exercise. The
platform changes only after independent review and then reruns the same frozen
exercise.

Only two kinds of output merit durable promotion:

1. a small repeatable conformance or release-gate definition; or
2. a reviewed useful application promoted as a Starter.

Solutions, caches, installed dependencies, evaluator scratch, and historical
workspaces do not.

## 8. Governing rule

> Prove the deterministic project before routing, prove the Agent before using
> it as a chooser, and prove routing before hiding it inside a factory.

The public milestone changes. The ownership and uncertainty rules do not.
