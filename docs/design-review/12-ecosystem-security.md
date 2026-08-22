# Ecosystem and security architecture review

## Verdict

The viable architecture is neither a renamed Skill format nor a universal
plugin framework.

FLOW should standardize three boundaries, with three independent conformance
claims:

1. **Package/1** makes a procedure discoverable and distributable.
2. **Run/1** lets a host invoke an executable unit and service its effects while
   the unit retains control of its own continuation.
3. **Services** is an optional, separately versioned extension for long-lived,
   multi-operation providers.

Jig should implement all three, but a third-party host may implement Package/1
and Run/1 without implementing Services, semantic routing, an Agent, a durable
event store, or a sandbox. Such a host must report those omissions honestly and
must not run untrusted code when it cannot enforce the required isolation.

The crucial separation is:

```text
Flow package       portable meaning and optional executable
Run/1              live one-shot execution boundary
Services           optional stable service boundary
Jig                policy, lifecycle, trust, binding and durability
Starter            one application's choices
```

This is large enough to support serious orchestration and small enough that an
independent host can implement the stable core. Long-lived service machinery is
available without being the tax paid by every one-file Flow.

---

## 1. Architectural laws

The following should be normative.

### 1.1 A runner owns its continuation

Caskada owns its nodes, transitions, branches and loops. Cordis owns its
Contexts, Fibers and local services. A plain program owns its call stack. Jig
does not mirror any of them.

During a Run, the component may synchronously await host effects. The host owns
the effects and the component owns what happens after each result.

### 1.2 A connection is not an identity

Run, Scope, effect, provider and mount identifiers are explicit. A process or
stdio channel may carry them, but the channel is not their identity. In Run/1 a
process crash still terminates its live continuations; the explicit identifiers
provide correlation and cleanup, not magic continuation recovery.

### 1.3 Active revisions are immutable

Users edit visible source. Jig executes immutable snapshots. A source edit or
upstream update creates a candidate revision for future Runs; it cannot alter an
active Run or mounted provider.

### 1.4 Semantic reasoning never proves compatibility or trust

Deterministic checks decide whether a candidate can run and whether a service
contract matches. Semantic ranking may choose only among candidates that have
already passed those checks.

### 1.5 No invisible repair

A missing dependency is a durable diagnostic. An Agent may prepare a repair,
but generated or downloaded code is staged, checked and approved according to
policy before it enters the active catalogue. A failed live Run is not silently
rewound into new code.

### 1.6 Security claims describe enforcement

"No network" is not true because a prompt says so. A host reports whether each
restriction is **enforced**, **mediated**, **advisory**, or **unavailable**. An
untrusted executable is refused when a required restriction is not enforced by
the selected backend.

---

## 2. Package/1

### 2.1 The minimal package

Only `FLOW.md` is required:

```text
research/
├── FLOW.md
├── flow.json                 optional executable descriptor
├── flow.ts                   optional implementation
├── input.schema.json         optional
├── settings.schema.json      optional
├── output.schema.json        optional
├── prompts/
├── skills/
├── references/
├── scripts/
└── assets/
```

Minimal frontmatter remains deliberately close to Agent Skills:

```markdown
---
name: comparison-research
description: >
  Research and justify a comparison target for an artifact.
---
```

`name` is a local display and routing name, not a global package identity.
Optional license, compatibility prose and public outcomes are reasonable.
Entrypoints, permissions, dependency graphs, routing expressions and service
method schemas do not belong in Markdown frontmatter.

### 2.2 Interpretable is not executable

A `FLOW.md`-only package is:

- universally discoverable;
- readable by humans and Agents;
- optionally interpretable by an agentic host.

It is not guaranteed executable. If no Agent is configured, the honest result
is `implementation_unavailable`. The host does not pretend that reading
Markdown is deterministic execution.

Portability should be reported by grade:

```text
described       Package/1 metadata can be read
interpretable   an Agent profile can interpret FLOW.md
executable      a compatible Run/1 entrypoint is available
service         required Services extensions and contracts are available
```

### 2.3 `flow.<ext>` is not an entrypoint specification

The extension `.ts` cannot say Bun, Deno, Node plus `tsx`, compiler flags,
dependency preparation, or supported platforms. POSIX does not standardize
shebang behavior sufficiently to make an unqualified `flow` file a universal
launcher either.

