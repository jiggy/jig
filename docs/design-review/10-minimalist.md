# The minimum architecture that still deserves the name FLOW

## Verdict

FLOW should standardize only a package envelope and one-shot process boundary.
Jig should be one capable host of that boundary, not part of the boundary. A
separate, optional Service profile should cover long-lived RPC providers. Almost
everything else discussed in the research--Agents, durable events, hooks,
semantic selection, repairs, source updates, sandboxes, and project policy--is
Jig machinery or a named extension, not FLOW core.

The irreducible model is:

```text
FLOW Package
    FLOW.md + ordinary resources + optional exact entry command

Run/1
    invoke once, call child work, report progress, cancel, finish

Service/1 (optional profile)
    open a declared serializable service, invoke it, close it

Jig
    catalogue, instances, bindings, policy, supervision, isolation,
    journals, semantic selection, Agents, updates, and provenance
```

There is no public `Scope`, `Context`, `Space`, `Mount`, `Effect`, `Hook`,
`Task`, or graph object in FLOW/1. A Run is already the ownership and
cancellation boundary. A private run directory is a directory, not a new
ontology.

The central architectural law is:

> Runners own internal control; the host owns external authority; FLOW owns the
> serializable boundary between them.

## 1. FLOW Package/1

A package is a directory whose only required special file is `FLOW.md`.
Everything else is an ordinary file. Package identity is not its display name;
it is source locator plus immutable revision/content digest.

The minimal document is:

```markdown
---
flow: 1
name: gauntlet-loop
description: Iteratively build, test, review, and improve an artifact.
---

# Gauntlet Loop

Read the request and available material. ...
```

The required fields are:

- `flow: 1`, so a parser never guesses the specification version;
- `name`, a package-local display/discovery name, not a global namespace;
- `description`, the short semantic discovery text.

The Markdown body is the instruction implementation for an instruction-capable
runner and the human documentation for an executable implementation. These are
not claimed to be behaviorally equivalent. A host must record which
implementation it used.

Only four optional core fields are justified:

```yaml
entry: ["bun", "./flow.ts"]
outcomes: [done, blocked]
config: ./config.schema.json
requires:
  - https://flow.example/extensions/agent-run/1
```

- `entry` is an exact, shell-free argument vector.
- `outcomes` makes non-default successful terminal labels inspectable. Absence
  permits only `done`.
- `config` points to an optional JSON Schema for the object supplied at Run
  creation. Absence means the Flow accepts an empty object but may still perform
  its own validation.
- `requires` lists exact protocol-extension identities needed before launch.
  It is not a package dependency solver and contains no semantic intent.

Frontmatter is a safe YAML 1.2 data subset: mappings, sequences, strings,
numbers, booleans, and null only. Duplicate keys, aliases, tags, merge keys, and
executable/custom types are errors. Unknown unnamespaced fields are errors;
extensions use `x-<owner>-<name>` or a future core version. This is deliberately
less permissive than general YAML.

No core metadata describes graphs, routing conditions, input mappings,
permissions, events, Agents, GUI faces, package managers, or runner profiles.

### Package classes

There are three honest classes, not one false claim of universal executability:

1. **Instruction package:** no `entry`; requires a configured instruction
   runner, normally Agent-backed.
2. **Executable package:** has `entry`; any Run/1 host with the named runtime may
   execute it.
3. **Service package:** has `entry` plus Service/1 extension metadata; requires a
   Service/1 host.

A `FLOW.md`-only package remains portable as instructions, not executable on a
machine lacking an instruction runner.

## 2. Entrypoint and runtime selection

The portable rule is the optional `entry` argument vector in `FLOW.md`:

```yaml
entry: ["python3", "./flow.py"]
entry: ["bun", "run", "./flow.ts"]
entry: ["deno", "run", "./flow.ts"]
entry: ["./flow.exe"]
```

This is less magical and more portable than filename inference or a shebang.
It is one optional line in the document that already defines the package.

Normative launch behavior is:

- the array is non-empty and every member is a literal string;
- no interpolation, environment expansion, command substitution, globbing, or
  shell parsing occurs;
- the process working directory is the immutable package snapshot;
- `shell` is false;
- relative paths may not escape the package snapshot;
- the first token is either a package-relative executable or a logical runtime
  name resolved by the host's allowlisted runtime registry;
- the selected executable path and observed runtime version are recorded;
- failure to resolve the exact first token makes this implementation
  unavailable; the host never tries a similar runtime.

