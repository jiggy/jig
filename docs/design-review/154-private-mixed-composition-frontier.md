# Private mixed-composition frontier

**Status:** partially closed on 2026-08-28. The finite normal path is implemented
in commit `3f84952` and recorded in
[`155-private-mixed-composition-checkpoint.md`](155-private-mixed-composition-checkpoint.md).
The provider-loss and coordinator-replacement proof gates below remain open.
This record publishes no supervisor, Service controller, effect registry,
project API, Runtime Adapter, or Sandbox Backend interface.

## 1. One bounded composition witness

The smallest useful mixed witness joins mechanisms which are already proved
separately:

```text
one admitted Bun counter Service and acknowledged generation
    + one admitted Bun root package
    + one admitted Python child Flow
    + the canonical Journal
    -> one finite coordinator epoch
```

The Bun root uses all three operation paths:

```text
flow/call
    -> the exact Python child pinned in the root's admission

effect/call through the canonical Journal slot
    -> one durable append

effect/call through one exact capability-backed slot
    -> counter.next on the acknowledged Bun Service generation
```

Root A calls the counter once and receives `1`. Exact replay of that operation
receives `1` without another Provider mutation. After Root A has closed all of
its operations and released its Service lease, Root B invokes the same root
package through a new Run and receives `2` from the same generation. One of
those roots also completes the Python child call and Journal append. This
proves one real mixed owner path without claiming counter-state durability or
general scheduling semantics.

## 2. Dispatch is closed and deterministic

This vertical adds one private dispatch decision inside the existing Run Host
session. It is not a provider registry or semantic router:

```text
flow/call
    -> existing deterministic child-Flow controller

effect/call to the exact canonical Journal slot
    -> existing Journal effect controller

effect/call to the exact admitted counter slot
    -> private Service invocation controller

anything else
    -> exact refusal before external dispatch
```

The caller cannot name a Mount, generation, Provider, package, Runtime Adapter,
or Sandbox Backend. The dispatcher validates the exact slot, export, method,
canonical input, and tagged result. Unknown slots, wrong kinds, unavailable
generations, undeclared methods, invalid values, and ambiguous targets fail
closed. No semantic similarity, ambient provider lookup, current filesystem
state, or post-admission fallback participates.

## 3. Roots resolve against pinned admission

A new Service lease is derived from the owner Root's pinned admission and
Candidate/5 revision, then matched to the exact live Mount and acknowledged
generation for that revision. It is **not** resolved against the project's
current admission head.

This rule is essential because a reviewed admission may change while an older
Run is still live. That change may admit work for later roots, but it cannot
retarget, invalidate, upgrade, or rebind an already allocated owner. A live
Mount from another candidate or generation is incompatible even when its
contract looks equivalent.

The owner+slot lease pins one generation. Every Service invocation records the
existing durable sequence:

```text
lease allocation
    -> invocation allocation
    -> possible-dispatch admission before the first Provider request byte
    -> validated durable terminal or honest loss classification
    -> invocation closure
    -> lease release
```

Same owner, operation ID, and canonical request joins or replays the same
terminal. Changed reuse is `OPERATION_CONFLICT`. A possibly dispatched call is
never automatically sent again.

## 4. One coordinator, privately shared

The finite session owns one project coordinator epoch. The Service Mount
controller and Root controller use that same epoch. The Root controller is
attached to the externally owned coordinator through a private construction
path; it must not acquire a second epoch, dispose the shared coordinator, or
invent a persistent supervisor abstraction.

The session owner has the complete lifetime:

```text
open coordinator
    -> recover old owned state
    -> start and acknowledge the exact Service Mount
    -> run Root A to a fixed point
    -> run Root B to a fixed point
    -> close new root and Service admission
    -> settle all owned operations and leases
    -> fence and finalize the Mount
    -> dispose the Root controller
    -> dispose the coordinator last
```

Root completion remains an ownership boundary. A Root cannot publish its
terminal until its child Flow operation, Journal operation, and every Service
invocation are durably closed and every owner-slot Service lease is released.
The shared generation may remain available for Root B after Root A closes;
Root closure does not by itself fence the Mount.

