# Ecosystem cross-examination: the smallest standard that still composes

## Revised verdict

The minimalist review is right about the boundary and too austere at two points.

I reverse my Round 1 position on `flow.json`: FLOW should have one obvious
implementation file and one FLOW-owned runtime directive in `FLOW.md`, not a
second manifest or package-controlled argv. I also reverse the recommendation
to leave Services experimental: Services should be a stable, separately
conforming module implemented by Jig v1, with release gated on independent
implementations.

I reject the minimalist removal of generic host effects and reliable facts.
Run/1 needs three deliberately different outbound channels:

```text
effect/call       acknowledged request for host-owned work
event/emit        acknowledged append of a durable fact
telemetry/emit    best-effort observation
```

This is not a universal capability framework. It is the minimum semantic
separation needed to prevent every extension from reinventing correlation,
idempotency and event reliability.

The resulting standard remains layered:

```text
Package/1
    FLOW.md + optional one flow.<ext> + ordinary resources

Run/1
    run, cancel, child call, effect call, durable fact, telemetry, outcome

Services/1
    optional host conformance; stable long-lived serializable boundary

Jig v1
    implements Run/1 and Services/1, bindings, grants, journals and Hooks
```

A small host may conform to Run/1 without Services. It must recognize core
methods and return explicit unsupported-feature errors for facilities it does
not provide.

---

## 1. Entrypoint: steelman, decision and falsifier

### 1.1 Steelman: exact argv in `FLOW.md`

The minimalist proposal is much stronger than arbitrary filename inference:

```yaml
entry: ["deno", "run", "./flow.ts"]
```

It has real advantages:

- no second manifest;
- no shell interpolation;
- the author can distinguish Bun from Deno;
- hosts can report the missing first token before launch;
- Windows does not need kernel shebang behavior;
- unusual runtimes require no central registry change.

If the only alternatives were raw extension inference and exact argv, argv
would win.

### 1.2 Steelman: one `flow.<ext>` and a FLOW runtime directive

The competing proposal has a different advantage: it standardizes intent rather
than a host command.

```text
flow.ts
```

```yaml
runtime: deno/1
```

The runtime identity means "launch this package according to the FLOW Deno/1
binding," not "find a program named `deno` somewhere on PATH and pass these
tokens." The binding owns:

- how the executable is located;
- the safe argv required by that runtime;
- version probing and compatibility;
- stdio and buffering details;
- package-local dependency/config conventions;
- how host grants become runtime flags plus OS sandbox rules;
- conformance fixtures.

The host owns the concrete executable path. The package owns only the portable
runtime requirement.

This removes an important authority leak. Raw argv lets a package choose
arbitrary launchers, flags and wrappers before the host has even reached the
Run protocol. A runtime binding gives policy one auditable launch compiler.

### 1.3 Decision: abandon `flow.json` and package-controlled argv

An executable Package/1 directory contains exactly one top-level file matching
the reserved `flow.<ext>` convention and declares a runtime binding in
`FLOW.md`:

```markdown
---
flow: 1
name: gauntlet-loop
description: Iteratively build, evaluate, and improve an artifact.
runtime: deno/1
---
```

```text
gauntlet-loop/
├── FLOW.md
├── flow.ts
└── ...
```

Normative rules:

1. No `runtime` and no `flow.<ext>` means an instruction package.
2. An executable package has exactly one `flow.<ext>` and one runtime ID.
3. The runtime binding declares which extensions it accepts. `deno/1` may
   accept `.ts` and `.js`; `python/1` may accept `.py`.
4. Extension and runtime mismatch is a package error.
5. The host resolves the runtime ID through its runtime registry and records
   the exact adapter, executable and observed version.
6. The package cannot supply extra argv, shell expressions or environment
   interpolation in portable mode.
7. Runtime-specific ordinary files such as `deno.json`, `package.json`,
   `pyproject.toml` or lockfiles remain available to the binding.
8. Unknown runtime IDs make the implementation unavailable, not invalid for
   discovery.

FLOW should own a very small initial registry such as:

```text
deno/1
bun/1
python/1
native/1
```

Third-party bindings use owner-qualified IDs. A runtime binding is not a graph
runner profile and does not define a source class hierarchy. It launches a
program that speaks Run/1.

There is no normative shebang. POSIX does not standardize `#!`, kernel parsing
differs, and language comment syntax is not universal. The host reads the FLOW
runtime directive and invokes its adapter directly. `native/1` may select a
platform-specific executable from a distribution artifact, but it does not
pretend that `#!/usr/bin/env` is portable.

