# Expected Cordis failure walkthroughs

## Missing Timer dependency

If native preparation cannot resolve the pinned Cordis packages, the Service
is unavailable before launch. If Timer fails during realm activation, the
bridge remains pending and the FLOW Mount fails its readiness deadline. Jig
does not synthesize a timer provider.

## Duplicate timer ID

The outer effect operation supplies retry idempotency. A different operation
attempting to reuse the same timer ID receives `timer-conflict`. Timer IDs are
single-use within one Mount so Journal operation IDs cannot alias.

## Provider loss

Every pending timer disappears with the provider process. Existing scheduler
Bindings become lost. Restart creates an empty realm and new export generation;
it does not replay or recover timers.

## Publication uncertainty

If the timer callback dispatches Journal append but cannot prove its result,
the timer record becomes `uncertain`. The provider never appends again under a
new operation ID. Provider loss may erase that in-memory diagnostic, but Jig's
operation ledger retains the uncertain Mount-owned effect.

## Disposal failure

Jig trusts neither process EOF nor Cordis disposal alone as OS fencing proof.
The Sandbox Backend still terminates and proves cleanup of the complete process
tree. A Cordis disposer error is recorded, cleanup continues, and the old
provider generation never remains callable.

## Replacement

Because a Hook selects the scheduler as Event source, old source authority is
drained and fenced before the Hook interval switches and replacement starts.
Pending timers are intentionally cancelled rather than migrated.

