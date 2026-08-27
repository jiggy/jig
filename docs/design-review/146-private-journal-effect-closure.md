# Private canonical Journal effect closure

**Status:** closed on 2026-08-27. The first host-native `effect/call`
vertical now passes focused storage/dispatch tests and a real privileged Bun
Run. This checkpoint does not close Hooks, Services, generic host-capability
registration, or a public Journal inspection API.

## 1. Closed boundary

One admitted Run Binding may request the exact canonical Journal contract and
map that slot to one admitted `defineJournalPublisher` declaration. The
publisher fixes both the authenticated `binding:<LocalName>` source and one
finite exact Event-type ceiling. The protected consumer Package/1 snapshot,
the candidate, and the portable lock must all reproduce the canonical
contract identity before Jig dispatches `append`.

The implementation is deliberately not a provider plugin. Jig owns this one
kernel operation directly:

```text
Run/1 effect/call
    -> pinned capability slot
    -> protected contract input validation
    -> publisher/type authority check
    -> one atomic Journal transaction
    -> protected contract output validation
    -> unwrapped Event returned to the component
```

Other contracts, methods, exports, provider implementations, and protected
Jig lifecycle Event types remain unavailable.

## 2. Durable operation semantics

The project Journal and root-operation records share the activation SQLite
owner. For each accepted append, one `BEGIN IMMEDIATE` transaction commits:

```text
monotonic project-local Event position and Event bytes
root Run + operation ID allocation
effect result terminal
Hook-selection completion
append closure
```

The same parent Run, operation ID, and canonical call returns the original
Event. Reusing the ID with different call bytes returns
`OPERATION_CONFLICT`. A different operation ID allocates another Event and
position. The private implementation bounds one Run to 65,536 committed
Journal operations, matching the Run/1 channel request domain; this limit is
not new portable FLOW metadata.

Every read revalidates canonical bytes, domain-separated digests, parent and
coordinator ownership, the pinned candidate, publisher authority, Event
identity, terminal, selection, and closure. Corruption never becomes a
plausible replay.

## 3. Parent ownership and recovery

Before publishing or recovering the parent terminal, the root controller
reopens every committed append, revalidates it against the protected package
contract, and records one deterministic aggregate closure digest over the
complete operation set. The empty set has its own digest. RunHostSession
already prevents a normal root response while owned operations remain live;
the durable aggregate closes the restart boundary.

A coordinator killed after the append transaction but before replying or
publishing the parent terminal never redispatches the append. A replacement
reopens the committed operations, fences the package tree, and classifies the
unproved parent result honestly as `COORDINATOR_LOST`. A transaction which did
not commit leaves no Event or operation terminal.

The Hook-selection record is intentionally empty in this checkpoint. Its
atomic presence proves the transaction seam needed by Hooks; it does not claim
Hook admission, interval selection, or derived Runs already exist.

## 4. Earned recipe widening

The real proof found that the private Bun planner still encoded the previous
child-Flow phase's one-slot restriction. It now accepts exactly either:

- one previously proved direct-Flow call slot; or
- one exact canonical Journal capability slot.

It does not admit arbitrary effects, multiple capability slots, Services,
Agents, or a generic provider registry. Later verticals must earn their own
planner widening.

## 5. Executable evidence

The focused corpus proves multiple appends, monotonic positions, exact replay,
changed-parameter conflict, load/list recovery, authority refusal, protected
namespace refusal, contract input/output validation, aggregate closure
identity, and tamper detection.

The privileged proof uses one real contained Bun package and proves:

- two Event positions and an identical replay;
- `OPERATION_CONFLICT`, `PERMISSION_DENIED`, and `INVALID_INPUT` refusal;
- authenticated source stamping;
- two durable append and closure records;
- parent release bound to the aggregate Journal closure;
- coordinator `SIGKILL` after both commits followed by recovery without a
  third append; and
- zero cgroup, private-device, materialization, and owner-state residue.

Observed gates were a passing TypeScript/package build, full cgroup capability
preflight, seven focused dispatcher/state tests, the focused durable-store
tests, and one privileged hostile case with 15 assertions in 57.4 seconds.

## 6. Preserved exclusions

This checkpoint adds no public Jig control-plane member, Runtime Adapter or
Sandbox Backend SPI, generic capability-provider SPI, Journal query/stream
surface, Event Source ABI, Hook callback, Service generation, Agent provider,
Semantic Choice, Sley graph integration, or Nix lifecycle behavior.

The next Hook slice must replace the empty selection with admitted interval
selection and actual derived Run allocation in this same transaction. It must
not reinterpret an Event listener as a Hook or synthesize external submission
IDs for derived Runs.