This reverses Round 1 for two reasons:

- the second `flow.json` duplicated machine identity already available in the
  one required document;
- argv was exact locally but failed the stronger portability test: equivalent
  packages could resolve different PATH programs and package-authored flags
  became part of the security boundary without a standard launch compiler.

### 1.4 What this deliberately gives up

An author cannot express arbitrary command pipelines in Package/1. That is a
feature. They may:

- write the required behavior in `flow.<ext>`;
- use ordinary runtime package configuration;
- publish a native launcher artifact;
- propose a reusable runtime binding;
- use a Jig-local nonportable launch override that is clearly outside portable
  Package/1 conformance.

### 1.5 Falsifier

Restore a shell-free `entry` extension only if all of the following become true
in implementation evidence:

1. three independent runtime bindings cannot run common packages without
   package-specific argv;
2. the need is not expressible in ordinary runtime config or source;
3. runtime IDs are proliferating per package rather than per execution
   environment;
4. a constrained argv extension passes the same grant and conformance checks.

If more than a small minority of real packages need local launch overrides,
the runtime-binding design has merely hidden profiles and has failed.

---

## 2. Run channels: steelman, decision and falsifier

### 2.1 Steelman: every effect type is a protocol extension

The minimalist proposal avoids a generic capability bus. An Agent extension
can define `agent/run`; a durable-events extension can define `event/append`;
Git and HTTP can define their own methods. This produces explicit compatibility
and makes accidental raw provider tunnelling harder.

It also keeps a leaf Run host tiny: `flow/run`, `flow/call`, cancel, progress and
outcome.

The concern is valid. An unstructured generic RPC tunnel would let packages
call arbitrary provider methods without meaningful contracts or host policy.

### 2.2 The cost of removing the generic effect envelope

Agent, HTTP, approval, secret, database and future extensions would each have
to redefine:

- operation identity;
- attempt and duplicate semantics;
- Run and Scope correlation;
- cancellation linkage;
- error and indeterminate-result representation;
- provider-slot resolution;
- effect journaling;
- tracing metadata.

Hosts and SDKs would need a growing method switch merely to supervise the same
request lifecycle repeatedly. More importantly, a Flow could not depend on a
project-local service slot without its runner importing a method-specific SDK.

The correct constraint is not "no generic call." It is "no unbound generic
call."

### 2.3 Decision: Run/1 has three outbound semantics

#### `effect/call`

```json
{
  "runId": "R-42",
  "operationId": "R-42/build-agent/1",
  "slot": "agent",
  "operation": "run",
  "input": {}
}
```

Rules:

- `slot` must have been granted and bound by the host;
- the host resolves the provider; the component never supplies an endpoint;
- a contract or named extension may constrain operations and schemas;
- the host validates when a schema is available;
- intent is durably journaled before provider dispatch;
- duplicate and indeterminate semantics are uniform;
- the provider cannot grant authority beyond the slot's effective grant.

Provider-specific extensions may offer typed SDK helpers while lowering to the
same envelope. A host may refuse opaque operations for untrusted packages.
This is closer to a supervised syscall than to vendor-RPC tunnelling.

#### `event/emit`

`event/emit` is a JSON-RPC request, not a notification:

```json
{
  "runId": "R-42",
  "operationId": "R-42/artifact-accepted/1",
  "type": "artifact.accepted",
  "data": {}
}
```

A successful response means the host durably accepted the fact and returns an
event ID and sequence. If durable events are unavailable, the host returns
`unsupported_feature`; it must not acknowledge and drop the fact.

The fact is observational with respect to the action that already happened.
Hooks run after commit and never return into the producer's control path.
Delivery to Hooks is at least once and separately deduplicated.

Host-owned facts such as `run.completed` and `agent.completed` are recorded by
the host/provider rather than trusted to component emission.

#### `telemetry/emit`

`telemetry/emit` is a JSON-RPC notification. Progress, logs, traces, token
deltas and node lifecycle observations may be sampled, reordered or dropped.
No Flow, Hook or state transition can require its delivery.

### 2.4 Small-host conformance

Every Run/1 host understands the three method names and their error semantics.
It need not provide arbitrary effects or a durable event store.

- an unbound effect slot returns `unbound_slot`;
- an unsupported durable event facility returns `unsupported_feature`;
- telemetry may be discarded;
- package metadata declares required Run facilities so incompatibility is
  normally detected before launch.

