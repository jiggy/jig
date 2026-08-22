# Jig's smallest credible product surface

## Product ruling

Jig should feel like a small host configured by ordinary code, not like an
application framework and not like a filesystem ritual. Its runtime kernel
needs only to activate immutable definitions, supervise Scopes and Runs, route
bound calls, enforce authority, and record what happened. Everything that gives
Jig a particular personality--Agents, semantic routing, durable events,
Services, source updating, or a software-factory workflow--is a replaceable
module or user-owned source composed at project activation.

The user-facing distinction is:

```text
FLOW package       reusable behavior
Flow Binding       one configured project-local use of that behavior
Run                one invocation of a Binding
Jig module         optional host facility used by Bindings/Runs
Starter            source copied once to create an application
```

No other noun should enter the main project API unless it protects an
independent invariant.

## 1. The runtime kernel

The irreducible Jig kernel has seven responsibilities.

### 1. Package catalogue and provenance

It reads Package/1 metadata, identifies source provenance, and indexes local
descriptions. It never executes code merely to discover a package. Package
identity is resolved source + revision + content digest, not `FLOW.md.name`.

### 2. Activation

It evaluates the project definition, resolves references, validates settings
and grants, materializes immutable package/definition snapshots, and publishes
one activation atomically. Active Runs never execute mutable source.

### 3. Bindings and deterministic resolution

It resolves exact Flow Binding and effect-slot references, filters candidates
by protocol/runtime/grants/trust, and exposes a resolver extension point when
more than one eligible candidate remains. Exact project bindings always win.

### 4. Scope and Run supervision

It creates the ownership tree, launches Run/1 processes, admits child Runs
without nested-scheduler deadlock, propagates cancellation child-first, applies
timeouts, and terminates remaining process trees through the selected isolation
backend.

### 5. Effect dispatch

It accepts `effect/call` and `flow/call`, resolves their bound slots, checks
grants, and dispatches to registered handlers/providers. The kernel knows the
generic envelope, not Agent, Git, HTTP, or database semantics.

### 6. Operation journal

It durably records Run identity, operation intent, completed result, unknown
completion, cancellation, binding revision, effective grants, and selected
entry runtime. This is sufficient for idempotency and truthful failure. It is
not arbitrary graph continuation persistence.

### 7. Isolation backend interface

It asks one backend to prepare and supervise a process under an explicit grant
set and records whether each restriction is enforced, mediated, advisory, or
unavailable. The kernel does not pretend that subprocess spawning alone is a
sandbox.

That is the kernel. It does not contain:

```text
Agent SDKs
semantic model calls
durable domain events or Hooks
Services provider semantics
Git, worktrees, inbox, Tasks or Kanban
GUI or HTTP hosting
source-update intelligence
filesystem watch mode
Caskada or Cordis execution
```

The kernel may use SQLite for journals, locks, leases, and indexes. Files are a
user authoring medium; forcing concurrent runtime state into JSONL files would
be an implementation handicap, not a portability virtue.

## 2. Bundled modules are capabilities, not another package system

Jig v1 should ship several modules, but none is initialized by a project that
does not use it:

| Bundled module | Responsibility |
|---|---|
| Services | Stable Services/1 mounting, contracts, invocation, loss, and cleanup |
| Agents | Agent providers, sessions, instruction execution, and normalized lifecycle facts |
| Semantic Resolver | Agent-backed ranking after deterministic filters |
| Events | Durable fact journal, subscriptions for Hooks, and replay cursors |
| Hooks | At-least-once local policy dispatch from durable facts to new Runs |
| Source tooling | Install, diff, update, validation, provenance, and rollback |
| Telemetry sinks | Retain/sample/display lossy `event/emit` observations |
| Watch | Optionally turn selected environmental changes into durable facts |

Services must be stable before the complete product is called Jig v1, despite
having separate FLOW conformance. Its implementation can remain a bundled
module because a Run-only project pays no runtime or authoring tax for it.

“Module” does not become a new distribution artifact. It is an ordinary
project-startup function that registers handlers/providers under the project
root Scope and returns cleanup. There is no `MODULE.md`, module marketplace,
module dependency language, or second plugin graph. A third party may distribute
such code through its normal language package manager or as source.

## 3. One special authored file

Only one Jig-specific authored filename is necessary:

```text
jig.ts
```

It exports one project definition. Authors may split it through ordinary
TypeScript imports, but Jig does not auto-discover magic `bindings/`, `hooks/`,
`agents/`, or `policies/` directories.

