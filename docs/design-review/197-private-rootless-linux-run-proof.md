# Private rootless Linux Run proof

**Status:** completed on 2026-08-31. This closes one private execution
mechanism. It does not publish a Sandbox Backend interface or make the current
Jig package an operable alpha.

## Question

Can Jig execute a real FLOW Run/1 process with aggregate resource ownership,
namespace isolation, complete-tree fencing and coordinator-independent cleanup
using only generic unprivileged Linux facilities which already exist when Jig
starts?

## Answer

Yes, on the current narrow proof host.

The host supplies one empty user-owned cgroup-v2 parent with `cpu`, `memory`
and `pids` delegated, unprivileged user namespaces, and Bubblewrap 0.12. Jig
creates no service, registration, policy file, privileged helper or persistent
host state.

The private ownership chain is:

```text
generic user-owned delegated parent
    -> foreground Jig coordinator
    -> private Unix control socket
    -> ephemeral unprivileged Run supervisor outside the Run cgroup
    -> one limited child cgroup
    -> same-PID entry trampoline writes cgroup.procs
    -> Bubblewrap
    -> FLOW Run/1 component and descendants
```

The supervisor creates the child and writes `memory.max`, `memory.swap.max`,
`pids.max` and `cpu.max` before it accepts admission. The entry trampoline
writes its own PID to `cgroup.procs`, verifies membership, emits one explicit
readiness receipt and only then starts Bubblewrap. There is no
attach-after-exec interval.

Bubblewrap creates fresh user, mount, PID, IPC, UTS, cgroup and network
namespaces, a namespace-local read-only procfs view, a minimal `/dev`, empty
temporary filesystems, an empty environment and no capabilities. The payload
cannot see host cgroupfs, host processes or network routes, cannot create a
nested user namespace, and cannot mount an alias over protected payload
locations. The private device projection denies metadata mutation and leaves
host `/dev/urandom` unchanged.

Cancellation, deadline, coordinator loss and ordinary completion converge on
one cleanup path:

```text
cgroup.kill
    -> wait for cgroup.events populated 0
    -> retain aggregate CPU/memory/PID evidence
    -> remove the empty cgroup
    -> report the terminal
```

The supervisor owns that path after coordinator socket loss. It never gives
the package its control socket or delegated cgroup authority.

## Proof corpus

The focused proof passes:

```text
ordinary namespace/device/network isolation       passed
real TypeScript FLOW Run/1 exchange                passed
protected mount-source/destination rejection       passed
cancellation                                       passed
aggregate pids.max                                 passed
aggregate descendant memory exhaustion            passed
CPU throttling plus independent wall deadline      passed
cancellation before package admission              passed
orphaned grandchild fencing                         passed
complete coordinator SIGKILL                       passed
eight repeated Runs                                passed
residual Jig Run cgroups                            0
```

The test harness launches every hostile payload only after its limited cgroup
exists. It independently checks zero residue after the suite.

The Run/1 witness mounts the current FLOW SDK source read-only and passes a
real `flow/run` request through `RunHostSession`; success is not inferred from
a raw process exit.

## Runtime fixture boundary

The proof environment retains Bun and Bubblewrap for the sandbox lifetime. The
test harness parses that environment's bounded read-only receipt to choose only
their recursive runtime closures and mount them read-only.

The backend implementation does not read that receipt, know Nix, search
`PATH`, install a runtime or expose any receipt to the package. A production
host may retain the same exact bytes by another mechanism. FLOW metadata still
describes none of this.

## Deliberate nonclaims

This checkpoint does not prove:

- installed acquisition of the delegated parent;
- the final rootless join to admitted Project Session execution;
- supervisor-process loss independent of coordinator loss;
- logout, reboot or daemon durability;
- macOS, Windows, VM or container portability;
- a public Runtime Adapter or Sandbox Backend SPI; or
- that the development sandbox is a Jig installation mechanism.

The current implementation remains private and is excluded from the packed
`@jigging/jig` artifact.

## Next boundary

Join the closed Project Session/root recipe to this mechanism through one
finite installed command on a fresh supported host. Acquisition must remain
simple: consume a complete pre-existing delegated envelope and exact retained
runtime or return `SANDBOX_UNAVAILABLE`. Do not add `jig setup`, a daemon,
privileged fallback, package-manager integration, or a public Backend registry.
