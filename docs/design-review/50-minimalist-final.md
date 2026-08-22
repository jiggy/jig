# Final hostile review: reject as a freeze candidate

The candidate is not yet independently implementable. Its central shape can be
salvaged, but it claims stability while leaving the executable-runtime ABI and
advanced Package metadata undefined. It also reintroduces transport identity as
lifetime identity, duplicates the generic effect gateway with a special event
method, and freezes a speculative Service contract type system before the two
required Service implementations exist.

This review classifies only defects and the smallest correction for each. It
does not propose a replacement architecture.

## Fatal findings

### F1. Runtime Contract is a name, not a specification

**Where:** 2.2, 11.2, release gate 3.

The only portable executable declaration is:

```yaml
runtime:
  contract: https://example.org/flow-runtimes/deno
  version: ^2.0.0
```

Nothing defines what that contract contains or what a conforming Runtime
Provider must do. Missing normative answers include:

- how an entry path is passed to the launcher;
- whether the provider supplies fixed arguments and their order;
- platform and architecture matching;
- source versus native artifact handling;
- dependency preparation and its digest;
- environment and stdio guarantees;
- runtime-version versus runtime-contract-version semantics;
- whether one provider may satisfy several contract versions;
- how provider conformance is tested;
- whether provider configuration may alter launch semantics.

The launch-plan digest records an undefined operation. Consequently two hosts
can accept the same package and launch different programs while both claiming
Package/1 conformance.

**Smallest correction:** specify a minimal Runtime/1 provider interface before
Package/1 freezes. It needs an exact runtime-contract identity, supported
platform tuple, deterministic `plan(entryPath, packageSnapshot)` result, literal
shell-free argv/environment, and preparation provenance. Avoid a SemVer range
until compatibility rules exist; an exact major-versioned contract URI is
enough. Alternatively restore an exact launch directive. Do not retain the
current half-abstraction.

### F2. Package/1's advanced interface is unwritten

**Where:** 2.3, 2.4, 4.2, 7.2, 9.1.

The candidate says frontmatter may declare:

```text
interpreted fallback
public outcomes
required Run facilities
minimum raw permissions
Service uses/provides
static/dynamic dependency modes
contract ranges
```

Only `runtime` and one permissions example have concrete shapes. Service/1
cannot discover exports/dependencies, Run/1 cannot preflight required events or
effects, and two hosts cannot agree whether Markdown fallback is authorized.
Calling these fields “reserved” does not define them.

This is a progressive-disclosure failure: the three-field package is simple,
but the first advanced use falls off a specification cliff into prose.

**Smallest correction:** publish one closed Package/1 frontmatter schema with
the exact optional fields already required by the candidate. Extension fields
must be namespaced. Do not add new behavior; merely make the claimed behavior
parseable and conformable. If that schema cannot stay small, move Service
declarations into one Service/1 descriptor rather than leaving two partial
authorities.

## High-severity findings

### H1. Lifetime identity contradicts the connection-independence law

**Where:** law 7; 3.4, 3.5, 3.8; 7.3.

`flow/call` and `effect/call` use `ownerRequestId`, while cancellation targets a
JSON-RPC request ID. The candidate simultaneously says a connection transports
identities and is not a lifetime. Request IDs are transport correlation values;
they are not stable ownership identities and cannot be used across transport
reconnection, provider forwarding, or a shared effect dispatcher.

The problem becomes concrete in Service/1: invocation children need authority
owned by one invocation, while Mount children need authority owned by the
Mount. A request-ID convention cannot express that independently of the current
channel.

`request/cancel` is also declared only host-to-component. A component that
times out its own `effect/call` or `flow/call` cannot tell the host to stop the
outbound work. The effect may keep consuming authority after the runner has
abandoned it.

**Smallest correction:** give every Run, Mount, and service invocation a
host-issued opaque `scopeId`; require outbound calls to name it. Keep JSON-RPC
IDs solely for correlation. Make `request/cancel` symmetric: the originator of
either-direction request may cancel it. This does not require `scope/open` or a
remote Context API.

### H2. `event/append` duplicates `effect/call`

**Where:** 3.2, 3.7, 6.1, 7.3.

The candidate defines `effect/call` as the universal binding-scoped gateway for
host-mediated operations, then adds a special acknowledged host operation for
events. No failure requires a separate wire method. Durable append has exactly
the properties already supplied by an effect slot: operation identity, schema,
authority, provider binding, durable result, and unavailable-provider error.

