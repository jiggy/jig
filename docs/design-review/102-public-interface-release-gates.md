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
evaluation, a retained package-only aggregate, strict portable-lock projection,
lock-first durable admission of exact `UNAVAILABLE` plus exact Python and Bun
`READY` targets, idempotent root-Run dispatch through the proven Linux
envelope, terminal persistence, and exclusive local coordinator takeover. One
private admitted Bun Binding can now perform one deterministic `flow/call` to
one exact Python direct Flow in the same pinned generation, with durable
operation identity, child-first fencing, cancellation/deadline propagation,
coordinator-loss recovery without replay, and complete cleanup. A second
private Bun Binding can now invoke the exact canonical Journal `append`
effect, with protected contract validation, attenuated producer/type
authority, durable multi-operation replay/conflict semantics, atomic Event and
operation closure, parent-release evidence, and restart recovery without
redispatch. That Journal path now also selects exact admitted Hook revisions
and atomically allocates their derived root Runs. The project controller
coalesces append wakes with durable rescans, executes one exact Python consumer
from a Bun publisher, drains to a fixed point, and reconciles unresolved
older-epoch Hook work to `COORDINATOR_LOST` without another append or dispatch.
This is not yet a published Jig SDK or complete product control
plane: Root Administration/1, its machine schema, and its private controller
cover in-process start/status, while generic Runtime Adapter and Sandbox
Backend models, non-Journal effects, project-authority issuance,
authentication/transport, and public plan/apply remain unfinished seams. The
private Service path now also admits and hosts one exact Bun Service Binding,
persists its complete Mount/generation lifecycle, and proves exact leases,
invocation allocation, possible-dispatch admission, terminal/closure evidence,
fenced recovery, and ordered release. It does not yet connect a root
`effect/call` to that live Mount. The private Candidate/5-to-Plan/2 path now
also classifies normalized no-op, inert lock repair, and authority-changing
admission, persists canonical applicable Plans, and applies them using only
their digest. Admission retains candidate-head compare-and-set; repairs ignore
inert candidate-head movement, stale on active-admission movement, commute
when equivalent, and advance no Hook or Service authority. This is a private
classification/apply checkpoint rather than a complete capture-to-plan product
operation. The intended package names are:

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
longer in main's current hostile corpus. Main now contains a real exact Bun
Mount under that envelope, including durable readiness acknowledgement,
generation, fencing, release, closure, and restart recovery. The private store
also proves generation-pinned owner leases and invocation allocation,
dispatch, terminal, operation closure, ordered release, and fence-based
`UNAVAILABLE` versus `UNCERTAIN` recovery. A separate stateful process witness
preserves counter state across sequential Service/1 invocations.

These cases are not yet one portable Host-under-test corpus, and the durable
state is not yet joined to a live root `effect/call`: current direct-Run
recipes truthfully reject the capability-backed Service Binding until mixed
effect dispatch is earned. A second independent Host, that real
Root-to-Service path, and the resulting conformance label remain release
gates. Run/1 does not wait for them. The exact checkpoint is
[`151-private-service-hosting-checkpoint.md`](151-private-service-hosting-checkpoint.md).

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
and complete cgroup/Bubblewrap fencing using the current proof host's
authenticated sandbox-lifetime runtime-support receipt. It is not a generic
retained evaluator recipe. The following
[`112-static-author-closure.md`](112-static-author-closure.md) checkpoint adds
one candidate-wide, captured, explicit static `.ts` import graph and makes the
evaluator resolve only its recorded edges. No aggregate schema or evaluator API
is public.

The subsequent private checkpoints retain the complete package-only aggregate,
reduce it with one closed host-planning observation without making that
observation executable, project canonical portable lock evidence while
excluding host state, and now durably publish/replay both exact unavailable
admission and one exact Python `READY` recipe. The READY path allocates one
idempotent root Run under a process-held coordinator epoch, executes Run/1
through the cgroup-v2/Bubblewrap proof Backend, persists the terminal after
cleanup, and reconciles an unknown older-epoch result to `COORDINATOR_LOST`.
Reviews 131–137 record that chain. It proves one concrete vertical path, not a
public lock schema, administration API, Runtime Adapter SPI, or Sandbox Backend
SPI.

