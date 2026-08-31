# Canonical rootless execution mechanism

**Status:** completed on 2026-08-31 for the private Linux alpha mechanism.

## Decision

Jig now has one execution mechanism: an unprivileged cgroup-v2 owner combined
with rootless Bubblewrap. The previous privileged helper path and the earlier
standalone rootless prototype are deleted rather than retained as fallbacks.

The private backend acquires only the exact delegated authority recognized by
review 200. It seals immutable launch inputs and mount identities, creates one
Run cgroup, configures CPU, memory, and PID controls before admission, and
starts a detached cleanup supervisor. The entry trampoline places itself in
the Run cgroup before the same process starts Bubblewrap. Package code receives
no writable cgroup view, host process view, network namespace, ambient
environment, host-control channel, or privileged executable.

The cleanup supervisor owns the Run independently of the coordinator. Every
terminal path kills the complete cgroup, waits for `populated 0`, reads
aggregate enforcement evidence, removes the empty cgroup, and only then
publishes a durable fenced receipt. A missing receipt while an active owner is
recorded remains unconfirmed; Jig does not infer success or redispatch.

The first alpha deliberately permits one foreground Run at a time. The
inherited delegated parent must remain exclusive. This is a product limit, not
a public Backend interface.

## Evidence

The combined rootless corpus passes 12 tests and 36 expectations. It covers:

- an isolated payload and a real Run/1 component;
- protected mount, cgroup visibility, migration, and nested-user-namespace
  denial;
- cancellation during admission, active execution, and shutdown;
- PID exhaustion and aggregate descendant memory exhaustion;
- CPU throttling plus an independent hard wall-clock deadline;
- orphaned grandchildren;
- complete coordinator death;
- repeated Runs; and
- zero Run cgroups, rootless control/owner directories, and private device
  directories after the corpus.

The supervisor boundary adds four fail-before-mutation cases for an absent
start message, malformed limits, owner/configuration mismatch, and duplicate
active claims. The absent-start case proves that the detached supervisor owns
a bounded startup deadline and exits without a claim or cgroup when its
coordinator connects but never transfers ownership. The durable owner-state
corpus adds four cases for cancellation, conflict preservation, interrupted
release, and idempotent release. The package TypeScript build passes after all
production consumers moved to the rootless contract.

## Removed surface

The same replacement deletes:

- the privileged cgroup backend;
- its helper, launch wrapper, recovery helper, preflight script, hostile suite,
  and coordinator fixtures;
- the earlier parallel rootless runner; and
- the development-sandbox-specific runtime-support observer.

Runtime support is now one generic private observation of exact, retained,
read-only host bytes. Development tests may translate their host's bounded
evidence into that observation, but shipped runtime code has no dependency on
the development sandbox or its package manager.

## Boundary

This checkpoint completes the mechanism replacement only. It does not prove
that project evaluation and retained native preparation fit their current
resource policies, create an installed host, publish a Backend registry, add a
second operating system, or release an alpha. Those are separate gates.