A code-backed package therefore needs a tiny `flow.json`:

```json
{
  "$schema": "https://flow.example/schemas/package-1.json",
  "entry": {
    "protocol": "run/1",
    "command": ["deno", "run", "flow.ts"]
  },
  "requires": {
    "features": ["host-effects", "child-runs"],
    "grants": ["package.read"]
  }
}
```

This is one process launcher, not a set of runner profiles. The host spawns an
argument vector directly; it never evaluates a shell string. A package may use
`["./flow"]` if its distribution provides a directly executable launcher, but
the descriptor still makes that choice explicit.

Runtime and dependency installation remain the responsibility of source
adapters and ordinary language ecosystems. Discovery never runs install hooks.
Preparation is an explicit, separately granted transaction.

### 2.4 Optional value schemas

The conventional JSON Schema 2020-12 files are optional. Their absence permits
arbitrary JSON. They validate values, not shared files, and therefore create no
runtime path coupling.

- `input.schema.json`: per-Run caller data.
- `settings.schema.json`: immutable configured values.
- `output.schema.json`: successful output data.

Implementation defaults remain in implementation code. JSON Schema's `default`
annotation is not silently promoted into a Jig mutation language.

---

## 3. Identity, distribution and provenance

### 3.1 Identity is resolved provenance, not `name`

A globally meaningful installed package identity is:

```text
source scheme and locator
+ component subpath
+ resolved immutable revision
+ content digest
```

Examples:

```text
Git    repository URL + subpath + commit + tree digest
npm    registry + scoped package + version + integrity digest + subpath
OCI    registry/repository + manifest digest + artifact subpath
local  canonical project-relative origin + content digest
```

Mutable branches, tags and version ranges may be user input, but the lock
records their immutable resolution. Forks are distinct packages even if their
frontmatter names match.

An optional index can search descriptions, signatures and contract claims. It
does not own names and is never the source of truth. Runtime selection does not
download arbitrary search results.

### 3.2 The three records

Do not overload one lock with every kind of state.

1. **Installation lock** records source, base revision, base digest, effective
   digest, signature/provenance evidence, launcher and preparation result.
2. **Binding lock** records explicit or selected Flow/service providers and the
   exact revisions and contract digests selected for future Scopes.
3. **Run journal** records the exact snapshots, grants, bindings, effects and
   decisions used by one Run.

Signatures prove a relationship between bytes and an identity; they do not
make code trustworthy. Editing installed source changes its effective digest
and turns it into a local derivative. An upstream signature no longer
authenticates that effective tree.

### 3.3 Visible source, immutable activation

An installed source tree is directly editable:

```text
flows/gauntlet-loop/
```

On activation, Jig materializes a content-addressed immutable snapshot under
its private state. New Runs bind to that snapshot. Existing Runs continue on
their prior snapshot. There is no runtime patch overlay.

---

## 4. Run/1

### 4.1 Dedicated duplex JSON-RPC

Run/1 should be a small symmetric JSON-RPC 2.0 protocol over stdio. Each JSON
message is framed according to one specified framing rule; stdout contains
protocol only and stderr contains diagnostics.

It should not be encoded as an MCP 2026 server. MCP 2026 intentionally removed
the server-to-client request channel and represents mid-call needs with handler
re-entry or Tasks. A Flow naturally retains a live graph or coroutine while it
issues several host requests. Turning each Agent or child Flow call into an MCP
task update would force a continuation store into every runner. Jig may expose
Flows outward as MCP tools/tasks and consume MCP servers as effect providers,
while keeping the runner boundary fit for its actual continuation shape.

The normal exchange is:

```text
Jig       → component   flow/run request remains outstanding
component → Jig         effect/call request
Jig       → component   effect result
component → Jig         flow/call request
Jig       → component   child result
component → Jig         final response to flow/run
```

Several component-to-host requests may be outstanding concurrently.

### 4.2 Required method vocabulary

Run/1 defines:

**Host to component**

- `flow/run`
- `flow/cancel`

**Component to host**

- `effect/call`
- `flow/call`
- `telemetry/emit`

Every Run/1 host recognizes these methods. It may return a structured
`unsupported_feature`, `unbound_slot` or `selection_unavailable` error when it
does not supply a requested facility. Consequently, a small host is easy to
implement without making failure mysterious.

