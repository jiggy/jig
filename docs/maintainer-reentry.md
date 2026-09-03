# Maintainer re-entry guide

This is the note a departing maintainer should leave for a future maintainer
who remembers nothing about Jig or FLOW. It is a living orientation guide, not
a specification, roadmap, release record, or substitute for executable
evidence.

It is repository-operational material under the root MPL-2.0 fallback in
`LICENSES.md`, not CC-BY public explanatory documentation.

The architectural boundaries and working rules below are intended to remain
current. The final state snapshot is dated and must be reverified before use.
When a release, public surface, supported host, or selected frontier changes,
update this guide in the same change.

## The one-minute model

Jig is a small, local, fail-closed host for reviewed FLOW packages:

```text
editable source
    -> immutable capture
    -> review
    -> admission
    -> exact execution
    -> complete fencing and cleanup
```

The governing law is:

> Source proposes. One aggregate compare-and-set admits. Immutable generations
> execute.

FLOW defines portable package and invocation meaning. Jig owns admission,
authority, containment, provider selection, and durable host state. A Flow
owns application logic. Sley or another component library may own live
in-process graph execution inside a Flow. Models return data; only admitted
Jig policy grants authority.

If you remember only one failure pattern, remember this:

> Jig repeatedly gets into trouble when machinery needed to prove one case is
> promoted into permanent architecture.

Its successful working pattern is:

```text
freeze one concrete outcome
    -> let an independent consumer expose the smallest missing seam
    -> implement only that seam
    -> prove authority, failure, cancellation, and cleanup
    -> delete the superseded path
    -> return to external evidence
```

## First ten minutes after returning

1. Read the root `AGENTS.md` and every child `AGENTS.md` on the paths you may
   touch. Do not trust remembered instructions.
2. Run `git status --short`, inspect recent commits, and compare `HEAD` with
   every relevant remote. Concurrent agents and the owner may have advanced
   the tree since the last report. Existing changes are theirs until proved
   otherwise: inspect them before continuing, never reset or clean them, stage
   exact paths, and inspect the staged list before committing.
3. Read the current root `README.md`, `SECURITY.md`, and `RELEASING.md`.
4. Read `docs/jig/spec/project-policy.md`,
   `docs/jig/spec/project-sdk.md`, and `docs/jig/spec/agent-run.md`.
5. Read the FLOW specifications under `docs/flow/spec/`. FLOW normative text
   must remain host-neutral.
6. Read `docs/suspended-experiments.md` before considering a feature that once
   existed.
7. Inspect current package manifests, root exports, CLI help, npm dist-tags,
   provenance, Git tags, and recent automation results. Do not infer them from
   this dated snapshot.
8. Check `.tmp/current-blockers.md` if it exists, but remember that `.tmp` is
   intentionally disposable and non-normative.
9. Run focused causal checks before a broad suite. For public changes, test
   the packed artifact from an external consumer.
10. Before implementing a new vertical, write its outcome, smallest proof,
    public concepts, exclusions, and stop condition.

Read old external-reviewer reports only as dated evidence. Research catalogues
are hypotheses, not product availability or a selected roadmap. Git preserves
history; current specifications and tests determine current truth.

## Layer ownership

| Layer | Owns | Must not own |
| --- | --- | --- |
| FLOW | Package/1, JSON/1, Schema/1, Run/1, Run SDK/1, capability descriptors | Jig admission, providers, sandboxes, persistence, project configuration, graph policy |
| Jig | Capture, review, admission, exact resolution, host authority, durable lifecycle, containment, credentials | General workflow semantics, a scheduler, or universal provider/runtime/backend frameworks |
| Flow package | Application logic, validation, Agent instructions, package-local skills, optional internal libraries/graphs | Host credentials, open-ended target authority, containment policy |
| Sley or another component runtime | Live graph advancement within one component process | FLOW/Jig meaning, durable orchestration, admission, or provider policy |
| Application/Starter | Domain rules, prompts, UX, Kanban, repository policy, professional oversight | New Jig core ontology merely because one application needs it |

FLOW's process boundary deliberately excludes host records, resolution,
authority evidence, provider identity, persistence, and application ontology.
Bun, systemd, Bubblewrap, Jig Bindings, Agent clients, and dependency
preparation are Jig facts, never FLOW vocabulary.

## Current public shape

The user experience should remain comprehensible as:

```text
jig init --bare <directory>
jig check [project] [--yes]
jig run <flow:path|binding:id> [--input JSON] [--timeout DURATION]
```

