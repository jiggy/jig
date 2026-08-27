# Deterministic child-Flow closure

**Status:** closed on 2026-08-27. The private vertical proof selected in
[`143-deterministic-child-flow-slice.md`](143-deterministic-child-flow-slice.md)
now passes focused, cross-language, package, and privileged hostile gates. This
checkpoint selects no succeeding phase and publishes no new interface.

## 1. Closed boundary

The completed path is deliberately narrow:

```text
one admitted Bun Run Binding
    -> one exact `flow/call` slot
    -> one admitted Python direct Flow in the same generation
    -> child Run/1 result admission
    -> parent Run/1 completion
    -> confirmed child and parent fences
    -> complete protected-backing cleanup
```

The child target is resolved only from the closed target set stored with the
parent's pinned admission candidate. Runtime planning reproduces the exact
admitted child recipe against current authenticated host evidence. It never
consults visible source, a current catalogue, a later admission generation, an
Agent, or an ambient runtime.

This first proof permits one distinct child operation. Repeated equal calls
join or replay it. A second distinct operation is refused. The limit is a
private proof bound, not portable FLOW vocabulary or a claimed scheduler API.

## 2. Deterministic resolution and refusal

Before child package execution, the controller proves all of the following:

- the slot exists on the admitted parent Binding;
- it contains exactly one direct-Flow target;
- the target belongs to the same closed candidate generation;
- the child request, recipe, and host observation reproduce their admitted
  digests;
- the child input satisfies the protected Package/1 input schema; and
- the exact child recipe is available on the current host.

Missing, wrong-kind, multi-candidate, unavailable, and schema-invalid calls
therefore fail without child admission. The proof does not silently rank,
repair, fall back to instruction mode, or select a newer target.

## 3. Operation semantics

Run/1's existing operation contract remains authoritative. The private host
now realizes it for one child Flow:

```text
first operation ID + canonical params
    -> one durable allocation and dispatch

same ID + same params while pending
    -> join one operation

same ID + same params after settlement
    -> replay one terminal

same ID + different params
    -> OPERATION_CONFLICT, no redispatch

second distinct operation in this proof
    -> RESOURCE_EXHAUSTED, no dispatch
```

Cancelling one waiter does not cancel shared work while another waiter remains.
Cancelling the final waiter requests cancellation of the child owner. Parent
cancellation, deadline, channel loss, or coordinator loss also closes every
waiter and begins exact child recovery.

## 4. Durable ownership and ordering

The implemented child lifecycle is monotonic:

```text
allocation
    -> plan
    -> retained package backing
    -> sealed Backend owner
    -> prepared admission
    -> provisional Run/1 terminal
    -> confirmed complete-tree fence
    -> backing and owner-state release
    -> protected result admission
    -> child closure
    -> parent may publish its terminal
```

The parent root Run is the durable owner. Its effective absolute deadline is
also the child's upper bound; the child may narrow it with its admitted recipe
ceiling but cannot extend it. Parent settings, attachments, slots, scratch,
and filesystem authority do not flow into the child.

An older coordinator's child work is never redispatched. A replacement
reacquires the recorded allocation, fences an admitted sandbox when one
exists, cancels an unadmitted owner allocation when it does not, releases the
exact package backing, closes the child, then classifies the parent as
`COORDINATOR_LOST` unless an independently proved terminal already exists.
Unconfirmed fencing keeps the parent pending.

## 5. Boundary validation

The protected child Package/1 snapshot owns both input and result admission.
A clean child success reaches the parent only when:

- its outcome is `done` or one declared package outcome; and
- its complete `{ outcome, output }` value satisfies `result.schema.json`
  when present.

Protocol failure remains `EXECUTION_FAILED`; invalid declared outcome or
result shape becomes `INVALID_RESULT`; cancellation and deadlines retain their
own classifications. No validation rereads visible project source.

## 6. Executable evidence

The closure corpus proves every item selected in review 143:

- real contained Bun-to-Python invocation and returned domain data;
- same-generation exact-slot resolution;
- pending joins, settled replay, operation conflict, and second-operation
  refusal;
- missing, wrong-kind, multiple, unavailable, and invalid-input refusal;
- child protocol, undeclared-outcome, and result-schema failure;
- one-waiter and final-waiter cancellation;
- parent cancellation and deadline before child Backend admission and after
  child preparation;
- parent pending while a prepared child has no fence, followed by a terminal
  only after the child fence exists;
- coordinator `SIGKILL` before child Backend admission and after preparation;
- exactly one child closure and no automatic redispatch after either uncertain
  completion boundary; and
- zero cgroup, process, private-device, owner-state, and package-materialization
  residue after repeated Runs and recovery.

Observed release evidence:

- focused composed lifecycle proof: 1 test, 56 assertions;
- complete privileged Linux matrix: 24 tests, 268 assertions;
- ordinary Bun, Jig, Run/1, and Service/1 matrix: 570 passed, 24 privileged
  cases skipped, zero failures, with the exact authenticated leased Python
  executable on the proof process's `PATH`;
- Python FLOW SDK: 40 passed;
- independent Python Run/1 peer: 21 passed;
- TypeScript package smoke and Python wheel/source-distribution build-install
  smoke: passed; and
- independent post-suite scan: zero Jig cgroups and zero Jig private-device
  directories.

The proof host intentionally has no ambient Python. An initial broad invocation
without the administrator-leased Python path produced only Python peer startup
timeouts; the exact authenticated lease corrected the invocation. Product code
was not changed to search Nix paths or fall back to `PATH`.

## 7. Deliberate implementation limits

The root and child controllers currently contain similar lifecycle steps. They
remain separate private implementations because there are only two owners and
their allocation, result, and recovery semantics differ. A shared execution
owner abstraction is justified only after a third real owner or measured drift
demonstrates one; this phase does not extract a public scheduler or Backend
interface to remove cosmetic duplication.

The hostile test also preserves the Backend's rejection of subclasses and
method shadowing. Lifecycle ordering is observed through durable facts and real
package timing rather than a test-only interception hook.

## 8. Preserved exclusions and phase boundary

This closure did not add:

- `effect/call`, the Journal, Events, Hooks, or host capability providers;
- semantic ranking, Agents, skills, instruction fallback, or repair Flows;
- recursive composition or several distinct concurrent child operations;
- durable Service generations or capability Bindings;
- public child-Run administration, project opening, transport,
  authentication, list/watch/cancel, or plan/apply;
- public Runtime Adapter, Sandbox Backend, dispatcher, operation-store, or
  scheduler interfaces;
- Sley or Jig Graph; or
- Nix lifecycle or ambient-runtime behavior.

The deterministic child-Flow slice is complete. Completion is a reporting
boundary, not authority to choose the next subsystem.

