# Zero-setup rootless product boundary

**Status:** selected on 2026-08-29. The product boundary is settled; the
rootless execution mechanism is not yet proved on this development host.

## Decision

Jig has no host-setup command.

Installing Jig must not create privileged helpers, system services, host
registrations, policy files, cgroup ownership, runtime receipts, or other
persistent host authority. Project initialization is ordinary project
authoring and is not host setup.

Each `jig run` must instead:

1. establish that one supported, pre-existing unprivileged containment path is
   completely available;
2. create only ephemeral per-Run ownership;
3. execute package bytes only after that ownership and its limits exist;
4. fence and clean the complete process tree before reporting a terminal; and
5. return one bounded `SANDBOX_UNAVAILABLE` result when any required predicate
   is absent.

There is no silent degradation, privileged fallback, or alpha `--unsafe`
mode. `jig doctor` may explain the same predicates, but it is optional and
does not prepare the machine.

The private root-owned cgroup-v2/Bubblewrap implementation remains valuable
security evidence. It is not the installation model for the product and does
not earn a public Sandbox Backend interface.

## First proof candidate

The smallest candidate is a foreground-only Linux/Bun path using facilities
already owned by the user's host:

- cgroup v2 with CPU, memory, and PID control delegated through the user's
  existing service manager;
- one transient user-owned service for pre-exec cgroup ownership, limits, the
  wall-clock deadline, and complete-tree lifecycle;
- unprivileged user namespaces; and
- a patched unprivileged Bubblewrap for filesystem, process, device, and
  network isolation.

This is a private implementation hypothesis, not portable FLOW vocabulary.
It must pass the existing hostile ownership, limit, cancellation, coordinator
loss, migration, visibility, and zero-residue cases before joining the
Project Session. No public Backend SPI follows from one successful mechanism.

The initial alpha may support only hosts satisfying this exact envelope. It
does not promise survival across logout or reboot, universal Linux support,
macOS, Windows, or containers whose outer host withholds the required
unprivileged facilities. Narrow support is preferable to Jig-specific setup.

## Current development-host result

The current sandbox cannot run this proof:

```text
uid                                      1000, unprivileged
cgroup v2 controllers                    cpu, memory, pids available
cgroup subtree/control files             not writable by uid 1000
user systemd manager/client               unavailable
user runtime directory                    unavailable
unprivileged user namespaces              enabled by kernel limit
Bubblewrap                                0.11.0
required patched Bubblewrap baseline      0.12.0 or newer
```

Using passwordless `sudo`, the existing root helper, or an artificial service
manager started inside the development container would test a different
product. No package or hostile payload was launched.

The next proof environment needs only generic rootless-Linux facilities: an
active unprivileged user service manager with delegated cgroup-v2 CPU, memory,
and PID controls, unprivileged user namespaces, and patched Bubblewrap. It
must not install or register any Jig-specific artifact.

## Superseded release gate

Earlier reviews required an administrator-installed Jig launcher, helper,
subreaper, runtime receipt, and registration before an operational alpha.
That product direction is superseded.

Ordinary operating-system prerequisites may be installed by the operating
system or its administrator, just as the kernel and C library are. Jig itself
does not claim their installation or lifetime. Missing or incompatible host
facilities make the host unsupported; they do not activate another protocol.

The durable rule is:

> Install the product once. Each Run proves and consumes ephemeral
> unprivileged authority, or fails closed.