There is no `jig setup`, daemon, runtime selector, sandbox selector, provider
management command, or public apply protocol.

The `@jigging/jig` package root exports only:

```ts
defineJig(...)
discover(...)
defineBinding(...)
```

and the two corresponding input types. These are inert authoring values; they
do not read, install, approve, or execute anything.

The `@jigging/flow` package is Run/1 ergonomics. Its central operation is:

```ts
await handle(async (run) => { ... });
```

One process handles one root request and exits. It is not a resident server.
After `handle()` takes ownership, protocol stdin/stdout belong to the SDK and
ordinary `console.log`, `console.info`, and `console.debug` go to stderr. A
bare Run/1 implementation remains responsible for reserving stdout itself.
Never restore the superseded `serve` name as an alias.

The SDK exposes `callFlow` and `callEffect` because they are portable Run/1
operations. It does not expose Jig, Agent, provider, graph, sandbox, or
administration APIs.

Everything under `packages/jig/src/internal/` remains private machinery even
when a TypeScript symbol is exported for composition or testing. One mechanism
has not earned a public SPI.

The ordinary authored shape is equally small. A FLOW package has exact-case
`FLOW.md`, whose only required metadata is `name` and `description`, plus zero
or one obvious root `flow.<suffix>` implementation and ordinary colocated
resources. Optional `input.schema.json`, `settings.schema.json`, and
`result.schema.json` carry reusable value contracts. Do not add host runtimes,
commands, credentials, dependency locks, or sandbox policy to `FLOW.md`.

A bare project keeps its defaults explicit in inert `jig.ts`: shallow
`discover("./flows")` and `discover("./bindings")`. Discovery executes
nothing, follows no symlink, interprets no glob, and grants no authority;
missing roots are empty and one invalid selected member rejects the candidate.
Exact member arrays are the fail-closed alternative.

Bindings are optional configured uses of one selected Flow. They may supply
immutable JSON settings and exact same-generation child slots. They are not
wrappers required around every component, generic permission bags, provider
selectors, or attachment placeholders. The current Jig alpha has no project
attachment mapping; a FLOW package may still declare portable attachment
requirements, but such a package is not currently an executable Jig target.

## Admission and lifecycle laws

These are the invariants most likely to be accidentally simplified away.

1. **Planning is authority-neutral, not read-only.** `jig check` may bootstrap
   protected `.jig` state, capture and evaluate source, prepare dependencies,
   and retain immutable packages and a review Plan. Before confirmation it
   must not modify visible source or `jig.lock`, grant admission or Run
   authority, or execute package code. The same command displays the review
   and, after explicit confirmation, admits it; users never manage a second
   apply protocol or Plan digest.
2. **Capture precedes authority.** Never evaluate or execute mutable visible
   source. Capture the declaration closure and packages first.
3. **Decoded or hashed does not mean authorized.** Parsing, schema validation,
   a digest, or `jig.lock` alone cannot grant execution authority.
4. **Portable lock and local consent remain distinct.** `jig.lock` records
   reproducible project meaning. Protected `.jig` state records host-local
   admission and execution. Cloning a lock never transfers consent.
5. **Project identity has one owner.** A descriptor-held exact project identity
   lasts for the complete finite session. A competing acquisition returns a
   bounded busy result; it never creates a second coordinator or authority
   issuer.
6. **Approval consumes retained meaning.** It reopens the retained Plan and
   exact artifacts. It never re-evaluates whichever source happens to be
   visible later.
7. **Lock publication precedes admission.** A crash between the durable visible
   lock and the admission compare-and-set leaves the old complete authority
   plus an inert lock. Replay of the retained Plan converges it; mixed
   authority is never exposed.
8. **One generation executes.** Root and child resolution use the exact same
   admitted generation, never a live directory or mutable catalogue.
9. **Validate both sides.** Validate actual input before package bytes execute,
   then validate the declared outcome and complete result before success.
10. **Intent is durable before effects.** Request identity and content are
   committed before package or provider dispatch. Reuse with changed content
   conflicts.
11. **Unknown dispatch stays unknown.** Possibly dispatched work is never sent
   again just because its result is unavailable. Preserve `UNCERTAIN` and
   `COORDINATOR_LOST`; never infer success from disappearance.
12. **Support and launch authority differ.** Stable mechanism support belongs
    in reproducible planning evidence. Ephemeral cgroup, device, and launch
    authority is revalidated immediately before use and never becomes project
    meaning.
13. **Success follows fencing.** A valid result frame is insufficient. The
   complete descendant tree must be fenced, reaped, cleaned, and the declared
   result validated before a terminal success is durable.
