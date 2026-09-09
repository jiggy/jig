# Jig project policy and admission

**Status:** direct-alpha specification candidate.

A Jig project is ordinary editable source plus protected local host state. An
edit proposes a new project meaning; it does not grant execution authority.
Jig captures and reviews one complete candidate, then explicitly admits those
exact bytes.

The governing rule is:

> Source proposes. One aggregate compare-and-set admits. Immutable generations
> execute.

## 1. Project layout

`jig --version` writes the package version embedded at build time followed by
a newline and exits successfully. It does not acquire a project or sandbox,
read project configuration, or look up a version in the registry.

`jig init --bare` creates:

```text
project/
├── .gitignore       contains `.jig/`
├── jig.ts
├── flows/
└── bindings/
```

The generated `jig.ts` makes its conventional membership explicit:

```ts
import { defineJig, discover } from "@jigging/jig";

export default defineJig({
  flows: discover("./flows"),
  bindings: discover("./bindings"),
});
```

The project initially needs no `package.json`, compiler configuration, setup
command, or visible lock. Jig creates protected `.jig/` state as needed. The
first approved project change creates `jig.lock`.

`jig.ts`, Flow packages, Binding declarations, and `jig.lock` are user-owned
files. `.jig/` contains local admission and lifecycle state. It is not project
source, is not portable, and is never exposed to package code.

## 2. Project sources

`defineJig()` accepts only `flows` and `bindings`. Either may be omitted;
omission means an empty source, not implicit discovery.

`discover()` selects shallow membership beneath one or more project-relative
directories. It is not a glob language. `*`, `?`, `[`, `]`, `{`, and `}` are
invalid in discovery roots.

```ts
export default defineJig({
  flows: discover(["./flows", "./vendor"]),
  bindings: discover("./bindings"),
});
```

For `flows`, Jig selects immediate child directories containing exact-case
`FLOW.md`. For `bindings`, it selects immediate regular files named
`<LocalName>.ts`. Discovery does not recurse or follow symlinks. A missing
valid discovery root contributes an empty set. Other entries are inert.

An exact member list is the fail-closed alternative:

```ts
export default defineJig({
  flows: ["./flows/build", "./flows/review"],
  bindings: ["./bindings/reviewer.ts"],
});
```

Discovery and exact-list forms are mutually exclusive for one field. An exact
member must exist and have the required kind. Missing, duplicate, escaping,
symlinked, wrong-kind, NFC-colliding, or case-fold-colliding exact members
invalidate the complete candidate.

Project paths use `/`, are relative Unicode 15.1 NFC strings, and contain no
NUL, backslash, empty, `.`, or `..` segment. One leading `./` is accepted as
authoring convenience and removed during normalization. `.jig` and every path
beneath it are protected and cannot be selected.

Multiple roots form an unordered union. They have no precedence. Duplicate or
overlapping canonical membership invalidates the candidate.

## 3. Author declarations

`jig.ts` and Binding files are TypeScript modules with one default-exported
inert value. They may import `@jigging/jig` and a bounded, acyclic graph of
explicit relative `.ts` modules. Other bare imports, dynamic imports, and
implicit suffix resolution are invalid.

Jig captures the complete static module graph before evaluation. Evaluation
runs with bounded resources and no project filesystem, environment, network,
host IPC, or process authority. Only the captured modules and the inert
authoring SDK are visible. The result must be a bounded canonical value; it
cannot carry callbacks, open handles, classes, or host paths.

Evaluation is not claimed to be mathematically deterministic. Clock and
randomness may affect ordinary language code. Safety comes from capture: Jig
retains the exact evaluated output and source closure, and apply never
reevaluates either.

If source changes during capture, Jig retries a bounded number of times and
then reports the project busy or unavailable. It never combines an evaluated
declaration with a different package tree.

## 4. Flow members and direct targets

Every selected Flow directory is captured and inspected as one immutable
FLOW Package/1 tree. Package paths and digests enter the project candidate.

A Flow is a direct Run target only when it:

- has one code entrypoint;
- declares no capability use, or at most one slot each for the exact Jig
  Agent Run and Run Checkpoint Capability Contracts;
- declares at most eight attachments, at most one writable; and
- accepts `{}` as settings.

