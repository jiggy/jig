# Public interface release gates

**Status:** authoritative gap inventory, not an SDK specification.

The first probe round consumed interfaces which the platform had never
published. That inverted the design process: examples invented helpers, then
the specifications changed to rationalize them. This document prevents a
repeat by separating reviewed semantics from actual public interfaces.

## What exists today

The repository contains reviewed prose, concrete Capability Contract
descriptors, and a closed Run/1 candidate with a machine message schema and
error registry. It now also contains private `0.0.0` TypeScript and Python
candidate SDKs, clean package-build/install checks, a complete shared
behavioral corpus under Bun and an independent Python host peer, and an
instruction-restricted external-author/evaluator pass against the packed
TypeScript SDK plus a valid Package/1 and Schema/1 package. Phase 1 is therefore
frozen as a prerelease foundation; npm/PyPI publication and a general
third-party certification label remain deferred. The repository also contains
private Jig slices for Package capture and inspection, Schema and Capability
Contract validation, captured-package materialization, and one Run/1 host
session whose private input is a Backend-supplied exact-component process
seam. The private project path now continues through static declaration
evaluation, a retained package-only aggregate, deterministic non-admissible
resolution, strict portable-lock projection, and lock-first durable admission
of one exact `UNAVAILABLE` target. This is not yet a public Jig SDK or complete
controller: a generic retained `READY` recipe, public Runtime Adapter and
Sandbox Backend models, root-Run dispatch, child-Flow/effect dispatch, and the
host administration interface remain unfinished seams. The intended package
names are:

```text
@jigging/jig    Jig TypeScript package
@flowmd/sdk     FLOW TypeScript SDK
flowmd-sdk      FLOW Python distribution
flowmd_sdk      FLOW Python import
@jigging/sley   independent Sley TypeScript graph runtime
sley            independent Sley Python graph runtime
```

These names are distribution coordinates, not protocol identities. Sley owns
and publishes its public graph APIs upstream; the Jig and FLOW SDK names remain
pre-release intent in this repository.

The former Nix-specific host-runtime retention sequence is preserved on the
`experiments/nix-runtime-retention` branch and is not the current roadmap. It
investigated retention of runtimes which happened to be installed in
`/nix/store`; it did not implement project `flake.nix`, `flake.lock`, or
`shell.nix` support. The exact disposition and current milestone are recorded
in
[`130-nix-experiment-disposition-and-next-slice.md`](130-nix-experiment-disposition-and-next-slice.md).

## Decontamination disposition

The review kept the probe-era changes which clarified pre-existing boundaries:

- Metadata/1 and the three conventional Schema/1 files;
- package-local Capability Contract descriptors with hashes derived internally;
- terminal missing-resolution plus a separate deliberate repair attempt;
- `requested -> wouldGrant -> planned -> realized` authority evidence;
- fixed Service dependencies/exports and one readiness transition;
- shallow opt-in discovery and exact-list alternatives;
- explicit per-Agent-call Flow-local skill selection;
- direct editing with update-time three-way reconciliation; and
- the intended Jig, FLOW SDK, and Sley package names.

It removed from the reviewed interface:

- Hook-owned watcher/Event Source construction and Hook-coupled Service
  replacement;
- the hidden derived-default Binding algorithm;
- `allRuns()`, its fixed-point machinery, and the universal 256-candidate cap;
- probe-invented Sley `Router`, `Agent`, `Parallel`, immutable-state, and
  `Outcome` APIs;
- `RunSnapshot`, `openProject`, `getRun`, and `cancelRun`;
- hypothetical provider-package imports and unregistered module IDs; and
- claims that absent SDKs, schemas, providers, or CLIs already exist.

It left the useful requirements open rather than discarding them: simple Runs
need low-ceremony targets, applications need admitted dynamic routing, Agent
providers need per-owner context/skill projection, and local GUIs eventually
need an authenticated host control API. Those are inputs to interface design,
not implicit APIs.

## Interfaces which must be closed before a probe consumes them

A probe need not wait for unrelated surfaces. The Run-only author slice is now
frozen and has passed independently together with the Package/Schema material
needed by its authored package; it does not wait for Service, GUI, or Agent
APIs. Every other consumed slice must likewise be versioned and fixed before it
is handed to an independent probe author.

### FLOW Run SDK

The closed [`Run/1`](../spec/run-protocol.md) and
[`Run SDK/1`](../spec/run-sdk.md) candidates, their
[`message schema`](../spec/machine/run-1.schema.json) and
[`error registry`](../spec/machine/run-1-errors.json), and the private
implementations under `packages/` now fix and exercise the finite Run slice.
The TypeScript and Python SDKs project it as:

- one finite Run handler and its immutable invocation projection;
- child `flow/call` and `effect/call` with stable semantic operation IDs;
- cancellation, deadlines, complete Flow results, unwrapped effect values, and
  distinct operation versus declared capability errors; and