14. **Cleanup outlives the coordinator.** A separate bounded owner must still
    fence and clean possibly launched work when the Jig coordinator dies.
15. **Close is an authority boundary.** A project session revokes future starts,
   settles or fences owned work, and releases exclusive ownership without
   erasing already durable records.
16. **Executable failure stays failure.** Missing or failed runtime support
    never silently reinterprets the prose in `FLOW.md` as equivalent
    executable behavior.
17. **Public output is sanitized.** Do not expose credentials, absolute host
    paths, cgroup details, helper arguments, SQLite errors, coordinator IDs,
    or private recipe records.

Do not rewrite correct durable machinery merely to reduce table or line count.
Do delete it when it belongs only to a removed feature and slows the active
product. Complexity is justified by an observed authority, crash, uncertainty,
or cleanup invariant—not by hypothetical reuse.

## Containment and host contract

The supported Jig host uses one private rootless Linux mechanism:

```text
systemd user transient scope with delegation
    -> delegated cgroup-v2 CPU/memory/PID controllers
    -> race-free placement before untrusted execution
    -> Bubblewrap user/mount/PID/network/IPC/UTS/cgroup namespaces
    -> fixed Bun support
    -> complete-tree fencing and zero-residue cleanup
```

There is no privileged fallback and no public Backend or Runtime Adapter
interface. Never substitute `sudo`, `ulimit`, RLIMIT, process-group killing,
per-process accounting, attach-after-exec placement, or `/proc` polling. Those
do not provide equivalent descendant ownership and fencing.

Normal Flow code receives only exact package bytes, fixed runtime support,
private scratch, private namespaces, and the Run/1 channel. It receives no
project tree, host environment, ambient `PATH`, host process tree, host
network, credentials, writable cgroups, general devices, or Jig control
channel.

Aggregate limits exist before package code executes. Cancellation kills the
whole owned cgroup, waits for `populated 0`, removes the owner resources, and
surfaces cleanup failure. Never launch hostile fork or memory payloads until
the complete envelope and delegation preflight are established.

The development environment may use `AGENT_SANDBOX_PROFILE=rootless-linux`.
`agent-sandbox` is a generic development-safety tool, not part of Jig. Its
name, runtime receipts, package manager, credentials, and host helpers must
never enter Jig product semantics. If it lacks a needed capability, request
the exact generic capability and stop; do not request a Jig-specific artifact
or registration and do not code around it in the product.

Disposable GitHub runner provisioning is a separate trust boundary. Its CI
script may use `sudo` to install and configure the pinned host substrate, but
Jig and every package payload then run unprivileged. Do not delete that
provisioning as though it were a product fallback, and never copy it into the
installed product.

The boundary does not defend against a compromised kernel, systemd,
Bubblewrap, cgroup implementation, fixed runtime, host administrator, or
malicious same-UID host process. Keep that claim ceiling visible whenever the
containment story is summarized.

The current public ceilings are recorded in `SECURITY.md`. At this snapshot:

```text
root Run default                         30 seconds
root Run maximum                         24 hours
Flow scope                               256 MiB, 48 PIDs, 50% one CPU
Agent provider scope                     256 MiB, 128 PIDs, 50% one CPU
project evaluation                       3 seconds, 256 MiB, 64 PIDs
one dependency preparation               60 seconds, 512 MiB, 64 PIDs, one CPU
one project preparation phase            180 seconds, 16 distinct preparations, 256 MiB
protected artifact                       64 MiB
protected project store                  1 GiB
```

Treat these as current policy to recheck, not eternal protocol constants.
Root-selected timeouts are Jig invocation policy, not FLOW metadata. Children
and Agent scopes inherit the remaining root deadline and cannot extend it.

## Dependency preparation: the narrow compromise

Mandatory bundling was rejected as unnatural TypeScript authoring. Authors may
use ordinary package-local `package.json` and exact Bun text `bun.lock` files.
They do not check in `node_modules`.

During `jig check`, Jig runs one fixed Bun-specific preparation inside the
same rootless containment mechanism. It:

- disables lifecycle scripts and authored Bun configuration;
- rejects package `.npmrc`;
- accepts only exact integrity-pinned registry packages from the default npm
  registry;
- rejects Git, GitHub, tarball, file, workspace, custom-registry, and other
  unsupported sources; a default-registry npm alias is accepted only when its
  resolved lock tuple names that registry and has supported SRI integrity;
- applies per-package and aggregate time/file/byte bounds; and
- retains exact prepared bytes as host evidence.

