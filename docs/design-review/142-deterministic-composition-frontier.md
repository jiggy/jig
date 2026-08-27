# Deterministic composition frontier

**Status:** selected next private vertical slice after direct-root containment;
not a new public SDK or protocol.

## 1. Why this is next

Jig can now admit, durably start, contain, and observe one exact Python or Bun
root Run. The Run/1 Host session nevertheless answers every valid `flow/call`
and `effect/call` with `UNAVAILABLE`. That is a deliberately honest leaf-Run
implementation, but it is not yet orchestration.

The next slice is therefore one deterministic child Flow call. It exercises
the already reviewed Run/1 ownership protocol, immutable project aggregate,
portable lock evidence, admitted recipes, runtime dispatch, containment, and
durable root coordinator together. No semantic decision is required to prove
that path.

## 2. Closed scope

The slice proceeds in this order:

1. replace the Host session's hard-coded unavailable response with one private
   operation-dispatch dependency;
2. preserve operation-ID conflict detection, bounded pending work, owner
   closure, component cancellation, and response serialization at the Host
   session boundary;
3. resolve one exact child-Flow slot already frozen in the admitted project and
   lock;
4. launch the child through an exact admitted recipe and the same private
   Sandbox Backend contract as the root;
5. inherit the parent's deadline and cancellation, wait for protected child
   cleanup before settling the call, and return only the Run/1 `RunResult`;
6. prove Bun-to-Python and Python-to-Bun calls plus failure, cancellation,
   operation replay/conflict, coordinator loss, and zero residue; and
7. install the dispatcher in the durable root path without adding authority to
   `RootAdministration` or FLOW packages.

## 3. Boundaries that remain fixed

- The dispatcher is trusted Jig host machinery, not a FLOW capability.
- A component can request only a declared local slot and FLOW JSON/1 input.
- The admitted project and lock determine the exact candidate universe.
- Discovery and semantic ranking confer no authority.
- Child processes receive no host control, cgroupfs, runtime-store, launcher,
  Backend, or administration authority.
- The private cgroup-v2/Bubblewrap implementation remains private.
- Coordinator loss never infers successful work and must still fence every
  descendant.

## 4. Explicit exclusions

This slice does not add:

- `effect/call` providers or a Journal;
- Semantic Choice or an open catalogue view;
- Agent providers or skill projection;
- Hook admission or event producers;
- Service Mounts or durable Provider generations;
- public Runtime Adapter or Sandbox Backend interfaces;
- durable arbitrary graph continuation; or
- new Root Administration methods.

Those features must build on the deterministic operation boundary. They may
not enlarge it while it is being proved.

## 5. Completion gate

The slice is complete only when an admitted root package calls one admitted
child package through Run/1, both execute under the secure Backend, the child
result reaches the parent, cancellation and deadlines close the full subtree,
coordinator failure leaves no processes or cgroups, and ordinary plus hostile
regression suites pass. Until then the current `UNAVAILABLE` behavior remains
the only supported product behavior.