```ts
import { defineJig, bind, hook } from "jig";
import { services } from "@jig/services";
import { events } from "@jig/events";
import { agents } from "./jig/agents";
import { semanticResolver } from "@jig/semantic-resolver";

const reviewStrict = bind({
  use: "./flows/review",
  settings: {
    maxRetries: 5,
    threshold: 0.9,
  },
  slots: {
    agent: "agents/reviewer",
  },
  grants: "policies/reviewer",
});

const gauntlet = bind({
  use: "./flows/gauntlet",
  settings: {
    maxIterations: 8,
  },
  slots: {
    review: reviewStrict,
    agent: "agents/builder",
  },
  grants: "policies/builder",
});

export default defineJig({
  use: [
    services(),
    events(),
    agents,
    semanticResolver({ agent: "agents/router" }),
  ],

  flows: {
    gauntlet,
    reviewStrict,
  },

  hooks: [
    hook({
      id: "review-completed-build",
      on: "agent.completed",
      handle(event, jig) {
        if (event.data.role !== "builder") return;

        return jig.run("reviewStrict", {
          input: {
            sessionId: event.data.sessionId,
          },
          actionKey: event.id,
        });
      },
    }),
  ],
});
```

The exact helper names may change after an ergonomic prototype. The important
properties are normative:

- project evaluation happens once during `jig apply`, not on every Run;
- its result must normalize to serializable Bindings, module registrations,
  Hooks, and policies;
- the resulting activation receives a digest and immutable snapshot;
- source modules can share values using normal language composition;
- no hidden directory precedence, deep merge, or environment lookup exists;
- project code is trusted project authority, never loaded from an untrusted
  Flow merely because that Flow was catalogued.

`.jig/` is reserved generated state: snapshots, locks, journals, staging, and
runtime data. `flows/`, `jig/`, `agents/`, `hooks/`, `inbox/`, or `kanban/` are
starter conventions, not names recognized by the kernel.

If a future non-TypeScript authoring frontend is useful, it must emit the same
normalized project definition. Jig should not maintain parallel JSON, YAML, and
TypeScript semantics in v1.

## 4. Flow Binding is the only configuration object

A Flow package is reusable source. A Flow Binding is one immutable configured
use in one project:

```text
Binding ID
+ exact package snapshot
+ settings
+ bound slots
+ grant policy
+ optional local routing description
```

Runs target Bindings, not mutable package directories. Several Bindings may use
the same package:

```ts
const reviewFast = bind({
  use: "./flows/review",
  settings: { maxRetries: 1, threshold: 0.7 },
});

const reviewStrict = bind({
  use: "./flows/review",
  settings: { maxRetries: 5, threshold: 0.95 },
});
```

These are separate router candidates and separate lock records without source
duplication.

There is no separate `FlowInstance`, `Profile`, `Role`, `Variant`, or
`Environment` abstraction. If code benefits from reusable fragments, it uses
ordinary constants and object spread visibly:

```ts
const reviewDefaults = {
  maxRetries: 3,
};

const reviewStrict = bind({
  use: "./flows/review",
  settings: {
    ...reviewDefaults,
    threshold: 0.95,
  },
});
```

Jig does not implement binding inheritance or deep merge.

### Settings cannot be overridden by a Run

This must be strict.

Settings describe the configured provider chosen by the project. Input
describes the request chosen by the caller. Allowing a caller to merge arbitrary
settings at `jig run` time would:

- make a Binding ID cease to identify behavior;
- bypass project-owned policy;
- make semantic descriptions and selection evidence inaccurate;
- complicate cache, lock, and provenance keys;
- create implicit precedence between package defaults, Binding values, caller
  overrides, and environment variables.

Therefore `flow/run.settings` is supplied by the host from the selected Binding
and is immutable for the Scope. It is not caller input. Parent settings never
flow to a child Binding.

If `maxRetries` legitimately varies by request, it belongs in the Flow input.
If an operator wants one exceptional configured use, Jig may materialize an
**anonymous one-Run Binding**:

```bash
jig run --flow ./flows/review \
  --settings ./strict-once.json \
  --input ./request.json
```

That command creates and journals a distinct ephemeral Binding definition; it
does not mutate or override `reviewStrict`. It requires the same authority and
validation as defining a Binding in `jig.ts`.

There should be no `jig run reviewStrict --set maxRetries=99` shorthand. Its
convenience is outweighed by the false identity it creates.

An optional package settings schema catches missing values during activation.
Otherwise the implementation must validate before its first effect. Schema
`default` annotations never mutate settings; implementation code owns defaults.