`jig run` performs no installation, network lookup, lifecycle script, or
ambient runtime discovery. It consumes only the retained admitted tree.

This is not a package-manager abstraction. If supporting another ordinary Bun
case requires registries, cache policy, workspace semantics, plugin hooks, or
a public preparation interface, stop and reconsider the entire automatic
preparation choice. Do not grow it incrementally into a package manager.

The networked worker currently sees the captured package source, not only its
manifest and lock. Project policy prevents known executable/configuration
influence, but manifest-and-lock-only projection remains the cleaner
least-authority design if another input seam is found.

Declined and superseded artifacts are capped, not garbage-collected. There is
no selective reclamation command. Removing `.jig` intentionally discards all
local admission and Run history. Do not claim that GC exists.

## Exact child Flow composition

A Binding may map at most 256 LocalName slots to selected Flow packages from
the same admitted generation. A direct `flow:` invocation receives no slots.

For each `flow/call`:

- only JSON/1 input crosses into a fresh child context;
- settings and attachments are empty;
- the child receives no slots and cannot recurse through this host slice;
- input and final result are validated;
- Run/1 owns join, conflict, waiter cancellation, deadline, and uncertainty;
- possible dispatch is never automatically replayed; and
- at most one distinct child/effect operation is active per parent, while
  sequential operations remain valid.

There is no child-history API, scheduler, catalogue, selector language, or
recursive graph host. Exact slots were enough for the real two-route case.

## Agent boundary

Agent Run is one experimental Jig-owned Capability Contract consumed through
ordinary Run/1 `effect/call`. It is not a new FLOW method or a public provider
SPI.

The public value shape is intentionally small:

```ts
input: {
  instructions: string;
  skills?: readonly string[];
  responseSchema?: JsonObject;
}

result: {
  outcome: "completed" | "blocked" | "limit";
  text: string;
  structured?: JsonValue;
}
```

An Agent-using package vendors the exact descriptor. Omitted skills means no
skills. Selected `skills/<name>` subtrees are fresh immutable UTF-8 guidance
for that call; they are not tools, filesystem access, provider configuration,
or host authority.

The Flow cannot select a client, endpoint, model, executable, credential, or
network policy. Those are trusted host configuration. Non-secret provider
behavior may be reviewed identity; secrets never enter FLOW input, Bindings,
artifacts, Plans, diagnostics, or retained Run state. Credential rotation alone
must not change project meaning.

The direct API base is the official OpenAI client and Responses API:

```text
OPENAI_MODEL + OPENAI_API_KEY
```

OpenRouter is only an explicit compatible endpoint/key flavor:

```text
OPENROUTER_MODEL + OPENROUTER_API_KEY
```

There is no default API model and no development model in product code. Never
make a test gateway the provider abstraction again.

Start Agent checks from a deliberate environment. Complete OpenAI and
OpenRouter variable pairs together are rejected as ambiguous. For a native
client, an `OPENROUTER_MODEL` selects the explicit gateway path and therefore
also requires its key; stale global variables can make a target unavailable
or change the provider identity that review admits.

Native Codex, Claude Code, and Pi use one bounded private ACP mechanism with
fixed client profiles. They start in empty work directories, advertise no
filesystem/terminal/MCP client capability, receive no MCP servers, reject
permission requests, and disable tools, extensions, plugins, and native
skills. Codex subscription mode currently fixes
`gpt-5.3-codex-spark`. OpenRouter overrides are host/test flavors, not user
package configuration.

The native profiles share transport and lifecycle ownership, but their
credential formats and executable layouts remain concrete. Do not add another
client or publish an ACP/provider SPI until independent installed evidence
shows the current family is maintainable.

Agent workers currently inherit general network egress rather than an
endpoint-filtered network policy. The direct worker asks for `store: false`,
but that is not a general retention or training guarantee. Provider suitability
for sensitive data remains an application/operator decision.

`jig check` proves locally selected support, credential shape, configuration,
and admitted identity. It does not send a remote health request and cannot
promise future provider reachability. A truthful local `ready` status must not
be inflated into a remote-service guarantee.

The bounded structured-result profile accepts closed nested objects, bounded
homogeneous arrays, strings/enums, safe integers, and nullable strings or
integers. It rejects arbitrary JSON Schema features. Direct Responses uses
strict JSON Schema; text-oriented ACP results are locally parsed and validated.
Shape validation does not make facts true. Source coordinates, evidence,
arithmetic, and domain rules remain deterministic application responsibilities.

## Release, package, site, and governance notes