- no public JSON-RPC IDs, owner IDs, resolution objects, Bindings, providers,
  sandboxes, Jig controls, Services, Agents, or graph types.

The selected semantic vocabulary is `serve(handler)`, `RunContext`,
`RunResult`, `callFlow`/`call_flow`, `callEffect`/`call_effect`,
`OperationError`, `EffectError`, and JSON value types. The checked-in source
declarations and examples are authoritative for this candidate, not a
publication claim. Both source projections pass the complete shared black-box
corpus under a Bun host and an independently implemented Python host. The
private npm tarball and unpublished wheel and sdist artifacts pass
clean-install checks. An instruction-restricted external author built the
concurrency probe from the applicable public documents, a private inert-package
checker, and the packed SDK. An independent evaluator repeated Package/1,
Schema/1, type, and wire checks against the same SDK artifact. The experiment
was not OS-hermetic; its durable evidence and limits are recorded in
[`103-phase-1-flow-foundations.md`](103-phase-1-flow-foundations.md).

### FLOW Service SDK

Service/1 remains a separate interface slice. The closed
[`Service/1`](../spec/service-protocol.md) wire candidate, its
[`message schema`](../spec/machine/service-1.schema.json),
[`error registry`](../spec/machine/service-1-errors.json), and
[`Service SDK/1`](../spec/service-sdk.md) candidate now fix:

- one pending Service Mount with fixed exports and dependencies;
- distinct Mount-background and invocation-owned clients/lifetimes; and
- provider readiness and bounded disposal without public remote Scope objects.

The private TypeScript and Python Provider projections implement
`serveService` / `serve_service`, a static `ServiceDefinition`, mount and
invocation contexts, owner-scoped dependency calls, `ServiceError`, readiness,
cancellation, and terminal quiescence. A private Jig Host drives both real
Provider processes, and an independent Bun peer runs the first shared Provider
matrix. An archived host-specific witness also completed one real Python Mount
inside the private Linux cgroup-v2 envelope; that Nix-runtime fixture is no
longer in main's current hostile corpus. Every session-local required case has
executable evidence, but
the cases are not yet one portable Host-under-test corpus. Durable Jig provider
generations/Bindings, a second independent Host, and the resulting conformance
label remain release gates. Run/1 does not wait for them.

### Jig project authoring SDK

The first package-authoring slice is now closed in
[`107-project-authoring-sdk-slice.md`](107-project-authoring-sdk-slice.md). It
projects captured inert desired state for:

- project source discovery and exact membership;
- package Binding declarations;
- exact and closed-candidate dependency slots;
- tagged direct Flow and Binding Run targets; and
- attachments and complete settings.

Its selected vocabulary is `defineJig`, `discover`, `defineBinding`, `flowRef`,
`bindingRef`, and `candidates`. The checked-in declaration implementation and
normalized captured-value schema must pass their corpus before this private
slice may be handed to an external probe.

The private implementation boundary is fixed in
[`108-project-capture-boundary.md`](108-project-capture-boundary.md): authored
values, a durable captured aggregate, and a resolved admission candidate are
three separate stages. Flow membership capture, retained Package/1 artifacts,
and the pure package/Binding linker are implemented private consumers. The
bounded evaluator checkpoint in
[`111-bounded-project-evaluator.md`](111-bounded-project-evaluator.md) now
proves captured-source evaluation, a closed `@jigging/jig` resolver, bounded
JSON transport, host-side schema validation and canonical re-normalization,
and complete cgroup/Bubblewrap fencing on the current Nix-backed proof-host
fixture. It is not a generic retained evaluator recipe. The following
[`112-static-author-closure.md`](112-static-author-closure.md) checkpoint adds
one candidate-wide, captured, explicit static `.ts` import graph and makes the
evaluator resolve only its recorded edges. No aggregate schema or evaluator API
is public.

The subsequent private checkpoints retain the complete package-only aggregate,
reduce it with one closed host-planning observation without making that
observation executable, project canonical portable lock evidence while
excluding host state, and durably publish/replay one lock-first unavailable
admission. They prove restart and compare-and-set mechanics, not a public lock
schema, public administration API, or runnable generation. The next path must
first replace the evaluator's proof-host runtime fixture with generic retained
support. A `READY` candidate must additionally retain and reacquire one generic
Adapter/Backend recipe and own its spawn lifecycle across restart.

Hooks, Service export references, instruction Agent selection,
`semanticChoice`, and host-capability Bindings remain later gated slices. The
zero-boilerplate target is resolved; only the changing admitted routing
universe remains open in
[`101-default-targets-and-open-routing-candidate.md`](101-default-targets-and-open-routing-candidate.md).

### Jig host and administration interface

Reviewed semantics exist for plan/apply admission and idempotent root Run
submission. Before CLI, GUI, or library clients can consume them, Jig must
define authentication and closed request/result/error models for:

- candidate inspection, plan, apply, and stale-plan handling;
- root Run submission and durable Run identity;
- status and authority evidence; and
- any later inspection or cancellation operations.

