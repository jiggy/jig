# Private root Flow-call filtering checkpoint

**Status:** accepted on 2026-08-29 as one deliberately narrow private
checkpoint. It closes invocation-local filtering for direct Flow targets in a
retained admitted slot. It does not yet dispatch the selected child.

## 1. Boundary proved

The Resolver consumes only:

```text
one reacquired parent owner
    + that owner's pinned Candidate/5 and Activation Request/2
    + one Run/1 flow/call value
    + retained Package/1 artifacts
```

It never consults visible source, the current admission head, or a live
catalogue. It recognizes the retained slot source as exactly `exact`,
`candidates`, or `project-run-targets` and preserves that source in its result.

For this checkpoint it filters the complete frozen target set by:

- the active parent owner itself;
- exact admitted readiness;
- the supported direct-Flow target kind;
- retained Package/1 provenance and direct-Run eligibility; and
- for broad sources only, actual input compatibility.

It returns one closed value:

```text
selected     one exact admitted direct Flow target
missing      no supported compatible target
ambiguous    the complete canonical survivor set
```

Rejection evidence distinguishes active ownership, unavailable disposition,
unsupported target kind, and input incompatibility. No candidate is sampled,
retrieved, ranked, truncated, or replaced. The 4,096-target aggregate boundary
is consumed in full.

## 2. Exact and broad calls deliberately differ

An exact call does not prevalidate child input in the Resolver. The existing
durable child path first allocates the operation and then admits its protected
input. Preserving that order is necessary for exact replay, changed-use
conflict, and no-redispatch semantics.

Broad `candidates` and `project-run-targets` sources use input compatibility
only to decide which candidate may be selected. `INVALID_INPUT` rejects that
candidate. Schema work exhaustion is not incompatibility: it closes the
resolution attempt as `RESOURCE_EXHAUSTED`.

## 3. Protected and operational failures remain different

The Resolver requires a stored Candidate envelope. Missing or corrupt retained
Package/1 bytes and disagreement between the admitted request and fresh package
inspection are protected-state corruption. Transient host I/O and resource
exhaustion remain sanitized operational failures. An absent or wrong-kind
package-controlled slot is ordinary `missing`, not corruption.

Captured package handles are disposed immediately after inspection. Only the
detached inspection value is cached by package digest, so consuming the maximum
target set does not retain thousands of descriptors. Target lookup uses one
canonical map rather than rescanning the Candidate per target.

## 4. Evidence

The focused shard passes:

```text
private root Flow-call filtering       7 tests, 25 assertions
complete project expansion             4,096 targets, no truncation
TypeScript build                        passed
diff check                              passed
```

The maximum-set fixture intentionally exercises retained store, Plan, apply,
admission, root allocation, and reacquisition. Its cost is accepted as
boundary evidence rather than hidden by a synthetic Resolver-only fixture.

## 5. Explicitly still open

This checkpoint does not prove:

- configured Run-Binding targets;
- a persisted complete ancestor-owner chain;
- current recipe, authority, resource, liveness, or wait-graph filtering;
- durable ownership of a broad routing decision;
- child allocation, dispatch, cancellation, deadline, fencing, or recovery;
- Semantic Choice; or
- public `projectRunTargets()` authoring.

The next checkpoint may integrate only the selected direct-Flow result into
the existing durable child controller. Missing and ambiguity must remain
closed pre-dispatch outcomes. Settings-bearing Bindings and semantic ranking
stay separate gates.