Direct eligibility is structural. Host execution support is planned
separately, so an eligible target can still be unavailable on this host.
Project Command requires a Binding's reviewed `commands`; command-capable
packages are therefore invoked through configured Bindings, not direct targets.

[Run Checkpoint](run-checkpoint.md) requires a root writable attachment and
the installed command's `--out` owner. Its accepted aggregate survives later
execution interruption under that capability's bounded retention contract.

The first alpha host has one exact recipe: `flow.ts` run by Bun inside the
rootless execution envelope. A package with production dependencies supplies
ordinary root `package.json` and optionally supplies a text `bun.lock`.
Project Flow capture excludes generated `node_modules` paths, without following
their links; dependency preparation never trusts a development installation.
Package-local source modules imported by relative
path need no dependency entry. During planning, Jig prepares the frozen
production tree with the fixed Bun installer through the same containment and ownership
mechanism used by a Run, lifecycle scripts disabled, and only default-registry
integrity-pinned sources accepted. Unlike a Run, the trusted preparation scope
has network access. Unsupported dependency sources fail closed before an
applicable Plan is published. A supplied lock is always validated and installed
frozen; missing, stale, and invalid are distinct states, not repair modes.

For a package with runtime dependencies but no authored lock, the operator may
pass `jig review --allow-resolution-network`. Without it, planning returns
`PACKAGE_BUN_RESOLUTION_PERMISSION_REQUIRED` at the affected manifest before
resolving that package. `--yes` grants only final Run admission, not networking.
The flag is local to the current review, not a project value, portable lock
field, or retained permission. It grants no Run authority by itself.

Before each new resolution, the CLI displays the escaped package path and
warns that Bun may contact dependency-selected public, private-network, or
loopback services reachable from the host before graph validation. Such
requests cannot be undone by failure or declined approval. The flag is not a
network destination filter. Jig first rejects known unsupported root sources;
standalone missing-lock manifests with workspaces, patches, overrides, or resolutions
are unsupported. It then uses the fixed Bun's lockfile-only resolution,
validates the generated graph against the same source/integrity policy, and
only then performs a frozen install. Unsupported transitive sources can
therefore fail after permitted network activity, not become executable through
the flag. Resolution and installation share the existing preparation limits.

Preparation ignores ambient configuration: the worker and installer receive
no ambient variables or env file, only fixed loader support, `/dev/null` as
Bun configuration, the exact runtime selected by Jig, and an explicit npm
registry. A package-local root `.npmrc` is rejected because Bun treats it as a
separate configuration input.
Only captured manifests and any supplied root `bun.lock` are staged for Bun;
other authored files are materialized after installation. Foreign locks,
preloads, and configuration therefore cannot influence resolution or install.
Git, GitHub, tarball, file, undeclared workspace, custom-registry, and non-integrity entries
in a supplied lock are rejected before the trusted installer starts a fetch.
A default-registry npm alias is accepted
only when the resolved lock tuple names that registry and carries supported
SRI integrity.

### Workspace dependency capture

A Flow may declare `workspace:` dependencies when both it and its libraries
are members of an ancestor Bun workspace. Jig captures the root manifest and
text lock, declared member manifests, and the transitive local runtime dependency
sources. Workspace names must be unique; paths and workspace patterns must stay
relative to that root, without symlink traversal. The workspace root may be above
the Jig application; this grants capture of declared dependencies, not arbitrary
ancestor contents. Explicit workspace requirements never fall back to a registry.

Library `files` paths and glob patterns select source when present, including
`package.json`, README and license files. Otherwise ordinary package files are
selected. `.git` and `node_modules` are excluded. Literal exported files must be
present; Jig runs no author build. Workspace metadata is rechecked after source
capture. Discovery is bounded to 256 members, 32,768 entries, and 32 levels;
metadata is bounded to 1 MiB per manifest and 2 MiB for the root lock. Existing
aggregate preparation limits apply to the captured workspace.

Bun installs the captured target with `--filter`, script execution disabled,
and the supplied root lock frozen, or with explicitly permitted lock resolution.
Workspace lock entries must name captured members and agree with their manifests.
Only selected members' code is staged, after installation. The collector resolves
installer-created workspace links only to captured selected members and retains
regular files in the target's self-contained dependency tree. Unselected member
links are omitted; unknown links and recursive output trees fail closed.
Registry dependencies retain the same integrity and source policy.