This works on Windows because `python3`, `bun`, or `deno` resolves to an actual
configured executable, not a POSIX kernel convention. Shell scripts require an
explicit interpreter. Native packages that need different binaries per OS
should publish platform variants or use a portable launcher runtime; v1 does
not add a platform command matrix.

`#!` is not normative. POSIX does not specify shebang execution, kernels differ
in argument splitting and length limits, `/usr/bin/env` is not guaranteed at
that path, and `env -S` is not POSIX. Defining a FLOW-specific shebang parser
would merely hide a second manifest inside source code. A host may execute
`entry: ["./flow"]` using local OS shebang behavior in trusted/local mode, but
that package is platform-specific and cannot pass a portable launch check.

The convention `flow.ts` is recommended for visual clarity, not interpreted by
the standard. An extension cannot distinguish Deno TypeScript from Bun
TypeScript. Exact argv can.

Automatic Markdown fallback is prohibited after a process starts. A project
may explicitly choose instruction execution when the declared runtime is
unavailable, but the default is fail-fast. Post-start fallback risks duplicating
effects and hiding a broken implementation.

## 3. Run/1

Run/1 is bidirectional JSON-RPC 2.0 over UTF-8 newline-delimited JSON on stdio.
Batch messages are not used. Stdout contains protocol frames only; stderr is
unstructured diagnostic output. One process serves one Run and exits after its
final response. This trades small startup cost for clear isolation and
lifecycle semantics.

The core has four messages:

| Direction | Method | Semantics |
|---|---|---|
| host -> component | `flow/run` | Start exactly one Run; the request remains pending until termination. |
| component -> host | `flow/call` | Invoke child work through a stable local slot. |
| host -> component | `flow/cancel` | Best-effort cancellation notification. |
| component -> host | `flow/progress` | Optional, lossy progress notification. |

The `flow/run` request contains:

```json
{
  "protocol": "https://flow.example/run/1",
  "runId": "R-42",
  "input": {},
  "config": {},
  "runDirectory": "/host-managed/runs/R-42",
  "attachments": [
    {"name": "source", "path": "/grants/source", "mode": "read"}
  ]
}
```

`runDirectory` is private to the Run and writable. Attachments are named,
explicitly granted directories/files. Paths are appropriate to the required
local stdio transport; a future remote transport may define URI handles without
changing Package/1.

A successful response is:

```json
{
  "outcome": "done",
  "output": {}
}
```

`outcome` must be `done` or one of the package's declared outcomes. `blocked` is
a normal, inspectable outcome when declared. Protocol failure, process failure,
and cancellation are not custom outcomes; they are separate terminal states in
the host's Run record.

### Child calls and bindings

Every child call uses a consumer-local slot and a stable semantic operation ID:

```json
{
  "slot": "comparison-research",
  "operationId": "R-42/research/1",
  "intent": "Find and justify a suitable comparison target",
  "input": {}
}
```

The slot is the unit of binding. A project may prebind it to a configured Flow
instance. Otherwise the host resolves it on first use and pins the selected
instance revision for the parent Run. Subsequent calls through the slot use the
same binding. Intent aids discovery but never overrides an explicit binding or
deterministic eligibility check.

The host owns the parent/child Run tree. A parent waiting on a child does not
retain a scarce scheduler execution permit. Cancellation closes descendants
before the parent and terminates their processes after a grace period. The host
does not need access to the runner's graph.

### Operation IDs, retries, and ambiguity

JSON-RPC IDs correlate messages. `operationId` identifies an intended external
operation and is the idempotency key.

- Repeating an ID with byte-equivalent canonical parameters returns the
  durably recorded result when one exists.
- Reusing an ID with different parameters is an error.
- A completed host record is written before its response is sent.
- If the host cannot determine whether an external side effect happened, the
  operation becomes `indeterminate`; it is never silently replayed.
- An intentional repeat uses a new operation ID.

This convention applies to `flow/call` and to effectful extension requests. It
does not create exactly-once execution. A provider may pass the ID to an
external idempotent API; otherwise reconciliation is required after an
indeterminate result.

Automatic whole-Run retry is allowed only when the host can prove the process
never accepted the Run. After acceptance, retry is an explicit new Run.

### Progress, facts, and logs

`flow/progress` is a disposable UI hint. Hosts may sample, reorder, or drop it.
Nothing may depend on receiving it. Stderr is for logs.

