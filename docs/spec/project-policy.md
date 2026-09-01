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

`jig.ts`, Flow packages, Binding declarations, attachments, and `jig.lock` are
user-owned files. `.jig/` contains local admission and lifecycle state. It is
not project source, is not portable, and is never exposed to package code.

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
- declares no capability use;
- declares no attachment; and
- accepts `{}` as settings.

Direct eligibility is structural. Host execution support is planned
separately, so an eligible target can still be unavailable on this host.

The first alpha host has one exact recipe: `flow.ts` run by Bun inside the
rootless execution envelope. A package with production dependencies supplies
ordinary root `package.json` and text `bun.lock` files and omits generated
`node_modules`. During planning, Jig prepares the frozen production tree with
the fixed Bun installer in the same envelope, lifecycle scripts disabled, and
only default-registry integrity-pinned sources accepted. Unsupported or
unlocked dependency sources fail closed before an applicable Plan is
published.

The admitted target pins the separately retained prepared Package/1 while the
portable lock continues to identify the reviewed source Package/1. A Run
performs no install or fetch and has no network, lifecycle scripts, or ambient
runtime lookup. A package without runtime dependencies needs no preparation.

Planning may reuse the execution Package from the active admission only when
the current request reproduces its exact recipe and observation digests under
the current runtime and containment mechanism. Final publication reacquires
the retained bytes and compare-and-sets the captured policy heads. Missing or
corrupt retained execution bytes fail closed; they are not silently fetched
again under an otherwise unchanged admission.

### Why preparation belongs to `check`

Requiring every TypeScript author to bundle dependencies was rejected because
it replaces Bun's ordinary manifest-and-lock workflow with a Jig-specific
packaging chore. Installing during `run` was also rejected: execution would
then depend on mutable registry state, network availability, installer side
effects, and a larger live authority boundary.

Preparation at `check` keeps both useful properties. Authors use normal Bun
inputs, while review and admission still pin every byte that execution can
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
});
```

`package` resolves from the project root, not from the declaration file. It
must name one selected Flow package. Moving a Binding file therefore does not
retarget it.

`settings` is one complete immutable JSON/1 object. Omission means `{}`. A
present `settings.schema.json` validates it; without that schema, nonempty
settings are invalid. Jig does not merge defaults, environment values, or
per-invocation overrides into settings.

A package that declares attachments requires the Binding to map every declared
name exactly once:

```ts
export default defineBinding({
  package: "./flows/format",
  attachments: {
    source: "./workspace",
  },
});
```

Each source is a confined project-relative path. The access mode comes from
the package declaration and cannot be widened by the Binding. `.jig` remains
excluded even when a mapped ancestor contains it.

The alpha executor currently admits only targets whose exact recipe needs no
attachment. Attachment-bearing Bindings remain valid project configuration
but are unavailable for execution until the installed host can enforce their
declared projection.

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
4. links packages, settings, attachments, and target identities;
5. selects one exact installed-host recipe for every target;
6. derives the complete portable lock; and
7. publishes one retained candidate and human-readable review.

Planning may create protected `.jig/` storage and retain immutable artifacts.
It does not mutate user source or the visible lock, admit execution authority,
or run package code.

If any target has no exact supported recipe, this alpha planning operation
returns `UNAVAILABLE` and publishes no applicable Plan. A successful review
shows the complete added, removed, and changed package, Binding, and target
identities. Its text is bounded and escapes project-controlled Unicode so
terminal control characters cannot alter the consent display.

A successful planning result is either `unchanged` or one applicable retained
Plan. The Plan digest is an internal authorization token carried by the CLI;
users do not need to copy or manage it. If publication commits but its response
is lost, replanning the same unchanged content rediscovers the same retained
meaning without admitting it.

## 7. Lock and local admission

`jig.lock` is the one portable desired-state lock. It records only:

- selected package paths and Package/1 digests;
- direct-target eligibility;
- declared attachments; and
- Binding package choices, settings, and attachment mappings.

It contains no runtime path, runtime version guess, host closure, sandbox
detail, process identity, coordinator epoch, or local approval.

Local admission lives under `.jig/` and is separate from the portable lock. A
clone containing source and `jig.lock` therefore carries reproducible choices,
not execution consent on a new host.

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

An unprefixed name is not guessed. A direct Flow receives empty settings and
no attachments. A Binding receives exactly its admitted settings and mappings.
Callers cannot override package source, runtime, environment, attachments,
authority, deadline policy, or containment.

Each submission has one bounded project-local idempotency key and JSON/1 input.
The first accepted request stores the exact target and canonical input before
dispatch. Repeating the key with identical content returns the same Run;
changed reuse conflicts and never dispatches again.

After allocation, Jig validates the actual input against
`input.schema.json`, when present. Invalid input terminates that same durable
Run without starting package code.

The host launches one Run/1 process from the exact admitted package bytes in a
rootless Linux envelope. It validates the returned outcome and the complete
result against package declarations and `result.schema.json`. A success is
published only after the complete process tree is fenced, reaped, and cleaned.

A Run is `pending` until it has one durable terminal:

- success with outcome, output, and bounded diagnostics;
- failure with a closed failure code and bounded diagnostics; or
- `COORDINATOR_LOST` when earlier dispatch may have occurred but no result can
  be proved.

Possibly dispatched work is never replayed merely because its result is
unknown. Closing the project session rejects new starts, revokes its issued Run
authority, settles or fences live Runs, waits for cleanup, and preserves
already durable status records.

## 9. Execution envelope

The direct alpha has one Linux rootless containment mechanism. Before package
bytes execute, it establishes one Run-owned cgroup and configures aggregate
memory, PID, and CPU limits. The same pre-exec path then enters isolated user,
mount, PID, IPC, UTS, cgroup, and network namespaces.

Package code receives:

- the admitted package tree, read-only;
- one private writable scratch directory;
- Run/1 protocol stdio; and
- only the minimal read-only process and device views required by the pinned
  Bun runtime.

It does not receive the host environment, network, host process tree, writable
cgroup controls, general devices, inherited descriptors, project source,
`.jig`, or host-control channels.

Dependency preparation uses the same ownership, cgroup, filesystem, process,
and cleanup boundary. Only Jig's fixed installer and worker execute there;
package source is handled as data and lifecycle scripts are disabled. That
trusted preparation process may inherit host networking long enough to fetch
the validated lock from the fixed registry. The resulting package is captured
before admission. This does not give the later Flow Run network access.

CPU throttling is not a deadline, so the trusted owner also enforces a hard
wall-clock limit. Every completion, failure, session close, and coordinator
loss kills the whole cgroup, waits until it is unpopulated, removes its
resources, and surfaces cleanup failure. There is no weaker fallback path.

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
4. Invalid package metadata, schemas, Binding settings, attachment mappings,
   or dangling package references reject the complete candidate.
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