This distinction permits a small host without letting it produce false
acknowledgements.

### 2.5 Falsifiers

Remove or demote `effect/call` if real implementations show that:

- it becomes an escape hatch around typed extension policy;
- operation schemas cannot be validated at the slot boundary;
- provider-specific methods require materially different lifecycle semantics;
- small independent hosts cannot implement the envelope and journal contract.

Demote reliable `event/emit` to an extension if a minimal durable append log is
still a material burden after the host is allowed to return
`unsupported_feature`. Do not demote it merely because some hosts choose not to
provide the facility.

---

## 3. Services stability: steelman, decision and falsifier

### 3.1 Steelman: ship Services as experimental

Long-lived providers introduce most of the difficult lifecycle surface:

- readiness and dependency activation;
- host-to-provider calls;
- provider-to-host dependency calls;
- state loss and draining;
- cycles and late dependencies;
- contract identity and compatibility;
- long-lived security authority.

Deferring stability would allow the Cordis bridge to reveal the real boundary
before third parties depend on it. It also keeps the initial conformance suite
and threat model smaller.

### 3.2 Why an experimental afterthought is strategically wrong

Deep extensibility is not an optional product aspiration. It is the reason FLOW
can be more than a workflow prompt format and the mechanism required for
DSH-class applications.

If Jig v1 ships only one-shot Runs, projects will create incompatible local
patterns for Agent sessions, event stores, UI registries, commands and database
services. Their assumptions will enter bindings, settings, lifecycle and
security policy. Standardizing Services later would then be a migration rather
than an extension.

An anemic first stable release is hard to repair socially even when it is easy
to repair technically: adopters classify the project by what v1 can actually
build.

### 3.3 Decision: Services/1 is stable, separate and implemented by Jig v1

Services/1 is not mandatory Run/1 functionality. Its conformance and SDK remain
separate. Jig v1 implements it as an official module and ships only after the
boundary passes:

1. a small plain provider implementation;
2. a Cordis realm exporting one serializable service;
3. the same lifecycle, crash, cycle, cancellation and conformance cases.

If those gates are not met, Jig v1 is not ready; calling the module experimental
would not make an unproven architecture safer for adopters already encouraged
to build on it.

The stable surface remains small:

```text
service/open       create one configured provider instance
service/invoke     invoke one provided operation
service/call       provider calls one pinned dependency slot
service/event      reliably publish a contracted service fact
service/close      drain and dispose
```

Required dependencies resolve before `service/open`. Required cycles fail
activation. Provider revisions remain pinned per consumer Scope. A provider
crash yields `provider_lost`; no implicit mid-Scope rebinding or state
restoration occurs.

Service contracts describe only serializable boundary operations and facts.
Package, Run, Services and contract versions remain independent. Small hosts can
state `Package/1 + Run/1` conformance without implementing any of this.

This reverses Round 1 because independent conformance, rather than an
"experimental" label, is the correct complexity firewall. The module can be
stable for those who implement it and absent for everyone else.

### 3.4 Falsifier

Do not freeze Services/1 if the pre-release implementations show any of these:

- Cordis needs runner-private lifecycle objects in the portable messages;
- the plain provider and Cordis realm cannot share one mount/invoke/close model;
- correct cleanup requires hidden connection identity;
- serializable contracts cannot represent the exported boundary;
- mutual-dependency handling requires a general distributed activation
  protocol;
- a minimal Services host cannot be built without importing Jig policy.

Failure of a gate delays Services/1 and Jig's stable release; it does not justify
publishing a knowingly provisional module as a foundation.

---

## 4. Permissions: a Deno-like request that remains truthful

### 4.1 Steelman: detailed declarative grants

Authors want to say what code needs near the code. A Deno-like list is familiar,
reviewable and can support least authority:

```yaml
permissions:
  read: [workspace]
  write: [workspace]
  net: [https://api.github.com]
  run: [git]
  env: [CI]
```

This is dramatically better than `permissions: workspace-write` or unrestricted
subprocess execution. It also gives installation and semantic selection useful
preflight metadata.

The danger is treating this syntax as an enforcement promise. Filesystem path,
DNS, subprocess and environment semantics vary across platforms. A host that
cannot compile `net: [api.github.com]` into a real network boundary must not call
it enforced.

### 4.2 Smallest portable syntax

