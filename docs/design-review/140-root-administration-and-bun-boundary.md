# Root Administration and Bun boundary clarification

**Status:** Root Administration terminology remains accepted. The Bun status
and next gate are historical and superseded by
[`141-bun-and-run-lifecycle-closure.md`](141-bun-and-run-lifecycle-closure.md).
This review made no wire or SDK surface changes.

## 1. Root Administration is host control plane

`RootAdministration` is issued by a trusted Jig host to a trusted host-side
frontend or control-plane integration for one already-open project. Expected
future holders include a CLI, GUI, authenticated daemon, or trusted automation
module. It is a Jig-local object capability, not a portable FLOW interface.

A FLOW activation never receives `RootAdministration` through Run/1. Portable
component code uses the FLOW SDK's `callFlow`/`call_flow` for child Flows and
`callEffect`/`call_effect` for bound capabilities; their Run/1 wire methods are
`flow/call` and `effect/call`. A package which reaches a host-specific
administrative bridge is outside the portable FLOW contract.

The current Root Administration/1 candidate closes only in-process
`startRun`/`runStatus` values and behavior for an already-open project. It does
not yet provide project-authority issuance, authentication, transport, an
actual CLI command, plan/apply, or publication. The earlier phrase
"application code" was ambiguous because other specifications also use that
phrase for sandboxed package code; current documents now name the host-side
boundary explicitly.

## 2. Bun containment and compatibility are distinct

The private Linux Backend successfully contains the tested activation-root Bun
1.3.3 evaluator process. The negative proof concerns a general
descendant-capable Bun-backed Flow Run recipe under the current
root-pinned-mappings construction:

```text
activation-root Bun                         succeeds
child Bun reading the root-pinned maps      exits 134
general Bun-backed Flow Run recipe           unavailable
```

"Activation root" means the root process of the package activation and not a
Unix root user. The package payload remains unprivileged.

The child sees the activation root's deliberately pinned
`/proc/self/maps` rather than a per-caller view. This is a runtime
compatibility failure under the current narrow predicate, not a containment
escape or evidence that Bun cannot run securely. The tested evaluator tuple
also needs access afforded by an evaluator-only `/dev/urandom` bind whose
production identity, representation, and attestation are not yet closed; it is
not FLOW package authority.

## 3. Next evidence gate

Before adding a Bun Run recipe, a private investigation must prove all of:

1. activation-root and Bun-child execution with correct per-caller process
   mappings;
2. one real `flow.ts` Run/1 exchange;
3. no host-process, cgroupfs, writable sysctl, unrelated-device, network,
   ambient-environment, or migration authority;
4. exact and reviewable entropy access or evidence that the selected runtime
   does not require it;
5. unchanged aggregate resource enforcement, cancellation, coordinator-loss
   fencing, quiescence, and zero-residue cleanup.

The first experiment should use the existing private Linux Backend and trusted
launcher. It may construct a namespace-local restricted process view, but it
must not bind host `/proc` into the payload or expose writable host controls.
Failure preserves exact unavailability. A VM Backend is a later alternative,
not the first compatibility workaround.

No public Sandbox Backend SPI follows from this investigation. A second proven
containment mechanism is still required before extracting a user-replaceable
interface rather than publishing cgroup-v2/Bubblewrap implementation details.