The special method taxes every Run-only host while that host is expressly
allowed to return `EVENT_JOURNAL_UNAVAILABLE`.

**Smallest correction:** remove `event/append` from Run/1 and Service/1. Bind a
durable-facts effect/service slot and call it through `effect/call`. Host-owned
lifecycle facts still commit directly to Jig's kernel outbox. Keep
`telemetry/emit` distinct because it is an unacknowledged notification, not an
effect.

### H3. The fact envelope is not conformable

**Where:** 3.7.

“CloudEvents-compatible where useful” defines nothing. The candidate does not
state required fields, field authority, canonicalization, size limits, or which
producer/source values a component may supply. Protected namespaces do not say
how the host authenticates or overwrites producer identity.

**Smallest correction:** if durable facts remain a FLOW facility, define one
small exact envelope. The host assigns fact ID, committed time, authenticated
producer, and Scope/Run correlation. Caller supplies only allowed type, subject,
schema, and data. Make CloudEvents mapping non-normative.

### H4. Service availability can race and static dependency loss is undefined

**Where:** 7.2, 7.3, scenario 8.

`service/bindings` is monotonically versioned, but `service/status` has no
specified monotonic revision. Concurrent or retried status requests can regress
the host's availability view. The added provider-supplied “component generation
key” creates another identity without defining uniqueness, persistence, or
anti-reuse rules.

The document defines dynamic dependency replacement but never states what a
Mount must do when a pinned static dependency is lost. Continuing with a broken
slot, becoming pending, and unmounting have materially different semantics.

**Smallest correction:** require monotonically versioned full status snapshots.
Let the host assign a fresh registration generation on each
unavailable-to-available transition; remove the provider generation key. State
that loss of a required static binding makes affected exports unavailable and
causes the Mount to fail/unmount under a bounded host policy; it is never
rebound in place.

### H5. Service/1 is called separately conforming while importing Run/1

**Where:** 7.1, 7.3, scenario 18.

Service providers reuse `flow/call`, `effect/call`, `event/append`,
`telemetry/emit`, and `request/cancel` “from Run/1.” A Service/1 host therefore
cannot implement the stated Service protocol without implementing a material
Run/1 subset. The claimed independent conformance boundary is false as written.

**Smallest correction:** normatively state that Service/1 imports a named
Host-Calls subset with the exact same schemas, and include that subset in the
Service conformance suite. Do not add a new marketing layer. After H2, that
subset is only cancellation, child call, effect call, and telemetry.

### H6. Service Contract/1 freezes unproved type-system features

**Where:** 8.2, release gate 6.

The two required Service prototypes need named methods, JSON input/output,
application errors, exact interface identity, and dependency contracts. They do
not prove a need for:

```text
nominal resource handles
delegated-Service handles
fact schemas
callback Services
explicit release methods
an executable conformance Flow embedded in the contract
```

Those fields create ownership, bearer-security, callback, recursion, and
distribution problems before a plain provider and Cordis have passed the basic
wire suite. Rejecting OpenRPC because these speculative fields would live in
extensions is not evidence that a new full IDL is mature.

SemVer ranges add another premature compatibility promise. Shape compatibility
and behavior compatibility do not follow from a caret. The named version
mismatch scenario requires only exact compatibility and explicit adapters.

**Smallest correction:** Service Contract/1 v1 contains contract identity,
exact version/digest, methods, input/output, and named application-error schemas
only. Put handles, facts, callbacks, conformance executables, and SemVer ranges
behind separately proven extensions. Use an exact major-versioned contract URI
for initial matching. Re-evaluate the canonical IDL after the two Service
prototypes exist.

### H7. The security surface is precise-looking but not precise

**Where:** 9.1, 9.2.

`net: [https://api.github.com]` leaves DNS resolution, redirects, port defaults,
WebSockets, proxies, certificate identity, and rebinding undefined. `run: [git]`
looks narrow while Git can read configuration, invoke hooks/pagers/SSH, start
children, and exercise filesystem/network authority. `true` creates an
unbounded grant with no portable audit shape.

The outer sandbox language is correct in principle but does not rescue an
undefined grant vocabulary. Independent backends can report “enforced” for
different effective resources.