All npm packages use `@jigging/*` for now. Do not migrate to `@jiggy/*` unless
the owner obtains and deliberately selects the matching GitHub and npm
identities. FLOW remains technically distinct while sharing the monorepo for
launch simplicity.

The public sites are separate even though their source is colocated:

```text
flow.jig.md    FLOW guides, specifications, and machine schemas
jig.md         Jig product, policy, contracts, and guides
```

Rspress builds both from separate configurations. The FLOW site deploys from
this repository. Jig documentation changes dispatch the separate
`jigmd/jig-site` Pages repository with the exact source revision. A manual run
of that repository's copied workflow defaults to current `main` and may accept
an exact revision for a historical deployment. Both repositories must use
GitHub Actions as their Pages source. The repository secret
`JIG_SITE_DISPATCH_TOKEN` is a fine-grained token limited to Actions read/write
on `jigmd/jig-site`; DNS and custom-domain state remain external. The owner
handles DNS; repository code owns the deployable sites.

The license map is:

```text
Jig source/specification/machine material     MPL-2.0
FLOW SDKs, schemas, examples, conformance     Apache-2.0
FLOW normative specifications                 Community-Spec-1.0
explanatory documentation and public sites    CC-BY-4.0
```

Copyright is `Victor Duarte <zvictor> and contributors`. Contributions use
DCO 1.1, no copyright assignment, and no broad relicensing CLA. Jig is to
remain OSI-open. FLOW is founder-stewarded and openly implementable, not
independently governed. Sponsors do not purchase specification outcomes.

The npm workflow is automatic after a successful push CI result. Exact
prerelease versions in manifests are release intent. Candidate jobs build and
test unprivileged archives, persist them, and receive no publication or Git
authority. The protected `npm` environment publisher has OIDC but no checkout;
it publishes the retained bytes, then refetches and compares them. A separate
job with only Git contents authority creates or verifies package-specific
annotated tags. The publisher never replaces an npm version or moves `latest`.
The protected publisher environment is named `npm`; `alpha` and `next` are
package dist-tags, not separate authority environments. Publication should
not require the owner to dispatch a workflow manually. Third-party GitHub
Actions remain pinned by full commit identity.

Both npm package identities need trusted-publisher records bound to repository
`jigmd/jig`, workflow `.github/workflows/npm-publish.yml`, and environment
`npm`. No npm token is needed or expected.

Every commit that changes packed archive bytes therefore needs a new
prerelease version before merge once its current version is published. If it
does not, exact convergence must fail. Test-only or archive-excluded changes do
not need a version bump. Do not weaken this rule or rebuild during publication.
A small pre-merge archive/version guard is preferable to a large release
framework.

The automatic publisher currently follows ordinary CI, not the separate full
Linux Host Conformance workflow. Its Jig candidate job does provision a host
and run packed operational and installed-hostile baselines. Decide explicitly
whether that is the sufficient irreversible gate or whether publication must
consume same-SHA full Host Conformance.

The exact external Bun dependency is
`@oven/bun-linux-x64-baseline@1.3.3`. Jig authenticates its version, revision,
layout, path, and digest. The project owner accepted modest transparent
good-faith prerelease licensing risk rather than building compliance or
runtime-distribution machinery. Do not claim a formal legal opinion. Act on a
specific violation if identified; do not reopen architecture from vague fear.

## Probe discipline

Design probes are disposable API-usability experiments under
`.tmp/design-probes-round-*`, not product code or historical archives.

For every probe:

1. Freeze or publish the candidate interface first.
2. Give an independent builder only public artifacts, public documentation,
   the requested outcome, and explicit limits.
3. Do not provide internal source, roadmaps, old probes, design reviews, or the
   intended implementation.
4. Explicitly prohibit the builder from changing Jig while consuming it.
5. Record exact versions, docs, commands, failed attempts, elapsed time,
   diagnostics, cleanup, and claims proved or not proved.
6. Include a malformed or failure case.
7. Deliberate separately before changing the platform.
8. Do not commit the probe by default.

Do not inventory or preserve old probe trees without a current question. If a
probe becomes excellent recommended structure, deliberately rewrite and
promote it as a Starter. An adversarial test or accidental snapshot is not a
Starter.

A failed probe is often more valuable than a polished demo. Do not prompt-tune
indefinitely, weaken a boundary, or invent an API to manufacture success.

## Historical mistakes not to repeat

### Probes invented the platform interface

The original `design-probes` cycle allowed experiments to alter the API they
were meant to consume. The team tried to use a public SDK before specifying
it. That destroyed the value of the evidence. Define first, consume from a
clean room second.

