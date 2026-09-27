# Reduce ordinary startup and settlement overhead

Status: measured; the bounded opt-in profile completed on Ubuntu 24.04 x86-64.
No runtime optimization or before/after improvement is established. The
installed-evidence shard can run the profile manually on Ubuntu 24.04 x86-64 from the exact frozen Jig
and FLOW archives; its results do not gate the normal host check.
The source trace now separates support verification, evaluator envelope startup,
execution/settlement and workspace capture within planning. These narrower spans
have not yet been measured on that host; no speedup is claimed.

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

The current profile is diagnostic only: one warmup and five sequential
fresh-project trials on a warm host. Package and fixture setup are excluded;
phase spans may overlap. It cannot establish an improvement until a comparable
before/after target is selected and measured.
