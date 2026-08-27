# Bun and Run-lifecycle closure

**Status:** implemented private Linux proof and exact Bun direct-Run recipe.
The later direct-root ownership and result-admission corrections are recorded
in [review 142](142-direct-root-closure-repair.md). This review changes no
portable FLOW metadata or wire protocol and does not publish a Sandbox Backend
SPI.

## 1. Closed environmental blocker

The restarted `firecracker-host` proof environment established:

```text
sudo -n                                      available
cgroup filesystem                            v2, writable through trusted launcher
Jig-owned empty delegation                   creatable and removable
controllers                                  cpu, memory, pids
child controls                               cpu.max, memory.max, pids.max,
                                             cgroup.events, cgroup.kill
outer PID 1                                  /run/podman-init
initial and final zombie count               0
/dev/kvm, /dev/net/tun                       present and writable (not used here)
runtime support receipt                      sandbox-lifetime, read-only
```

The outer PID 1 is only the final owner if Jig's trusted supervisor dies. It is
not the Run lifecycle mechanism.

## 2. Jig-owned lifecycle boundary

The private Backend now requires an exact host-supplied subreaper executable.
The proof uses Catatonit from `/run/podman-init`; the Backend resolves and
digests the exact binary and starts it between the trusted `sudo -n` launcher
and the root helper. It remains outside the Run cgroup. FLOW/package code
cannot select, see, invoke, or inherit the launcher, subreaper, cgroupfs, or
their authority.

The existing placement remains race-free:

```text
trusted helper creates and configures Run cgroup
    -> child trampoline writes its own PID to cgroup.procs
    -> readiness byte proves placement
    -> same PID execs the exact launcher which drops to coordinator UID/GID
    -> exact Bash clears cwd and environment
    -> unprivileged Bubblewrap constructs the namespace
    -> only then can package bytes execute
```

On every terminal path the helper writes `cgroup.kill`, waits for
`cgroup.events` to report `populated 0`, removes the Run and parent cgroups,
and reports cleanup failure. The outside-cgroup subreaper adopts and reaps
exited descendants. Coordinator `SIGKILL`, activation-root exit, and eight
repeated Runs preserve both an empty Jig cgroup delegation and an unchanged
zero-zombie set.

The subreaper executable is a private Backend mechanism, not a FLOW dependency
or a claim that every Backend must use Catatonit. A public replaceable Backend
interface remains deferred until a second containment implementation proves
the shared contract.

The protected-package proof assumes one trusted same-UID coordinator and one
trusted same-UID mutator for its `0700` materialization. That is a private proof
condition, not a portable launcher or cross-UID Backend contract.

## 3. Namespace and mount hardening

Bubblewrap now receives all of:

```text
--unshare-all
--unshare-user
--disable-userns
--assert-userns-disabled
```

The hostile proof invokes `unshare(CLONE_NEWUSER)` through the proof host's
util-linux executable and requires failure. Read-only mount sources are
resolved before launch and rejected when they resolve beneath `/dev`, `/proc`,
`/run`, or `/sys`, or report procfs, sysfs, cgroup-v2, or devpts filesystem
types. This closes the former alias path around the cgroup-only check.

## 4. Exact Bun runtime support

The root-pinned `/proc/self/maps` experiment is removed. A Bun activation which
needs process mappings now receives a procfs created inside its own PID and
cgroup namespaces and remounted read-only. The proof requires:

- the activation root is PID 1 in that namespace;
- an outer host PID is absent;
- procfs is `ro,nosuid,nodev,noexec`;
- `/proc/self/cgroup` reports the isolated cgroup namespace;
- root and child Bun processes each read their own `/proc/self/maps`; and
- the child Bun process completes successfully.

The Backend does not bind host procfs.

For runtime devices, the root helper creates a unique root-owned directory
under `/dev` and uses its exact, digested `mknod` tool to create only:

```text
/dev/null       character 1:3, mode 0666
/dev/urandom    character 1:9, mode 0444
```

Bubblewrap device-binds those fresh nodes into its otherwise empty `/dev`.
The payload can read entropy but cannot open `/dev/urandom` for writing; KVM,
TUN, host `/dev`, and unrelated devices remain absent. The proof checks that
the projected entropy inode differs from the host node, the host node's inode
and mode are unchanged, and the temporary device directory is removed after
normal completion and coordinator loss.

These process/device details are Adapter-selected private Backend mechanisms.
They are not Package/1 fields, Binding grants, capabilities, or portable FLOW
vocabulary.

## 5. Exact Bun direct recipe

`private-bun-direct/1` accepts only a direct Run with:

```text
entrypoint     flow.ts
selector       absent or bun
settings       {}
attachments    {}
slots          {}
```

It pins the retained runtime-support observation, executable digest, Backend
mechanism digest, request and observation digests, a 256 MiB/48-PID finite
ceiling, and the fixed Bun policy:

```text
--no-env-file
--no-install
--config=/dev/null
```

The package is materialized read-only at `/package`, scratch is `/work`, the
environment is empty, network remains unshared, and Run/1 is served over
protocol stdio. A vendored TypeScript `@flowmd/sdk` fixture completes a real
request/result exchange and a descendant Bun proof passes under the same
envelope.

Python and Bun remain separate exact recipes. The only extracted common layer
is a closed dispatcher which selects `flow.py` or `flow.ts`, authenticates the
corresponding recipe, and invokes it. It is not a public Runtime Adapter
registry.

## 6. First durable host caller

Private activation admission now accepts either authenticated direct recipe.
The Root Run controller reproduces the admitted exact recipe from the retained
request and current runtime-support observation before execution. The durable
Root Administration proof now admits and runs the Bun fixture and preserves
idempotent root submission. Review 142 closes the more precise ordering:
durable dispatch ownership, retained Run backing, Backend admission, confirmed
whole-tree fence, backing release, package-result admission, and only then
terminal publication. A replacement coordinator inventories older work; the
Root Administration controller reacquires and fences the exact owner before it
can publish `COORDINATOR_LOST`.

`RootAdministration` remains a trusted host-side object capability. Portable
FLOW code receives only Run/1 and its `callFlow`/`callEffect` operations.

## 7. Superseded conclusions

The following previous conclusions are no longer current:

```text
root-pinned mappings are the only admissible live kernel view
Bun descendants necessarily fail with exit 134
the general direct Bun recipe is unavailable
the evaluator-only host /dev/urandom bind remains unresolved
the Root Run controller is Python-only
```

Historical reviews remain useful evidence of why the narrower construction
failed. This review and the canonical security/Runtime Adapter text are the
current decision.

## 8. Still deliberately deferred

- public Sandbox Backend or Runtime Adapter interfaces;
- dependency preparation or ambient package-manager lookup;
- Service recipes;
- network authority;
- VM/Firecracker execution;
- durable arbitrary live-graph resumption; and
- package-selected process, device, launcher, or administrator authority.

The proof closes one exact Linux/Bubblewrap mechanism and two exact direct Run
recipes. It does not turn its implementation details into FLOW.