Service export references, instruction Agent selection, `semanticChoice`, and
host-capability Bindings remain later gated slices. The private
`@jigging/jig/experimental/hooks` overlay and its corresponding admitted
runtime are now a closed private proof: inert authoring, exact revision
intervals, atomic derivation, prompt same-epoch execution, and conservative
restart loss all have executable evidence. They do not reopen Project
Authoring SDK/1 or publish Hook authoring, inspection, replay, or scheduling.
The zero-boilerplate target is resolved; only the changing admitted routing
universe remains open in
[`101-default-targets-and-open-routing-candidate.md`](101-default-targets-and-open-routing-candidate.md).

### Jig host and administration interface

The smallest library-facing root slice is now closed as the
[`Root Administration/1`](../spec/root-administration.md) candidate and its
[`machine value schema`](../spec/machine/root-administration-1.schema.json).
A trusted host hands one object-capability to a trusted host-side frontend or
control-plane integration, outside every FLOW activation, for one already-open
project. Its complete surface is `startRun` and `runStatus`; the host, rather
than the caller, supplies policy, authority, deadline, and launch mechanism.
The candidate deliberately excludes project location and opening, transport
authentication, list/watch/cancel, and authority inspection. It is not a FLOW
capability; portable packages continue to use Run/1 calls and effects.

Before CLI or GUI clients can consume equivalent authority, Jig must still
define authentication and closed request/result/error models for:

- candidate inspection, plan, apply, and stale-plan handling;
- project selection and authority issuance;
- plan/apply and authority evidence; and
- any later inspection or cancellation operations.

The first private local admission boundary is defined in
[`150-private-project-admission-frontier.md`](150-private-project-admission-frontier.md).
Its Candidate/5 classification and Plan/2 apply subset is implemented and
closed in
[`152-private-plan2-classification-and-apply-checkpoint.md`](152-private-plan2-classification-and-apply-checkpoint.md).
It retains one canonical Plan/2 machine review with a final
`activationMeaningDigest`, authoritative proposed state, a Plan-bound prior
generation, and exact visible-lock observation. Prior state and delta are
derived rather than duplicated. Apply accepts only `planDigest`; its protected
Plan supplies the compare-and-set base. Equivalent final meaning and portable
lock may durably repair visible `jig.lock` with an idempotent receipt but no
admission generation, Hook transition, or Service wake. Distinct equivalent
repair Plans commute and may each record their own receipt; later candidate
observations do not stale them, while a new active admission does.

The implementation does **not** yet provide the complete source-capture,
evaluation, resolution, host-observation, classification, and Plan-publication
operation promised by a product `plan()`. The current private foreground path
publishes Candidate/5 and then binds classification to that expected head. A
closed project-facing error wrapper, the remaining classifier/authority proof
matrix, public lock and Plan schemas, project opening,
authentication/transport, and a public CLI/API remain release gates.

No `RunSnapshot`, `openProject`, `getRun`, or `cancelRun` interface is part of
Jig/1. The root administration candidate does not become published merely by
having checked-in declarations. Its private coordinator-owned controller, clean
public-surface consumer, and independent packed-package consumer review now
pass. The independent review first rejected three ambiguous semantics and
cleared the amended candidate only after its original counterexamples passed.

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

## Closed private execution slices and open phase boundary

The private direct-root chain is complete for exact Python and Bun recipes: one
discovered zero-configuration Run package records `READY` or exact
`UNAVAILABLE`, applies lock-first, accepts one idempotent root submission under
an exclusive local coordinator epoch, executes inside the Backend-owned
envelope, and publishes one durable terminal after cleanup.

The smallest administration interface and its private controller are now
closed. A clean consumer uses only the packed public subpath, and an independent
consumer review of the installed tarball passes. None of this pretends the one
proof mechanism has established a generic Runtime Adapter or Sandbox Backend
SPI.

The deterministic-composition slice is also complete. It adds one
private Binding with one exact child-Flow slot, one durable Run/1 operation,
same-generation resolution, child result admission, child-first fencing, and
replacement-coordinator cleanup without redispatch. It intentionally adds no
public child-Run administration or general dispatcher/scheduler surface. The
complete evidence and limits are in
[`144-deterministic-child-flow-closure.md`](144-deterministic-child-flow-closure.md).