Durable domain facts are not progress and are not Run/1. Jig may expose a
durable Event extension whose append operation uses an `operationId`. Hooks are
Jig project policy over that store. Traces are host observability records. None
of these alter runner control flow invisibly.

## 4. Host effects are extensions, not a universal capability bus

Run/1 does not contain `effect/call`, `agent/run`, filesystem APIs, Git APIs,
HTTP, approvals, secrets, or databases. A protocol extension owns a set of
JSON-RPC methods and an immutable owner-controlled identity, for example:

```text
https://jig.example/extensions/agent-run/1
https://jig.example/extensions/durable-events/1
```

Packages list required extension identities in `requires`; hosts reject an
unsupported package before launch. Effectful extension requests carry
`runId` and `operationId`. This gives third-party hosts a precise compatibility
answer without forcing every host to implement Jig.

Do not tunnel arbitrary vendor RPC through a generic method. That defeats
policy, observability, compatibility, and least authority. Provider-specific
power belongs in provider-specific, documented extensions.

Configuration is Run input, not an effect and not ambient environment. Secrets
are handles supplied by an explicit secrets extension, never plaintext project
configuration by default.

## 5. Service/1 is a separate optional profile

Long-lived, stateful, multi-operation providers are real, but placing them in
Run/1 would make the minimum host carry a plugin container. Service/1 is an
independently conformable extension.

An advanced package declares static public services and dependencies in an
extension field. Each service contract is an immutable owner-controlled URI
whose document describes serializable JSON-RPC methods with JSON Schema (an
OpenRPC document is preferable to a new interface language):

```yaml
x-flow-service:
  provides:
    sessions: ./contracts/sessions.openrpc.json
  uses:
    database: https://owner.example/contracts/database/1
```

Contract identity denotes one exact compatibility surface. V1 does not infer
compatibility from SemVer ranges or natural language. A changed incompatible
surface gets a new URI; a provider may implement several URIs. Contract
documents and provider revisions are digest-pinned.

Service/1 has four operations:

| Direction | Method | Semantics |
|---|---|---|
| host -> provider | `service/open` | Start one configured service instance after required bindings resolve. |
| host -> provider | `service/invoke` | Invoke a declared provided operation. |
| provider -> host | `service/call` | Call a pinned required service. |
| host -> provider | `service/close` | Drain and dispose the instance. |

The same package `entry` handles either `flow/run` or `service/open` as its
first request. A service instance, not its socket, owns registrations and
cleanup. A connection loss marks the instance lost.

Required service dependencies are resolved before `service/open`. A dependency
cycle is an activation error in v1. Optional/late calls may exist, but if the
host observes a synchronous wait-for cycle, the newest call fails with
`dependency_cycle`; it must not wait forever.

When a provider crashes, pinned consumers receive `provider_lost`. They are not
silently rebound. A supervisor may start the same exact provider revision for
new consumers; transparent state restoration and mid-use rebinding require a
stronger service-specific contract and are not assumed.

Arbitrary JavaScript objects, closures, symbols, classes, and Cordis Contexts
cannot cross Service/1. A Cordis adapter hosts a complete local realm and
exports only explicitly declared serializable boundary services. Its many local
services remain local.

## 6. Security and grants

Subprocess isolation is not a sandbox. A portable untrusted Run has this
baseline authority:

- read its immutable package snapshot;
- read/write its private run directory;
- communicate over protocol stdio;
- access only explicitly listed attachments and protocol extensions;
- no ambient host filesystem, network, inherited secrets, IPC, or child-process
  authority.

The isolation backend reports each restriction as `enforced`, `mediated`,
`advisory`, or `unavailable`. An untrusted Run requiring enforcement is denied
when the backend cannot enforce it. A project may explicitly choose trusted or
advisory execution, but the decision and effective grants are journaled.

Portable network, Git, Agent, and secret access should be mediated extensions.
Direct host access is a trusted/local optimization and makes the package's
security portability conditional. The spec must never convert “requested” into
“enforced” by wording alone.

## 7. Jig's project model

Jig adds policy around FLOW without changing Package/1 or Run/1.

The project owns inert configuration, for example:

```json
{
  "instances": {
    "review-fast": {
      "flow": "./flows/review",
      "config": {"maxRetries": 1}
    },
    "review-strict": {
      "flow": "./flows/review",
      "config": {"maxRetries": 5}
    }
  },
  "bindings": {
    "gauntlet#review": "review-strict"
  },
  "execution": {
    "markdownFallback": "never",
    "minimumIsolation": "enforced"
  }
}
```

