# Deterministic child-Flow slice

**Status:** closed on 2026-08-27. The selected private proof is complete; its
implementation evidence and preserved limits are recorded in
[`144-deterministic-child-flow-closure.md`](144-deterministic-child-flow-closure.md).
This checkpoint added no FLOW field, Run/1 method, Root Administration member,
Runtime Adapter SPI, Sandbox Backend SPI, or general scheduler API.

## 1. Why this slice comes next

Jig can now execute one exact admitted leaf Run safely, but a valid
`flow/call` still receives `UNAVAILABLE`. That leaves the product unable to
perform its defining orchestration operation.

The competing control-plane slice would need to settle project opening,
authority issuance, authentication, transport, inspection, and plan/apply
before adding execution capability. Those surfaces are important, but freezing
them now would make the existing leaf path easier to invoke without testing
whether Jig can compose work. Deterministic composition exercises the already
closed Run/1 and project Binding semantics while remaining private.

## 2. Exact proof

The first supported composition is deliberately narrow:

```text
one admitted Bun Run Binding
    -> one exact flow-call slot
    -> one admitted zero-configuration Python direct Flow
    -> child Run/1 result returned through flow/call
    -> parent returns its Run/1 result
    -> both enforcement owners are fenced and removed
```

The parent Binding may carry JSON settings. It carries no attachments,
capability slots, candidate set, or second distinct child-operation slot. The
child is an exact direct Run with no settings, attachments, or slots. These are
proof limits, not new portable restrictions.

The slot is resolved only against the candidate and admission generation
already pinned by the parent root Run. No current catalogue, visible source,
newer admission, semantic model, repair Flow, or ambient runtime is consulted.
The child has no public Run ID and cannot be submitted or inspected through
Root Administration.

## 3. Operation semantics

Run/1 remains authoritative:

- the first `(operationId, canonical flow/call params)` allocates the operation
  before child package bytes execute;
- the same ID and signature join one result and never redispatch;
- the same ID with different params returns `OPERATION_CONFLICT` before
  another dispatch;
- missing, wrong-kind, unavailable, or non-exact slots fail before child
  package execution;
- child input is admitted against the protected child Package/1 snapshot;
- a clean child result is admitted against that same package's declared
  outcomes and `result.schema.json` before it reaches the parent; and
- `effect/call` remains exactly `UNAVAILABLE`.

This proof permits only one distinct outstanding child operation. A second
distinct operation receives `RESOURCE_EXHAUSTED`; repeated waiters for the
first operation still join. General per-Run concurrency is a later measured
extension, not a prerequisite for proving ownership.

`request/cancel` cancels one waiter. Only loss of the final waiter requests
child cancellation. Parent cancellation, deadline, channel loss, or process
exit closes every waiter and requests cancellation of the child owner.

## 4. Ownership and recovery

The parent root execution is the durable owner. Before child package bytes can
execute it records one child-operation identity and the no-effect identities
needed to recover its package materialization and Linux enforcement owner.

The order is:

```text
durable child-operation allocation
    -> exact admitted target and recipe plan
    -> retained child package backing
    -> child Backend admission
    -> child Run/1 provisional result
    -> confirmed complete-tree fence
    -> child backing release
    -> child result admission
    -> operation terminal returned to the parent
```

The parent cannot publish its own terminal until the child operation has
settled or has been fenced and classified. A coordinator replacement never
replays child package code. It reacquires and fences the exact child owner,
releases its exact backing, then completes the existing root-loss recovery.
Unconfirmed child fencing keeps the root pending just as unconfirmed parent
fencing does.

The parent and child share the parent's admitted absolute deadline. The child
may narrow it with its recipe ceiling but cannot extend it. Runtime settings,
attachments, slots, scratch, process state, and filesystem authority do not
inherit from parent to child.

## 5. Required evidence

Before closure, the proof must cover:

- one real contained Bun-to-Python call and returned domain result;
- exact-slot resolution from the pinned admission generation;
- duplicate join and conflicting operation IDs;
- missing, wrong-kind, multi-candidate, unavailable, and invalid-input refusal
  before child execution;
- child protocol, declared-outcome, and result-schema failure;
- single-waiter and final-waiter cancellation;
- parent cancellation and deadline while the child is starting and running;
- coordinator loss before and after child Backend admission;
- no parent terminal before confirmed child and parent fencing;
- no automatic child redispatch after uncertain completion; and
- repeated Runs with zero process, cgroup, private-device, owner-state, and
  package-materialization residue.

## 6. Explicit exclusions

This slice does not implement:

- `effect/call`, the Journal, Hooks, or host capability providers;
- semantic ranking, dynamic candidate universes, or missing-Flow repair;
- recursive composition or several distinct concurrent child operations;
- Service providers or capability Bindings;
- Agent providers, skills, or instruction-mode execution;
- public child-Run administration, list/watch/cancel, project opening, IPC, or
  authentication;
- public Runtime Adapter, Sandbox Backend, dispatcher, operation-store, or
  scheduler interfaces; or
- Sley or Jig Graph.

If the exact proof requires weakening the containment contract, exposing host
control to package code, inventing a package-manager lifecycle, or publishing
one-mechanism extension abstractions, the phase stops at that blocker.