### Sley was nearly absorbed into Jig

Caskada became Sley and correctly remained an independent in-process graph
runtime. Jig must not fork its scheduler, subclass its elements, or store Jig
meaning in Sley objects.

A later Jig Graph lowering worked but added hundreds of lines around roughly
45 lines of direct Sley with no stored-graph consumer. It was deleted. Retry
only when a real independently stored graph has meaningful nested or
non-router behavior that direct Sley cannot express cleanly.

### A `/nix/store` proof-host fact became architecture

Runtime paths happened to live in `/nix/store`, leading to GC roots, host
generations, retention, and package-manager lifecycle work. The valid
requirement was exact immutable host runtime support. Jig managing Nix was not.

The lab branch `experiments/nix-runtime-retention` at `d34ccb6` is not a
feature branch. Do not merge or cherry-pick it. Never use daemon-global
`nix-store -q --roots` as harmless observation.

### Development sandbox authority leaked toward the product

The old privileged cgroup proof established valuable hostile invariants but
was replaced by the canonical rootless path. `agent-sandbox` almost became a
Jig-specific runtime registrar. It is not. Never restore sudo-based execution
or development-host terminology as fallback.

The local `wip/rootless-durable-backend` branch is evidence from the transition,
not a pending merge. Current `main` is the corrected product path.

### Horizontal proofs preceded an installed product

The repository once contained sophisticated Journal, Hook, Service, Agent,
Semantic Choice, and durable execution experiments but no installed `jig run`.
The product order was inverted. The correction deleted more than 100,000
lines and established one finite three-command path.

Do not restore a suspended subsystem because it once had good tests. Read its
invariants and reimplement only what a current application earns.

### Bundling moved host convenience onto every author

Requiring every dependency to be bundled or vendored was safe but unnatural
for TypeScript authors. Here “vendoring” meant copying dependency bytes into
the Flow package. Contained exact Bun preparation is the current compromise;
it must stay narrow.

### Compiled Bun was technically successful but distribution-heavy

Embedding Bun created avoidable JavaScriptCore/WebKit redistribution and
relinking concerns. The exact external Oven package replaced it. Do not revive
embedded Bun unless a concrete reviewed distribution solution is simpler.

### OpenRouter was made the product model

A development key and model briefly became an OpenRouter-centered provider
and hard-coded default. The whole path was replaced. OpenAI owns the Responses
model; OpenRouter is an optional compatible flavor.

### `serve()` and protocol stdout contradicted reality

The name implied resident servers and ordinary logging corrupted protocol
stdout. `handle()` and SDK-level console redirection fixed both. Do not retain
the old name for compatibility.

### Historical documents became a second architecture

Hundreds of exploratory reviews made current truth hard to find. They were
removed. Git is the archive; `docs/suspended-experiments.md` is the small
recovery index. Extract valid invariants into current specs instead of
restoring old review prose.

### Finishing a phase was mistaken for permission to choose the next one

After the agreed containment roadmap closed, an agent immediately selected
deterministic composition, wrote a frontier document, and began a dispatcher.
The owner had approved finishing the roadmap, not choosing its successor. The
uncommitted code and premature frontier were removed.

Phase completion authorizes a closure report. It does not authorize the next
product phase. Compare the options and stop for direction when the choice is
material.

## Suspended work and reconsideration gates

Always consult `docs/suspended-experiments.md` for exact recovery commits.

- **Journal and Hooks:** reconsider only when one real external fact must
  durably activate one admitted Run. Start from that outcome, not the old
  schema.
- **Services:** reconsider only when an application needs process-local state
  across calls and portable Service conformance has independent evidence.
- **Semantic Choice/changing candidates:** reconsider only when at least two
  applications cannot express their need with ordinary structured Agent data
  plus exact slots.
- **Python direct execution:** reconsider when a real Python Flow earns a
  second exact runtime recipe.
- **Jig Graph:** reconsider only for a real stored graph direct Sley cannot
  express cleanly.
- **Privileged backend:** keep its hostile-test lessons; never restore it as a
  fallback.
- **Nix retention:** never restore as Jig runtime architecture.
- **Compiled Bun:** reconsider only if lawful distribution becomes simpler
  than the exact external dependency.

Never cherry-pick a former subsystem wholesale. Recover the proof, not the old
shape.

## Simplicity and stop rules

Before every checkpoint, write down:

1. the exact user-visible outcome;
2. the smallest observable proof;
3. why current Flow code, Run/1, exact slots, or a capability contract cannot
   already express it;