No `RunSnapshot`, `openProject`, `getRun`, or `cancelRun` interface is currently
part of Jig/1.

### Trusted host extension interfaces

The host must define closed registration and call models for:

- Runtime Adapters;
- Sandbox Backends;
- host-capability provider registrations;
- authenticated Journal producer registration/lifecycle for protected host
  producers;
- Agent per-owner resource/tool projection; and
- instruction-runtime conductors.

It must also publish the closed host-policy document schema, the module or
artifact identity used to name installed extensions, deterministic registration
lookup, and the management interface which inspects or changes that host-local
policy. These are operator surfaces; project source cannot supply or override
them.

The behavioral requirements are reviewed, but examples must not invent provider
package names, tokens, receipts, or launch structures before these interfaces
exist.

The former Linux `SANDBOX_UNAVAILABLE` stop is historical. The private proof
now has a delegated aggregate owner, pre-exec placement, entropy and
root-mapping evidence, coordinator-independent cleanup, and a hostile corpus.
A Python Run/1 and Service/1 activation using this host's Nix-store runtime
were integration witnesses for that envelope, not an admitted Nix Adapter or
current product dependency. The exact evidence is recorded in
[`105-phase-2-linux-cgroup-proof.md`](105-phase-2-linux-cgroup-proof.md); the
old environmental stop remains in
[`104-phase-2-security-blocker.md`](104-phase-2-security-blocker.md). The proof
still withholds the public Backend interface: registration and plan schemas,
an installed immutable helper, and a genuinely different Backend mechanism
remain unclosed.

### Jig Graph over Sley

Jig Graph must own a serializable compiler/contract model independent of Sley
objects:

- stable Jig node/workflow/path IDs;
- route contracts and boundary schemas;
- an injected deterministic `DecisionEngine` interface;
- validation and compilation to ordinary Sley nodes, links, and Flows; and
- trace mapping back to Jig IDs.

It must not subclass Sley graph elements, attach Jig metadata to them, fork the
scheduler, or claim Sley owns semantic routing. The first executable check uses
a deterministic chooser; an LLM-backed engine comes only after valid and
invalid routes pass.

The external Sley-backed component under `conformance/run-1/` now proves the
lower boundary using published `@jigging/sley`: ordinary component code maps
`RunContext -> Sley state -> RunResult` and explicitly preserves an operational
failure through Sley's `RunError`. It intentionally adds no adapter package,
compiler, or conformance claim. Repeated real components must first demonstrate
that a shared helper is worth publishing.

This model is not automatically a second user-authored workflow DSL or a
universal graph schema. Expose only the authoring surface real Jig Graph users
need; keep compiler IR private when possible.

## Next public vertical slice

The next slice is one direct exact root Run. It begins with one discovered
zero-configuration Run package, resolves one explicitly installed Runtime
Adapter and Sandbox Backend, records `READY` or exact `UNAVAILABLE`, applies
the reviewed candidate lock-first, accepts one idempotent root Run submission
against that admitted generation, executes Run/1 inside the Backend-owned
envelope, and publishes one durable terminal result after complete cleanup.

Before that chain can be generic, it must retain one exact author-evaluator
support closure or an equivalently narrow host mechanism. The current
Nix-backed evaluator remains proof evidence only.

This slice intentionally adds no Binding requirement, Service, Hook, Agent,
Semantic Choice, child Flow, Jig Graph compiler, update watcher, Nix
dependency, or ambient runtime fallback. It closes only the host-extension,
host-policy, lock, administration, and Run models required for that path.

Before an independent probe consumes it, the candidate must prove:

1. generic retained author-evaluator support on the selected host;
2. deterministic Adapter and Backend selection from explicit host policy;
3. one retained generic `READY` recipe beside the exact unavailable branch;
4. stale-plan rejection and lock-first admission;
5. idempotent root submission and durable Run identity;
6. restart reconciliation around spawn intent and terminal publication; and
7. cancellation, deadline, whole-tree fencing, and zero residue.

The complete status and Nix decontamination boundary are in
[`130-nix-experiment-disposition-and-next-slice.md`](130-nix-experiment-disposition-and-next-slice.md).

## Machine-readable release gates

The repository still needs:

- the complete Service/1 Host/Provider cross-language black-box corpus and
  durable Jig hosting integration;
- Runtime Adapter and Sandbox Backend schemas;
- the host-policy document schema and extension-registration identity model;
- the canonical `jig.lock` schema; and
- cross-language fixtures for every claimed stable boundary.

## Rule for the next experiment

1. Freeze and version the minimal consumer-facing slice the next probe will
   actually import.
2. Give only that published subset to independent agents which did not design
   the platform.
3. Let them build probes without editing platform specifications.
4. Record friction and failures separately.
5. Change the platform only after an explicit review, then rerun the same
   probes.

A probe may reveal a missing interface. It may not define that interface and
silently promote it while acting as its consumer.