Required features and slots in `flow.json` allow preflight failure before code
starts. Undeclared dynamic calls remain possible but receive the same explicit
runtime errors.

### 4.3 Run request

A Run receives only serializable values and explicit handles:

```json
{
  "runId": "R-42",
  "scopeId": "S-91",
  "parentRunId": null,
  "input": {},
  "settings": {},
  "slots": {
    "agent": { "bindingId": "B-7" },
    "review": { "bindingId": "B-9" }
  },
  "roots": [],
  "grants": [],
  "_meta": {
    "protocol": "run/1",
    "extensions": {},
    "traceparent": "..."
  }
}
```

The process does not receive ambient project secrets or an unfiltered
environment. A filesystem root is an optional grant, not an assumption in the
FLOW standard.

### 4.4 Outcome versus failure

A successful `flow/run` response contains a domain outcome and optional output:

```json
{
  "outcome": "done",
  "output": {}
}
```

`blocked`, `rejected` and other declared outcomes are domain results. Invalid
messages, unavailable required features, process crashes, timeouts and internal
exceptions are runtime/protocol failures. They must not be disguised as a
domain outcome.

### 4.5 Scope and cancellation

Every Run has a root Scope. Child Runs, subprocesses, Agent sessions, leases and
effect attempts are registered beneath it.

Cancellation proceeds child-first:

1. mark the Scope cancelling;
2. stop admission of new effects and children;
3. propagate cancellation to child Runs and providers;
4. wait a bounded grace period;
5. terminate remaining processes through the sandbox backend;
6. continue cleanup despite individual disposer failures;
7. mark the Run cancelled.

A late external success is journaled as such but cannot change a terminally
cancelled Run back to success.

Parents awaiting child Runs do not consume the same admission permit required
to start those children. The scheduler reserves or re-enters capacity for
nested calls, preventing the classic all-parents-waiting deadlock.

### 4.6 Effects, attempts and unknown completion

Each effect request carries:

```text
effectId    stable semantic operation identity within the Run
attempt     intentional retry number
requestId   transport correlation only
```

Rules:

- same effect ID, same attempt and identical input returns a recorded result;
- same identity with different input is an error;
- a higher attempt is an intentional retry;
- intent is journaled before dispatch;
- completion and provider receipt are journaled before replying when possible.

If an external operation may have succeeded but no durable result exists, its
state is `indeterminate`. Jig does not silently retry it. A provider may expose
reconciliation by idempotency key or receipt. Otherwise policy or a human must
resolve it. This is the only honest answer for non-idempotent external systems.

### 4.7 Inputs, settings, dependencies and effects

The semantic model is:

| Value | Lifetime | Owner |
|---|---|---|
| Input | one Run | caller |
| Settings | one configured Flow binding | project |
| Dependency slot | one Scope | resolver |
| Effect | one requested operation | host/provider |

"Coeffect" is useful theory, but it should not be public jargon. Input,
settings, roots, grants and bound dependencies form the immutable Run Context.
Calling a dependency creates an effect.

If a value varies per invocation, it is input. If it configures a reusable
project-local use, it is a setting. If another component maintains it, it is a
dependency. Parent settings do not implicitly flow into children.

### 4.8 Telemetry is not a fact

`telemetry/emit` is a best-effort notification. Logs, traces, progress,
`agent.message.delta` and `caskada.node.started` may be sampled, dropped or
retained temporarily. No correct Flow or Hook can depend on delivery.

Durable facts use an acknowledged Jig event-store service. Persistence of a
telemetry message for debugging does not promote it into a fact.

---

## 5. Services: deep extension without core tax

### 5.1 Separate protocol and conformance claim

Services is not part of Run/1 conformance. It has its own version, schemas and
test suite. Jig should implement an experimental Services revision early, but
it should not be called stable until at least a Cordis realm and one unrelated
provider implementation pass the same conformance suite.

The version dimensions remain independent:

```text
Package/1 format version
Run/1 wire version
Services/1 wire version
service contract identity and semantic version
provider package version and content digest
```

No implementation should claim merely "FLOW compliant". It claims, for
example, `Package/1 + Run/1 host`, with `Services/1` separately.

### 5.2 Service lifecycle

Services adds:

- mount and ready;
- invocation of provided operations;
- dependency slots for a mount Scope;
- draining and unmount;
- provider-lost errors;
- optional contracted notifications.

