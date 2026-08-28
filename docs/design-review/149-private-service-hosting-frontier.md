# Private Service-hosting frontier

**Status:** closed on 2026-08-28 at the private Service-hosting substrate
boundary. The real Root-to-Service invocation witness described below remains
deferred until an admitted Run can carry the required capability-backed effect
slot. The exact disposition and executable evidence are recorded in
[`151-private-service-hosting-checkpoint.md`](151-private-service-hosting-checkpoint.md).
This record does not publish a Service controller, Runtime Adapter, Sandbox
Backend, provider registry, or new Root Administration method.

## 1. Why this is the next Service proof

Run/1 already proves finite work. Service/1 earns its separate lifecycle only
if one admitted process can retain state across independently owned calls. The
smallest useful witness is therefore one process-local counter, not an echo
provider and not a database:

```text
one admitted Bun Service Binding, with `uses: {}`, and one generation
    -> Root A invokes counter.next and receives 1
    -> exact operation replay receives 1 without another increment
    -> Root B invokes the same generation and receives 2
    -> provider loss ends that state and fences its generation, leases,
       and unresolved invocation work
```

This proves Mount lifetime, generation identity, invocation idempotency, and
honest loss without implying durable application state, transparent restart,
or live replacement.

## 2. Service means a long-lived component, not necessarily an RPC server

Service/1 permits zero through 256 fixed exports. An empty set is explicit
readiness for a watcher, timer, or ingress component whose useful work is
Mount-owned. It is not a second Component or EventSource profile and it does
not weaken Capability Contract/1: every capability that is exported still has
its exact nonempty method contract.

The authoritative model remains eager reconciliation of explicitly authored,
admitted, `READY` Service Bindings; discovery alone executes nothing. This
first proof exercises exactly one Binding with `uses: {}`. It
does not yet prove project-wide topological startup. Eagerness is a supervisor
rule after admission; package code never runs inside the admission database
transaction.

Lazy activation is excluded because a zero-export producer has no first
invocation, and concurrent get-or-create/dependency races add machinery the
first proof does not need.

## 3. Private ownership model

The project coordinator owns these durable private identities:

```text
Mount allocation
    exact Binding + admission generation + package/recipe observation

Provider generation
    one acknowledged service/ready incarnation of that Mount

Lease
    one admitted consumer slot pinned to one provider generation

Invocation
    owner Run + operation ID + exact export/method/input

Invocation closure
    one terminal result or honest uncertain/lost result
```

The Mount state is durable before package bytes execute: allocation, exact
Binding/admission/candidate/recipe/lifetime, spawn intent, Backend lifecycle,
readiness observation, fencing, release, and closure are separate evidence.
Coordinator loss fences the old Mount before any later attempt. This slice
makes at most one Mount attempt for its admitted Binding and does not
automatically restart it after loss.

Readiness has an explicit crash boundary. Jig validates the fixed export set
and durably allocates one fresh generation as part of accepting the readiness
observation. It then serializes and flushes the `{}` acknowledgement. Only
after that flush may the generation become lease- or invocation-admissible.
Failed or ambiguous acknowledgement delivery admits no lease and fences the
already allocated generation. Loss after acknowledgement may have been
observed by the Provider; Jig fences the generation rather than inferring
readiness after restart.

The process remains inside the same private cgroup-v2/Bubblewrap security
contract as a Run, with a host-controlled finite lifetime ceiling. At that
ceiling Jig closes admission, cooperatively cancels the Mount, and awaits its
bounded owned work, successful mount result, clean EOF/exit, fencing, and
Backend cleanup. That is clean host-driven closure. A crash, protocol or
unclean exit, ambiguous acknowledgement, or unconfirmed fence is provider
loss. Service/1 does not promise an immortal daemon.

Package code receives no coordinator epoch, generation ID, cgroup, runtime,
launcher, host path, or privileged control channel. Root Administration
remains `startRun` plus `runStatus`; portable callers reach a Service only
through an admitted effect slot.

## 4. Invocation and recovery rules

The first dispatcher accepts exactly one admitted Capability Contract export
and method through each Root's exact effect slot. It validates the complete
input before dispatch and the complete tagged result after return. A durable
owner+slot lease pins one acknowledged generation before the invocation is
allocated. While a generation is starting or after it is lost, a new call gets
an exact `UNAVAILABLE`; Jig does not wait ambiently, select a newer Provider,
or retry.