Workspace members use the root lock; member locks, dependency patches, overrides,
catalogs, and alternate sources are unsupported. A new review recaptures and
prepares the workspace, rather than reusing dependencies merely because the Flow
source has not changed. The prepared identity participates in target-change review
and admission. Runs neither reopen the workspace nor follow development links.

Package-local imports remain available without workspaces. Symlinks and
hardlinks whose complete link set cannot be proved inside the captured package
remain invalid; fully contained hardlinks are captured as independent
regular-file records.

### Prepared execution and limits

The admitted target pins the separately retained prepared Package/1 while the
portable lock continues to identify the reviewed source Package/1. Generated
`bun.lock` bytes live only in the retained execution package, not visible
source. Without an authored dependency lock, identical source and `jig.lock`
on different machines may resolve different dependency versions. A Run
performs no install or fetch and has no network, lifecycle scripts, or ambient
runtime lookup. A package without runtime dependencies needs no preparation.

For standalone registry preparation, planning may reuse the execution Package
from the active admission only when the current request reproduces its exact
recipe and observation digests under the current runtime and containment
mechanism. Exact reuse performs no
resolution and requires no new resolution permission. Any source change, including a
code-only edit, or changed execution support can invalidate reuse and require
the flag again for unlocked source. Declined preparations do not grant reuse.
Final publication reacquires
the retained bytes and compare-and-sets the captured policy heads. Missing or
corrupt retained execution bytes fail closed; they are not silently fetched
again under an otherwise unchanged admission.

After bounded project capture, the alpha's dependency-planning phase permits
16 distinct actual preparations, 256 MiB of aggregate prepared content, and
one 180-second cancellation deadline. Each contained preparation has the
earlier 60-second hard deadline. Reused admitted execution packages consume
none of the preparation count or output budget. One package accepts at most
4,096 source files and 16 MiB before installation and at most 4,096 files and
32 MiB after installation.

Source, author-closure, and prepared Package/1 artifacts share one protected
content-addressed store. Its fixed limits are 64 MiB per canonical artifact
and 1 GiB per project. Review may retain immutable evidence even when the Plan
is later declined or superseded; that evidence still consumes the cap. The
alpha performs no implicit garbage collection. Existing exact artifacts can
be reused at the cap, but a new artifact fails closed until the closed
project's protected `.jig` state is intentionally removed along with its local
admission and Run history. There is no selective reclamation command in this
alpha.

### Why preparation belongs to `review`

Requiring every TypeScript author to bundle dependencies was rejected because
it replaces Bun's ordinary manifest-and-lock workflow with a Jig-specific
packaging chore. Installing during `run` was also rejected: execution would
then depend on mutable registry state, network availability, installer side
effects, and a larger live authority boundary.

Preparation during `review` keeps both useful properties. Authors use normal
Bun inputs, while review and admission still pin every byte that execution can
load. The prepared tree is not a second user lock or a portable FLOW concept;
it is private content-addressed host evidence. Bundling remains an optional
authoring choice for packages that prefer a self-contained source tree.

## 5. Bindings

A Binding gives one package a reusable project-local configuration. A file's
basename is its `LocalName` ID; there is no duplicate `id` field.

```text
bindings/reviewer.ts    -> Binding ID `reviewer`
```

A Binding default-exports:

```ts
import { defineBinding } from "@jigging/jig";

export default defineBinding({
  package: "./flows/review",
  settings: {
    strict: true,
  },
  slots: {
    research: "flow:./flows/research",
    critique: "binding:critic",
  },
});
```

`package` resolves from the project root, not from the declaration file. It
must name one selected Flow package. Moving a Binding file therefore does not
retarget it.

`settings` is one complete immutable JSON/1 object. Omission means `{}`. A
present `settings.schema.json` validates it; without that schema, nonempty
settings are invalid. Jig does not merge defaults, environment values, or
per-invocation overrides into settings.

`slots` is an optional map of at most 256 LocalName keys to exact
`flow:<project-relative-path>` or `binding:<LocalName>` selectors. Omission
normalizes to `{}`. A Flow selector must identify a direct Flow target, using
empty settings. A Binding selector uses that Binding's own validated settings
and must select a Binding with no child slots. Either target may use the exact
Agent Run capability, and a configured Binding may also use
[Project Command](project-command.md). Slots cannot select the parent's own package, directly
or through a Binding; unknown targets, cycles, nonleaf Bindings,
instruction-only packages, and packages requiring attachments reject the
candidate. Plain package paths are not slot selectors. Linking captures each
target identity, and apply admits the complete relation and target
configuration in the same immutable generation.
In the example, `binding:critic` is a separate declaration selecting a
different package, such as `flows/critique`, with its own settings and no slots.