A mounted provider has one owning Scope. Its registrations disappear when that
Scope closes. Existing consumer bindings pin its provider revision for their
Scope. A replacement may serve new Scopes, but existing consumers do not
silently jump revisions.

Required dependency cycles are rejected before activation. If A requires B to
mount and B requires A to mount, the strongly connected component remains
pending with a cycle diagnostic. Authors must split bootstrap interfaces or use
an explicitly lazy/optional dependency. A two-phase distributed activation
protocol is not justified in the first Services release.

### 5.3 Capability contracts

Ordinary Flow calls need no formal contract. Public portable Services do.

A service requirement identifies:

```text
canonical owner-controlled contract URI
compatible version range
descriptor media type and URI
exact descriptor digest selected by the lock
```

A provider advertises one exact contract version. Package and contract versions
are unrelated. `review@^2` is not satisfied by version 1 or 3. A compatibility
adapter may consume 3 and provide 2.

The wire standard should not immediately mandate one interface language.
OpenRPC is a sensible JSON-RPC descriptor profile, but lifecycle, subscription
and conformance semantics sit outside OpenRPC. Services can initially identify
descriptor media types and later standardize one proven profile. Local opaque
services may exist, but hosts report them as local/nonportable and semantic
similarity cannot establish their API compatibility.

Provider claims are not proof. Important contracts ship conformance fixtures,
and the binding lock records the tested descriptor digest.

### 5.4 Cordis boundary

The correct unit is one Cordis realm, not one arbitrary plugin object.

```text
Cordis realm
├── many local non-serializable services
├── native Fibers, effects and events
└── one or more explicitly contracted serializable boundary services
```

The adapter constructs the root Context, supplies boundary dependency proxies,
publishes declared boundary services and maps root disposal to Scope closure.
Closures, classes, symbols, React components and arbitrary service objects stay
inside the realm. Importing a DSH plugin may additionally require DSH-specific
host/client services; Cordis alone does not provide those APIs.

---

## 6. Flow and service binding

### 6.1 A configured Flow is a project binding

A package defines reusable behavior. A **Flow Binding** gives one project-local
name to an exact package plus immutable settings and dependency choices. A Run
invokes a Binding, not a mutable directory.

Multiple Bindings may target one package and appear as distinct router
candidates.

### 6.2 Resolution algorithm

For each child Flow slot or service slot:

1. reuse a still-valid exact binding lock;
2. apply an explicit project binding;
3. filter installed candidates deterministically by protocol support, runtime,
   schemas/contracts, permissions, trust, availability and recursion policy;
4. choose directly if exactly one remains;
5. if several remain, use a configured semantic selector, otherwise return an
   `ambiguous_binding` diagnostic;
6. pin and journal the exact choice for the Scope.

The semantic selector sees bounded, escaped metadata for already installed and
approved candidates. It does not ingest arbitrary public Markdown and cannot
install software. Full candidate descriptions are untrusted data, not router
instructions.

An exact local binding is always preferred to semantic choice. Rebinding occurs
between Scopes after explicit invalidation, provider loss or project change,
never midway through an active Scope.

### 6.3 Missing dependency repair

A missing diagnostic contains:

- consumer package and slot;
- intent;
- required Run features or contract range;
- input/output schemas when declared;
- rejected nearby candidates and exact reasons;
- current grant and trust constraints;
- configured indexes that may be searched explicitly.

Without an Agent, the component is blocked or the call fails with that
diagnostic. The CLI can offer deterministic `add` or `bind` commands.

With an Agent, a project-owned maintenance Flow may search indexes, generate an
implementation or adapter, and place it in staging. Deterministic checks,
sandbox probing, contract tests and approval policy run before activation. The
original failed Run is not silently resumed; a hook or user starts a new Run
against the repaired environment.

Long-lived Services may remain pending and activate after a compatible provider
appears, because they have an explicit mount lifecycle rather than an arbitrary
serialized graph continuation.

---

## 7. Project configuration without a monolith

### 7.1 Authored project tree

Keep authored configuration out of `.jig/`, which remains generated state:

```text
jig/
├── bindings/
│   ├── gauntlet-fast.ts
│   ├── gauntlet-deep.ts
│   └── review-strict.ts
├── hooks/
│   ├── process-inbox.ts
│   └── review-build.ts
├── policies/
│   └── untrusted-builder.ts
└── shared/
    └── defaults.ts

jig.ts       optional host-wide mechanics only
.jig/        locks, snapshots, journals, staging and runtime state
```