An invocation records allocation before wire dispatch and durably records its
dispatch-admission/possible-dispatch fact before the first `service/invoke`
request byte can reach the Provider. That fact is bound to the exact owner,
slot, generation lease, export, method, and input. It records its durable
terminal before returning that terminal to the Run, and its operation closure
and owner-lease release before the parent may publish its own terminal. Loss
before dispatch admission is `UNAVAILABLE`; loss after dispatch admission
without a trustworthy terminal is `UNCERTAIN`.

The invocation deadline is allocated by the host at the first durable
allocation, persisted, and reused by join and replay. It is neither recomputed
nor part of caller replay equality. Replay equality remains the call kind,
slot, method, and canonical input.

```text
same owner + operation ID + same canonical request
    -> same durable terminal or same pending owner

same owner + operation ID + different request
    -> OPERATION_CONFLICT

dispatch may have happened but no terminal is durable
    -> honest provider/coordinator loss; never automatic replay
```

Provider loss fences the generation, every lease, and unresolved invocation.
It does not silently rebind existing owners. A later replacement is outside
this slice: compatible shadow-first publication and incompatible
drain-before-start remain authoritative requirements, not behavior inferred
from this one process.

Normal success or a cooperatively settled invocation cancellation does not
fence the Provider generation. It requires the invocation's durable terminal
or classification, invocation-operation closure, and owner-lease release,
leaving the eagerly reconciled Mount available to later owners. Generation
fencing is required for Provider loss, Mount cancellation or final closure,
or invocation cancellation or uncertain work whose quiescence cannot be
proved within host policy.

The Root A, replay, and Root B calls in this witness are sequential. Their
`1 -> 2` result demonstrates this counter Provider's process-local behavior;
it does not add a serialization or linearizability promise to Service/1.

## 5. Refusals and stop conditions

The proof stops rather than broadens if it would require:

- weakening the existing Linux containment or removing its hard lifetime;
- replaying a possibly dispatched invocation;
- exposing a public Adapter, Backend, provider registry, or launcher shape;
- adding Service methods to Root Administration;
- dynamic dependencies or exports, provider-selected generations, callbacks,
  subscriptions, streams, or state migration;
- general dependency ordering, automatic restart, shadow activation, or hot
  replacement; or
- claiming that process-local counter state is durable.

Directly submitting a Service target as a root Run remains a deterministic
refusal. Run/1 and its smaller conformance claim do not wait for Service/1.

## 6. Original proof gates

The private vertical must prove:

1. the already closed zero-export SDK/Host/cross-language regression remains
   green, without claiming a useful producer implementation;
2. one exact admitted Bun Service Binding with `uses: {}` records its Mount
   intent before package execution, durably allocates one generation while
   accepting readiness, acknowledges readiness once, and opens lease and
   invocation admission only after the acknowledgement flush;
3. Root A receives `1`, its exact operation replay receives `1`, and Root B's
   independently scoped operation receives `2` through the same generation;
4. owner+slot leases pin exactly one generation, and conflicting operation
   reuse fails without another mutation;
5. complete contract input and tagged result validation, fixed exports,
   host-owned deadline, invocation cancellation, and no invoke-before-ack;
6. normal success or cooperatively settled invocation cancellation waits for
   durable terminal/classification, operation closure, and owner-lease release
   without fencing the shared generation; Provider loss, Mount cancellation
   or final closure, or invocation cancellation/uncertain work whose
   quiescence is unproved additionally requires generation fencing;
7. startup cancellation, readiness timeout, clean host-driven lifetime
   closure, clean voluntary exit, Provider crash/loss, coordinator loss, and a
   possibly dispatched invocation are classified distinctly without replay,
   restart, or transparent rebinding;
8. generation fencing and repeated hostile cleanup leave no descendant,
   cgroup, private-device, or materialization residue; this one-attempt,
   no-replacement slice never overlaps two generations, without weakening the
   later shadow-first replacement requirement; and
9. no public control-plane or host-extension interface grew to support the
   witness.

The hosting, generation, lease, invocation-state, and recovery parts of these
gates are now proved. The live Root A/replay/Root B path through a contained
Mount is not: the current admitted direct-Run recipes correctly reject the
capability-backed Binding needed to reach that Service. Rather than add an
unreachable controller or silently widen effect dispatch, the checkpoint
stops at that exact boundary. Development may proceed to the smallest local
project control plane without claiming end-to-end Service invocation. The
later mixed-effect vertical must re-use these durable records and complete the
stateful counter witness before Jig can claim a real Service consumer path.