Slots are Binding-local. Starting `flow:flows/review` never borrows slots from
`binding:reviewer`, and no direct `flow:` target has slots. The map is neither
a candidate catalogue nor authority to select a different child at runtime.

Attachment declarations participate in root eligibility and review without
invocation paths. A direct root or configured Binding receives its declared
attachments through the [root file profile](#root-file-runs). Child relations
to attachment-bearing packages reject the candidate; they do not inherit
parent file access. Unsupported declaration counts reject the project candidate.

Bindings contain no runtime command, environment map, package-manager policy,
or generic permission bag.

## 6. Candidate and planning

Planning uses one descriptor-held project identity for the complete finite
session. A second competing owner receives a bounded busy result rather than a
second coordinator or authority issuer.

One planning attempt:

1. captures the exact author module graph;
2. evaluates and retains its inert project and Binding values;
3. captures and retains every selected Package/1 tree;
4. links packages, settings, exact child slots, and target identities;
5. selects one exact installed-host recipe for every target;
6. derives the complete portable lock; and
7. publishes one retained candidate and human-readable review.

Planning is Run-admission-neutral, not free of authority or side effects. It
may create protected `.jig/` storage and retain immutable artifacts, and may
exercise explicitly granted resolution networking before final approval.
It does not mutate user source or the visible lock, admit execution authority,
or run package code.

If any target has no exact supported recipe, this alpha planning operation
returns `UNAVAILABLE` and publishes no applicable Plan. Missing or invalid
host Agent configuration for an Agent-using target includes
`PROJECT_AGENT_UNAVAILABLE` and its project-relative `FLOW.md` location.
Failure to prepare dependencies includes `PACKAGE_BUN_PREPARATION_FAILED`
and its project-relative `package.json` location. These diagnostics include
fixed guidance, not credentials, raw provider errors, or installer output.
A successful review
shows the complete added, removed, and changed package, Binding, and target
identities. Current and proposed package entries include their full Package/1
content digest, which is the same portable identity written to `jig.lock`.
The review is not a source-file diff; authors inspect editable source with
their editor or version-control tools before approval. Its text is bounded and
escapes project-controlled Unicode so terminal control characters cannot
alter the consent display.

The target change summary describes affected admitted execution targets. A
target may therefore be marked changed because its selected package identity
or exact host execution evidence changed even when its visible configuration
fields did not. Package digests are shown once in the package section; private
recipe and host-observation identities are never exposed by the review.

A successful planning result is either `unchanged` or one applicable retained
Plan. The Plan digest is an internal authorization token carried by the CLI;
users do not need to copy or manage it. If publication commits but its response
is lost, replanning the same unchanged content rediscovers the same retained
meaning without admitting it.

## 7. Lock and local admission

`jig.lock` is the one portable desired-state lock. It records only:

- selected package paths and Package/1 digests;
- direct-target eligibility;
- Binding package choices, settings, and exact child slots.

Lock slot values are closed target identities: `{ "kind": "flow", "path":
"flows/research" }` or `{ "kind": "binding", "id": "critic" }`. The lock
retains the selected Binding's configuration in its own Binding entry.

It contains no runtime path, runtime version guess, host closure, sandbox
detail, process identity, coordinator epoch, or local approval.

Local admission lives under `.jig/` and is separate from the portable lock. A
clone containing source and `jig.lock` therefore carries source and Binding
choices, not execution consent on a new host.

Applying a reviewed Plan:

1. reopens the retained Plan and artifacts by digest;
2. rechecks the project identity and the candidate and admission heads;
3. writes the exact proposed `jig.lock` durably; and
4. advances local admission in one compare-and-set transaction.

Apply never rereads or reevaluates visible source. If source has since changed,
that edit remains a later proposal; it cannot mutate the retained Plan. If the
Plan's base admission has changed, apply returns stale and grants nothing.

Lock publication precedes admission. A crash between the two leaves a visible
but inert lock and the old complete admission. Replaying the same retained Plan
converges that state. A crash during the admission transaction exposes either
the old or the new complete generation, never mixed authority.

If admitted meaning already matches and only the visible lock is absent or
drifted, apply repairs the lock without creating a new execution generation.
The CLI handles that distinction; it is not a user-selected protocol mode.

## 8. Direct Run

Only an exact target in the current admitted generation can start. Target
identity is explicit:

```text
flow:flows/build
binding:reviewer
```

An unprefixed name is not guessed. A direct Flow receives empty settings.
A Binding receives exactly its admitted settings. Callers
cannot override package source, runtime, environment, authority, the host
deadline ceiling, or containment. The installed CLI may supply the exact
declared root attachments and choose one root execution duration within
the host's fixed policy; it does not change admitted project meaning.

Each submission has one bounded project-local idempotency key and JSON/1 input.
The first accepted request stores the exact target, canonical input, captured
file manifest, and output intent before
dispatch. Repeating the key with identical content returns the same Run;
changed reuse conflicts and never dispatches again.

After allocation, Jig validates the actual input against
`input.schema.json`, when present. Invalid input terminates that same durable
Run without starting package code.

Package schema roots use FLOW Schema/1 and therefore declare exactly
`"$schema": "https://flow.jig.md/schemas/schema-1.json"`. This is a portable
package rule, not Jig project authoring metadata.

The host launches one Run/1 process from the exact admitted package bytes in a
rootless Linux envelope. It validates the returned outcome and the complete
result against package declarations and `result.schema.json`. A success is
published only after the complete process tree is fenced, reaped, and cleaned.

While a Binding Run remains open, its package may use Run/1 `flow/run-child` with
one of that Binding's admitted slot names. Jig resolves the name only to the
exact Flow or Binding target captured in the same admitted generation. The call
carries one JSON/1 input and returns that child's complete JSON/1 Run result;
there is no argument or response channel for target selection, settings,
attachments, or host authority.

Each child starts in a fresh Run/1 context with its own scratch directory,
the selected target's own settings, empty attachments, and no child slots.
A direct Flow child has empty settings. Parent settings and attachments are
not inherited. Its effective deadline is the earlier of its
own direct-Run ceiling and the parent's deadline, so it can never outlive or
widen the parent deadline.

Run/1 owns child operation identity, duplicate joins, conflicting reuse,
cancellation races, and `UNCERTAIN` completion. Jig does not automatically
replay possibly dispatched child work; a deliberate retry uses a new
`operationId`. The child is invocation-local owned work, not an independently
addressable Run. Its terminal exists only as the parent-owned Run/1 operation
result; Jig creates no child Run history and exposes no child administration,
scheduler, catalogue, or resolver.

The root permits two active sibling Flow calls, or one exclusive Agent or
command effect. Each leaf permits one effect and no child Flow calls. A third
sibling or conflicting effect receives `RESOURCE_EXHAUSTED` before dispatch;
there is no host queue or automatic retry. Identical waiters join the same
operation. Applications use ordinary promises to schedule and aggregate work,
and per-call cancellation to stop a selected sibling without stopping another.
Run/1's request-lifetime limit still applies.

Before dispatch, Jig reserves a Flow branch plus its largest possible effect
against a fixed root payload budget: 1,280 MiB memory, 448 tasks, and 2.5 CPU
cores with a 100 ms quota period. Each actual envelope is kernel-limited below
its reservation. Unused reservations are not borrowed; reservations remain
until confirmed fencing and cleanup. This bounds the complete root call tree,
not just each parent's immediate children. Trusted coordinators and supervisors
are outside this payload budget. It is not fair-share scheduling or combined
utilization accounting. Every descendant remains within the root deadline.

An Agent-capable root or child package may use ordinary Run/1 `capability/call`
through its one exact admitted Agent Run Capability Contract slot. The `run`
method accepts instructions, an optional exact package-local skill selection,
and an optional response Schema/1 value. Its wire success is
`{ "value": { "outcome", "text", "structured"? } }`; Run SDK/1 unwraps the
outer `value`. A completed structured result is validated against the caller's
schema before it is returned to the package.

Selected skills are immediate `skills/<name>/` subtrees containing exact-case
`SKILL.md`. Omission selects none. They are copied from the immutable admitted
package and passed as read-only guidance only to that call; they grant no
tools, network, filesystem, child target, or other authority. Agent and child
calls share the root's absolute deadline. Each child occupies one root branch;
its own Agent call uses the effect capacity already reserved for that branch.
Child skills come only from the selected
child's admitted package.
Possibly dispatched Agent work is fenced and reported as uncertain rather
than automatically replayed.

A command-capable Binding may call the exact [Project Command](project-command.md)
contract with a bounded text candidate and a reviewed command name. Jig uses
the installed Bun runtime inside a separate keyless envelope and collects
output and termination outside candidate execution. The root or child has
only its own admitted command map. Command effects share the context's single
active-operation limit and its containing deadlines. Independent assertions
remain application policy; repository test logs cannot establish an
independent verdict. Commands confer no shell, network, installation,
credential, or writable host-repository authority.

A Run is `pending` until it has one durable terminal:

- success with outcome, output, and bounded diagnostics;
- failure with a closed failure code and bounded diagnostics; or
- `COORDINATOR_LOST` when earlier dispatch may have occurred but no result can
  be proved.

Possibly dispatched work is never replayed merely because its result is
unknown. Closing the project session rejects new starts, revokes its issued Run
authority, settles or fences live Runs, waits for cleanup, and preserves
already durable status records.

### Root file Runs

The installed command accepts `--input JSON|@FILE`, repeated `--attach NAME=DIR`
and `--select NAME=FILE`, and one `--out DIR`. Parsing performs no file reads;
acquisition happens once, preserving caller-relative paths through reexecution.
An ordinary quoted JSON string beginning with `@` is still an inline value.

Every declared read attachment requires exactly one mapping. Selectors name
exact regular files relative to that root; without selectors Jig enumerates
its bounded tree. Unknown or duplicate mappings/selectors fail before dispatch.
Review requires no invocation paths. The declared writable attachment requires
`--out`; with no writable attachment, `--out` publishes only the host record.

Capture preserves binary and empty file bytes, omits empty directories, and
rejects symlinks, multiply linked files, special files, traversal, malformed
Unicode paths, and nested mounts. Descriptor-relative acquisition prevents
pathname substitution from changing the selected root. Protected paths and
resolved mount-source aliases into `/proc`, `/sys`, `/dev`, `/run`, or `.jig`
are refused. Supported source and destination-parent filesystems
are ext4, XFS, Btrfs, and tmpfs, with Linux `openat2` and no-replace rename support;
unsupported semantics have no fallback. These checks exclude a malicious host
administrator or same-user process, as specified in the security boundary.

Limits are aggregate across input attachments: eight declared attachments
including any writable one, 64 regular files, 8 MiB content, 256 enumerated
entries, 16 path components, and 512 UTF-8 bytes per relative path. Exact
selection never enumerates unselected subtrees. A detected file mutation fails
capture; the captured set is not an atomic repository revision or a secret scan.

`@FILE` is operator-selected data, not an execution attachment. Jig opens its
non-symbolic-link regular-file leaf once, bounds and snapshots its bytes, checks
that the opened file remained stable, and parses it as JSON/1 before project
acquisition. Parent-directory aliases and filesystems do not need attachment
mount semantics because neither the path nor its descriptor enters Flow code.
JSON/1's byte and value limits still apply.

Input is projected from immutable sealed bytes, never live host directories.
Captured bytes live only through command ownership and are not retained as
Package/1 artifacts. Durable request evidence sorts attachment names and paths
ordinally and records names, lengths, SHA-256 content digests, and the absolute
output intent. Equivalent selected bytes have the same data identity regardless
of source spelling; hashes never authenticate the private file descriptors.
Same-submission conflict rules include this identity. Repeating the CLI command
creates a new submission, not a replay or export-resumption request.

The single writable attachment is initially empty, on a 16 MiB anonymous tmpfs
inside the completed execution envelope. Its runtime metadata and allocation
are subject to the scope's aggregate memory ceiling. A trusted descriptor
handoff retains this bounded filesystem beyond complete writer fencing and
execution cleanup. The host validates its final tree before copying: at most
64 singly linked regular files, 16 MiB logical bytes, and the same entry, depth,
and path limits as capture. Sparse excess, links, and special files reject
delivery without changing a separately accepted execution terminal.

Destination preparation precedes dispatch. The new leaf must be absent beneath
an existing anchored parent, outside every selected input root and protected
state. A separate command owner owns destination staging before allocation,
survives coordinator failure, and removes unpublished staging without another
invocation. Output storage, its bounded read buffer, and destination copies
remain accounted for after the Run cgroup is removed; see the security ceilings.

Publication uses one no-replace atomic directory rename. Directories have mode
`0700`, files `0600`; empty directories and source permissions are not preserved.
`files/` contains Flow deliverables. `result.json` contains the accepted execution
record, Run identity, admitted Package/1 and configuration identity when resolved,
canonical JSON input digest, captured manifest, and delivery manifest. The
manifest lists only Flow files, never its own host record. Private launch,
inode, device, provider, and credential evidence is not exported.

`delivery.status` is `written`, `failed`, or `unknown`, independently of execution
`status`. A written receipt's `source` is `final`, `checkpoint`, or `none`.
A known successful terminal is not downgraded when coordinator loss leaves only
earlier checkpoint files for delivery; the source identifies those bytes.
A valid custom outcome may publish files. Operational execution or
result-validation failure publishes only the actual host record when available,
unless the root declared [Run Checkpoint](run-checkpoint.md). That capability
delivers its latest accepted aggregate after confirmed cleanup and adds an
explicit checkpoint record or `null`; it never exports unfinished scratch.
unconfirmed Project Session cleanup also suppresses Flow files and returns a
nonzero command result while preserving a known terminal.

Without an accepted checkpoint, cancellation before ordinary publication leaves
no packet. Validation, copying, or a destination collision
leaves no packet and removes owned staging. If publication wins cancellation,
the complete packet remains. Later acknowledgement, stdout, or cleanup failure
never retracts the packet, rewrites its terminal, or authorizes reexecution.
Channel loss may leave publication unknown to the caller. The immutable packet
and ordinary stdout agree; later CLI errors can report additional observations.
`written` promises atomic visibility, not persistence through machine failure.
If expanded metadata exceeds the report's JSON/1 limits, the CLI preserves the
unexpanded execution terminal on stdout, reports known delivery/cleanup status
with `JIG_REPORT_LIMIT` on stderr, and exits nonzero without replay.

The root `--timeout` covers execution. Attachment capture checks a 10-second budget and
delivery checks a 20-second budget at bounded operations; the independent
command lifetime also bounds host overhead. Cleanup retains its existing
reserve and is not skipped on cancellation or expiry. These private budgets
do not introduce Flow-controlled policy or a new public timeout API.

## 9. Execution envelope

The direct alpha has one Linux rootless containment mechanism. Before package
bytes execute, it establishes one Run-owned cgroup and configures aggregate
memory, PID, and CPU limits. The same pre-exec path then enters isolated user,
mount, PID, IPC, UTS, cgroup, and network namespaces.

Package code receives:

- the admitted package tree, read-only;
- the root's immutable read attachments and optional bounded empty output;
- one private writable scratch directory;
- Run/1 protocol stdio; and
- only the minimal read-only process and device views required by the pinned
  Bun runtime.

It does not receive the host environment, network, host process tree, writable
cgroup controls, general devices, inherited descriptors, project source,
`.jig`, or host-control channels.

The Agent implementation is a separate bounded process. The host may use the
official OpenAI JavaScript SDK against an operator-selected OpenAI-compatible
endpoint, or select native Codex, Claude Code, or Pi through one private ACP
mechanism. Direct configuration uses either the `responses` (default) or
`chat-completions` wire shape. Jig supplies no default model. Client, API,
endpoint, model, executable path, and credentials are trusted host
configuration, not FLOW or Binding inputs.

Among workload processes, only the selected Agent scope receives its bounded
credential projection and inherited network access. The parent Flow remains
network-isolated and keyless. A native client starts with an empty work
directory; Jig advertises no ACP filesystem, terminal, or MCP client
capability, supplies no MCP servers, and grants no permission request. Fixed
profiles disable client tools, extensions, plugins, and native skills. Selected
FLOW skills become bounded instruction text only. No Agent implementation can
widen the Flow's exact admitted child slots, and none creates a public provider
registry or SPI.

Dependency preparation uses the same ownership, cgroup, filesystem, process,
and cleanup boundary. Only Jig's fixed installer and worker execute there;
package source is handled as data and lifecycle scripts are disabled. That
trusted preparation process may inherit host networking long enough to fetch
the validated lock from the fixed registry, or perform explicitly permitted
missing-lock resolution before graph validation. The resulting package is captured
before admission. This does not give the later Flow Run network access.

CPU throttling is not a deadline, so the trusted owner also enforces a hard
wall-clock limit. Root Runs default to 30 seconds; the installed CLI accepts a
positive integer duration with `ms`, `s`, `m`, or `h`, up to 24 hours. This
deadline begins with the accepted root Run. Project acquisition precedes it,
and mandatory fencing and cleanup may settle afterward. Every completion,
failure, session close, and coordinator loss kills the whole cgroup, waits
until it is unpopulated, removes its resources, and surfaces cleanup failure.
There is no weaker fallback path.

Host executables default to `/usr/bin`, `/bin`, and the NixOS system profile
`/run/current-system/sw/bin`. The operator may select Bubblewrap through an
absolute `JIG_BWRAP_PATH` in the host environment. An explicit selection must
pass the same executable, feature, retained-identity, and revalidation checks;
failure never selects another executable. Neither project input nor ambient
`PATH` selects host executables. The selection is not exposed to Flow code.
NixOS uses its system-managed nix-ld link to select the real glibc
loader. Runtime support is still authenticated and mounted file by file;
neither the nix-ld shim nor the entire Nix store is exposed to a Run. These
host paths do not alter capability, delegation, or resource requirements.

Containment details are Jig host internals. FLOW metadata cannot choose or
weaken them.

## 10. Editing behavior

- Adding or changing source proposes a new candidate. It has no effect until
  review and apply.
- Deleting a member proposes removal. The old admitted generation remains
  usable until a replacement is applied.
- Renaming is one removal plus one addition in the same candidate.
- Formatting changes which preserve normalized project meaning need no new
  admission.

Runtime dispatch always uses an immutable admitted generation. It never reads
the live discovery directories to decide what to execute.

## 11. Required conformance

The direct-alpha project implementation must prove at least:

1. Bare initialization creates only `.gitignore`, `jig.ts`, `flows/`, and
   `bindings/`, and cleans up its own partial output after failure.
2. Discovery is shallow and exact; missing roots are empty; exact lists fail
   closed; unsafe paths, symlinks, aliases, and collisions reject.
3. Only the captured static TypeScript closure is evaluated, under bounded
   authority, and apply never reevaluates it.
4. Invalid package metadata, schemas, Binding settings or slots,
   unsupported attachment profiles or child relations, or dangling package references reject
   the complete candidate.
5. Source changes grant no authority before explicit apply.
6. A Plan binds the exact candidate, lock, host readiness observation, and
   base admission; stale apply changes nothing.
7. Lock bytes become durable before local admission; injected crashes expose
   either the old or new complete authority state.
8. Replaying one Plan is idempotent. Lost Plan publication responses and lost
   Run acknowledgements converge without duplicate authority or execution.
9. A direct Run resolves only an exact admitted `flow:` or `binding:` target,
   validates input before package execution, and validates outcomes and result
   before success.
10. Same submission key and content returns one Run; changed content conflicts
    before dispatch.
11. Coordinator loss fences possibly dispatched work and reports loss without
    redispatch or invented success.
12. Session close linearizes with in-flight operations, rejects new work,
    settles or fences live Runs, and releases exclusive project ownership.
13. Hostile descendants cannot escape aggregate resource limits, namespace or
    filesystem isolation, deadline enforcement, cancellation, or whole-tree
    cleanup.
14. Repeated Runs leave no process, cgroup, scratch, or private-device residue.
15. Binding-local child calls resolve only exact same-generation Flow or leaf
    Binding targets, receive their own admitted settings and empty attachments,
    cannot exceed the parent deadline, and leave no separately addressable
    child history.
16. One exact Agent Run capability projects only explicitly selected
    package-local skill subtrees, validates structured output, remains inside
    the parent deadline, and gives the Flow neither network nor its provider
    credential.
17. Reviewed project commands execute immutable candidate bytes in separate
    keyless envelopes, retain exact identities and bounded collected evidence,
    reject authority outside the Binding, and close root and child ownership
    on cancellation, deadline, and coordinator loss without replay.