Each module evaluates once during reconciliation and must produce a serializable
definition. Runtime mappings and conditions remain ordinary code in Hooks or
Flows; Jig does not invent YAML programming.

### 7.2 Compact binding API

```ts
// jig/bindings/gauntlet-deep.ts
import { defineFlowBinding } from "jig";

export default defineFlowBinding({
  use: "../../flows/gauntlet-loop",

  description:
    "Thorough iterative construction for high-value work.",

  settings: {
    maxRetries: 12,
    qualityThreshold: 0.9,
  },

  slots: {
    agent: "agents/high-quality",
    review: "review-strict",
  },

  policy: "untrusted-builder",
});
```

The relative module path supplies the Binding ID. Resolved output is captured
in the binding lock and active snapshot, so use of TypeScript does not make a
Run depend on reevaluating configuration.

Common values use explicit language composition:

```ts
// jig/shared/defaults.ts
export const thorough = {
  maxRetries: 12,
};
```

There is no implicit global setting precedence and no deep-merge DSL.

### 7.3 Required settings

If `settings.schema.json` marks `maxRetries` required and the Binding omits it,
`jig check` and activation fail with `missing_setting`. If it is optional, the
Flow implementation owns its default. Jig does not search ambient
`MAX_RETRIES`, another Flow's settings or a project-global magic value.

If retry behavior should vary per request, it is input rather than a setting.
Transport retries remain a separate host policy and never reuse a Flow's
semantic retry setting.

---

## 8. Durable facts, telemetry and Hooks

### 8.1 Two channels

Telemetry is the Run/1 best-effort notification described earlier. Durable
facts are committed to Jig's event journal through an acknowledged service
operation.

Examples:

```text
agent.message.delta       telemetry
caskada.node.started      telemetry
flow.progress             telemetry

agent.message.completed   durable fact
agent.completed           durable fact
jig.run.completed         durable fact
input.file.created        durable fact
```

Host-owned lifecycle facts are written by the host or provider, not trusted to
component emission. When possible, Jig commits an effect result and its
corresponding lifecycle fact in one transaction.

A reusable Flow that itself needs append/query/wait declares the Jig event
service as a Services dependency. Durable events are not a hidden requirement
of Run/1.

### 8.2 Hook semantics

A Hook is project policy:

```text
committed fact → schedule zero or more new Runs
```

It is not producer middleware and cannot undo or delay the fact.

```ts
// jig/hooks/review-build.ts
import { defineHook } from "jig";

export default defineHook({
  on: "agent.completed",

  async handle(event, jig) {
    if (event.data.role !== "builder") return;

    await jig.runs.start("review-strict", {
      input: {
        sessionId: event.data.sessionId,
      },
      idempotencyKey: `review-build:${event.id}`,
    });
  },
});
```

Rules:

- event commit precedes Hook delivery;
- delivery is at least once;
- active Hook revisions are snapshotted into delivery records;
- scheduling deduplicates Hook revision + event ID + action key;
- Hook failures do not roll back the event;
- multiple Hooks are unordered and fan out independently;
- new Hooks do not consume history unless explicitly replayed;
- complex work belongs in a Flow, not in a Hook callback.

A Hook that performs an external side effect outside Jig forfeits scheduler
deduplication for that action and must implement its own idempotency.

---

## 9. Security and trust

### 9.1 Requested needs and granted authority

The package declares minimum needs. Project policy grants a maximum. The Run
starts only when its minimum needs fit inside the project grant and every
required denial can be enforced.

The initial grant vocabulary should be resource-oriented and small:

```text
package.read
filesystem.read       named roots
filesystem.write      named roots
network.connect       destinations, or unrestricted
process.spawn         approved executables
environment.read      named variables
secret.read           named secret handles
```

Agent, Flow and service access normally use mediated slots rather than raw OS
grants.

Each effective permission has one enforcement status:

| Status | Meaning |
|---|---|
| `enforced` | the sandbox backend prevents bypass |
| `mediated` | Jig exposes only a host operation, but does not claim OS denial outside it |
| `advisory` | instructions/policy request the behavior but cannot prevent violation |
| `unavailable` | the backend cannot supply or restrict it |