A configured instance is package revision plus configuration plus grants. It is
the target of a binding. This permits many uses of one package without copying
or mutating it. Environment variables are not implicit configuration.

The Jig lock records:

- source locator, upstream revision, and content digest;
- immutable package snapshot used by each active Run/service;
- configured instance and effective config digest;
- selected entry executable/runtime;
- explicit and semantic slot bindings with selection evidence;
- extension/service contract digests;
- effective grants and isolation report.

Selection order is fixed:

1. reuse a valid project binding;
2. filter by Run implementation availability, required extensions, contracts,
   configuration, grants, trust policy, and platform;
3. use the single remaining candidate;
4. if several remain, ask a SemanticRouter only when one is configured;
5. otherwise return `binding_ambiguous` with candidates;
6. persist and pin the result for the Run.

Semantic routing ranks already eligible choices. It does not decide protocol
compatibility, permissions, or service contract equivalence.

A missing binding produces a structured diagnostic. A separately configured
repair Flow may search, install, generate, or adapt a provider, but it operates
in its own Run and staging area. V1 does not silently mutate the environment or
resume an arbitrary suspended graph. The original Run normally returns
`blocked`; after repair, policy or a human starts a new Run.

### Kernel boundary

The minimum Jig runtime is:

- package parser/catalogue and immutable revision materializer;
- configured instances and binding resolver;
- Run process supervisor, child scheduler, cancellation tree, and operation
  journal;
- runtime/extension registry;
- isolation backend interface and truthful grant report;
- provenance/lock records.

Jig's Agent provider, instruction runner, semantic selector, durable event
store, hooks, Service/1 manager, updater, and GUI are official components or
project tooling, not universal FLOW or irreducible Run-host requirements.

Jig may use SQLite for concurrent journals, leases, cursors, and indexes. User
definitions and artifacts remain ordinary files. “File-native” is an authoring
property, not a ban on transactional storage.

Task, inbox, Kanban, Git, worktrees, GUI slots, approval policy, and checkpoint
policy belong to starters or projects.

## 8. Source ownership, updates, and active revisions

Installed source is the visible, complete, directly editable effective tree.
There is no persistent patch overlay and no runtime patch application.

Every Run uses an immutable snapshot digest. Editing the visible tree affects
future Runs only. Long-lived providers retain their old snapshot until an
explicit restart/update policy replaces them.

An update is a staged three-way merge:

```text
BASE      pristine revision originally installed
LOCAL     current visible edited tree
UPSTREAM  new pristine revision
```

Jig first performs deterministic merge and validation. Conflicts leave the
active source/runtime untouched. A human or explicitly configured maintenance
Flow may resolve remaining textual or semantic conflicts. Publication is
atomic only after required checks; rollback selects the previous immutable
revision.

Textual mergeability cannot prove semantic preservation. A project that cannot
test the customized behavior must require review. An Agent review is useful
evidence, not a correctness proof.

Continuous hot reconciliation, shadow activation, and provider draining are
valuable later features, not v1 kernel requirements. Explicit update/reload is
the smaller reliable starting point.

## 9. Adversarial acceptance cases

1. **`FLOW.md` only, no Agent.** Discovery succeeds; invocation fails before
   creating a Run with `implementation_unavailable`. No instructions are
   pretended to execute.

2. **Deno-only `flow.ts`, Bun-only host.** Its exact `entry` names Deno, so
   preflight reports an unavailable runtime. Jig never substitutes Bun. If the
   author falsely names Bun, the process fails and there is no automatic
   Markdown fallback.

3. **Two plausible child providers.** Explicit binding wins. Otherwise
   deterministic filters run, then a configured SemanticRouter may choose and
   the decision is pinned and recorded. With no router the call fails
   `binding_ambiguous` and lists both candidates.

4. **No child Flow.** `flow/call` returns `binding_missing`. Without an Agent the
   parent can return `blocked`. With an Agent, an optional repair Flow may run
   separately; it does not rewrite and resume the live Run invisibly.

5. **External success followed by crash.** If the host durably recorded the
   result before responding, the same `operationId` returns it. If the crash
   occurred between external success and durable confirmation, status is
   `indeterminate`; no automatic replay occurs. Provider-specific
   reconciliation or an idempotency key is required.

6. **Cancellation with children/processes.** The host marks the Run cancelling,
   rejects new calls, cancels descendants, sends `flow/cancel`, waits a bounded
   grace period, kills remaining processes, and records cleanup failures. A
   waiting parent consumes no child scheduler permit.

