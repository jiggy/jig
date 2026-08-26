# Phase 2 private Linux cgroup-v2 proof

**Status:** implemented and host-proven on 2026-08-25. This closes the
environmental stop recorded in
[`104-phase-2-security-blocker.md`](104-phase-2-security-blocker.md) for the
private Linux proof backend. It does not publish a Sandbox Backend interface,
make cgroup v2 portable FLOW vocabulary, or qualify the Bun Runtime Adapter.

## Disposition

The `firecracker-host` profile supplies the previously missing trusted
resource-owner boundary. Jig now has one private Linux implementation which:

1. creates a unique `jig-run-<run>-<nonce>/run` cgroup under an empty delegated
   host scope;
2. enables only `cpu`, `memory`, and `pids` for that private subtree and writes
   `cpu.max`, `memory.max`, and `pids.max` before starting the payload;
3. forks only a fixed trusted trampoline, which writes its own PID into
   `cgroup.procs` before `exec` of Bubblewrap—there is no attach-after-exec
   interval in which package-controlled bytes can run outside the cgroup;
4. starts Bubblewrap in that cgroup with new user, mount, PID, IPC, UTS,
   cgroup, and network namespaces, a cleared environment, an unprivileged
   identity, and no capabilities;
5. exposes neither host cgroupfs nor general `/proc` or `/dev` to the payload;
6. applies an independent trusted-helper wall timer in addition to aggregate
   cgroup CPU throttling and accounting;
7. fences every terminal path with `cgroup.kill`;
8. waits for `cgroup.events` to report `populated 0` before removal;
9. removes both Run and unique parent cgroups and reports a non-fenced receipt
   when cleanup fails; and
10. retains a root trusted helper as the cleanup owner. Its unlinked Unix
    control socket closes when the Jig coordinator dies, so coordinator loss
    itself triggers fencing and removal.

The implementation is intentionally private:

```text
packages/jig/src/internal/linux-cgroup-backend.ts
packages/jig/src/internal/linux-cgroup-helper.ts
```

It is evidence from which a later public Backend contract may be derived, not
that contract. The helper currently runs from the Jig installation through an
explicit trusted Bun path. A distributable backend must replace that
development arrangement with an installed, immutable, administrator-owned
helper artifact before this boundary can be presented as a production trust
root.

## Capability preflight

The repeatable preflight is:

```sh
sh scripts/preflight-linux-cgroup.sh
```

On the proof host it reported:

```text
sudo=ok
cgroup.mount=rw,nosuid,nodev,noexec,relatime,nsdelegate,memory_recursiveprot,memory_hugetlb_accounting
cgroup.scope=/sys/fs/cgroup/machine.slice/libpod-…scope
cgroup.controllers=cpuset cpu io memory hugetlb pids misc
run.cpu.max=50000 100000
run.memory.max=134217728
run.pids.max=32
optional.kvm=rw
optional.tun=rw
cleanup=removed
```

The script creates only a uniquely named Jig preflight parent and one empty
child, checks `cpu.max`, `memory.max`, `pids.max`, `cgroup.events`, and
`cgroup.kill`, and removes both. A missing required predicate exits with
`missing capability: <predicate>`. KVM and TUN are reported separately and do
not gate this cgroup/Bubblewrap backend.

No `ulimit`, process-group kill, `/proc` enumeration, per-process accounting,
or advisory fallback exists.

## Ownership and lifecycle

```text
Jig coordinator (unprivileged)
    |
    | unlinked private Unix control socket
    v
trusted root helper (outside Run cgroup; cleanup owner)
    |
    | fork fixed trampoline
    v
trampoline writes own PID to run/cgroup.procs
    |
    | exec, same PID and cgroup membership
    v
Bubblewrap -> package activation root -> descendants
```

The helper connects before creating host state. The coordinator then removes
the listening socket path, leaving only the connected kernel socket. Package
code inherits only protocol stdin, stdout, and stderr; it receives neither the
control socket nor a cgroup descriptor. Normal exit, cancellation, deadline,
startup failure, shutdown failure, and coordinator loss converge on the same
kill, quiescence, evidence, and removal path.

This design deliberately uses a unique parent per activation in the proof.
It avoids cross-Run controller mutation and makes the complete ownership unit
obvious. A future shared parent optimization has not earned its concurrency
and delegation complexity.

## Hostile proof corpus

Run:

```sh
bun run --cwd packages/jig test:linux-cgroup
```

The 2026-08-25 proof now passes all eleven focused tests:

