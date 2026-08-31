# Zero-setup rootless product boundary

**Status:** selected on 2026-08-29. The product boundary is settled. Review
197 closes the first private execution-mechanism proof; product acquisition
and the admitted Project Session join remain open.

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

The generic rootless host envelope is now available and review 197 proves one
private Run mechanism against it. The mechanism consumes an already delegated,
empty cgroup-v2 parent with active CPU, memory and PID controllers; creates one
ephemeral child cgroup per Run; enters that child before Bubblewrap or package
bytes execute; and uses unprivileged Bubblewrap 0.12 for the remaining
namespace and filesystem boundary.

The proof uses no `sudo`, host user bus, Nix daemon, Jig-specific service,
privileged helper, or persistent registration. Its supervisor survives loss
of the Jig coordinator, fences the complete Run through `cgroup.kill`, waits
for `populated 0`, and removes the Run cgroup.

The development test harness reads the sandbox's bounded runtime receipt only
to construct exact read-only Bun and Bubblewrap mounts. That is fixture
machinery, not Jig product code or a FLOW concept. Installed acquisition of an
equivalent delegated envelope and exact retained runtime, plus the join to the
admitted Project Session path, remain the next product gate.

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