Package/1 should support only five extra-authority categories:

```yaml
permissions:
  read: [workspace]
  write: [workspace]
  net: [https://api.github.com]
  run: [git]
  env: [CI]
```

Semantics:

- omission or `[]` requests no authority in that category;
- `true` requests unrestricted authority and is expected to require high trust;
- an array requests only the listed named resources;
- filesystem values are attachment names, not absolute host paths;
- network values are normalized origins, not arbitrary shell patterns;
- run values are logical executable grants resolved by host policy;
- environment values are literal variable names;
- secrets are never environment permissions and use a bound secret service;
- package snapshot read, private Run directory read/write and protocol stdio are
  the baseline and need not be repeated.

The package declaration is a minimum need, not a grant. A project policy
chooses a maximum. Launch succeeds only if every requested item is within that
maximum and the backend's enforcement level satisfies project policy.

### 4.3 Compilation and evidence

The sandbox backend compiles each item independently and produces:

```text
enforced     OS/backend prevents direct bypass
mediated     access is possible only through a host proxy or effect
advisory     requested behavior is communicated but raw bypass remains
unavailable  backend cannot supply or restrict it
```

Examples:

- a read-only bind mount can enforce `read: [workspace]` on an appropriate
  Linux backend;
- a network namespace plus egress proxy can mediate an origin allowlist;
- a backend supporting only network on/off cannot truthfully satisfy a
  restricted origin list by granting all network;
- an exact `git` subprocess may be mediated through an effect instead of raw
  `execve` when executable allowlisting cannot be enforced;
- environment filtering can usually be enforced at process creation, while the
  possibility of reading host process state must be assessed separately.

An untrusted Run fails when any required denial or restriction is only advisory
or unavailable. A user may explicitly choose a trusted/advisory policy, and the
Run journal records the effective difference.

The syntax intentionally does not include syscall lists, UID maps, seccomp,
containers, DNS policy, IPC namespaces, cgroups or platform backend names.
Those belong to sandbox implementations and policy, not portable authoring.

### 4.4 Relationship to effects

Portable packages should prefer bound effects for network, Git, Agents,
databases and secrets. Raw permissions remain necessary for existing programs
and high-performance local work, but they weaken journal completeness.

A granted effect slot does not automatically imply raw OS authority. Conversely,
raw `net` permission does not create an HTTP effect slot. The distinction is
visible.

### 4.5 Falsifier

Reduce the portable syntax to booleans plus mediated effects if cross-platform
backend tests show that named `net` or `run` restrictions are routinely
reported advisory. Add a new category only after two independent backends can
compile it or a host-mediated service can enforce it.

The permission design fails if users see the same declaration marked
"enforced" on one host and silently widened on another. A weaker host must fail
or require an explicit trust override.

---

## 5. Adoption failures at both extremes

### 5.1 Too little specification

FLOW becomes another Markdown convention if it omits the following.

#### No runtime identity

`flow.ts` alone is ambiguous. Packages work on their author's machine and fail
under a different TypeScript runtime. Hosts begin guessing and portability
becomes branding rather than conformance.

#### No generic supervised effect envelope

Every provider extension reinvents identity, retry, cancellation and tracing.
SDKs fragment, host policy becomes method-name dispatch, and Jig-specific
components become easier to write than portable ones.

#### No reliable fact channel

Authors abuse progress notifications for Hooks. Dropped messages create missing
automation, and hosts quietly invent incompatible durable-event APIs.

#### Services deferred beyond v1

FLOW acquires a reputation as a one-shot workflow format. Agent sessions,
registries and GUI/service applications grow host-private lifecycles that later
Services cannot replace cleanly.

#### No author permission declaration

Public executable packages are impossible to assess before launch. Secure hosts
deny most packages; permissive hosts normalize unsafe execution.

#### No exact contracts for Services

Semantic routing is asked to guess method compatibility. Failures move from
installation into live calls.

#### No configured Flow instances

Projects fork or copy packages merely to change `maxRetries`, cost or provider
choice. Updates and semantic routing become noisy.

#### No provenance and immutable activation

Runs cannot be reproduced, signatures authenticate the wrong bytes, and edits
change live behavior.

### 5.2 Too much specification

FLOW becomes an application framework if it adds the following.

#### Package-controlled arbitrary argv

The package format becomes a cross-platform process manager and expands the
pre-protocol attack surface. PATH and flag behavior undermine portability.

#### Mandatory Services conformance