```text
plan rejects cgroupfs mounts and malformed finite limits
payload cannot see cgroupfs or migrate and runs as uid 1000/gid 100
fork storm reaches aggregate pids.max
four descendant allocators reach aggregate memory.max
cpu.max throttles while the trusted wall deadline terminates the tree
cancellation during startup and shutdown leaves no owner
orphaned grandchildren are fenced after activation-root exit
coordinator SIGKILL is recovered by the surviving helper
eight repeated Runs leave no process or cgroup residue
one real Python flowmd_sdk component completes Run/1 through RunHostSession
one real Python Service/1 Provider completes Mount, invocation, and cleanup
through ServiceHostSession
```

The suite's final `afterAll` enumerates the delegated scope and requires zero
`jig-run-*` cgroups. A separate post-run inspection also found none.

## Bun entropy exception and unavailable Runtime Support Closure

The Backend itself does not expose general `/proc` or `/dev`. The Bun proof
uses two private switches:

- the reviewed `root-process-mappings` predicate, realized by one read-only
  `/proc/self/maps` bind pinned to the activation root; and
- an unresolved evaluator-only `/dev/urandom` exception.

The latter is not FLOW metadata, package authority, an admitted Runtime
Adapter predicate, or a general device grant. The private Backend currently
resolves the literal host path at launch and receipts only a boolean; it does
not pin and identify the device strongly enough to establish a portable or
production trust boundary. It remains confined to the Bun evaluator proof and
cannot enter a Python recipe or resolved admission candidate.

With `--as-pid-1`, a root Bun 1.3.3 JavaScript process succeeds using only the
Bun and glibc Nix store trees plus those two predicates. It reads entropy and
its pinned mapping view successfully.

The same Bun executable started as a descendant exits `134` with empty stdout
and stderr because the descendant sees the activation root's pinned mapping
view rather than a retargeted `self` view. Retargeting it would violate the
reviewed descendant invariant; mounting a general procfs would broaden the
kernel surface expressly excluded from v1.

Therefore:

```text
Bun root proof:       pass
Bun descendant proof: fail (exit 134 under root-pinned mappings)
Bun recipe status:    unavailable
```

The hostile suite preserves this as a passing negative gate. No insecure Bun
compatibility path was retained.

## First complete exact-Run path

A separately selected Python 3.14.7 recipe now proves the complete live path:

```text
finite immutable Nix Runtime Support Closure
    -> private Linux Backend launch
    -> Python flowmd_sdk component
    <-> Run/1 over the Backend-owned byte channel
    <-> RunHostSession
    -> typed done result
    -> cgroup.kill fence, populated 0, removal
```

The Run and Service proofs mount only the 23 paths in the Python runtime's Nix
closure, the FLOW SDK source, and one fixture component. Their historical
plans also enabled the private entropy switch even though the proof did not
establish that Python needed it. A conforming Python planning witness must
disable that switch and prove the exact device absent. The existing paths
clear the ambient environment, write no bytecode, admit no network, and
observe no memory or PID limit event. This proves that the private
`ExactComponentProcess` seam can represent both finite and long-lived enforced
activations; it is not yet a Python Runtime Adapter implementation or public
Backend API.

## VM comparison

The host also passed the Firecracker prerequisites and booted the official,
checksum-verified Firecracker 1.16.1 VMM to `Running` with KVM. That result is
deliberately not counted as a second Backend. A conforming VM Backend still
needs a host-owned guest image, an authenticated full-duplex Run/1 guest
transport, jailer and outer-owner containment, coordinator-loss recovery,
whole-tree cancellation, and hostile cleanup proofs.

The comparison nevertheless rejects two premature abstractions:

- the public boundary cannot be named or shaped as a container interface; and
- host bind mounts and child-process stdio are mechanisms, not portable plan
  vocabulary. A VM may materialize sealed trees as images and proxy its guest
  channel while exposing the same bounded byte channel and terminal evidence
  to Jig.

## Still open before a public Backend API

This proof closes the cgroup ownership blocker, but it intentionally does not
settle:

- the public registration, closed launch-plan, enforcement-receipt, and error
  schemas;
- installation and upgrade of an immutable administrator-owned helper;
- a portable meaning for a finite aggregate CPU-consumption budget beyond the
  proven rate ceiling, accounting evidence, and hard wall deadline;
- Runtime Support Closure construction for an executable recipe that supports
  all permitted descendants beyond the qualified Python proof; or
- VM/Firecracker backend behavior. KVM and TUN availability alone is not such
  a proof.

Those questions should be derived from this working implementation rather than
added speculatively to FLOW or Package/1.