`mediated` is sufficient only when the process is also prevented from reaching
the raw resource. Otherwise an untrusted Flow could bypass the host effect.

### 9.2 Sandbox backend contract

Jig defines an interface, not one imaginary universal sandbox:

```ts
interface SandboxBackend {
  probe(): Promise<EnforcementReport>;

  prepare(request: {
    snapshot: Snapshot;
    command: readonly string[];
    grants: readonly Grant[];
    limits: ResourceLimits;
  }): Promise<SandboxPlan>;

  spawn(plan: SandboxPlan): Promise<SupervisedProcess>;
}
```

The report separately covers filesystem isolation, network isolation,
environment filtering, process spawning, child-process containment, resource
limits and cleanup. A backend name is not evidence; the prepared plan records
the actual enforcement result for the Run.

If network denial is unavailable, Jig refuses an untrusted Flow requiring that
restriction. A user may explicitly promote the source to a trust policy that
permits advisory execution. The journal then records the limitation. Jig never
prints a green "sandboxed" label for partial isolation.

Runtime dependencies should be prepared before the Run. Package-manager
postinstall scripts and dependency downloads are separate privileged operations,
not ambient network access during execution.

### 9.3 Trust states

Useful trust states are policy decisions, not package metadata:

```text
metadata-only          may be indexed, never interpreted or executed
interpreted            FLOW.md may enter a restricted Agent context
sandboxed-executable   may run only under a sufficient backend
trusted-executable     may run with explicitly accepted advisory gaps
trusted-service        may remain mounted with its declared long-lived grants
```

Services require separate explicit trust because their persistence and inbound
invocation surface exceed a one-shot Run.

Descriptions and Markdown are prompt-injection inputs. Semantic selection uses
bounded frontmatter serialized as candidate data. The interpreter Agent receives
only tools allowed by the same grant policy that would govern executable code.

---

## 10. Reconciliation, update and rollback

### 10.1 Explicit activation first

The fundamental primitive is a transactional `jig apply`, not an always-on file
watcher. Watch mode may invoke the same transaction later.

```text
authored files
    → resolve and validate candidate
    → prepare runtime and sandbox plan
    → create immutable snapshot
    → atomically publish for new Scopes
```

Broken candidates leave the current active revision untouched.

### 10.2 Three-way source update

An update uses:

```text
BASE       pristine upstream revision originally adopted
LOCAL      current directly edited visible source
UPSTREAM   new pristine upstream revision
```

Sequence:

1. fetch and verify the exact upstream candidate;
2. copy BASE, LOCAL and UPSTREAM into an update transaction;
3. perform a deterministic three-way tree merge;
4. retain unresolved conflicts in staging;
5. run package, schema, runtime and contract checks;
6. optionally invoke a maintenance Agent for conflicts or semantic review;
7. show required review according to trust policy;
8. atomically replace visible source and activate a new snapshot;
9. retain the prior snapshot for rollback.

An Agent does not replace deterministic merging. It receives all three trees,
the partial merge, conflict list, tests and upstream notes. Its output remains a
candidate.

A textually clean merge can still be semantically wrong. Tests and conformance
may detect this; no architecture can prove arbitrary behavioral equivalence.
High-authority packages should require human or Agent-assisted semantic review
on upstream change, and rollback must remain immediate.

Persistent patch stacks are not runtime state. A diff may be exported for
review or sharing.

---

## 11. Jig kernel, official components and Starters

### 11.1 Minimum Jig runtime kernel

Jig itself needs:

- Package/1 discovery and provenance;
- immutable activation snapshots;
- Run/Scope lifecycle and scheduler;
- Run/1 process supervision;
- effect intent/result journal;
- grant evaluation and sandbox-backend interface;
- deterministic resolver and binding locks;
- cancellation and cleanup;
- telemetry ingestion;
- durable fact journal and Hook delivery.

The durable journal is a Jig product guarantee, not a requirement imposed on
every Run/1 host.

### 11.2 Optional official components

Keep these outside the unavoidable kernel:

- Services host and Cordis adapter;
- Agent service and ACP/native adapters;
- semantic selector;
- update-repair Agent Flow;
- MCP ingress/egress bridge;
- Git and worktree providers;
- GUI and HTTP hosts;
- filesystem watch mode.

Jig may ship them prominently without making them portable-core prerequisites.