## 5. Slots and grants

A slot is a consumer-local dependency name. It does not imply a global service
namespace. Binding a slot turns a late dependency into a recorded exact
provider for a Scope.

```ts
slots: {
  review: reviewStrict,
  agent: "agents/builder",
}
```

The kernel needs slots because both `flow/call` and `effect/call` must be
inspectable and pin provider identity. It does not need a generalized
dependency-injection object graph.

A grant is authority, not a preference. The smallest grant record is:

```text
resource kind
resource selector
access mode
minimum enforcement
```

Project policies may package repeated grant sets, but the normalized Run record
contains their explicit expansion. Grant sets are monotonic; there are no deny
rules, roles, inheritance, or boolean policy language. Child Scopes receive an
explicit subset.

Portable raw-resource kinds should remain limited to filesystem roots, network
destinations, approved spawned executables, named environment keys, and secret
handles. Agent, child Flow, and Service authority normally comes from a bound
slot and mediated `effect/call`, not an OS grant.

The Binding chooses the maximum authority. A package may declare minimum needs
for preflight. Launch requires the checked intersection and sufficient sandbox
enforcement. If a backend cannot enforce a required restriction, an untrusted
Run is refused; a trusted override is explicit and journaled.

Do not add `Workspace`, `Project`, `Repository`, or `Worktree` grants. Those are
application meanings attached to ordinary roots or service slots.

## 6. Facts, observations, and Hooks

The kernel accepts lossy Run/1 `event/emit` observations and may discard them.
The optional Events module adds durable facts.

The separation is absolute:

```text
event/emit observation
    lossy, unacknowledged, never drives correctness

event-store append through effect/call
    acknowledged, operation-ID deduplicated, durable fact
```

Host-owned lifecycle facts such as `jig.run.completed` are committed by the
host. An Agent provider commits `agent.completed`; a Flow cannot forge that
provider fact merely by emitting a similarly named observation.

A Hook is local project policy from a committed fact to zero or more scheduled
actions. It is not a class, portable package, Markdown file, middleware chain,
or graph node. The `hook()` helper above merely validates an ordinary project
definition.

Rules:

- fact commit precedes delivery;
- delivery is at least once;
- Hooks fan out independently and cannot retract/delay the fact;
- scheduling deduplicates Hook revision + event ID + action key;
- Hook failure does not roll back the fact;
- complex work starts a Flow rather than living in the Hook callback;
- raw external work performed by Hook code forfeits Jig's effect idempotency
  unless it uses a host operation with an operation ID.

There is no magic `hooks/` directory. A starter may create one because ordinary
imports keep a large `jig.ts` readable.

Environmental producers are modules. A filesystem watcher can commit
`input.file.created`; an HTTP listener can commit `http.request.received`.
Neither makes files or HTTP a Jig ontology.

## 7. Agent integration

FLOW remains Agent-neutral. Jig remains Agent-native through one bundled Agent
module and one project-owned provider interface.

The public integration should have one concept, `AgentProvider`, capable of the
operations it actually supports:

```text
one-shot run
open/prompt/cancel/close session
structured output, when available
provider observations and lifecycle facts
```

Codex, Claude Code, ACP, and process-based adapters implement that interface.
They are ordinary local source or language packages; Jig core does not export a
different Agent class for every vendor. A Starter may generate editable
`agents/codex.ts` and `agents/claude.ts` adapters so users own their flavors.

Projects define configured Agent providers just as they define Flow Bindings:

```ts
export const agents = agentModule({
  router: codex({
    permissions: "none",
    session: "ephemeral",
    maxTurns: 1,
  }),

  builder: claudeCode({
    permissions: "workspace-write",
    session: "resumable",
  }),
});
```

The Router or a Flow receives an Agent through a slot. It never imports the
vendor directly unless it intentionally sacrifices portability for a
provider-specific effect contract.

Agent sessions belong to the requesting Scope. Provider raw logs and session
state are stored by the Agent module, associated with Run/Scope IDs. Message
deltas are observations; lifecycle completion is a durable provider fact when
the Events module is present.

The instruction runner for `FLOW.md`-only packages is a normal Agent-backed
runner. With no Agent provider, those packages remain discoverable but
`implementation_unavailable`. Deterministic executable Runs, checks, applies,
and clean updates do not require an Agent.

## 8. Semantic resolution and missing-Flow repair

The kernel performs all deterministic work first:

1. use the explicit Binding for the caller slot;
2. reuse a still-valid Scope-pinned selection;
3. filter catalogued Bindings by executable/instruction availability,
   extensions, schemas/contracts, grants, trust, recursion limits, and policy;
4. select directly if one remains;
5. delegate ranking only if several remain and the Semantic Resolver module is
   configured;
6. otherwise return `binding_ambiguous` with exact reasons.

The semantic Agent receives bounded candidate records. `FLOW.md` descriptions
are quoted untrusted data, not appended as router instructions. It can rank only
installed and approved candidates; it cannot grant authority or install code.
The chosen Binding snapshot and evidence are pinned for the Scope.

### Repair may satisfy a still-pending first call

The previous blanket rule “repair, then start a new Run” is unnecessarily
strict. A missing dependency can safely satisfy an already-waiting
`flow/call` when and only when no child has been dispatched and the slot has
never been bound in that Scope.

The safe sequence is:

1. journal the pending `flow/call` and its operation ID;
2. determine that the slot has no prior binding or child attempt;
3. consult explicit project policy allowing synchronous repair for that slot;
4. start the repair Flow in a separate child Scope and staging area;
5. install/generate, validate, sandbox-probe, and approve the candidate;
6. activate one immutable candidate revision;
7. apply normal deterministic filters and semantic selection;
8. bind the slot once, journal it, dispatch the child, and answer the original
   call;
9. respect the original deadline and cancellation throughout.

This is not mid-Run rebinding. It is delayed first binding before dispatch. The
runner's continuation is still alive waiting on the call, so no arbitrary graph
serialization or rewind occurs.

It is forbidden when:

- a provider was already bound or attempted in the Scope;
- the missing dependency is a replacement for a lost provider;
- repair requires unapproved authority;
- the parent deadline cannot accommodate it;
- the parent process/host has crashed;
- policy requires human approval that cannot complete within the bounded wait.

In those cases `flow/call` returns `binding_missing` or the Run returns
`blocked`. A completed repair may still benefit a later Run.

Without an Agent, Jig may offer exact deterministic install/bind choices, but
it cannot generate or semantically select. The diagnostic remains useful:
caller/slot, intent, rejected candidates/reasons, required features/grants, and
configured indexes.

Repair is never invisible. It has its own Run/Scope, source provenance, grant
record, staging tree, checks, approval decision, activation, and resulting slot
binding in the journal.

## 9. `jig init` should copy one application, not invent starter algebra

`jig init` needs only:

```bash
jig init --bare
jig init
jig init --from github:owner/project-starter@<revision>
```

- `--bare` writes the smallest `jig.ts`, ignore rules, and generated-state
  directory.
- the default resolves one release-pinned recommended starter.
- `--from` copies one exact starter source.

A Starter is an ordinary repository copied once. It is not mounted at runtime,
not a package type, not a collection dependency, and not automatically updated
as a unit. The resulting files belong to the user immediately.

Do not add multi-Starter merge order, `STARTER.md`, Starter inheritance,
profiles, or a pack solver. Composition after initialization is ordinary:

- imports in `jig.ts` compose bundled/third-party modules;
- Flow Bindings compose package behavior;
- `jig add` installs an exact package/module source;
- users copy or write local Flows, Hooks, Agent adapters, and policies.

A future generator may offer questions and optional files, but its output must
still be an ordinary project with no runtime dependency on the generator.

## 10. Mutable source, immutable activation

The visible source tree is always the effective editable source of truth. No
runtime patch stack exists.

```bash
jig check       # parse, resolve, validate, and probe without activation
jig apply       # snapshot and atomically publish a valid activation
jig status      # compare authored, active, and running revisions
jig diff        # show local divergence from installed upstream base
```

`jig apply` is the fundamental reconciliation operation. Watch mode may invoke
the same transaction, but the kernel does not assume an always-on file watcher.
A broken candidate never tears down the current activation.

Every new Run pins the active Binding/package digests. Editing source affects no
active Run. A mounted Service continues its old snapshot until explicit reload;
new consumers do not observe half-applied source.

### Update

```bash
jig update <source>
jig update <source> --repair agent
jig rollback <activation>
```

Update stages:

```text
BASE       pristine upstream revision adopted previously
LOCAL      current visible edited source
UPSTREAM   new pristine upstream revision
```

Jig performs a deterministic three-way tree merge first, runs all deterministic
checks, and atomically publishes only a valid candidate. Textual conflicts stop
safely. `--repair agent` starts a maintenance Flow with BASE/LOCAL/UPSTREAM,
partial merge, conflicts, tests, and upstream notes. Its output is still a
candidate subject to checks and policy.

