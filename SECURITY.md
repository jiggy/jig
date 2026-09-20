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
Trusted launchers exclude unselected descriptors before entering the sandbox
and before launching package code, including access through visible parent
processes. Missing enforcement refuses execution.

Jig applies aggregate CPU, memory, and process limits before package code can
execute. Every terminal path fences the complete process tree and removes its
rootless owner state before reporting completion.

Project evaluation, the fixed dependency installer, HTTP request worker, and Agent
provider worker use the same containment mechanism in separate scopes. The
preparation worker inherits networking only during `jig review`; supplied
locks are validated before the fixed installer's first fetch. Without an
authored lock, `--allow-resolution-network` explicitly permits dependency-
selected requests before graph validation, including private-network and
loopback destinations reachable from the host. This is not egress filtering.
Failed or declined review cannot undo requests already made. The permission
lasts only for that review; `--yes` is separate Run-admission approval. Known
unsupported root declarations are rejected first; the resolved graph must
pass the usual source/integrity policy before frozen installation and
admission. Bun sees only captured manifests, the lock, and bounded declared
workspace-root patch files during installation, not other authored configuration
or foreign lockfiles. Patch declarations and bytes are captured, checked against
the lock, and retained with the prepared installation; Bun owns their application
inside the same script-disabled scope. An ordinary API-backed Agent
prepares its request as data and uses an exact reviewed HTTP grant; the
separate HTTP owner holds the credential and network authority. Native Codex,
Claude Code, or Pi clients inherit networking only inside their admitted ACP
execution scope. Their executable, authentication and launch policy remain
operator configuration. Jig supplies no default model.

The selected native-client scope receives its bounded credential projection
through a transient private channel. Instructions and selected Skill text
arrive through the ordinary Agent Flow's admitted resource call. A
native ACP client starts with an empty work directory. Jig provides it no
filesystem, terminal, or MCP client capability, no MCP servers, and no
persistent permission. Claude and Pi profiles disable their tools; Codex uses
its qualified constrained workspace mode, with managed restrictions protecting
projected authentication. This is not a universal claim that native tools are
disabled. Profiles also restrict extensions, plugins and native Skills as
specified in [Finite ACP](docs/jig/spec/finite-acp.md). Secrets never enter Flow environments, launch
arguments, Plans, locks, or retained Run state. Instructions and selected Skills
are explicit caller data, not secret authority or host-attested provenance.
Non-secret native client, model, and exact support identities
are reviewed as provider identity. Jig exposes
no public provider SPI or registry.

The HTTP Request worker receives one reviewed exact URL/method grant and its
optional bearer via private stdin. It alone has network access for that request;
Flow code gets neither the credential nor sockets. No authored imports, redirects,
proxies, arbitrary headers or automatic retries run in that worker. Request and
response sizes and deadlines are bounded, and optional operator-owned Schema/1
validates the JSON request body. Public grant policy is review-pinned; secrets
are excluded from identities and retained records. Revocation stops new commands;
cancel existing commands to stop their snapshotted authority. Remote effects
already accepted cannot be recalled. HTTP status is evidence, not domain success.
Exact HTTPS URLs use normal TLS verification and host DNS; this is not an IP
firewall, and selected private services are permitted. Numeric-loopback HTTP is
also supported explicitly. The selected service must be trusted with its token:
literal echoes reject, but encoded disclosure is not generally detectable.
See [HTTP Request](docs/jig/spec/http-request.md) for the complete boundary.

Authored package code and lifecycle scripts never execute during preparation,
and every Flow Run remains offline.

The bundled Markdown interpreter runs inside that same keyless Flow envelope.
It selects only captured original recipes and calls an admitted ordinary Agent
through the reserved `markdown-agent` route. Model decisions, resource content
and `allowed-tools` text cannot create routes, credentials or host permissions.
Raw resource reads are limited to captured package bytes. Reasoning requests
carry complete bounded context; overflow fails instead of silently dropping
instructions. Markdown resources do not trigger dependency installation.

Project Command effects execute supplied immutable text using installed Bun
and reviewed Binding invocations in their own keyless, offline scopes. Their
collector stays outside candidate execution. Candidates see no Flow package,
host repository, credentials, or writable input controls. Collected output
and termination do not prove that repository tests ran honestly: candidate
code can interfere with their runner. Independent application assertions
must inspect captured behavior without importing candidate code.

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
| Each project-command scope | 10 seconds, within its parent deadline | 256 MiB | 64 | 50% of one CPU |
| Project evaluation | 3 seconds | 256 MiB | 64 | 50% of one CPU |
| One dependency resolution and preparation | 60 seconds | 512 MiB | 64 | one CPU |

Root Runs default to 30 seconds. The trusted CLI caller may select a positive
integer duration with `--timeout`, using `ms`, `s`, `m`, or `h`, up to 24
hours. This is invocation policy, not FLOW metadata, project configuration, or
Flow-controlled authority. The deadline starts when the root Run is accepted;
project acquisition happens before it, and mandatory fencing and cleanup may
finish afterward. The memory, PID, and CPU ceilings in the table are fixed.