Small hosts disappear. Services must be stable and first-class without being a
requirement for Run hosts.

#### Contracts for ordinary child Flows

The zero-ceremony path is lost. Intent-driven one-shot work already shares the
Run boundary; formal contracts are reserved for stable service APIs.

#### A universal graph, Task, GUI or Agent ontology

Runners and Starters lose ownership of their internal/application models.

#### YAML expressions and merge rules

Static metadata becomes an inferior programming language. Settings are inert
values; transformations and policy are ordinary project code.

#### Fine-grained security claims without backends

An impressive permission vocabulary creates false assurance. Categories enter
the portable syntax only when a backend or mediation path can enforce them.

#### Mandatory central registry and global names

Git, npm, OCI and private distribution become second-class, and namespace
ownership becomes political infrastructure before the artifact succeeds.

#### Exactly-once, transparent replay and universal crash resumption

The protocol promises properties arbitrary external systems and runner state
cannot provide.

#### Automatic Agent repair inside a live Run

Trust, source identity and deterministic control become invisible. Repair is a
separate staged Run followed by validation and a new invocation.

---

## 6. Compact revised Package/1 and Run/1

The package surface after cross-examination is:

```markdown
---
flow: 1
name: gauntlet-loop
description: Iteratively build, test, review, and improve an artifact.
runtime: deno/1
outcomes: [done, blocked]
requires: [effects, events]
permissions:
  read: [workspace]
  write: [workspace]
  net: []
  run: []
  env: []
---
```

Only `flow`, `name` and `description` are required. `runtime` exists only for an
executable package. `requires`, `outcomes` and `permissions` are inert bounded
metadata. Input/config/output JSON Schemas remain optional conventional files.

Run/1 is:

| Direction | Method | Reliability |
|---|---|---|
| host → component | `flow/run` | request/result |
| host → component | `flow/cancel` | best effort plus process kill fallback |
| component → host | `flow/call` | acknowledged, operation-ID journaled |
| component → host | `effect/call` | acknowledged, operation-ID journaled |
| component → host | `event/emit` | acknowledged only after durable acceptance |
| component → host | `telemetry/emit` | best effort, droppable notification |

The three outbound channels are not interchangeable:

```text
effect      please do this and return its result
event       this happened; commit the fact
telemetry   this is happening; observe if useful
```

Services/1 reuses effect identity, reliable fact and telemetry semantics while
adding the long-lived open/invoke/call/close lifecycle.

---

## 7. Release gates and final falsification plan

Before freezing these reversals:

### Runtime gate

Run the same Deno, Bun and Python packages on two independent hosts. Confirm
that runtime bindings, not PATH accidents, determine launch. Collect every
package needing a local argv override.

### Effect/event gate

Implement one Agent effect, one HTTP-like effect and one project-local provider
through `effect/call`. Crash between external completion and host reply. Verify
duplicate and indeterminate behavior. Drop telemetry intentionally and deliver
one durable event twice to a Hook.

### Services gate

Implement a plain counter/session provider and a Cordis realm provider. Test
required cycles, concurrent invocation, provider crash, pinning, drain and
Scope cleanup through the same suite.

### Permission gate

Compile the five-category syntax on at least Linux plus one of macOS or Windows.
Produce machine-readable enforcement reports and reject every case that would
otherwise widen authority silently.

### Adoption gate

Ask an independent host author to implement a leaf Run host without Jig code.
Ask a Flow author to publish:

1. one Markdown-only Flow;
2. one executable Flow with an Agent effect and durable event;
3. one Services provider.

If either needs to understand Jig's project model, the portable boundary has
leaked. If the executable author needs more than `FLOW.md`, one `flow.<ext>` and
ordinary runtime files for the common case, the package surface is too large.

---

## Final position

The minimalist review correctly removes universal graphs, host application
concepts, YAML programming and mandatory service machinery. It goes too far by
making host effects extension-specific, durable facts nonstandard and Services
provisional.

The mature compromise is:

> One obvious implementation file, launched by a FLOW-owned runtime binding;
> one small Run protocol that distinguishes requested effects, committed facts
> and disposable telemetry; one stable but independently conforming Services
> module; and one permission request syntax whose authority is only as strong as
> the backend evidence recorded for that Run.

That is sufficiently small for an independent host, sufficiently precise for a
public executable ecosystem, and sufficiently deep to prevent Jig from being
classified as merely another Markdown workflow tool.