**Smallest correction:** either specify normalized selectors and transitive
authority conformance now, or move `net`, `run`, and unrestricted `true` into
versioned grant profiles. At minimum, every spawned executable and descendant
must remain inside the same filesystem/network/environment sandbox; granting
`git` cannot expand any other grant. Disable or mediate executable-specific
hooks/config where they bypass process policy.

### H8. Agent completion has an atomicity escape clause

**Where:** 6.1, 6.3.

The kernel exists partly to commit an operation result and its lifecycle facts
atomically. Agent completion is then promised only “where the backend permits.”
That reintroduces the exact crash gap the fact outbox was added to prevent: the
Agent result may exist while the Hook-triggering `agent.completed` fact never
does.

**Smallest correction:** define normalized `agent.completed` as a Jig fact
created only in the same transaction that commits the Agent effect result. A
provider-native completion received before Jig can determine the effect result
is a separately named provider fact or an uncertain operation, not the
normalized completion promise.

### H9. `jig.ts` violates “mutable authored source never executes”

**Where:** law 6; 5.3; 10.1.

`jig apply` executes trusted mutable TypeScript to obtain desired state. The
absolute law is therefore false, and evaluating project code directly from the
working tree allows it to change while evaluation/imports are in progress.

**Smallest correction:** snapshot the candidate project source first, then
evaluate `jig.ts` from that immutable candidate in a separate trusted
reconciliation process. The resulting normalized definition and source digest
are activated together. Rewrite the law to distinguish trusted configuration
evaluation from active Flow/Service execution.

### H10. Rollback contradicts visible source authority

**Where:** 10.1, 10.2.

The visible tree is declared the complete effective source of truth, but
rollback “selects a previous complete activation.” If source remains at the
newer broken revision, the next `jig apply` silently reinstates it. Operators
cannot tell whether rollback is a runtime pin or a source restoration.

**Smallest correction:** define `jig rollback` to atomically restore both the
visible authored tree and matching activation from a recorded update
transaction. If runtime-only rollback is needed, give it a different explicit
command such as `jig activate <revision>` and report source/activation drift.

### H11. `jig init` smuggles an application generator into Jig

**Where:** 11.3.

The guided generator asks about semantic routing, missing-Flow repair,
software-factory ingress, Git, and GUI support. These are precisely the
application choices assigned to Starters. Putting their composition into core
`jig init` creates a second Starter algebra and forces Jig to own cross-feature
merge behavior.

**Smallest correction:** retain only `jig init --bare` and
`jig init --from <one-starter>`, with one release-pinned default if desired. A
Starter may run its own one-time questions after copying. The result remains
ordinary source.

## Medium-severity findings

### M1. `telemetry/emit` is core without a conformance need

Structured observation is useful, but stderr already supplies diagnostics and
no required scenario needs portable structured telemetry. Making it a Run/1
method forces vocabulary, size, ordering, and backpressure semantics.

**Smallest correction:** mark it an optional Telemetry/1 notification profile
that conforming hosts may ignore. Promote it only after Caskada and the plain
runtime demonstrate the same minimal envelope. If retained in core, specify
strictly that senders never block indefinitely and hosts may drop at ingress.

### M2. “Coeffect” is gratuitous public theory

**Where:** 3.3.

The candidate immediately translates the term back into input, settings,
roots, grants, and bindings. It protects no wire invariant and adds vocabulary
for users.

**Smallest correction:** title the section “Run inputs and environment.” Keep
`RunContext` as an SDK convenience.

### M3. Disjoint JSON-RPC ID prefixes are unnecessary

**Where:** 3.1.

Direction already disambiguates independent request-ID spaces. Prefixes are an
SDK convention, not portable semantics.

**Smallest correction:** remove the requirement unless a demonstrated JSON-RPC
library cannot support bidirectional requests without it.

### M4. Runtime fallback lacks a declaration

**Where:** 2.3.

The two-party fallback rule is reasonable, but the package opt-in field is part
of F2's unwritten metadata.

**Smallest correction:** define one boolean/package-level fallback field and
one Binding policy enum. Do not add fallback priority lists.

### M5. Service contract identity is overdetermined

**Where:** 8.3.

Owner URI, SemVer, descriptor digest, publisher authority, provider package
version, conformance digest, and provider digest are all useful evidence but
are presented as one compatibility mechanism. This obscures the minimum
question: does the provider implement the exact interface the consumer names?

**Smallest correction:** compatibility first matches exact contract identity
and descriptor digest. Keep package/provenance/conformance evidence in the
trust decision and lock, not the type identity. Add range matching later if it
earns independent tests.