7. **Mutually dependent services.** Required dependency cycles are rejected
   before activation. A late synchronous wait-for cycle fails
   `dependency_cycle`; it cannot occupy workers indefinitely.

8. **Provider crash with pinned consumers.** The instance becomes lost and
   calls fail `provider_lost`. Existing bindings do not jump to another
   provider. New consumers may bind a replacement.

9. **Untrusted direct network/filesystem access.** An enforcing sandbox blocks
   it. In trusted/advisory mode it may succeed, which is why Jig records that
   mode and does not claim portable least authority.

10. **Host cannot enforce requested restriction.** The Run is denied when the
    project's minimum is `enforced`. Only an explicit trusted/advisory override
    permits launch.

11. **Durable fact delivers twice.** This is Jig Event/Hook behavior, not
    Run/1. Delivery is at least once; a hook deduplicates by `(hookId, eventId)`
    and schedules derived work transactionally or with the same operation ID.

12. **Progress is dropped.** Nothing semantic happens. Final response and
    durable facts remain authoritative.

13. **Local/upstream textual conflict.** The staged three-way merge stops;
    current visible source and active snapshots remain intact until human or
    maintenance-Flow resolution passes checks.

14. **Clean textual merge, semantic break.** Tests, schema/contract checks, or
    required review must catch it. If none encodes the local intent, no system
    can guarantee detection; Jig states that limitation instead of claiming
    Agent certainty.

15. **Two configurations of one Flow.** Two configured instances point to the
    same package digest with different config/grants and receive separate Runs,
    directories, and binding identities.

16. **Missing `MAX_RETRIES`.** An optional config schema rejects launch; without
    one, the implementation must return `invalid_config` before effects. Jig
    never invents an environment value.

17. **Cordis exports one service.** One Cordis realm runs behind a Service/1
    process. The declared serializable service crosses the boundary; all other
    Cordis services and objects stay inside the realm.

18. **Minimal third-party Run host.** It can execute explicit-entry leaf Flows
    and return precise errors for unresolved child intent. It marks packages
    requiring instruction execution, unsupported extensions, or Service/1 as
    incompatible. It need not implement Jig's sandbox, event store, Agent,
    semantic router, or updater, and must not claim those qualities.

## 10. What v1 must exclude

Delete or defer:

- normative shebangs and extension-based runtime guessing;
- automatic Markdown fallback after executable failure;
- public `Scope`, `Context`, `Space`, `Mount`, and `Effect` abstractions;
- graph schemas, graph mirroring, and runner-specific execution paths;
- generic arbitrary-provider RPC tunnelling;
- capability SemVer inference and semantic compatibility guesses;
- dynamic service publication and implicit rebinding;
- event middleware or hooks that secretly gate facts;
- exactly-once or unknown-effect replay claims;
- arbitrary graph crash resumption;
- persistent patch stacks and runtime overlays;
- automatic Agent repair inside active execution;
- continuous hot reload/draining as a conformance requirement;
- Tasks, Kanban, Git, worktrees, GUI, and provider-specific Agent concepts;
- a mandatory public registry.

The first stable release should contain Package/1, Run/1, a Jig host, one
instruction runner, one Agent extension, one Caskada Run/1 adapter, and one
small non-TypeScript adapter. Service/1 should remain an independently versioned
official profile until Cordis plus at least one unrelated implementation prove
the same boundary.

## 11. Failure conditions and quality assessment

This architecture fails its own test if:

- Package/1 starts accumulating workflow logic or host policy;
- Run/1 gains APIs that only Jig needs;
- semantic routing occurs before exact eligibility filtering or on every call;
- a Run can gain authority not present at launch;
- an unknown external effect is replayed automatically;
- active code is executed from a mutable tree;
- Service/1 is treated as transparent in-process object transport;
- a host advertises enforcement it cannot provide.

Against the review criteria, the design is intentionally strongest in economy,
independent implementation, deterministic failure, and evolvability. It gives
up universal execution of Markdown, transparent service objects, automatic
recovery, and topology inspection because those promises are either false or
runner-specific. It scales by keeping Runs isolated, bindings pinned, selection
off the hot path, runtime state transactional, and services optional. It remains
portable by being exact about the small boundary and explicit about everything
that lies outside it.

The final rule is:

> A FLOW Package says what it is and exactly how to start it. Run/1 says how one
> execution composes and terminates. Optional profiles add authority. Jig makes
> policy decisions, but never disguises them as portable semantics.