4. whether it introduces public vocabulary;
5. explicit exclusions; and
6. the stop condition.

Stop and ask the owner if the apparent solution requires:

- `jig setup`;
- a daemon merely to make a finite command work;
- a second lock or public admission protocol;
- a registry, plugin system, provider ABI, graph DSL, or query language;
- package-manager lifecycle ownership or host-global mutation;
- exposing coordinator, store, runtime, or sandbox internals;
- weaker containment or a compatibility fallback;
- replay of possibly dispatched work;
- retention of a superseded path “just in case”;
- modeling a development environment as product architecture;
- a public abstraction inferred from one implementation; or
- a new product phase that has not been explicitly selected.

Do not stop merely because the work is difficult. Record a blocker in
`.tmp/current-blockers.md` only when the owner must supply authority,
credentials, infrastructure, an accepted commercial/legal risk, or a material
product-direction choice. Solve research, documentation, code, and CI issues
with specialist agents when they remain within the approved scope.

## Working with the owner

Victor wants strong execution after a boundary is agreed, and an explicit
pause before the boundary itself changes. “Go for it” means carry the selected
vertical through implementation, proof, deletion of superseded work, and a
stable commit. It does not mean choose the next subsystem when that vertical
ends.

Be direct about blockers. Say exactly what is missing and exactly what only he
can do. Do not hand him research, code, CI, documentation, or routine service
configuration that an agent can complete. Conversely, do not disguise a real
choice about product meaning, public authority, commercial risk, credentials,
or external ownership as an implementation detail.

He welcomes disagreement when it comes with concrete evidence and a simpler
alternative. External reviewers are valuable adversaries, not project
authorities: verify their claims, accept the useful correction, and explain
each disagreement. Never implement a review wholesale.

The economic and institutional intent also matters:

- Jig must remain genuinely useful as open-source local software rather than a
  crippled community edition.
- FLOW should be widely implementable while remaining founder-stewarded for
  now; openness does not require prematurely giving away the official project,
  marks, or sponsor relationships.
- The nearer public milestone is a convincing Agent-assisted routing product;
  the north star is a useful software factory with human merge and release
  authority. GUI, Cordis reuse, and update campaigns must not hold the first
  releases back.
- Modest, transparent prerelease risk can be preferable to a large compliance
  or infrastructure subsystem. Name the risk honestly; do not silently ignore
  a concrete violation.

When asked to continue across several agreed verticals, balance effort: make
each one sufficient for the first release, commit its stable boundary, record
only genuine owner blockers, and move on. If a vertical is blocked, preserve
its stable slice and quarantine unstable evidence on a separate branch only
when that evidence is worth keeping; then continue through the other approved
verticals. Do not spend the whole cycle perfecting one proof after it has
answered its question.

## Evidence and claim discipline

The successful synthetic underpayment probe proved one real Agent call,
source-linked structured extraction, deterministic integer time/money
arithmetic, one expected discrepancy, one unresolved ambiguous shift, and no
need for a new Jig API.

It did **not** prove legal accuracy, OCR, privacy suitability, provider
suitability for wage data, professional benefit, precision/recall targets,
review-time reduction, or cross-party rule-package value.

Likewise:

- closed two-route Agent selection is not open semantic discovery;
- a JSON delivery packet is not a software factory;
- a successful SDK Node test is not a Jig Node-host claim;
- `jig check` readiness is not remote provider health;
- one rootless implementation is not a public Backend SPI;
- private ACP profiles are not a public provider framework; and
- research catalogues are not a roadmap.

Keep every claim smaller than its evidence.

## Verification habits

Useful ordinary checks include:

```sh
bun test packages/flow-sdk
bun run --cwd packages/flow-sdk build
FLOW_NODE="$(command -v node)" bun run --cwd packages/flow-sdk test:package

bun test packages/jig
bun run --cwd packages/jig check

bun test conformance/run-1
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s conformance/run-1/python-peer -p 'test_*.py' -v

FLOW_NODE="$(command -v node)" \
PYTHON="$(command -v python3)" \
scripts/test-release.sh
```

Install dependencies with the package-local frozen locks before a clean gate.
The exact release scripts and versions in `RELEASING.md` and package manifests
outrank examples here.

Containment or lifecycle changes require the provisioned Linux Host
Conformance workflow or an equivalent completed rootless envelope. Run hostile
files sequentially where the suite requires it, then independently assert zero
units, cgroups, processes, control paths, and private-device residue. Never
count a skip or interrupted aggregate as a pass.