### M6. Stable bundled modules overcommit the first release

**Where:** 11.2, release gates.

OpenTelemetry adapters, watch/ingress, four Runtime Providers, multiple
isolation backends, source repair, and a DSH-class import are useful ecosystem
work, not all prerequisites for a coherent v1. The list dilutes the minimal
kernel and makes “stable” a release bundle rather than conformance claim.

**Smallest correction:** require stable Services, one Agent/instruction runner,
one semantic resolver, source check/apply/update, at least two unrelated Run
runtimes, and one honestly scoped isolation backend. Ship telemetry/watch and
additional runtimes as preview modules without changing protocol stability.

### M7. Caskada v3 redesign is not part of the architecture contract

**Where:** 12.1.

Immutable graphs, returned transitions, and Node specializations may be good
Caskada work, but FLOW/Jig requires only a conforming external runtime. Making
that redesign part of this candidate expands the critical path and couples the
standard to one implementation's roadmap.

**Smallest correction:** move Caskada internals to a separate implementation
plan. Keep only the requirement that its adapter pass Run/1 and effect/call
conformance without a privileged path.

### M8. Generic Flow schema filtering is overstated

**Where:** 4.1.

The resolver claims deterministic filtering by value schemas, but generic Flow
output compatibility is not defined and JSON Schema implication is not a
simple portable decision. Input validation against a candidate schema is
different from proving two schemas compatible.

**Smallest correction:** say Jig validates the concrete child input against a
declared input schema and validates returned output against the selected
package's output schema. Do not claim general schema compatibility.

### M9. Contract-owned executable conformance Flow can recurse

**Where:** 8.2, 8.3.

A conformance Flow may require the very Service, runtime, Agent, or grants being
validated. No bootstrap environment or authority boundary is defined.

**Smallest correction:** remove it from Contract/1 base per H6. A later
conformance-evidence extension must specify test-host prerequisites and prohibit
depending on the candidate provider except through the contract under test.

### M10. `true` permissions defeat progressive disclosure

**Where:** 9.1.

A tiny YAML value silently means unbounded filesystem/network/process authority
and “high trust.” That is too much consequence for too little syntax.

**Smallest correction:** remove unrestricted shorthand in v1. Require an
explicit Binding trust policy outside package minimum needs.

## Low-severity findings

### L1. “Fact log / transactional outbox” names one primitive twice

Choose one public term. “Fact log” describes the durable record; outbox is an
implementation pattern.

### L2. `flow.<single-suffix>` needs filesystem details

Define ASCII case, symlink policy, regular-file requirement, reserved
`FLOW.md`, and behavior on case-insensitive filesystems. Reject `flow.d.ts` by
the stated single-suffix grammar rather than relying on intuition.

### L3. `name` needs a portable grammar

It is not global identity, but routers, CLI, and indexes still need a bounded
case/length grammar and duplicate-name behavior.

### L4. Trigger/causality metadata is listed but not shaped

Either define a minimal correlation/causation object in Run/1 or mark it an
optional extension. Do not let each host serialize arbitrary event objects.

### L5. `Service Contract/1` and “contract descriptor” are used interchangeably

State whether the contract is the canonical JSON document, the `(id, version)`
identity, or the compatibility family. Current wording moves among all three.

## Eighteen-scenario audit

