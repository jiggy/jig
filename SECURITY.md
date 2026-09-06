# Security

Jig's direct-run alpha treats admitted project and FLOW package code as
untrusted. Its supported Linux host runs project evaluation, dependency
preparation, and Flow execution inside one rootless cgroup-v2 and Bubblewrap
boundary. There is no privileged or weaker fallback.

## What the boundary protects

An admitted Flow receives only its exact execution package, fixed runtime
support, explicitly supplied root attachments, private scratch space, private process and network namespaces, and
the Run/1 channel. It does not receive the project tree, host environment,
ambient `PATH`, host process tree, host network, writable cgroup controls,
general host devices, inherited descriptors, or Jig's control channel.

Jig applies aggregate CPU, memory, and process limits before package code can
execute. Every terminal path fences the complete process tree and removes its
rootless owner state before reporting completion.

Project evaluation, the fixed dependency installer, and the fixed Agent
provider worker use the same containment mechanism in separate scopes. The
preparation worker inherits networking only during `jig review`; it validates
the authored lock before the fixed installer's first fetch. The Agent worker
inherits networking only for an admitted Agent `effect/call`. The host may use
the official OpenAI JavaScript SDK against an operator-selected HTTPS endpoint
with either the `responses` or `chat-completions` wire shape, or run native
Codex, Claude Code, or Pi through one private ACP mechanism. Client paths,
selected APIs, endpoints, models, and credentials are trusted host
configuration, not FLOW values. Jig supplies no default model.

The selected Agent scope receives its bounded credential projection,
instructions, and selected skill text through a transient private channel. A
native ACP client starts with an empty work directory. Jig provides it no
filesystem, terminal, or MCP client capability, no MCP servers, and no
persistent permission. Fixed profiles disable client tools, extensions,
plugins, and native skills. The secret, instructions, and skills do not enter
the Flow environment, launch arguments, Plans, locks, or retained Run state;
non-secret client, selected API, endpoint, model, and exact support identities
are reviewed as provider identity but are not exposed to the Flow. Jig exposes
no public provider SPI or registry.

Authored package code and lifecycle scripts never execute during preparation,
and every Flow Run remains offline.

## Supported trust boundary

The alpha does not defend against:

- compromise of the Linux kernel, systemd, Bubblewrap, cgroup v2, or Jig's
  fixed Bun runtime and trusted support files;
- the host administrator or another malicious process running as the same
  operating-system user;
- physical access or compromise outside the supported host; or
- denial of service within the documented resource ceilings or through
  bounded content-addressed storage retained while a project is reviewed.

An unsupported host or missing containment capability fails closed. Do not
replace cgroup-v2 ownership with `ulimit`, per-process accounting,
process-group killing, or `/proc` polling; those mechanisms do not enforce the
same descendant and cleanup boundary.

## Alpha ceilings

| Operation | Wall clock | Aggregate memory | Aggregate PIDs | CPU quota |
| --- | ---: | ---: | ---: | ---: |
| Each Flow execution scope | root deadline, at most 24 hours | 256 MiB | 64 | 50% of one CPU |
| Each Agent provider scope | parent's remaining root deadline | 256 MiB | 128 | 50% of one CPU |
| Project evaluation | 3 seconds | 256 MiB | 64 | 50% of one CPU |
| One locked dependency preparation | 60 seconds | 512 MiB | 64 | one CPU |

Root Runs default to 30 seconds. The trusted CLI caller may select a positive
integer duration with `--timeout`, using `ms`, `s`, `m`, or `h`, up to 24
hours. This is invocation policy, not FLOW metadata, project configuration, or
Flow-controlled authority. The deadline starts when the root Run is accepted;
project acquisition happens before it, and mandatory fencing and cleanup may
finish afterward. The memory, PID, and CPU ceilings in the table are fixed.

A Binding child Flow or Agent provider runs in a second execution scope while
its parent remains live. Jig admits at most one active child operation per
parent, so this alpha can have at most the parent and one child scope active
for one root Run. The table's CPU, memory, and PID ceilings apply to each
scope, not to their combined total. Every child operation's wall deadline is
capped by the parent's remaining deadline.

After bounded project capture, one `jig review` dependency-planning phase uses
one 180-second cancellation deadline, performs at most 16 distinct dependency
preparations, and accepts at most 256 MiB of prepared file content across
them. Each contained preparation has the earlier 60-second hard deadline.
Each accepts at most 4,096 source files and 16 MiB of source content, and
produces at most 4,096 files and 32 MiB of prepared content.

The protected Package/1 store accepts at most 64 MiB per canonical artifact
and 1 GiB per project. Review may retain content-addressed source and
prepared artifacts before the user approves a Plan. Declined and superseded
artifacts therefore continue to consume the same fixed cap; Jig does not
silently garbage-collect review evidence in this alpha. Exact retained bytes
remain reusable at the cap, while a review requiring any new artifact fails
closed. This alpha has no selective reclamation command. Reclaiming space
requires closing Jig and intentionally removing the project's protected
`.jig` state, which also discards its local admission and Run history.

## File capture and delivery

Root read attachments contain immutable captured bytes, not live host mounts.
Capture accepts at most 8 MiB across 64 files; selectors avoid enumerating
unselected subtrees. Linux descriptor-relative operations reject symlinks,
multiply linked files, nested mounts and protected host-state aliases. Source
and destination-parent filesystems must be ext4, XFS, Btrfs or tmpfs. This does
not detect secrets in explicitly selected files or defeat a malicious host user.

The sole writable attachment uses a 16 MiB anonymous tmpfs under the Run's
256 MiB aggregate memory ceiling, including filesystem metadata. A trusted
descriptor retains that bounded mount after all payload writers are fenced.
Removal of the cgroup does not free these retained pages: they stay charged
in the memory hierarchy until the last holder releases them. Final-tree
validation accepts at most 16 MiB of logical bytes and 64 files, rejecting
oversized sparse files, links, special files and excess metadata before copying.

Finite caps bound hostile allocation and trusted capture/export work. The
8 MiB input and 16 MiB output values are conservative host policy for small
file jobs, not portable FLOW limits or benchmark-derived optimums. Changing
them requires reviewing the complete retained-storage budget and runtime
policy together; removing them is not a usability fallback.

Temporary content may coexist: 8 MiB of sealed input and a bounded capture
buffer; the retained output mount and up to 16 MiB of copied file buffers;
and up to 16 MiB of destination file staging plus a bounded JSON/1 host record.
The Run memory ceiling includes runtime and tmpfs metadata, not all trusted
coordinator or delivery-process memory. No per-invocation source tree is added
to the retained Package/1 store. Only bounded request and terminal evidence
survives command cleanup; the requested final packet is intentionally retained.

The independent outer command owns output staging and removes it if its
execution coordinator dies during copying. Flow code sees neither the host
destination nor the delivery socket. On cancellation or command expiry, the
owner gives its exact trusted child 250 ms after SIGTERM before SIGKILL and
reaping. The independent cgroup owner still fences the complete payload tree;
the child signal is not a substitute for that boundary. Atomic no-replace publication creates
private files and directories; it promises complete visibility, not power-loss
durability. A published packet survives later cancellation or acknowledgement
loss. Killing the whole host or both trusted owners is outside the coordinator-
loss cleanup guarantee; no automatic replay or general artifact-recovery service
is provided. Cleanup failures are surfaced rather than reported as zero residue.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Report it through
[GitHub's private vulnerability form](https://github.com/jiggy/jig/security/advisories/new).
Include the affected version, supported-host details, reproduction steps, and
the observed security impact. Never include secrets or third-party data.