### 11.3 Starters

A Starter is a repository copied once, not a runtime package type. It may
contain:

- Flow sources;
- Flow Bindings and settings;
- Hooks;
- grant policies;
- Agent providers;
- inbox, Task, Kanban, Git and GUI application models.

`jig init` may resolve an official recommended Starter pinned to the CLI
release. `--bare` creates only the host skeleton. Community Starters are ordinary
source repositories with the same provenance and trust treatment as any other
code. No `STARTER.md`, pack dependency system or update coupling is needed.

---

## 12. Conformance and evolution

### 12.1 Independent matrices

Publish these suites separately:

```text
Package/1 reader and package tests
Run/1 host tests
Run/1 component tests
Services/1 host tests
Services/1 provider tests
sandbox enforcement report tests
```

A security feature is never inferred from Run conformance.

Package and Run should not be called 1.0 until there are at least two
independent hosts and two unrelated component runtimes. Caskada TypeScript plus
Caskada Python proves less than Caskada plus a plain Python runner. Services
needs a Cordis realm and a non-Cordis implementation.

### 12.2 Version rules

- Major protocol identifiers (`run/1`, `services/1`) define incompatible wire
  generations.
- Additive optional behavior uses reverse-DNS extension identifiers negotiated
  per request or mount.
- Unknown required extensions fail preflight; unknown optional telemetry is
  ignored or retained.
- Contract SemVer is meaningful only under its owning contract authority.
- Exact schema/descriptor and package digests are always pinned.
- Deprecation requires a published overlap window and matching conformance
  scenarios before removal.

---

## 13. Required adversarial scenarios

### 1. `FLOW.md` only, no Agent

The package is discovered as `described` but is not runnable. Invocation returns
`implementation_unavailable` with the missing interpreter profile. No implicit
LLM, shell or guessed executable is used.

### 2. Deno imports, Bun-only host

`flow.json` requests Deno. Runtime filtering marks the implementation
incompatible before launch. The host does not try Bun because the file suffix
looks close. An interpreted fallback is used only if the package explicitly has
one and an Agent is configured.

### 3. Two plausible child providers

An exact lock or project Binding wins. Otherwise both pass deterministic
filters. A configured semantic selector chooses and the exact revision is
journaled and pinned for the Scope. Without that selector, the result is
`ambiguous_binding` with both candidates; arbitrary catalogue order never wins.

### 4. No child Flow, with and without Agent

Without an Agent, the caller receives a structured missing-binding diagnostic
and may return `blocked`. With an Agent, a maintenance Flow may prepare a staged
candidate, but activation follows checks and approval. The failed Run is
retried or replaced explicitly after repair; it is not silently resumed against
new code.

### 5. External success followed by crash before response

The pre-dispatch intent remains journaled with no completion and is marked
`indeterminate`. If the provider supports reconciliation by effect ID or
receipt, Jig queries it. Otherwise no automatic retry occurs; policy or a human
resolves the uncertainty.

### 6. Cancellation with active children and subprocesses

Scope cancellation closes children first, propagates signals, prevents new
effects, waits a bounded grace period and then asks the sandbox backend to kill
the process tree. Cleanup errors are collected rather than aborting remaining
cleanup. Late successes are recorded but do not reverse cancellation.

### 7. Mutually dependent long-lived providers

The required-dependency graph contains a cycle. Neither provider becomes ready;
the SCC is reported as a binding cycle. The resolution is an optional/lazy
edge, split bootstrap contract or broker, not scheduler luck.

### 8. Mounted provider crash with pinned consumers

The mount Scope closes and its provider registrations disappear. Existing calls
receive `provider_lost`; consumers do not rebind mid-Scope. Dependent Services
stop or return to pending according to declared lifecycle. New Scopes may bind a
restarted or replacement revision.

### 9. Untrusted Flow bypasses host effects

An enforcement-capable sandbox denies direct network/filesystem access. If the
backend only mediates host APIs while raw OS access remains possible, Jig
refuses the untrusted executable. A trusted-policy override may run it with the
advisory gap recorded, but Jig cannot journal or replay bypassed effects.

### 10. Restriction cannot be enforced

The sandbox report marks it `advisory` or `unavailable`. An untrusted execution
requiring that restriction fails preflight. Only an explicit trust-policy
override permits execution, and diagnostics must not call that Run sandboxed.

