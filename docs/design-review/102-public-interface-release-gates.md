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
candidate SDKs, clean package-build/install checks, an expanded Bun-hosted
behavioral matrix, and a clean-room Python host for the shared golden
conversation. Run/1 is not yet a stable conformance label: the complete
behavioral matrix has not passed under two independent peers, and publication
checks remain deferred. The repository also contains private Jig slices for
Package capture and inspection, Schema and Capability Contract validation,
captured-package materialization, and one Run/1 host session over an already
fenced exact component process. This is not yet a public Jig SDK or complete
controller: runtime preparation, Sandbox Backend activation, child-Flow/effect
dispatch, and durable admission remain separate unfinished seams. The intended
package names are:

```text
@jigging/jig    Jig TypeScript package
@flowmd/sdk     FLOW TypeScript SDK
flowmd-sdk      FLOW Python distribution
flowmd_sdk      FLOW Python import
sley            independent Sley TypeScript/Python graph runtime
```

These names are distribution intent, not protocol identities or claims that a
package is published. Sley owns its public graph API upstream.

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

A probe need not wait for unrelated surfaces. The Run wire is now frozen as a
closed candidate, but a Run-only component probe still waits for the exact SDK
declarations and runnable package it will import; it does not wait for Service,
GUI, or Agent APIs. Every consumed slice must be versioned and fixed before it
is handed to the independent probe author.

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
publication claim. Both source projections pass one shared full-duplex
conversation, a Bun host exercises the expanded behavioral matrix, and an
independent Python host repeats the golden path. The private npm tarball and
unpublished wheel and sdist artifacts also pass clean-install checks. The
remaining matrix must be closed and exercised under two independent peers
before a stable label.

### FLOW Service SDK

Service/1 remains a separate interface slice. Its eventual SDK must project:

- one pending Service Mount with fixed exports and dependencies;
- distinct Mount-background and invocation-owned clients/lifetimes; and
- provider readiness and bounded disposal without public remote Scope objects.

Its wire schemas, owner-attribution model, error registry, SDK vocabulary,
examples, and conformance fixtures remain release gates. Run/1 does not wait
for them, and examples may not infer Service helper names from the Run SDK.

### Jig project authoring SDK

The SDK must project captured, inert desired state:

- project source discovery and exact membership;
- Binding declarations and package/host-capability references;
- exact and closed-candidate dependency slots;
- Hook producer/type selectors and Run targets;
- attachments, settings, registration-defined grant attenuation; and
- the optional project Semantic Choice Binding.

The desired ergonomics currently use illustrative names such as `defineJig`,
`discover`, `bind`, `hook`, `bindingRef`, `serviceExportRef`, `candidates`, and
`event`, and `root`. They are not published APIs until one authoritative declaration file
and normalized captured-value schema define their inputs, outputs, unknown-key
behavior, and module-evaluation boundary.

The separate questions of zero-boilerplate simple Run targets and a changing
admitted routing universe remain open in
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

This model is not automatically a second user-authored workflow DSL or a
universal graph schema. Expose only the authoring surface real Jig Graph users
need; keep compiler IR private when possible.

## Machine-readable release gates

The repository still needs:

- the complete Run/1 conformance corpus passing under two independent peers;
- closed Service/1 method schemas, owner-attribution model, and error registry;
- `schema-1.json`;
- `capability-contract-1.schema.json`;
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
