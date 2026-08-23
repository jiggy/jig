# Expected writable-Service replacement

This walkthrough is the probe's main challenge to the current architecture.

## Why shadow-first is unavailable

Both old and candidate `document-index` Mounts request `read-write` access to
the same `./index` attachment. Jig's authority model requires one exclusive
writer lease. Mounting the candidate before fencing the old process would
either violate that lease or require an application-specific shared-state
coordination protocol which the package did not declare.

## Required sequence

```text
admit desired replacement
    -> stop new consumer leases to old generation
    -> drain existing old leases/invocations to deadline
    -> cancel and fence old Mount
    -> prove process-tree cleanup and writer-lease release
    -> atomically switch admission and Hook intervals
    -> prepare and mount replacement
    -> replacement validates/adopts state and drains outbox
    -> replacement publishes ready export generation
    -> admit new consumer leases
```

The service is visibly unavailable between old fencing and replacement
readiness. Opening the replacement Hook interval before startup lets pending
outbox publication produce an admitted Event without a second activation
signal. If the replacement fails, Jig records it unavailable. The old process
cannot be resurrected because its owner and fencing epoch ended. Rollback is a
new admitted activation of old package source.

## Simplification opportunity

Service replacement should distinguish only what authority already proves:

```text
coexisting attachment/resource leases are enforceable
    -> shadow-first rollout is permitted

leases conflict
    -> drain/fence-first rollout is required
```

FLOW needs no migration callback or replacement protocol. A provider which
requires online migration must expose an application-specific capability and
use independently isolated state. Jig merely follows enforceable lease
compatibility.

## Failure cases

- Drain deadline expires: fence old generation, record affected invocations,
  and continue only after cleanup is proven.
- Old provider has an uncertain Journal effect: preserve that ledger evidence;
  candidate outbox replay may create an additional Event under its new source.
- Candidate cannot parse state: candidate fails readiness; do not mutate or
  delete the source tree implicitly.
- Cleanup cannot be proven: keep the writer lease fenced and block candidate
  mount rather than assuming the old writer died.
