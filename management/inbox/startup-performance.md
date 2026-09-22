# Reduce ordinary startup and settlement overhead

Status: post-launch optimization. Current failing release gates are not deferred
by this task.

## Proposed scope

Measure an installed deterministic conversation on a documented supported host,
separating configuration evaluation, dependency preparation, containment startup,
durable ownership, actual work and settlement. Choose one demonstrated dominant
cost and a measurable target before changing its implementation.

## Completion

Comparable before/after measurements meet the selected target with unchanged
authority, deadlines and cleanup guarantees. Public diagnostics distinguish
known failure phases without exposing private state.

## Exclusions

No blanket timeout increases, retries of uncertain work, telemetry framework or
claim that a single host-pressure sample explains historical failures. Existing
release-blocking failures must be addressed before merging, not parked here.

Owners follow the measured phase; begin with the existing evaluator, compiler,
materialization and lifecycle boundaries rather than a new subsystem.