### 11. Hook delivered twice after restart

At-least-once delivery is expected. The Hook schedules its target using the
derived idempotency key, so Jig returns the already recorded scheduling result.
A Hook performing raw external work must provide its own idempotency and cannot
claim Jig's guarantee.

### 12. Progress message dropped

Nothing correctness-sensitive happens. Progress is telemetry. If the producer
needs a durable milestone, it appends a fact through the acknowledged event
service.

### 13. Local and upstream edit the same behavior

The deterministic three-way merge leaves a staged conflict. The active source
and snapshot remain unchanged. A human or maintenance Agent resolves the
candidate, followed by all checks and policy approval.

### 14. Clean text merge breaks local intent

Runtime, package and contract tests run against the candidate. Failure blocks
activation. If all checks pass, semantic equivalence is still not provable;
high-authority policy may require Agent or human review. Previous activation is
retained for rollback.

### 15. Two configurations of one Flow

Two Flow Binding modules point to the same package digest with different
settings, dependency slots and local descriptions. They have distinct Binding
IDs and immutable snapshots and appear separately to explicit callers and the
semantic selector.

### 16. Required `MAX_RETRIES` missing

If `settings.schema.json` requires `maxRetries`, `jig check` and activation fail.
If optional, the implementation uses its documented code default. Jig does not
read an ambient variable or another Binding's setting implicitly.

### 17. Cordis exports one serializable service

The Cordis adapter exposes only that declared contracted boundary service.
Other services, objects and events remain native within the realm. The realm's
root Fiber belongs to the mount Scope and is disposed with it.

### 18. Small Run-only third-party host

It can parse Package/1, launch a compatible executable, process `flow/run`,
cancel it and return explicit unsupported errors for effects it does not
provide. It cannot interpret Markdown without an Agent, mount Services,
semantically choose a provider or promise durable events. Without a sufficient
sandbox it runs only explicitly trusted executables. It is legitimately
`Package/1 + Run/1` conforming and nothing more.

---

## 14. Quality assessment and failure conditions

| Criterion | Assessment | Principal cost |
|---|---:|---|
| Conceptual economy | 4/5 | Binding and Services add necessary vocabulary |
| Independent implementation | 4/5 | Duplex SDK and conformance suite are required |
| Retry/crash determinism | 4/5 | Unknown external completion is intentionally unresolved |
| Least-authority security | 4/5 | Depends on real platform sandbox backends |
| Fault tolerance | 4/5 | Arbitrary live continuations do not survive crashes |
| Ecosystem ergonomics | 4/5 | Executables need an honest launcher descriptor |
| Scale | 3.5/5 | Process-per-Run and provider supervision need measurement |
| Evolvability | 4.5/5 | Services and optional features do not freeze the core |

Known failure conditions must remain explicit:

- A host without an Agent cannot interpret Markdown.
- A host without the declared runtime cannot execute that implementation.
- A host without a sufficient sandbox cannot safely execute untrusted code.
- A non-idempotent external operation may remain indeterminate after a crash.
- A runner process crash loses its arbitrary live continuation in Run/1.
- Natural-language descriptions cannot prove input/output or service
  compatibility.
- Three-way merge and tests cannot prove preservation of semantic intent.
- Existing DSH plugins require DSH application services, not merely Cordis.
- Long-lived provider availability and distributed consensus are outside the
  first Services protocol.

---

## Final recommendation

Freeze the following architecture and prototype it before expanding the
standard:

```text
FLOW Package/1
    one required FLOW.md
    one optional, honest flow.json launcher
    optional value schemas and ordinary resources

FLOW Run/1
    duplex stdio JSON-RPC
    run, cancel, effect call, child call, telemetry and outcome
    explicit Scope/effect identities
    no graph mirroring or crash-resumption claim

FLOW Services
    independent optional extension and conformance claim
    contracted serializable boundaries
    mount, invoke, drain and provider loss

Jig
    immutable revisions, bindings, grants, sandbox evidence,
    journals, Hooks, deterministic resolution and optional Agents

Starter
    every application opinion
```

The design is intentionally stricter than a Skill where executable authority is
involved and intentionally smaller than Cordis where one-shot work is enough.
That is the viable adoption position: simple at the package surface, precise at
the process boundary, optional at the service boundary, and uncompromisingly
honest about trust and failure.