No architecture can prove that a clean textual merge preserved local intent.
Tests, contract conformance, Agent review, and human approval provide evidence;
high-authority policies should demand more evidence. Previous snapshots make
rollback immediate.

Basic `check`, `apply`, clean update, and rollback require no Agent. Semantic
repair and semantic update review clearly report that they do.

## 11. The file-native software-factory Starter

A software-factory application is an excellent Jig Starter and a terrible Jig
kernel model.

It may generate:

```text
inbox/
kanban/
tasks/
flows/
agents/
project-repository/
jig.ts
```

The Starter defines, in user-owned source:

- a watcher that commits a durable fact for a completed inbox submission;
- a Hook that starts the triage Binding;
- Flows that create/move Kanban cards;
- its Task ID and task-data conventions;
- an optional Git/worktree provider and merge policy;
- Agent bindings for triage, building, review, and maintenance;
- artifact and session presentation;
- checkpoint/approval policy.

Jig sees only modules, facts, Hooks, Bindings, Runs, roots, slots, and grants. It
does not know that a Markdown file is a ticket, a directory is a Kanban column,
or a filesystem root is a Git worktree.

The orchestrator source repository and target-project repository remain
separate because the Starter grants them as different roots/services. The same
Jig kernel can instead host a GUI application, background service, research
workspace, or non-file event source.

“File-native” therefore means users can inspect, edit, version, and move the
definitions and artifacts they own. It does not mean every application is an
inbox or every runtime fact is a file.

## 12. CLI surface worth freezing

The initial CLI should remain small:

```text
jig init [--bare | --from <source>]
jig check
jig apply
jig run <binding> --input <json-file>
jig run --flow <source> --settings <json-file> --input <json-file>
jig status
jig explain <run-or-binding>
jig add <source>
jig diff [source]
jig update [source] [--repair agent]
jig rollback <activation>
jig repair <diagnostic-id>
```

`jig explain` shows exact package/runtime, settings digest, slots, grants,
selection filters/evidence, and Run/Scope tree. It should be the antidote to
hidden semantic orchestration.

Do not add core CLI nouns for Tasks, inbox, boards, worktrees, prompts, roles,
graphs, or sessions. A Starter/module may add its own commands without teaching
the kernel those concepts.

## 13. Noun and convention audit

Keep:

| Noun | Protected invariant |
|---|---|
| Package | Portable source/provenance unit |
| Flow | Runnable unit of work |
| Binding | Reproducible configured project use |
| Run | One invocation and outcome |
| Scope | Authority and cleanup owner |
| Slot | Consumer-local pinned dependency |
| Effect | Host-mediated external operation |
| Observation | Lossy structured runtime information |
| Fact | Durable acknowledged occurrence |
| Hook | Local reaction policy to a Fact |
| Service Mount | Long-lived provider instance |
| Grant | Explicit authority |

Reject or demote:

| Noun/convention | Reason |
|---|---|
| Context as remote object | It is an SDK view of immutable Run/Mount fields |
| Space/Workspace | A named root is sufficient; meanings are application-specific |
| Task/WorkItem | Starter domain model |
| Profile/Role/Variant | A Binding already represents a configured use |
| Agent subclass per vendor | One provider interface plus project adapters |
| Reconciler daemon | `jig apply` is the primitive; watch is optional |
| Patch stack | Visible effective source plus three-way update is sufficient |
| Magic folders | Ordinary imports are clearer |
| Starter pack/composition graph | Copy one project, then use normal source composition |
| Application event bus in Run core | Durable facts belong to the Events module |

## Final surface

The stable Jig promise can be summarized without an application framework:

> `jig.ts` defines modules, Flow Bindings, and Hooks. `jig apply` turns that
> mutable source into an immutable activation. Runs execute Bindings inside
> owned Scopes, using only bound slots and granted authority. Optional bundled
> modules provide Agents, semantic selection, Services, durable facts, and
> updates. Starters copy ordinary source that users own.

The two disputed operational rules should be frozen explicitly:

1. **A named Binding's settings are never overridden per Run.** Variable caller
   data is input; an exceptional configuration creates a distinct ephemeral
   Binding.
2. **A missing first binding may be repaired while `flow/call` waits, but only
   before any provider dispatch, under explicit bounded policy, with staged and
   journaled activation.** This preserves dynamic fault tolerance without
   rebinding or rewinding live work.