A Binding child Flow or effect runs in a separate scope while its parent
remains live. The root permits two sibling Flows or one exclusive effect;
each child permits one Flow or effect, within two child Flow levels. Before
dispatch, durable root ownership reserves the longest admitted Flow path in
each branch, including its largest possible effect. Two simultaneous two-level
branches fit, each with its own effect. Reservations last
through confirmed fencing and cleanup, even after execution fails.

At most seven payload/provider envelopes fit the fixed root aggregate ceiling:
the root, four child Flows, and two effects. The budget is 1,792 MiB memory,
576 tasks, and 3.5 CPU cores (100 ms quota period). The table's
individual kernel ceilings stay unchanged and their reserved sum cannot exceed
that budget. Unused reservations are not borrowed. Trusted coordinators and
supervisors are outside this budget; this is not combined utilization accounting
or fair-share scheduling. Every child's deadline is capped by the root deadline.
The fixed reservation policy is part of the admitted launch identity; changing
it requires review, not silent reuse of an earlier admission.

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

Bindings may select read-only project-relative resource trees for capture during
review. Their bytes and manifests are retained under the existing Package/1
store cap, including after declined review. They are not secret storage or live
host mounts. Each Run revalidates and projects only its selected Binding's
retained bytes, combined with per-run input under the same 64-file/8-MiB limit.
Neither children nor native provider scopes inherit them. Tool code receives no
additional execution privilege: all of its behavior is available within the
existing sandbox, without subcommand restrictions, network or credentials.

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
buffer; the read-only named input tree in a 16 MiB private tmpfs; the retained
output mount and up to 16 MiB of copied file buffers;
and up to 16 MiB of destination file staging plus a bounded JSON/1 host record.
The Run memory ceiling includes runtime and tmpfs metadata, not all trusted
coordinator or delivery-process memory. No per-invocation source tree is added
to the retained Package/1 store. Only bounded request and terminal evidence
survives command cleanup; the requested final packet is intentionally retained.

A project command accepts at most 256 KiB of text across 64 files, 16 KiB of
stdin, and 32 arguments. Its collector retains the first 64 KiB of each pipe
and drains the remainder; decoded invalid UTF-8 can use more bytes than the
retained raw prefix. The command's named input tree uses the same bounded,
read-only projection. These invocation bytes do not become installed code
or retained package artifacts.

An explicit Codex `retainSessions: true` grant permits a separate private history
store: at most sixteen available 8 MiB snapshots per project, with 24-hour logical
expiry pruned on access. Only the owned, complete rollout for the qualified native
version is collected from bounded anonymous output, after clean process exit and
fencing. Credentials, native home directories, SQLite and logs are not copied.
The collector rejects known credential bytes; this is not a detector for secrets
explicitly supplied as conversation content. Retained history is sensitive local
data protected by the admission store's filesystem/ownership checks, not encrypted
storage or a secure-erasure promise. A current authorized caller atomically consumes
an exact-scope reference before restoration; uncertain or interrupted work is never
replayed. New references follow cleanup and store commit. See
[Finite ACP](docs/jig/spec/finite-acp.md) for the exact qualification ceiling.

The independent outer command owns output staging and removes it if its
execution coordinator dies during copying. Flow code sees neither the host
destination nor the delivery socket. On cancellation, the owner sends SIGTERM
to its exact trusted child and allows at most 60 seconds for cooperative Run
settlement and delivery before SIGKILL and reaping. The existing absolute
command expiry can shorten that wait and retains a 250 ms escalation grace;
later signals cannot extend either bound. This changes no payload deadline
or cancellation authority. The independent cgroup owner still fences the complete payload tree;
the child signal is not a substitute for that boundary. Atomic no-replace publication creates
private files and directories; it promises complete visibility, not power-loss
durability. A published packet survives later cancellation or acknowledgement
loss. Killing the whole host or both trusted owners is outside the coordinator-
loss cleanup guarantee. After confirmed settlement, an interrupted command can
publish its terminal record and previously accepted checkpoint, never unfinished
final output files. No automatic replay or general artifact-recovery service
is provided. Cleanup failures are surfaced rather than reported as zero residue.

Run Checkpoint is an optional, reviewed root-only effect with a writable output
mapping. Its independent command owner retains one accepted aggregate (up to
2 MiB canonical JSON, including 64 UTF-8 files totaling 1 MiB) plus a bounded
replacement. Protocol decoding, immutable snapshots, serialized replies, file
buffers, and final staging can coexist; these trusted-owner allocations are
separate from the Run's cgroup memory ceiling and remain bounded by the request
and publication limits. At most 16 saves and one in-flight save are accepted;
worker reservations are unchanged. No control socket, project descriptor or
host output path enters package code. A retained record's identity is supplied
by the host; application evidence is not certified by retention.

On coordinator loss, that owner opens one recovery-only coordinator for the
bound project inode, epoch and Run. It must fence and release the complete tree
before publishing saved bytes. Recovery never submits work, extends execution
budgets or retries effects. Unconfirmed recovery delivers no saved files.
Previously accepted bytes survive cancellation, not death of both owners or
machine failure. Normal completion and interrupted progress remain distinct
in the output packet.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Report it through
[GitHub's private vulnerability form](https://github.com/jiggy/jig/security/advisories/new).
Include the affected version, supported-host details, reproduction steps, and
the observed security impact. Never include secrets or third-party data.
