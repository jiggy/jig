# Phase 2 secure-root blocker

**Status:** verified host blocker on 2026-08-25. This is implementation
evidence, not a weakening of the reviewed security model or a portable
Sandbox Backend specification.

## Decision

Phase 2 cannot honestly publish a live secure Bun root Run on the current host.
The reviewed planning disposition is `SANDBOX_UNAVAILABLE`; this record does
not freeze a public error envelope or Backend API. Jig must not substitute an
advisory sandbox or issue an `enforced` receipt for predicates it cannot prove.

The first sufficient blocker is owner-wide resource control and fencing. The
current process is at the root relative to its visible cgroup namespace, but
the effective cgroup-v2 mount is read-only and no writable subtree is
delegated. Jig can therefore neither create a single-use per-owner resource
group nor enforce aggregate CPU, memory, and PID ceilings over an activation
root and all its descendants. This fact alone makes the current Backend
unavailable; it is not a claim that every other secure-Bun predicate is solved.

## Verified evidence

The host reports:

```text
/proc/self/cgroup:          0::/ (root relative to current cgroup namespace)
/sys/fs/cgroup mount:       effective cgroup2 layer is read-only
cgroup.controllers:         cpu io memory pids
cgroup.subtree_control:     empty and not writable
cgroup.procs:               not writable
outer cpu.max:              200000 100000
outer memory.max:           4294967296
outer pids.max:             512
effective capabilities:    0000000000000000
```

The decisive read-only checks are:

```sh
cat /proc/self/cgroup
grep ' /sys/fs/cgroup ' /proc/self/mountinfo
cat /sys/fs/cgroup/cgroup.controllers
cat /sys/fs/cgroup/cgroup.subtree_control
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/memory.max
cat /sys/fs/cgroup/pids.max
test -w /sys/fs/cgroup
test -w /sys/fs/cgroup/cgroup.procs
test -w /sys/fs/cgroup/cgroup.subtree_control
awk '/^CapEff:/ { print $2 }' /proc/self/status
```

All three writability checks fail. The listed CPU, memory, and PID values are
outer-container limits, not controls which Jig can subdivide or assign to one
Flow owner. Mount information contains covered lower mounts; the effective
final cgroup2 layer has read-only VFS flags.

The following mechanisms do not replace the missing owner controller:

- `RLIMIT_CPU` and `RLIMIT_AS` are per process, so descendants multiply the
  allowance;
- `RLIMIT_NPROC` accounts a real user rather than one Jig owner;
- a PID namespace groups and helps terminate tasks but does not aggregate CPU
  or memory;
- `/proc` polling has race windows and cannot support an enforced receipt;
- parent-death signals help cleanup but do not provide accounting; and
- Landlock and seccomp restrict operations rather than aggregate consumption.

A trusted daemon, service manager, container facility, or writable delegated
cgroup subtree could implement the missing predicates. No usable alternate
resource-controller broker was discovered in this execution context:
`systemctl`, `systemd-run`, `busctl`, `machinectl`, `podman`, `docker`, `runc`,
and `crun` are absent from `PATH`, and the standard systemd, D-Bus, Podman,
Docker, and environment-advertised Podman sockets are absent. This is scoped
negative evidence, not proof that a differently provisioned trusted broker
could not satisfy the predicates. A deliberately singleton Backend which
proves that a known runtime cannot create descendants could use hard process
limits, but that is a narrow Backend class and has not been proven for Bun.

The alternate-broker check used:

```sh
for command in systemctl systemd-run busctl machinectl podman docker runc crun
do
  command -v "$command" || true
done

for socket in \
  /run/systemd/private \
  /run/dbus/system_bus_socket \
  /run/user/1000/bus \
  /run/user/1000/systemd/private \
  /run/podman/podman.sock \
  /run/user/1000/podman/podman.sock \
  /var/run/docker.sock \
  /run/agent-container-api/podman.sock
do
  test -S "$socket" && echo "$socket present" || echo "$socket absent"
done
```

## Predicates which did work

Bubblewrap 0.11.0 successfully demonstrated:

- distinct user, mount, PID, IPC, UTS, cgroup, and network namespaces;
- a closed read-only filesystem; `--clearenv` removed the inherited
  environment and Bubblewrap supplied only deterministic `PWD=/`;
- denied host networking;
- `bun --version` startup from only the Bun 1.3.3 and glibc 2.40 Nix store
  trees with empty `/proc` and `/dev`; and
- the reviewed `root-process-mappings` view when the activation root is made
  PID 1 and `/proc/self/maps` is bound read-only at the pinned path.

These results demonstrate that namespace topology and the activation root's
mappings view can be constructed; neither is the first sufficient stop. The
Bun check proves executable startup only, not arbitrary JavaScript execution
inside the final authority envelope. None of these checks establishes
complete-tree resource ownership. A root Bun JavaScript process ran only after
the root mappings view and an exact
`/dev/urandom` device bind were both present. A child Bun process aborted while
inheriting the root-pinned mappings file, so descendant runtime behavior
remains unproven. Mounting a fresh procfs was denied by the outer sandbox; no
general procfs success is claimed.

## Bun entropy observation

A behavioral differential shows that trivial Bun 1.3.3 JavaScript depends on
access afforded by `/dev/urandom` in this construction. With the root mappings
view but an empty `/dev`, the process exits 132. Adding exactly:

```sh
--dev-bind /dev/urandom /dev/urandom
```

makes the same program succeed; a read-only bind still exits 132. This proves
the dependency and observed access mode, not the exact syscall or open flags.
Broad synthetic `/dev` is unnecessary, but the exact device bind is still
outside the reviewed v1 authority envelope.

This single implementation observation does **not** justify changing FLOW
authority, adding a package grant, admitting `/dev` generally, or defining a
new Backend predicate. The entropy seam remains unresolved; further runtime
and threat-model work must consider the exact device access and alternatives
such as `getrandom()` before any authority consequence is inferred.

## Resource-owner unblock conditions

A general descendant-capable Linux Backend needs an equivalent of all of:

1. a stable, single-use owner containment identity;
2. delegated aggregate CPU, memory, and PID enforcement;
3. atomic placement before package-controlled code executes;
4. prevention of guest migration or envelope weakening;
5. whole-tree kill, quiescence, and cleanup;
6. durable enumeration and fencing after coordinator failure; and
7. a closed definition of finite aggregate CPU consumption. A rate ceiling
   alone is not a total CPU budget.

The implementation may use cgroup v2 or another trusted facility. Any later
Backend interface must be derived from demonstrated observable predicates and
must not make cgroup v2 part of the portable contract.

These are the complete resource-ownership and fencing acceptance conditions,
not claims that every item independently failed. Even after a trusted
aggregate controller becomes available, a complete secure Bun Run remains
unproven until aggregate CPU semantics are closed, atomic placement and
post-crash fencing are demonstrated, the entropy/device seam is resolved, and
an arbitrary JavaScript Run is exercised with its prepared package tree,
scratch, protocol descriptors, cancellation, descendants, and cleanup.

## Scope of the stop

The block applies to live Phase 2 activation on this host. It does not reopen
the completed Run/1 protocol or SDK work. Closed planning and availability
detection could be developed separately, but publishing their interface before
one real Backend can satisfy it would be speculative. Under the project's
minimalist discipline, implementation stops at this boundary until the owner
resource predicates and the remaining Bun activation predicates exist, or a
genuinely narrower Backend is proven end to end.