## 5. Mount fence and finalization are separate phases

The current Service substrate contains the durable facts required for both
phases, but mixed ownership makes their ordering observable. The controller
must not implement one monolithic `fence-and-release` operation.

### Fence

Fencing first closes Provider dispatch admission, settles or kills the
contained Provider tree, and records the exact Mount fence. The generation can
no longer accept a lease or invocation. Fence evidence is also the authority
needed to classify unresolved invocation work:

```text
never dispatch-admitted
    -> UNAVAILABLE

possibly dispatched without a trusted terminal
    -> UNCERTAIN
```

### Finalize

Only after every linked invocation has a durable closure and every linked
owner lease has a durable release may finalization release package backing and
owner state, record the Mount release, and close the Mount. Open leases forbid
release. An unresolved invocation forbids lease release. Cleanup failure is
surfaced rather than converted into a successful closure.

Normal shutdown drains the roots first, so their invocations and leases close
before the Mount is fenced and finalized. Provider or coordinator loss uses
the stricter recovery order:

```text
fence the old Mount
    -> classify and close unresolved Service invocations
    -> release owner leases and settle their Roots
    -> finalize and close the Mount
```

A Provider exit only triggers fencing and classification. It never authorizes
automatic restart, replacement, rebinding, or replay.

## 6. Minimal proof matrix

The vertical is complete only when executable evidence proves:

1. one exact admitted Bun counter Mount reaches acknowledged readiness before
   any lease or invocation is admitted;
2. Root A receives `1`, exact operation replay receives `1`, and Root B
   receives `2` through one pinned generation;
3. the Bun root completes one exact Python child call and one canonical
   Journal append in the same finite session;
4. unknown or wrong-kind slots, invalid Service methods or values, and changed
   operation reuse fail before unintended Provider mutation;
5. moving the project's current admission head cannot retarget a live Root's
   pinned Service lease or child-Flow resolution;
6. neither Root publishes a terminal before its child, Journal, invocation,
   operation-closure, and lease-release obligations are complete;
7. normal shutdown drains Roots, fences the Mount, finalizes it, and leaves no
   process, cgroup, private-device, package, or owner-state residue;
8. loss before dispatch admission becomes `UNAVAILABLE`, while loss after
   possible dispatch without a trusted terminal becomes `UNCERTAIN`, with no
   redispatch or transparent rebinding;
9. coordinator replacement recovers in fence -> invocation closure -> lease
   and Root settlement -> Mount finalization order; and
10. the existing direct Run, deterministic child-Flow, Journal, Plan/2,
    foreground, Service-hosting, and hostile containment checks remain green.

The proof may use sequential roots and one Service generation. It need not
establish parallel Root ordering or Service linearizability.

## 7. Explicit exclusions and stop conditions

This vertical does not add:

- a persistent project supervisor, daemon, watcher, or automatic restart;
- Service dependencies, project-wide startup ordering, shadow replacement,
  migration, state recovery, or hot rebinding;
- Semantic Choice, Agents, Hooks, Jig Graph, or Sley;
- a generic effect registry, dynamic Service catalogue, or package-selected
  Provider generation;
- callbacks, subscriptions, streams, or Provider-selected exports;
- new Root Administration methods or a portable way to administer Services;
- public coordinator, Service host, Runtime Adapter, or Sandbox Backend APIs;
  or
- a claim that the counter's process-local state survives Provider loss.

Stop and report the exact blocker instead of widening the slice if completion
would require:

- resolving a live owner against the current admission head;
- replaying possibly dispatched work;
- restarting or rebinding after Provider exit;
- releasing a Mount with open invocations or leases;
- combining Mount fence and finalization in a way which hides their ordering;
- weakening the proved cgroup-v2/Bubblewrap security or cleanup contract;
- exposing trusted host controls to package code; or
- inventing a public abstraction from this one private mechanism.

The selected boundary is:

> Prove one finite, pinned, mixed Root/child/Journal/Service composition and
> its complete normal and loss ownership order. Do not generalize it into a
> supervisor or provider platform.