For public changes, verify source, conformance, packed inventory, an external
install, Operational Baseline, and the relevant hostile artifact behavior.
Build once, hash once, publish the retained bytes, then refetch and compare.

## Current snapshot — 2026-09-03 UTC

Reverify every item in this section before acting.

```text
audited base            8912bdd  docs(flow): keep public specifications host-neutral
origin/main             93c1b39  fix(jig): expose subcommand help without acquisition
worktree                clean before this guide was added
public Jig              @jigging/jig@0.1.0-alpha.7
public FLOW SDK         @jigging/flow@0.1.0-alpha.3
npm alpha tags          point to those functional versions
npm latest tags         point to inert 0.0.0 bootstrap packages
Python FLOW SDK         private/unpublished 0.0.0
owner blockers          none recorded
```

`93c1b39` passed ordinary CI and Linux Host Conformance. It changed packaged
Jig CLI bytes without moving the already-published `alpha.7` version, so the
automatic publication job correctly failed archive convergence. The help fix
is in source but not in `alpha.7`; publish it as a new immutable prerelease
rather than replacing existing bytes.

`8912bdd` was an unpushed documentation-only commit at this snapshot. It removes
Jig-specific policy and internal release history from FLOW's public normative
specifications. Preserve that host-neutral correction.

Published `alpha.7` at `e74e99d` had successful ordinary CI, Linux Host
Conformance, candidate build, npm publication/refetch, and tagging jobs.

One release-history anomaly is known: npm provenance for Jig `alpha.6` names
`1064832`, while remote tag `jig-v0.1.0-alpha.6` was later created at
`d7e0140` after a failed earlier publication response. Do not rewrite history
casually; record a deliberate disposition.

The `latest -> 0.0.0` bootstrap posture is also unusual. Public instructions
use exact alpha versions. The bootstrap versions are not currently marked
deprecated in npm. Decide explicitly whether leaving `latest` inert is
protective or confusing before stable release.

Development-session live prompts have completed through direct OpenAI
Responses using an explicit OpenRouter flavor, Codex subscription with
`gpt-5.3-codex-spark`, and ACP-backed Codex, Claude Code, and Pi. These are not
independent installed-client conformance. Ordinary CI skips credentialed live
tests.

The latest independent probe is under
`.tmp/design-probes-round-underpayment-reconstruction-v2/`. It used public
Jig `alpha.7`, FLOW `alpha.3`, and `discover()` naturally. It is temporary and
must not be promoted into tracked product structure by default.

## Open frontier — not an approved roadmap

First close already-earned release hygiene:

1. publish the `93c1b39` CLI-help correction under a new Jig prerelease;
2. add the smallest guard against package changes under an already-published
   version;
3. decide whether publication must mechanically wait for same-SHA full Linux
   Host Conformance;
4. record the `alpha.6` tag/provenance anomaly; and
5. make the `latest`/`alpha` posture unambiguous.

Then independently stress the Agent surface already present. A useful
installed-artifact matrix covers direct OpenAI, explicit OpenRouter, Codex
subscription through ACP, and at least one other ACP client; structured
output, exact skill selection, permission/tool denial, cancellation,
credential rotation, cleanup, and residue should be observable. Do not add a
provider framework while doing this.

A follow-up underpayment probe may place independently authored deterministic
jurisdiction rules behind one exact child slot. That tests cross-party package
value with existing APIs. Consider `--input-file` only if repeated independent
evidence shows shell-inline JSON is material friction.

The owner's principal product milestone is an honest software factory. The
next genuinely new authority likely needed for it is:

```text
one admitted issue
    -> one contained coding Agent
    -> one bounded disposable repository/workspace authority
    -> exact declared tests
    -> one inspectable patch/evidence bundle
    -> human retains merge and release authority
```

That is a repository/workspace-authority problem. It is not a reason to add
Semantic Choice, Kanban, a graph language, a generic tools framework, or a
long-lived Service. Obtain owner direction before selecting its exact shape.

Only after a real issue source must reliably activate the workflow should an
external Event Source be explored. Let that outcome determine whether a
durable Journal/Hook-like seam is necessary instead of restoring the old
subsystem first.

## Final note to a future self

The owner values honest refusal and small interfaces more than uninterrupted
forward motion. “Go for it” authorizes the agreed vertical, not every adjacent
idea it reveals. If two materially different directions are plausible, stop
and make the trade-off explicit. If the environment is missing a capability,
name it exactly. If a probe fails, keep the failure honest. If code becomes
superseded, remove it.

Protect the boundaries and the method more fiercely than any individual
implementation.