The canonical-Journal and Hook slices are complete as private vertical proofs.
The first closes one exact `effect/call` append with durable operation and
parent-aggregate evidence. The second atomically selects admitted Hook
revisions, allocates derived roots, promptly executes them through the same
controller, and proves coordinator-loss reconciliation without duplicate
append, derivation, or dispatch. They add no public Hook SDK, Event query,
callback, subscription, producer construction, or scheduler SPI. Their exact
evidence and limits are in
[`146-private-journal-effect-closure.md`](146-private-journal-effect-closure.md)
and
[`148-private-hook-runtime-frontier.md`](148-private-hook-runtime-frontier.md).

The private Service-hosting substrate is also complete. One real admitted Bun
Service reaches acknowledged readiness and clean or recovered closure inside
the proven Linux envelope. Durable generations, owner-slot leases, invocation
allocation and dispatch evidence, terminals, operation closures, fence-based
recovery, and ordered release are closed and tamper-checked. This does not yet
claim a live Root-to-Service invocation controller; review 151 records that
deliberate boundary.

The private Plan/2 classification/apply substrate is likewise complete at its
deliberately smaller boundary. Candidate/5 classification, canonical Plan/2
persistence, digest-only apply, historical replay, no-op normalization,
commuting lock repairs, admission compare-and-set, and mixed-version private
store refusal have executable evidence. Review 152 records both those results
and the unimplemented capture-to-plan and public-interface seams.

None of the closed slices adds a public Service host, Agent, Semantic Choice,
Jig Graph compiler, update watcher, Nix dependency, ambient runtime fallback,
or public Backend or Runtime Adapter SPI.

Before an independent probe consumes it, the candidate must prove:

1. one exact retained author-evaluator and runtime-support closure;
2. deterministic recipe and Backend selection from trusted host evidence;
3. one retained `READY` recipe beside exact unavailable admission;
4. stale-plan rejection and lock-first admission;
5. idempotent root submission and durable Run identity;
6. exclusive coordinator takeover and terminal reconciliation; and
7. cancellation, deadline, whole-tree fencing, and zero residue.

All seven are privately proven for the selected host path, and the child-Flow
closure additionally proves deterministic refusal, operation replay/conflict,
parent cancellation and deadlines before and after child admission, and
coordinator loss on both sides of admission. The closed root
request/result/error model is routed through the coordinator-owned controller,
passes a clean external-module consumer, and clears the independent consumer
review recorded in review 139. Publication remains a product release decision,
not a claim implied by this checkpoint.

The Service-hosting frontier in
[`149-private-service-hosting-frontier.md`](149-private-service-hosting-frontier.md)
is closed at the exact substrate boundary recorded in
[`151-private-service-hosting-checkpoint.md`](151-private-service-hosting-checkpoint.md).
The Plan/2 classification/apply subset of
[`150-private-project-admission-frontier.md`](150-private-project-admission-frontier.md)
is closed in review 152. The next foreground session is finite and root-only,
using the existing coordinator and Root Administration controller; it does not
earn a persistent supervisor or start Services. Mixed root/Journal/Service
composition is the next composition boundary, and must prove authentic
Root-to-Service dispatch plus phased operation, lease, Mount, and loss cleanup
before persistent Service policy is considered. Neither checkpoint authorizes
a public SDK. The Nix decontamination boundary remains in
[`130-nix-experiment-disposition-and-next-slice.md`](130-nix-experiment-disposition-and-next-slice.md);
the latest completed control-plane boundary is review 152.

## Machine-readable release gates

The repository still needs:

- one complete capture-to-plan snapshot owned by a trusted project-opening
  path, rather than the current private publish-then-classify seam;
- the remaining Plan/2 classifier/authority proof matrix and one closed public
  project-facing error wrapper;
- public plan/apply request, result, error, authentication, and CLI/API
  surfaces plus an independent packed consumer;
- the complete Service/1 Host/Provider cross-language black-box corpus, a
  second independent Host, and one real Root-to-Service invocation through
  admitted mixed effect dispatch;
- a closed host-policy/configuration document for supported mechanisms;
- Runtime Adapter and Sandbox Backend schemas only after a second independent
  mechanism proves those abstractions;
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
