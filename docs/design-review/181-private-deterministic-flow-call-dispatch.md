# Private deterministic Flow-call dispatch checkpoint

**Status:** accepted on 2026-08-29 after focused retained-store review and one
real cgroup-v2/Bubblewrap composition witness. This closes deterministic
direct-Flow dispatch from an exact or broad pinned slot into the existing
single-child lifecycle. It does not close configured child Bindings or
Semantic Choice.

## 1. Selection and execution now meet at one narrow seam

The parent Runtime Adapter pins the complete admitted Flow-call slot as
authority but does not choose a target. At invocation time the deterministic
Resolver consumes only the parent Run's pinned Candidate and retained
Package/1 artifacts.

```text
missing survivor      -> Run/1 UNAVAILABLE, no child allocation
one survivor          -> durable child allocation, then existing lifecycle
several survivors     -> Run/1 UNAVAILABLE, no child allocation
```

There is no live-catalogue lookup, current-head read, semantic ranking,
sampling, truncation, or fallback. The existing Run/1 wire has no public
`BINDING_MISSING` or `BINDING_AMBIGUOUS` codes, so both deterministic
pre-dispatch states remain sanitized `UNAVAILABLE` operations in this private
host.

## 2. The durable boundary remains authoritative

The allocation store independently reopens the parent's Candidate revision
and verifies:

- the selected target is an exact member of the retained caller slot;
- the target is READY and is a direct Flow supported by this host;
- the target is not the active parent owner; and
- request, recipe, and observation identities exactly match admission.

The Resolver cannot manufacture execution authority merely by returning a
value. A nonmember, configured Binding, active parent, or recipe mismatch is
refused by the durable layer even if an earlier filter were wrong.

An exact source still allocates before child input validation, preserving
operation replay and changed-use conflict. A broad source uses input
compatibility to choose, but the selected child is validated again after
allocation and before package execution. From that point the previously
proved cancellation, deadline, package backing, race-free sandbox admission,
fencing, result admission, release, coordinator-loss, and no-redispatch paths
are unchanged.

## 3. Contained evidence

```text
pure Resolver                         7 tests, 25 assertions
complete structural set               4,096 targets, no truncation
durable allocation authority          1 test, 12 assertions
contained composition                 1 test, 56 assertions
contained composition duration        432.877 seconds
TypeScript build and diff check        passed
residual Jig cgroups                   0
residual private device directories   0
residual child fixtures                0
host /dev/urandom                      character 1:9, mode 0666
```

The contained witness proves both a broad set reduced to one READY direct
Flow and a set with two compatible survivors. The former enters the existing
durable Python child lifecycle; the latter returns `UNAVAILABLE` to the Bun
parent without allocating a child.

## 4. Deliberate limits

This checkpoint does not add:

- configured Run-Binding child execution;
- attachments, child-owned effects, or nested child Flow calls;
- recursive orchestration or a complete persisted ancestor chain;
- Semantic Choice or a durable routing-decision owner;
- public `projectRunTargets()` authoring; or
- a new Run/1 error code.

Broad filtering is finite and bounded, but it currently observes operation
cancellation only after the complete scan. That can delay parent settlement
for an expensive maximum-set filter, although no package code is dispatched
during the scan. This is explicit follow-up debt, not a reason to weaken the
completed authority and lifecycle proof.

The next safe product slice is a configuration-only Run Binding: immutable
settings, no attachments, and no slots. Capability-bearing children wait for
a real provider and a child-owned durable effect path.
