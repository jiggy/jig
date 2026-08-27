# Private project coordinator fencing

**Status:** implemented release-gate checkpoint. Root Run submission and
completion now require one process-held project coordinator generation. The
boundary remains private and does not yet freeze a daemon, administration API,
or multi-host lease protocol.

## 1. One local owner

The coordinator opens a dedicated owner-only SQLite database under protected
`.jig` state and holds `BEGIN EXCLUSIVE` for its complete lifetime. A second
coordinator fails closed with `COORDINATOR_BUSY`. Process death closes the
database descriptor and releases the kernel-managed SQLite lock; there is no
PID polling, stale lockfile removal, timeout-based lease stealing, or reliance
on orderly shutdown.

The lock database is not the durable project record. It is a local ownership
mechanism with a closed schema and verified path identity. Shared/network
filesystems are unsupported because their lock semantics are outside this
proof.

## 2. Monotonic epoch and takeover

The protected activation database advances to private schema version 6. A
single `coordinator_head` row stores a monotonic safe-integer epoch, and every
new root Run and spawn intent records the epoch which created it.

After taking the exclusive lock, a coordinator advances the epoch and, in the
same durable state transaction, converts every unresolved older-epoch spawn
intent to:

```text
lost / COORDINATOR_LOST
```

Only then is coordinator authority returned. A Run from the newly allocated
epoch cannot exist before takeover completes, and a persisted future epoch is
corruption. Successful work is never inferred or replayed after an unknown
coordinator state.

## 3. Authority boundary

Coordinator objects are invocation-local authenticated values. Root
submission verifies the live lease before and inside allocation. Launch
authority embeds the exact coordinator, Run epoch, admission, candidate, and
spawn intent. Execution verifies the lease before package code starts, and
terminal publication verifies it again. A disposed or replaced coordinator
therefore cannot publish a late terminal.

The cgroup-v2 helper remains the resource owner across coordinator `SIGKILL`;
the SQLite lease owns project admission, not process-tree cleanup. Replacement
combines the two facts: the old tree is fenced by the Backend and the old Run
is durably classified by its new coordinator.

## 4. Proof

- Two coordinator connections cannot own one project concurrently.
- Releasing the first lease permits a second generation and increments the
  epoch exactly once.
- A replacement automatically reconciles an older unresolved root intent.
- Old launch authority fails after replacement.
- The proof-host case kills a coordinator process after durable spawn intent,
  reacquires the project lease, and observes `COORDINATOR_LOST` before further
  admission.
- Existing hostile Backend tests continue to prove descendant fencing and
  zero resource residue independently of SQLite.

## 5. Deliberate boundary

This checkpoint fences the implemented root-Run path. The raw private
candidate/plan/apply functions remain construction evidence, not a released
administration surface. Before public release, one controller must own those
mutations behind the same coordinator and an independent consumer must use
only the proposed public plan/apply/start/status/error subset.

Reviews 138 and 139 subsequently satisfy the controller and independent
start/status consumer gates. Plan/apply, authority issuance, transport, and
publication remain separate gates.

This is a single-host V1 mechanism. It is not HA consensus, distributed
leadership, a generic lease SPI, or permission for several Jig daemons to
share one project over a network filesystem.