| # | Scenario | Result |
|---:|---|---|
| 1 | Markdown-only, no Agent | **Pass.** Explicit pre-launch `IMPLEMENTATION_UNAVAILABLE`. |
| 2 | Deno-only source, Bun-only host | **Blocked by F1.** Intended failure is correct, but no Runtime Contract/Provider ABI lets independent hosts prove it. |
| 3 | Two plausible child providers | **Pass with M8 correction.** Explicit binding/filter/optional semantic choice is deterministic. |
| 4 | No matching child, Agent present/absent | **Pass.** Bounded delayed-first-binding repair is explicit; failure remains useful without Agent. |
| 5 | External success then crash | **Pass.** Intent/result ledger and `uncertain` state are honest. H8 must close the Agent-specific fact gap. |
| 6 | Cancellation with children/processes | **Partial.** Host-originated root cancellation is covered; H1 leaves component-originated outbound calls and transport-independent ownership uncovered. |
| 7 | Mutually dependent long-lived providers | **Pass in intent.** Static cycle and runtime wait-edge failure are specified; exact wait-graph ownership depends on H1. |
| 8 | Provider crash with pinned consumers | **Partial.** Loss/new identity is correct; H4 leaves static dependency loss and availability ordering ambiguous. |
| 9 | Untrusted direct network/filesystem | **Partial.** Fail-closed outer isolation is stated, but H7's selector/transitive semantics are not conformable. |
| 10 | Host cannot enforce restriction | **Pass.** Untrusted activation fails and trusted override is explicit. |
| 11 | Hook delivered twice | **Pass if the kernel ledger is used.** Derived scheduling key joins the same Run; raw Hook side effects remain explicitly outside the guarantee. |
| 12 | Progress dropped | **Pass.** Telemetry has no semantic consequence; M1 questions only whether it is core. |
| 13 | Local/upstream textual conflict | **Pass.** Staging retains active revision. |
| 14 | Clean merge invalidates local intent | **Pass.** The limitation is admitted and review/tests are evidence, not proof. |
| 15 | Two configurations of one package | **Pass.** Distinct immutable Bindings. |
| 16 | Missing `MAX_RETRIES` | **Pass.** Binding validation fails and environment is ignored. |
| 17 | Cordis exports one serializable service | **Blocked by F2/H4/H5.** The conceptual boundary is present, but declarations, status ordering, and imported host calls are not conformable. |
| 18 | Minimal Run-only third-party host | **Partial.** It may reject unavailable facilities, but F1 prevents exact execution interoperability and H2/M1 unnecessarily enlarge the method surface. |

## Removed/deferred features whose absence has a named failure

Most removals are safe. Four absences need explicit treatment rather than being
presented as cost-free.

### 1. Transport-independent Scope IDs

The candidate removed a wire Scope identity while retaining Scope semantics.
Named failure: a component abandons an outbound effect, but the host cannot
cancel/clean it by durable owner independently of the transport request. H1 is
the minimum restoration; no arbitrary Scope API is needed.

### 2. Generic streaming/subscription

Deferral is acceptable, but it has a named limitation: a one-shot Run cannot
portably consume an unbounded backpressured Service stream or receive an
ephemeral per-call callback unless it prepublishes a callback Service, polls,
or uses durable facts. This does not block any of the 18 scenarios, but the
product must report such a package as requiring an unsupported future profile,
not imply that Service/1 already covers all multi-operation ecosystems.

### 3. Multiple native platform artifacts

Exactly one root implementation means one package cannot carry
`flow-linux-x64`, `flow-windows-x64`, and `flow-darwin-arm64`. The named failure
is a portable native package that otherwise has identical FLOW semantics. V1
may deliberately require separate platform package revisions or one portable
launcher, but Package/1 must state that limitation and let the catalogue group
variants without runtime suffix guessing.

### 4. Preparation declaration

Discovery correctly refuses install hooks, but the runtime abstraction does
not say how a fresh TypeScript/Python package's locked dependencies become
available. Named failure: an exact `flow.ts` activates on the author's machine
and fails on a clean host before Run/1 begins. F1 must assign deterministic,
separately authorized preparation to the Runtime Provider/source adapter and
record its digest. It must not happen opportunistically during launch.

No required failure justifies restoring a universal graph, per-Run settings
overlays, persistent patches, dynamic undeclared Service exports, central
registry, in-process Caskada path, or automatic replay of uncertain work.

## Minimum correction set before another candidate

1. Specify Runtime/1 or replace it with an exact portable launch rule.
2. Publish the complete Package/1 optional-frontmatter schema.
3. Add stable Scope ownership IDs and symmetric request cancellation.
4. Remove `event/append`; route durable facts through `effect/call`.
5. Define an exact fact envelope for Jig's event provider.
6. Version Service status snapshots, remove provider generation keys, and
   define static dependency loss.
7. State Service/1's imported Host-Calls dependency honestly.
8. Cut Service Contract/1 to methods/errors/exact schemas and defer speculative
   handles, callbacks, facts, conformance Flows, and range inference.
9. Make grant selector/transitive semantics conformable or profile them out.
10. Close the Agent result/fact atomicity gap.
11. Snapshot before evaluating `jig.ts`.
12. Make rollback restore source as well as activation, or split the commands.
13. Remove guided application-feature composition from `jig init`.
14. Move Caskada internals and nonessential bundled modules out of the release
    architecture.

Until F1 and F2 are resolved, the candidate cannot support independent Package,
Run, or Service implementations and should not be frozen.
