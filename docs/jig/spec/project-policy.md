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

`jig init <directory>` creates an ordinary editable greeting package under
`flows/hello`, a short project README, and the project skeleton below. Its
package-local manifest names the exact `@jigging/flow` revision tested with the
Jig build, rather than a moving registry tag. It uses
the same explicit missing-lock resolution permission and review as any other
package; initialization performs no installation, network requests, approval,
or execution. A destination must not exist. Initialization never replaces files.

`jig init --bare <directory>` creates only:

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

`PROJECT_STATE_INVALID` reports retained state whose format or contents cannot
be validated by this build. It is distinct from unsafe filesystem ownership or
permissions (`PROJECT_UNSAFE`). Failed acquisition preserves the retained state;
it does not reset admission, migrate records, or bypass pending cleanup.

## 2. Project sources

`defineJig()` accepts the independently optional `flows`, `bindings`, and
`grants` membership sources, plus the contract-keyed `defaultProviders` map.
Omitted membership means an empty source, not implicit discovery. Omitted
provider mappings impose no explicit preference; [default providers](#default-providers-by-contract)
defines sole-match selection and the separate resolution rules.

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
`FLOW.<ext>` entrypoints. For `bindings`, it selects immediate regular files named
`<LocalName>.ts`. For `grants`, it selects immediate regular `<LocalName>.json`
policies under the [grant contract](grants.md). Discovery does not recurse or follow symlinks. A missing
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
FLOW Package/0 tree. Package paths and digests enter the project candidate.

A Flow is a direct Run target only when it:

- has one qualified `FLOW.<ext>` entrypoint and invocation profile;
- has all invocation requirements resolved through matching ordinary project
  defaults or qualified root Run Checkpoint support;
- declares at most eight attachments, at most one writable; and
- accepts `{}` as settings.

Direct eligibility is structural. Host execution support is planned
separately, so an eligible target can still be unavailable on this host.
An unsatisfied requirement, including an incompatible ordinary default, removes
the automatic direct target; the package can still be configured through a
valid explicit Binding. A direct Flow may call other reviewed Flow or Binding
targets; it is not necessarily a leaf in the admitted child graph.
Project Command, HTTP Request and Finite ACP require a Binding's reviewed
resource grants at the declared invocation slots. Packages requiring those
resources are invoked through configured Bindings, not direct targets.

[Run Checkpoint](run-checkpoint.md) requires a root writable attachment and
the installed command's `--out` owner. Its accepted aggregate survives later
execution interruption under that invocation's bounded retention contract.

Jig qualifies `FLOW.ts` through installed Bun and `FLOW.md` through the
bundled [Markdown interpreter](https://flow.jig.md/spec/markdown-runtime),
both inside the same rootless execution envelope. Other valid formats and
named-operation contracts are unavailable, not silently substituted.
Every Markdown package, including a recipe-only body, derives
the typed `markdown-agent` requirement. Review pins an explicit matching Agent
Flow route from its Binding or project defaults, or the qualified native
implementation when no ordinary route was selected. Markdown
resources are inert: their `package.json` does not initiate Bun preparation.

A TypeScript package with production dependencies supplies
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
resolving that package. `--yes` grants final revision admission, not resolution networking or new resource delegations.
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
Only captured manifests, any supplied root `bun.lock`, and declared workspace
patch files are staged for Bun; other authored files are materialized after
installation. Foreign locks,
preloads, and configuration therefore cannot influence resolution or install.
Git, GitHub, tarball, file, undeclared workspace, custom-registry, and non-integrity entries
in a supplied lock are rejected before the trusted installer starts a fetch.
A default-registry npm alias is accepted
only when the resolved lock tuple names that registry and carries supported
SRI integrity.

### Workspace dependency capture

A Flow may declare `workspace:` dependencies when both it and its libraries
are members of an ancestor Bun workspace. The Jig application may also select
workspace Flow dependencies directly from the workspace root. That selection
captures root package metadata, not unrelated repository files. Jig captures the root manifest and
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
Only selected members' code is staged, after installation. Preparation uses the
pinned Bun hoisted linker and preserves workspace-relative source paths and
installed dependency scopes. Exact installer aliases to selected member roots
are retained as bounded private layout metadata, not Package/0 file records.
This preserves nested versions and canonical module identity, including cyclic
imports. Unselected member links are omitted; unknown links, aliases traversing
aliases, and source-path collisions fail closed. Preparation permits at most
4,096 combined file/alias records and 32 MiB of file content plus layout JSON;
layout JSON has its own 1 MiB ceiling. Existing project-wide preparation bounds
also apply. The target entrypoint runs from its retained member path while its
working directory remains disposable scratch. No isolated-linker mode is exposed.
Ancestor runtime configuration outside selected packages is not captured.
Registry dependencies retain the same integrity and source policy.

The workspace root may declare Bun `patchedDependencies`: at most 256 exact
registry `name@version` keys mapped to root-relative `.patch` files. Paths must
be canonical, at most 1,024 UTF-8 bytes, contain no controls or backslashes,
and traverse neither links nor `.git`, `.jig`, or `node_modules`. Each patch
must be a regular, singly linked file of at most 1 MiB; the existing aggregate
capture limits also apply. Jig captures and rechecks these bytes, including
patches outside the selected members, and stages them before installation.
The supplied lock's patch map must match the root manifest exactly. Bun applies
patches inside the existing contained, script-disabled installation; Jig does
not implement a patch engine or rewrite manifests. Patch bytes remain part of
the retained execution artifact and are verified unchanged after preparation.

Workspace members use the root lock; member locks and member-level patch
declarations, overrides, catalogs, and alternate sources are unsupported.
A new review recaptures the workspace. It may reuse this Jig project's approved
preparation only when the complete captured input digest matches the preparation
evidence bound to that artifact and the current request reproduces its approved
recipe and observation. Inputs include root manifest, lock and patch bytes,
member manifests and selected local source bytes. Flow identity alone is
insufficient. Reuse never crosses Jig project boundaries, even within one
ancestor workspace, and performs no resolution or installation. Missing
preparation evidence or changed inputs require preparation.
Prepared bytes and normalized layout participate in
target-change review, exact admission, launch and durable materialization identity.
The host creates only recorded aliases after copying regular bytes, verifies both
on reopen, and unlinks aliases without following their targets during cleanup.
Runs neither reopen the workspace nor follow development links. Authored package
metadata, contracts and Skills remain relative to the admitted Flow package.

Package-local imports remain available without workspaces. Authored symlinks and
hardlinks whose complete link set cannot be proved inside the captured package
remain invalid; fully contained hardlinks are captured as independent
regular-file records.

### Prepared execution and limits

The admitted target pins the separately retained prepared Package/0 while the
portable lock continues to identify the reviewed source Package/0. Generated
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

Source, author-closure, and prepared Package/0 artifacts share one protected
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

`settings` is one complete immutable JSON/0 object. Omission means `{}`. A
present `settings.schema.json` validates it; without that schema, nonempty
settings are invalid. Jig does not merge defaults, environment values, or
per-invocation overrides into settings.

`slots` is an optional map of at most 256 LocalName keys to exact
`flow:<project-relative-path>` or `binding:<LocalName>` selectors, inline grants,
or `grant:<LocalName>` selections. Omission
normalizes the declaration to `{}` before project defaults are resolved. A
Flow selector must identify a direct Flow target, using empty settings and its
own resolved routes. A Binding selector uses that Binding's own validated settings.
Either may have further routes, within the fixed aggregate resource budget. Grant slots
do not count as child routes. Either target may use the exact
ordinary [Agent Run](agent-run.md) invocation, and a configured
Binding may also use [Project Command](project-command.md) or
[HTTP Request](http-request.md) or [Finite ACP](finite-acp.md). Slots cannot select the parent's own package, directly
or through a Binding; unknown targets, cycles, paths exceeding the root resource budget,
unqualified execution profiles, and packages requiring attachments reject the
candidate. Plain package paths are not slot selectors. Linking captures each
target identity, and apply admits the complete relation and target
configuration in the same immutable generation.
In the example, `binding:critic` is a separate declaration selecting a
different package, such as `flows/critique`, with its own settings and no slots.

Explicit Flow routes are Binding-local. Starting `flow:flows/review` never borrows
routes from `binding:reviewer`; project defaults and qualified native
implementations are resolved from each target's own requirements. The map is neither
a candidate catalogue nor authority to select a different child at runtime.

`uses` in `FLOW.meta.json` (code) or optional Markdown frontmatter declares
uncontracted requirements with `{}` or named requirements with a local
`contract` path. A typed Flow route must offer the identical contract ID,
version and descriptor/closure digest in its root `FLOW.contract.json`. An explicit
route wins or fails; it never falls back. Uncontracted exact Binding routes
need no additional declaration and cannot receive project defaults. Without a
selected ordinary default, only qualified root Run Checkpoint requirements
resolve implicitly to host support. Agent requirements resolve to ordinary
Flows offering the exact contract. HTTP Request, Finite ACP and Project Command
require explicit grants; these three contracts and Run Checkpoint remain
host-only evidence/authority interfaces. Claiming a
descriptor grants no credentials, endpoint access, command execution or
retention authority.
Review shows the resolved route and expected contract for each target slot.

An optional `requires` list beside a dependency's `contract` selects names from
that contract's `features` catalog. The selected package declares its implemented
names in metadata `supports`. Both lists are bounded, unique LocalNames; even
empty declarations require an identified single-form contract, and every name
must occur in that exact catalog. Inspection rejects unknown names before routing.

After exact contract matching, Jig checks required names against the selected
implementation's support declaration. A missing feature marks the consuming
target and its selected dependents `FEATURE_UNAVAILABLE` before their execution
is prepared. Unrelated targets remain eligible. This check never ranks alternatives,
changes an explicit selection or falls back. The decision and evidence belong to
the captured admission generation; visible metadata edits require a new review.
The lock projects both requirements and package support declarations from those
captured bytes. Review names each failing caller slot, selected provider and
missing feature once, including the actual descendant edge for dependent refusals.
Support claims are package-wide obligations across accepted settings, not proof
of provider honesty, native runtime availability, grant authority or successful
execution. No feature requirement is needed for ordinary one-shot calls.

Attachment declarations participate in root eligibility and review without
invocation paths. A direct root or configured Binding receives its declared
attachments through the [root file profile](#root-file-runs). Child relations
to attachment-bearing packages reject the candidate; they do not inherit
parent file access. Unsupported declaration counts reject the project candidate.

Bindings contain no runtime command, environment map, package-manager policy,
or generic permission bag.

### Default providers by contract

`defaultProviders: { 'https://jig.md/contracts/agent-run': 'binding:agent' }`
selects an ordinary implementation for omitted slots requiring that contract.
The optional map contains at most 256 contract IDs, canonically ordered by key.
Each value is an exact Flow or Binding selector. The selected package must
offer a named root `FLOW.contract.json` whose ID equals the map key. A key is
not a consumer-local slot name, a URL to fetch, or a declaration of compatibility.

For each target and requirement, review resolves in this order:

1. An explicit Binding slot wins and must itself validate.
2. Otherwise, a default selected for the required named contract ID must match
   its version and descriptor/closure digest exactly.
3. Otherwise, exactly one structurally provisioned ordinary target offering the
   required ID, version and closure digest supplies the route. Zero remains
   unresolved; several require an explicit selection. Each configured Binding
   is distinct, including an empty Binding and its directly invokable package.
4. A qualified root Run Checkpoint implementation may satisfy its unmapped
   requirement. Other native resources require explicit grants.

Candidate construction does not allocate resources or test provider health.
Targets with root attachments, invalid settings, missing explicit native grants,
or unbound anonymous slots are not candidates. Ordinary named dependencies may
themselves resolve; count candidates before validating the resulting graph,
without pruning cycles or backtracking to manufacture a unique answer.
An ambiguous unconfigured direct identity may remain ineligible when that
package has a Binding; each Binding must still resolve independently. An
explicit consumer selection must not be vetoed by its unused direct identity.

An `npm:<name>` reference explicitly selects project dependency membership.
The host captures the project dependency metadata and prepares its locked
closure through existing Bun controls, then inspects the selected package's
own FLOW files without executing them. Workspace source selection and registry
installation keep their existing limits, permissions and source checks.
No package source, installer alias, mutable manifest, or resource name grants
execution authority. Review retains the exact effective routes and reachable
resource policies; Run uses only those admitted bytes.

A selected but incompatible default never falls back to native authority. It
makes the package's automatic direct target ineligible; an omitted Binding slot
with that mismatch rejects the candidate. An explicit matching Binding override
can still make the package usable. Anonymous requirements need explicit slots.

Each selected default must itself be invokable and require no attachments.
A `flow:` selection must be a direct target; a `binding:` selection uses its
own settings and exact admitted routes and grants. HTTP Request, Project Command
and Run Checkpoint cannot be ordinary defaults. A default selects an
implementation, not resource authority: grant admission and recipient checks
remain unchanged.

Jig resolves defaults for direct Flows and Bindings during review, retains
their effective routes in the same immutable generation, and validates the
complete graph including both target kinds. Cycles, same-package recursion,
and paths exceeding the root resource budget reject the candidate. Runtime calls
use only the retained target-local routes; they do not consult current source,
a defaults map, or a provider catalogue. Changing defaults proposes a new
generation and cannot retarget an already admitted Run.

### Resource grants

A Binding supplies inline `kind: 'http'`, `kind: 'command'` or `kind: 'acp'`
policies through its ordinary `slots` map. Optional `grants: discover('./grants')`
membership enables `grant:<name>` reuse with one JSON policy per named file.
These are proposals until explicit admission. [Grants](grants.md) defines the
closed grammar, capture limits, recipient-scoped continuity and authority
approval. Each grant requires its exact HTTP Request, Project Command or
Finite ACP invocation contract.

An admitted slot pins its policy. The host enforces it outside Flow execution.
For finite ACP, the grant selects the native client; the host holds private
authentication and constrains dispatch and process lifetime, while an ordinary
Agent Flow owns the dialogue and answer interpretation.
Source edits do not revoke active admissions; a new approved
generation changes new Runs, while cancellation settles existing work.
HTTP, finite ACP and command calls share the existing exclusive effect capacity.
Root and child Bindings receive only their own grants. Grant slots do not
introduce nested Flow routes or additional execution capacity.

### Reviewed Binding attachments

A Binding may supply `attachments: { decoder: "tools/base64" }`. Each LocalName
key must name a declared `read` attachment; each value is a project-relative
directory, resolved from the project root. At most eight selections are allowed.
Empty or absent maps select nothing. These values are inert requests to capture
project resources, not live mount permissions. Absolute paths, traversal and
protected `.jig` paths are invalid. No environment or host path expansion occurs.

Every review recaptures each selected tree using the root file capture controls
and limits below, including no links or nested mounts. There are no selectors or
implicit exclusions: a selected directory means its complete bounded regular-file
tree. Review does not execute its contents, discover libraries, install tools,
or search host executables. Capture is not a secret scan; selected bytes are
retained in protected storage even if execution approval is declined.

The Binding lock and review include each source path, tree digest and file
manifest (relative paths, lengths and SHA-256 digests). The retained tree uses
the existing bounded content-addressed store. Admission revalidates those
artifacts with the complete candidate. The exact activation and configuration
identities include them. A source edit changes the next proposed generation,
not the current admission; deleting an original does not invalidate its retained
copy. Missing or corrupt retained bytes fail without recapture or substitution.

Only that root Binding receives the captured bytes through ordinary
`run.attachments`. Other read attachments require `--attach`; supplying an
already-bound name fails rather than overriding it. Bound and per-run inputs
share the 64-file/8-MiB execution budget. Both use sealed descriptors and the
same read-only input projection, without source modes or live host paths.
Children and native Agent/command scopes receive none of these attachments.

These trees can contain data or self-contained code/tool bundles. A script may
use installed Bun; a native bundle must supply its own compatible closure.
Jig does not resolve an arbitrary installed binary's loader or libraries, preserve
executable permissions, or grant mounts for absolute paths embedded in a tool.
Direct code access permits all its behavior within the existing execution
envelope; configured filenames or arguments do not restrict it to one operation.
Narrower semantic rights need a separately authorized owner, not an executable
renamed to look harmless. This profile adds no network, credential or shared
writable resource authority.

Execution cancellation fences owned descendants and releases invocation copies.
Removing a selection and approving the new generation revokes it for future
Runs, not an already running invocation; stop that Run separately. Retained
review artifacts remain subject to the existing store limit and retention policy.

## 6. Candidate and planning

Planning uses one descriptor-held project identity for the complete finite
session. A second competing owner receives a bounded busy result rather than a
second coordinator or authority issuer.

One planning attempt:

1. captures the exact author module graph;
2. evaluates and retains its inert project and Binding values;
3. captures and retains every selected Package/0 tree;
4. links packages, settings, resolved defaults, exact slots, and the complete
   direct-Flow and Binding target graph;
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
native configuration for a target with an ACP grant includes
`PROJECT_ACP_UNAVAILABLE` and a project-relative package location.
Failure to prepare dependencies includes `PACKAGE_BUN_PREPARATION_FAILED`
and its project-relative `package.json` location. These diagnostics include
fixed guidance, not credentials, raw provider errors, or installer output.
Manifest-policy refusals identify the manifest and offending JSON field with
a closed cause: unsupported field or dependency source, invalid object shape,
dependency map, package name, or patch declaration. Rejected values are not
displayed; invalid dependency names identify their containing map instead.
Workspace manifest locations are relative to the Jig project and may begin
with up to 32 `../` segments for an ancestor workspace, within the existing
path bounds. Only these manifest diagnostics permit ancestor locations;
they grant no filesystem access and cannot name protected `.jig` state.
A successful review
shows the complete added, removed, and changed package, Binding, and target
identities. Current and proposed package entries include their full Package/0
content digest, which is the same portable identity written to `jig.lock`.
The default CLI view leads with additions, changes, removals, and the resulting
target list. It shows changed fields as previous/proposed values and omits
unchanged policy. `jig review --details` expands the same diff with unchanged context.
For ACP grants, both views identify the recipient's exact proposed client,
configured model, authentication mode and operator-selected executable through
a non-secret field allowlist. They never expose credentials or private
authentication-store paths. These facts come from authenticated recipes, not
package-authored claims.
Ordinary Agent implementations appear through their selected package,
Binding settings and reviewed resource grants, like other ordinary targets.
Approval behavior is identical in both views; `--details` is display policy,
not another admission operation.

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

- selected package paths and Package/0 digests;
- direct-target eligibility, invocation requirements, and effective ordinary
  routes for direct Flows;
- Binding package choices, settings, and effective slots;
- resolved slot grant policies and reviewed attachment source paths, tree
  digests and file manifests.

Lock slot values are closed target identities: `{ "kind": "flow", "path":
"flows/research" }` or `{ "kind": "binding", "id": "critic" }`,
or resolved grants `{ "kind": "grant", "policy": { ... }, "name": "optional-name" }`. The lock
retains the selected Binding's configuration in its own Binding entry.

Only a package with `directRun: true` may contain `slots`. This optional map
is present only when nonempty and contains only Flow or Binding identities
resolved from project defaults, never grants. Binding `slots` includes its
effective default selections as well as explicit routes and resolved grants.
The authoring `defaultProviders` map is not a runtime lock field. Exact interface
matching, direct-target eligibility and the full bounded graph are validated
with the retained packages, not inferred from lock shape alone.

It contains no runtime path, runtime version guess, host closure, sandbox
detail, process identity, coordinator epoch, or local approval.

Local admission lives under `.jig/` and is separate from the portable lock. A
clone containing source and `jig.lock` therefore carries source and Binding
choices, not execution consent on a new host.

Applying a reviewed Plan:

1. reopens the retained Plan and artifacts by digest;
2. rechecks the project identity, candidate and admission heads, and explicit
   approval for new or changed resource delegations;
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

Each submission has one bounded project-local idempotency key and JSON/0 input.
The first accepted request stores the exact target, canonical input, captured
file manifest, and output intent before
dispatch. Repeating the key with identical content returns the same Run;
changed reuse conflicts and never dispatches again.

After allocation, Jig validates the actual input against
the `input` schema in `FLOW.contract.json`, when present. Invalid input terminates that same durable
Run without starting package code.

Package schema roots use FLOW Schema/0 and therefore declare exactly
`"$schema": "https://flow.jig.md/schemas/schema-0.json"`. This is a portable
package rule, not Jig project authoring metadata.

The host launches one Run/0 process from the exact admitted package bytes in a
rootless Linux envelope. It validates the returned outcome and the complete
result against `FLOW.contract.json` outcomes and its `result` schema. A success is
published only after the complete process tree is fenced, reaped, and cleaned.

While a direct Flow or Binding Run remains open, its package may use Run/0
`flow/call` with one of that target's admitted slot names. Jig resolves the name only to the
exact Flow or Binding target captured in the same admitted generation. The call
carries one JSON/0 input and returns that child's complete JSON/0 Run result;
there is no argument or response channel for target selection, settings,
attachments, or host authority.

Each child starts in a fresh Run/0 context with its own scratch directory,
the selected target's own settings and slots, and empty attachments.
A direct Flow child has empty settings and its own reviewed routes resolved
from project defaults and qualified native requirements. Parent settings,
routes, grants and attachments are not inherited. Its effective deadline is the earlier of its
own direct-Run ceiling and the parent's deadline, so it can never outlive or
widen the parent deadline.

Run/0 owns child operation identity, duplicate joins, conflicting reuse,
cancellation races, and `UNCERTAIN` completion. Jig does not automatically
replay possibly dispatched child work; a deliberate retry uses a new
`operationId`. The child is invocation-local owned work, not an independently
addressable Run. Its terminal exists only as the parent-owned Run/0 operation
result; Jig creates no child Run history and exposes no child administration,
scheduler, catalogue, or resolver.

The root permits two active sibling Flow calls, or one exclusive Agent or
command effect. A child permits one active Flow or effect; admitted branch depth
is bounded by the root's fixed aggregate budget. A third sibling, conflicting operation,
or branch exceeding remaining aggregate capacity receives `RESOURCE_EXHAUSTED` before dispatch;
there is no host queue or automatic retry. Identical waiters join the same
operation. Applications use ordinary promises to schedule and aggregate work,
and per-call cancellation to stop a selected sibling without stopping another.
Run/0's request-lifetime limit still applies.

Before dispatch, Jig reserves every Flow level in the selected branch's longest
admitted path plus its largest possible effect
against a fixed root payload budget: 1,792 MiB memory, 576 tasks, and 3.5 CPU
cores with a 100 ms quota period. Each actual envelope is kernel-limited below
its reservation. Two simultaneous two-level branches fit, including an effect
in each: one root, four child Flows, and two effect envelopes. Each Flow retains
its fixed 256 MiB, 64-task, and half-CPU ceiling; effect ceilings are unchanged.
The same budget permits one five-level child branch with its effect, or two
branches of depths three and one. A sixth child level cannot fit and is rejected
at review. Two individually admissible branches may not fit simultaneously;
their concurrent allocation fails before dispatch rather than borrowing capacity.
Unused reservations are not borrowed; reservations remain
until confirmed fencing and cleanup. This bounds the complete root call tree,
not just each parent's immediate children. Trusted coordinators and supervisors
are outside this payload budget. It is not fair-share scheduling or combined
utilization accounting. Every descendant remains within the root deadline.
The reservation policy participates in each exact launch recipe identity;
a changed policy requires renewed review before execution.

An Agent-using root or child uses `flow/call` through its exact Agent Run slot,
selecting an ordinary Flow implementation. Input carries instructions, optional
explicit Skill contents and guidance, and an optional response Schema/0 value. The result is
`{ "outcome": "done" | "blocked" | "limit", "output": { "text", "structured"? } }`.
There is no method selector or native-only value wrapper. A completed
structured result must match the caller's schema. Consumers validate replacement
results independently; both supplied ordinary methods also validate their own
dynamic result boundary.

The ordinary ACP method uses a [finite native resource](finite-acp.md) through
two required channels. The method owns prompt preparation, protocol dialogue,
public updates and answer interpretation. The resource independently authorizes
native writes and owns private authentication and process settlement. Channel
completion, ACP stop reason and the final Agent result remain distinct.

Agent Run accepts explicit selected Skill contents, with exact-case `SKILL.md`
in each Skill. A caller can read its captured `skills/<name>/` trees using
the public method library. Supplied text is guidance, not host-attested origin;
it grants no tools, network, filesystem, child target, or other authority. Agent and child
calls share the root's absolute deadline. Each direct child occupies one root
branch; its descendants use that branch's reserved Flow and effect capacity.
No ancestor or sibling's files or conversation are included implicitly.
Possibly dispatched Agent work is fenced and reported as uncertain rather
than automatically replayed.

A command-capable Binding may call the exact [Project Command](project-command.md)
contract through a granted slot with a bounded text candidate. Jig uses
the installed Bun runtime inside a separate keyless envelope and collects
output and termination outside candidate execution. The root or child has
only its own admitted slot policy. Command effects share the context's single
active-operation limit and its containing deadlines. Independent assertions
remain application policy; repository test logs cannot establish an
independent verdict. Commands confer no shell, network, installation,
credential, or writable host-repository authority.

A Run is `pending` until it has one durable terminal:

- success with outcome, output, and bounded diagnostics;
- failure with a closed failure code and bounded diagnostics; or
- `COORDINATOR_LOST` when earlier dispatch may have occurred but no result can
  be proved.

The installed CLI shows readable results on terminal stdout. Redirected stdout
or `--json` preserves JSON, or NDJSON for selected channels.
Elapsed status and cancellation updates follow the [CLI experience contract](cli-experience.md) on terminal stderr;
diagnostics remain available with redirected streams. A cancellation request
is not a cleanup acknowledgement. Execution completion, application outcome,
delivery, and late cleanup failure remain distinct observations. Status output
does not turn `blocked` into task success or unknown delivery into a retry hint.

Possibly dispatched work is never replayed merely because its result is
unknown. Closing the project session rejects new starts, revokes its issued Run
authority, settles or fences live Runs, waits for cleanup, and preserves
already durable status records.

### Stale execution approval

If the current host cannot reproduce an admitted root execution recipe because
its execution environment changed, Jig refuses execution with the host-only
`REVIEW_REQUIRED` failure code and directs the operator to `jig review`.
Its details are `reason: "EXECUTION_ENVIRONMENT_CHANGED"` and `flowStarted: false`.
This refusal is established before starting Flow code; it is not inferred from
arbitrary execution failures or missing diagnostics. Existing cancellation and
recovery precedence remain authoritative. Flow Run/0 responses cannot emit this
host-only code. Neither the refusal nor subsequent review replays the failed Run.


### Root file Runs

The installed command accepts `--input JSON|@FILE`, repeated `--attach NAME=DIR`
and `--select NAME=FILE`, and one `--out DIR`. Parsing performs no file reads;
acquisition happens once, preserving caller-relative paths through reexecution.
An ordinary quoted JSON string beginning with `@` is still an inline value.

Every declared read attachment not supplied by the selected Binding requires
exactly one mapping. Selectors name
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
that the opened file remained stable, and parses it as JSON/0 before project
acquisition. Parent-directory aliases and filesystems do not need attachment
mount semantics because neither the path nor its descriptor enters Flow code.
JSON/0's byte and value limits still apply.

Input is projected from immutable sealed bytes, never live host directories.
Per-run captured bytes live only through command ownership and are not retained
as Package/0 artifacts. Reviewed Binding resources instead belong to the admitted
configuration and retained store described above. Durable request evidence sorts attachment names and paths
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
an existing anchored parent, outside every per-run selected input root and protected
state. A separate command owner owns destination staging before allocation,
survives coordinator failure, and removes unpublished staging without another
invocation. Output storage, its bounded read buffer, and destination copies
remain accounted for after the Run cgroup is removed; see the security ceilings.

Publication uses one no-replace atomic directory rename. Directories have mode
`0700`, files `0600`; empty directories and source permissions are not preserved.
`files/` contains Flow deliverables. `result.json` contains the accepted execution
record, Run identity, admitted Package/0 and configuration identity when resolved,
canonical JSON input digest, captured manifest, and delivery manifest. The
manifest lists only Flow files, never its own host record. Private launch,
inode, device, provider, and credential evidence is not exported.

`delivery.status` is `written`, `failed`, or `unknown`, independently of execution
`status`. A written receipt's `source` is `final`, `checkpoint`, or `none`.
A known successful terminal is not downgraded when coordinator loss leaves only
earlier checkpoint files for delivery; the source identifies those bytes.
A valid custom outcome may publish files. Operational execution or
result-validation failure publishes only the actual host record when available,
unless the root declared [Run Checkpoint](run-checkpoint.md). That native invocation
delivers its latest accepted aggregate after confirmed cleanup and adds an
explicit checkpoint record or `null`; it never exports unfinished scratch.
unconfirmed Project Session cleanup also suppresses Flow files and returns a
nonzero command result while preserving a known terminal.

After confirmed interrupted settlement, publication may retain the actual host
terminal without Flow files, even without a checkpoint. Cancellation during
ordinary final-file copying still removes unpublished staging. Validation,
copying, or a destination collision
leaves no packet and removes owned staging. If publication wins cancellation,
the complete packet remains. Later acknowledgement, stdout, or cleanup failure
never retracts the packet, rewrites its terminal, or authorizes reexecution.
Channel loss may leave publication unknown to the caller. The immutable packet
and ordinary stdout agree; later CLI errors can report additional observations.
`written` promises atomic visibility, not persistence through machine failure.
If expanded metadata exceeds the report's JSON/0 limits, the CLI preserves the
unexpanded execution terminal on stdout, reports known delivery/cleanup status
with `JIG_REPORT_LIMIT` on stderr, and exits nonzero without replay.

The root `--timeout` covers execution. Attachment capture checks a 10-second budget and
delivery checks a 20-second budget at bounded operations; the independent
command lifetime also bounds host overhead. Cleanup retains its existing
reserve and is not skipped on cancellation or expiry. These private budgets
do not introduce Flow-controlled policy or a new public timeout API.

## 9. Execution envelope

### Installation verification policy

The operator selects installation verification with
`--verification cached|strict|fast` on `run`, `review`, or `inspect`. The argument
overrides `JIG_VERIFICATION`; if both are absent, the default is `cached`.
Missing, invalid or repeated argument values are usage errors before host
acquisition. An invalid environment value is a configuration error unless a
valid argument overrides it. The effective policy is captured before project
loading and preserved through delegation, file delivery and recovery.
This is a host performance/integrity choice, never a `jig.ts`, FLOW, Binding,
approval, or capability setting. It applies to review, Run, and environment
inspection, including each later installed-support revalidation boundary.

- `cached` reuses an installed file's SHA-256 while its selected canonical path,
  device, inode, ownership, permissions, link count, size, modification time,
  and change time match. Times use filesystem nanosecond precision. A miss or
  mismatch hashes current bytes and checks metadata again before retaining the
  digest. This detects ordinary installation updates, including in-place edits
  with restored modification time; it does not promise fresh byte verification
  when filesystem identity and metadata appear unchanged.
- `strict` hashes current installed bytes at every verification boundary. It
  neither reads nor writes the installation cache.
- `fast` reuses a stored digest for the selected canonical file path without
  comparing file freshness. A cache miss still hashes current bytes. Changed
  installed bytes can therefore retain their old identity without requiring
  review; operators selecting this mode accept that limit.

The bounded, disposable cache contains only installed tool/support paths,
metadata and digests. It lives in owner-private storage outside project source
at `$XDG_CACHE_HOME/jig/installation-verification`, or
`$HOME/.cache/jig/installation-verification` when XDG cache home is unset.
Unsafe locations, symlink cache routes, invalid entries or cache failures fall
back to fresh hashing. Cache deletion is harmless. Inspection can reuse valid
entries but never creates or updates them. A cache grants no approval or
execution authority. Mode selection alone does not change execution identity
when the observed installation bytes agree.

All modes retain executable/path eligibility, supported-runtime and sandbox
feature checks, credential validation, capability permissions, resource limits,
recovery, cancellation and cleanup. Package capture, retained artifacts and
invocation files keep their existing exact verification. These policies concern
change detection for the trusted installation; none protects against a
compromised host administrator, same-user process, runtime or containment tool.

### Containment and lifetime

The direct alpha has one Linux rootless containment mechanism. Before package
bytes execute, it establishes one Run-owned cgroup and configures aggregate
memory, PID, and CPU limits. The same pre-exec path then enters isolated user,
mount, PID, IPC, UTS, cgroup, and network namespaces.

Package code receives:

- the admitted package tree, read-only;
- the root's immutable read attachments and optional bounded empty output;
- one private writable scratch directory;
- Run/0 protocol stdio; and
- only the minimal read-only process and device views required by the pinned
  Bun runtime.

It does not receive the host environment, network, host process tree, writable
cgroup controls, general devices, inherited descriptors, project source,
`.jig`, or host-control channels.

The native resource is a separate bounded process running Codex,
Claude Code, or Pi through the constrained finite ACP mechanism. Jig supplies no
default model. Native executable, model, authentication and launch policy are
operator configuration, not powers supplied by the calling Flow.
An API-backed Agent is an ordinary Flow with reviewed model and wire-format
settings and an exact HTTP resource grant. It runs in the ordinary keyless Flow envelope and
requests only its explicitly granted resources. Selecting that Flow through a
default does not project native credentials or network authority into it.
The ACP Agent is also an ordinary Flow, using its granted native resource and
ordinary channels instead of a hidden host Agent method.

Among native Agent workload processes, only the selected Agent scope receives its bounded
credential projection and inherited network access. The parent Flow remains
network-isolated and keyless. A native client starts with an empty work
directory; Jig advertises no ACP filesystem, terminal, or MCP client
capability, supplies no MCP servers, and grants no permission request. Fixed
Claude and Pi profiles additionally disable native tools and ambient extensions.
Codex retains its constrained native tool environment with no-network workspace
policy and protected authentication projection; it is not a universal tools-off
profile. See [exact native profiles](finite-acp.md#native-client-profiles). Selected
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

Containment and system-management executables default to `/usr/bin`, `/bin`, and the NixOS system profile
`/run/current-system/sw/bin`. The operator may select Bubblewrap through an
absolute `JIG_BWRAP_PATH` in the host environment. An explicit selection must
pass the same executable, feature, retained-identity, and revalidation checks;
failure never selects another executable. Neither project input nor ambient
`PATH` selects those containment tools. Native Agent clients use the separate
[operator executable discovery rules](agent-run.md#alpha-host-implementations).
The selection is not exposed to Flow code.
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
15. Direct-Flow and Binding child calls resolve only exact same-generation Flow
    or bounded Binding targets, receive their own admitted settings and routes and empty attachments,
    cannot exceed the parent deadline, and leave no separately addressable
    child history.
16. One exact Agent Run invocation receives only explicitly supplied Skill
    contents and context, validates structured output, remains inside
    the parent deadline, and gives the Flow neither network nor its provider
    credential.
17. Reviewed project commands execute immutable candidate bytes in separate
    keyless envelopes, retain exact identities and bounded collected evidence,
    reject authority outside the Binding, and close root and child ownership
    on cancellation, deadline, and coordinator loss without replay.
18. Project defaults match named contracts exactly, explicit Binding routes
    override them, mismatches never select native fallback, and anonymous slots
    receive no defaults. Review retains effective direct-Flow and Binding
    routes, rejects invalid or over-deep graphs, and source edits cannot
    change an admitted Run's implementation or authority.
