# Final hostile ecosystem review

## Release verdict

Reject the candidate as a stable specification.

Two Service/1 contradictions make its advertised callback and long-lived
provider model impossible to implement as written. Eleven other gaps would
produce incompatible independent hosts, false security expectations, or a
public contract ecosystem whose identities cannot be governed safely.

The Service signal/subscription deferral is not itself fatal. The narrower
combination of contracted callback Services plus durable provider facts can
cover a defensible v1. It works only after the callback call path, Mount-owned
authority, handle grammar, and cleanup semantics become normative. Those pieces
are currently missing, so the candidate has deferred the generic mechanism
before making its replacement real.

Severity means:

```text
fatal
    The candidate cannot implement one of its own required boundaries or
    release gates. Stable release is impossible until corrected.

high
    Independent hosts or public packages will diverge, or a security claim can
    be false. The issue is release-blocking but does not invalidate the layer
    split.

medium
    A real class of use is constrained, surprising, or likely to fragment.
    Evidence may justify the trade after explicit tests.

low
    Precision or ergonomics defect unlikely to corrupt authority or state.
```

This review does not propose a replacement architecture. Every remediation is
the smallest change capable of making the candidate's existing claim true.

---

## Fatal findings

### F-1 — Delegated callback Services have no callable wire path

The candidate says:

```text
callbacks are Services
a delegated-Service handle may be passed as a JSON value
generic Service subscriptions are deferred
```

But its outbound methods are only:

```text
flow/call
effect/call
event/append
telemetry/emit
```

`effect/call` names a consumer-local `slot`. A delegated callback is an opaque
handle received in a method input. It is not a statically declared slot and is
not part of the Mount's `service/bindings` snapshot. Service/1 defines no
component-to-host `service/call(handle, operation, input)` method.

Therefore a UI service cannot invoke `PanelCallbacks`, a session service cannot
call a subscriber, and a Cordis adapter cannot translate an external event to
a consumer callback. The only mechanism offered in place of generic
subscriptions is non-executable.

#### Minimal fix

Add one Service/1 request from component to host:

```text
service/call
    owner request or Mount
    operation ID
    delegated-Service handle
    operation name
    input
```

The host must verify, before dispatch:

- token authenticity and live owner lifetime;
- the nominal callback-handle type at that schema position;
- exact pinned callback contract ID, compatible version, and descriptor
  digest;
- operation existence and input schema;
- caller authority and budget;
- wait-for-cycle admission.

Output, application errors, cancellation, uncertainty, and provider loss use
the same semantics as `service/invoke`. The handle selects one exact published
provider; it never causes discovery or semantic rebinding.

Do not overload `effect/call` with an undocumented second target mode. Local
slot calls and delegated handle calls have different authority provenance and
should remain distinguishable in audit records.

#### Release test

Mount A with an exported callback contract, pass its handle to B, and have B
invoke it concurrently while A also calls B. Verify:

1. the valid call reaches the exact A registration;
2. a forged token fails before dispatch;
3. a token of the wrong nominal type fails;
4. a callback implementing the wrong contract fails;
5. A loss yields `PROVIDER_LOST` rather than replacement;
6. a synchronous A→B→A→B wait cycle rejects the newest edge;
7. closing A revokes the handle and removes B's registration resource.

Until this passes for plain providers and a Cordis realm, callback Services do
not exist in practice.

### F-2 — A Mount loses the owner needed for background authority

`service/mount` returns after local initialization, and the process remains
alive. Run/1 outbound operations, however, require a live `ownerRequestId`.
After the mount response, that request is no longer pending.

The candidate then says mounted components reuse `flow/call`, `effect/call`,
`event/append`, and `telemetry/emit`. It does not say what owns a background
database call, timer-triggered fact, health operation, or Cordis effect after
the mount request has completed.

This is not a naming omission. Ownership determines authority, settings,
dependency bindings, budgets, cancellation, journaling, and cleanup. Letting a
provider keep using a completed request ID creates immortal authority; denying
it makes long-lived providers unable to do background work.

#### Minimal fix

Have the host assign an opaque `mountId` before initialization. Every outbound
operation is owned by exactly one of:

```text
ownerRequestId
    work caused by one live service/invoke or flow/run request

ownerMountId
    declared background work owned by the live Mount
```

Mount-owned calls use the Mount's pinned settings, grants, dynamic binding
snapshot, deadline/budget policy, and ledger namespace. New work is denied as
soon as draining begins. Unmount cancels Mount-owned requests before cleanup
and revokes the Mount ID after termination.

The alternative is to keep `service/mount` pending for the complete Mount
lifetime. The candidate explicitly chose a completed initialization request,
so it must introduce Mount ownership rather than pretend a completed request is
still live.

#### Release test

After `service/mount` has replied, cause the provider to:

1. call a bound dependency;
2. append a fact;
3. start a timer-owned effect;
4. receive and handle an invocation concurrently;
5. enter draining while both kinds of work are live.

Verify per-invocation cancellation does not cancel unrelated Mount work,
unmount cancels both, no new work starts after drain, and no call succeeds with
the revoked Mount ID after process restart.

---

## High-severity findings

### H-1 — Cancellation is only half duplex

The method table permits `request/cancel` only from host to component. A graph
runner can start two child or effect requests, abandon one branch, and continue
the root Run. It currently has no portable way to tell the host to cancel the
abandoned `flow/call` or `effect/call`.

Ignoring the response does not revoke external authority. An Agent session,
subprocess, or expensive child may continue after its graph branch is gone.

#### Minimal fix

Make `request/cancel` bidirectional. Each peer may cancel only a pending request
originated by that peer, cancellation is idempotent, and the target request ID
plus owner identity must match. Root cancellation remains host-owned.

#### Release test

In Caskada, start two Agent effects, accept the first result, cancel the second,
and continue to a successful root outcome. Verify the second provider and its
descendants receive cancellation, no new effects are admitted under it, and
the root process is not killed.

### H-2 — “Runtime contract” has identity but no standard

Executable portability depends on:

```yaml
runtime:
  contract: https://example.org/flow-runtimes/deno
  version: ^2.0.0
```

No artifact or conformance rule defines what the contract version means. The
Runtime Provider owns a “fixed launch algorithm,” but independent providers do
not know which of these are contractual:

- accepted implementation suffixes;
- required runtime binary range;
- exact launch arguments;
- package-root and current-directory behavior;
- dependency and lockfile behavior;
- environment filtering;
- signal and exit mapping;
- permission-to-runtime flag compilation;
- source-map and stdio requirements;
- native platform variant selection.

Two hosts can both claim the same URI/version while launching materially
different programs. Pinning each launch-plan digest records divergence after
the fact; it does not make packages portable.

#### Minimal fix

Define Runtime Contract/1 as a named semantic standard plus conformance corpus,
not another package argv manifest. Each contract version must specify accepted
`flow.<suffix>` forms, launch/current-directory behavior, runtime-version
probe, dependency preparation boundary, Run/1 stdio behavior, permission
translation obligations, cancellation/exit mapping, and platform limits.

The contract descriptor and suite need exact digests and owner authorization.
Providers claim an exact contract version only after passing it. FLOW should
publish initial Deno, Bun, Python, and native contracts under an authority it
controls; third-party runtime identities remain owner-qualified.

#### Release test

Run the same immutable Deno, Bun, Python, and native fixtures on two independent
hosts. Compare observable input, settings, attachments, cwd, env, cancellation,
exit, permission denial, dependency preparation, and protocol framing. A
Deno-only package must fail at activation on a Bun-only host. No fixture may
depend on PATH order or package-supplied argv.

### H-3 — Package content identity is not reproducible across source types

The package identity includes a content digest, but the candidate never defines
the canonical tree being hashed. Git, npm tarballs, OCI layers, local folders,
Windows, and Unix disagree about:

```text
file mode bits
symlinks
case sensitivity
Unicode path representation
line endings
empty directories
archive metadata
submodules
generated dependency trees
device and special files
```

Without one snapshot algorithm, a contract lock, signature, runtime activation,
and update BASE can refer to different bytes while reporting the same source
revision—or different digests for identical intended packages.

The YAML parser boundary is also absent. Untrusted `FLOW.md` metadata can use
duplicate keys, aliases, tags, merge keys, or implementation-specific scalar
coercion unless Package/1 forbids them.

#### Minimal fix

Normatively define the Package/1 snapshot:

- paths are relative UTF-8 strings under the component root;
- sorted path/type/mode/content records form the tree digest;
- only regular files, directories, and safe relative symlinks are admitted;
- escaping/absolute symlinks, devices, sockets, FIFOs, and case-colliding paths
  are rejected;
- the executable-bit policy is explicit;
- source-adapter metadata and package dependencies are outside the package
  digest unless materialized into the snapshot;
- archive extraction is traversal-safe and resource-bounded;
- `FLOW.md` uses a safe YAML 1.2 data subset with duplicate keys, tags, aliases,
  merge keys, custom types, and executable coercions rejected.

The snapshot algorithm, not Git or npm, becomes runtime identity.

#### Release test

Materialize the same fixture through Git, npm, OCI, and a local directory on
Linux and Windows. Valid trees must produce one digest. Include case collisions,
Unicode names, CRLF bytes, executable bits, escaping symlinks, archive
traversal, decompression bombs, submodules, and special files. Every host must
accept or reject identically.

### H-4 — The Service descriptor is not yet independently implementable

The candidate names the right descriptor categories but omits the normative
shapes and wire mappings needed by a second SDK:

- the `handles` object grammar;
- how a schema position declares a nominal resource or delegated-Service
  handle;
- exact application-error result envelope versus JSON-RPC protocol errors;
- resource-handle issuer, lease owner, transfer, expiry, and release method;
- `facts` declaration grammar and its exact mapping to `event/append` types;
- whether undeclared errors/facts are rejected;
- JSON Schema dialect behavior and allowed `$ref` closure;
- conformance Flow binding and report shape.

The candidate also mentions provider/contract concurrency limits without
putting them in the contract or clearly assigning them to provider policy.

Two implementations will create incompatible tokens, error envelopes, and
cleanup behavior while passing the prose-level release gate.

#### Minimal fix

Freeze the thin Service Contract/1 meta-schema before claiming provider
conformance. It needs, at minimum:

```text
method input/output/error-data schemas
stable string application-error names
nominal resource and delegated-Service handle declarations
one normative schema annotation for handle positions
provider fact name/data schemas
self-contained JSON Schema closure
exact conformance Flow slot/report convention
```

Specify `service/invoke` application results as a tagged success/error value;
reserve JSON-RPC errors for protocol, validation, policy, cancellation, and
provider loss. Specify how the host automatically releases every resource
lease on owner closure.

Do not add generic signal subscriptions merely to fix this descriptor. The
callback path can remain narrower once it is actually callable.

#### Release test

Generate TypeScript and Python clients independently from only the descriptor.
Exercise every method/error, valid and forged handle, explicit and automatic
release, provider fact, provider crash, and conformance Flow. Their wire values
and failures must match without importing Jig code.

### H-5 — Effect dependencies are not statically declarable

`effect/call` is binding-scoped and contract-checked, yet Package/1 never shows
how an executable declares:

```text
slot agent requires contract A at range R
slot git requires contract G at range R
slot secrets requires contract S at range R
```

The Run context somehow receives local dependency slots, but a host cannot
preflight, select, grant, or document those slots before starting the code.
Failing only when `effect/call` arrives makes public packages less portable and
forces semantic discovery into live execution.

Service `uses` metadata may be intended to cover this, but the candidate
restricts its discussion to mounted Services and never states that a finite Run
may consume the same contracted operations through `effect/call`.

#### Minimal fix

Define one inert `uses` map for executable packages. Each effect slot either:

- requires an exact public Service/operation contract and range; or
- is explicitly `local` and therefore nonportable.

The map does not select a provider or define workflow logic. Run-only hosts may
validate and bind a finite request/response provider without implementing
Service mounting; unsupported slots fail before launch. `flow/call` remains
contract-free and may continue to supply intent at call time.

#### Release test

Install one Flow that uses `agent.run` and one that uses a local opaque effect.
On two hosts, verify the public package is rejected before launch when its
contract is unavailable, the local package requires an explicit project
binding, undeclared operations fail before provider dispatch, and neither slot
can be forged by runtime input.

### H-6 — Raw executable grants understate transitive authority

`run: [git]` looks like permission to execute one binary. Git can invoke hooks,
pagers, editors, credential helpers, protocol helpers, filters, SSH, shell
commands embedded in configuration, and arbitrary child processes. Similar
problems apply to package managers, compilers, and browsers.

An OS backend may truthfully restrict the initial `execve` to Git while Git
still reaches authority the author did not request. Reporting the `run`
restriction as enforced is misleading unless the descendants and their
filesystem/network/config inputs are constrained too.

#### Minimal fix

Define `run: [name]` as authority to start that logical executable **inside the
same complete sandbox and descendant policy**, not as a claim that only that
program's behavior occurs. The enforcement report must include child-process,
network, attachment, inherited descriptor, and configuration authority. If the
backend cannot prevent arbitrary helpers, it reports the wider authority or
fails.

Official guidance should prefer mediated Git/package-manager effects for
untrusted code. Raw `run` is an escape hatch whose transitive authority is
visible.

#### Release test

Attack the reference backend using Git hooks, `.gitconfig`, pager/editor
variables, credential and protocol helpers, filters, SSH commands, alternate
object directories, and spawned shells. Also test network redirects, DNS
rebinding, inherited file descriptors, `/proc`, and executable replacement.
No undeclared authority may be reached under an `enforced` report.

### H-7 — `jig.ts` turns safe-looking project commands into code execution

The project frontend is trusted TypeScript. That is a valid local policy
choice, but it means evaluating `jig.ts` and its imports is arbitrary code
execution. A user cloning an unknown repository cannot safely run `jig check`
if that command evaluates the project definition. Package discovery is inert;
project checking is not.

Starters and imported TypeScript dependencies expand this trusted computing
base before any Flow sandbox exists. The candidate records the normalized
result but does not define a trust prompt, dependency lock, evaluation sandbox,
or safe inspection mode.

#### Minimal fix

Separate commands and trust states explicitly:

```text
jig inspect
    reads Package/1 metadata and existing normalized state without executing
    project code

jig check/apply
    evaluates jig.ts only after the exact project/config dependency digest is
    trusted
```

Record the config source and resolved import graph in the activation. Never
auto-evaluate `jig.ts` during repository browsing, package installation, index
discovery, or GUI preview. Starter-generated code receives the same trust
review as any other project code.

#### Release test

Clone a fixture whose `jig.ts` and transitive npm import attempt network,
filesystem, environment, and process access. `jig inspect` must remain inert.
`jig check/apply` must refuse before explicit exact-digest trust, and the audit
must identify the code that was authorized.

### H-8 — Contract-owner authority and update continuity are policy placeholders

An owner-controlled URI plus a digest does not establish who may publish the
next version. DNS/domain takeover, Git account transfer, compromised indexes,
and key rotation can all produce a correctly formatted contract at the same
URI. The resolver step “verify publisher authority” has no portable evidence
record or continuity rule.

Direct source editing adds another failure. A user may edit an imported
`service.contract.json` while leaving its owner ID and exact version unchanged.
That intentionally creates the same equivocation Jig says must be quarantined.
The source/update UX does not tell the user how to fork or version a locally
changed public contract.

#### Minimal fix

Do not mandate one global PKI. Do mandate that a lock record:

```text
contract URI/version/digest
publisher/source identity
authority evidence type and digest
first-trusted or explicitly approved continuity root
any approved owner/key rotation
```

New versions under a locked identity require continuity with the project's
accepted authority or explicit reapproval. `jig check` must reject a local
descriptor edit under the same public ID/version. The user either keeps the
official descriptor while editing the implementation, bumps a version they are
authorized to publish, or forks to an owner URI they control.

#### Release test

Attempt same-version descriptor mutation, domain/account takeover, signer
rotation, mirrored-source substitution, and an approved organizational key
rotation. Independent hosts may apply different trust policies, but both must
expose and lock the evidence rather than silently accepting “same URI.”

### H-9 — “CloudEvents-compatible where useful” is not a wire contract

Independent hosts cannot implement an event ABI from compatibility “where
useful.” They need to know the exact required attributes, JSON representation,
extension names, ID/source authority, time format, data-schema behavior,
canonical request digest, and maximum envelope size.

One host may emit CloudEvents structured JSON; another may merely reuse field
names. Hooks, replication tools, and provider fact schemas will then disagree.

#### Minimal fix

Either adopt the CloudEvents 1.0 JSON event format exactly with a small fixed
set of FLOW extension attributes, or define one exact FLOW Fact/1 envelope and
publish a deterministic CloudEvents mapping. Remove “where useful.”

The host, not an untrusted component, supplies protected source and lifecycle
attributes. Contract-declared provider facts map to one exact type namespace.
Size, schema-validation, canonicalization, and operation-ID behavior must be
testable.

#### Release test

Append the same fact through two hosts and compare canonical envelopes. Reject
forged host namespaces, invalid time/data/schema, oversized payloads, changed
input under the same operation ID, and a provider fact undeclared by its
contract. Crash after commit and before response; retry must return the same
event ID without a duplicate journal fact.

### H-10 — The protocol is prose, not yet an independent conformance target

Method names and state transitions are not enough for a third-party host. The
candidate lacks normative JSON Schemas and error codes for Run/1 and Service/1,
facility negotiation, request-owner fields, canonical request hashing,
deadline representation, settings/input validation failure, stdout violation,
process exit mapping, and version mismatch.

The release gates assume a conformance suite that cannot yet be written
unambiguously.

#### Minimal fix

Before implementation lock-in, publish versioned protocol schemas and a state
machine/error registry. Keep the vocabulary exactly as narrow as the candidate;
this is specification work, not a feature addition.

The suite must be black-box and usable without Jig libraries. A host or
component should be able to claim individual `Package/1`, `Run/1`,
`Service/1`, `Contract/1`, Runtime Contract, event-journal, and sandbox-backend
conformance rather than “FLOW compliant.”

#### Release test

Have a team with no Jig dependency implement a Run host and another implement a
Service provider from only the published artifacts. Exchange them with the
reference component/host. Any reliance on source-level Jig types, undocumented
error interpretation, or fixture-specific behavior fails the gate.

### H-11 — The DSH ecosystem release gate claims more than v1 transports

“Importing a DSH-class component” is ambiguous. A DSH extension may contain:

```text
host Cordis plugins
browser Cordis plugins
React/UI slot contributions
session and remote-command services
application-specific resources and build assumptions
```

The candidate explicitly defers universal GUI-client code packaging. Service/1
can test the host-side serializable seam, but it cannot make an arbitrary DSH
client extension portable. Calling a host-only bridge a DSH-class import risks
an adoption promise the product cannot fulfill.

#### Minimal fix

Narrow the v1 gate to two named exercises:

1. a host-side Cordis realm with real dynamic dependencies, callback events,
   provider loss, and cleanup crossing Service/1;
2. a Jig-specific UI compatibility component which proves the selected Jig UI
   contract while explicitly making no universal client-code claim.

List unsupported DSH dependencies before activation. Do not infer that Cordis
compatibility supplies DSH sessions, slots, locale, commands, or browser code.

#### Release test

Choose representative DSH host and client plugins. Produce a compatibility
report listing every injected service, event, client module, and resource as
satisfied, adapted, local-only, or unsupported. The host plugin must run
through Service/1; the client plugin may run only through the explicit Jig UI
module. Any undeclared ambient service or raw Cordis object crossing the
boundary fails the gate.

---

## Focused ruling on deferred generic signals and subscriptions

### Decision

Do not reject the candidate merely because generic Service signals and
subscriptions are deferred.

A stable v1 can express the necessary interactions as:

```text
live one-way notification
    explicit callback Service method with no meaningful result

waterfall/bail/query callback
    explicit callback Service method with a typed result

registration lifetime
    provider-issued resource handle released on owner closure

durable public fact
    contract-declared fact through event/append

recoverable state observation
    callback invalidation plus an ordinary snapshot/cursor method
```

This is more verbose than `subscribe("changed")`, but it makes application
semantics explicit and can represent Cordis's several event modes without
forcing them into one universal event abstraction.

### What facts do not solve

A provider fact enters the host journal for Hooks, audit, and later queries. It
does not by itself deliver a live callback to a bound Service consumer. Jig
Hooks are project policy, not a portable component subscription mechanism.

Documentation must not claim that declaring `facts.changed` replaces a session
consumer's change callback. A provider that needs both declares the fact and a
registration method accepting a callback Service handle, or exposes a
cursor/long-poll method.

### Remaining scope limitation

A finite Run cannot publish a callback Service under the current model. It
cannot consume a callback-based stream directly. In v1 it must use one of:

- a request that remains pending until the desired event;
- a snapshot/changes-since polling method;
- a durable fact plus project Hook which starts a new Run;
- a mounted companion Service that owns the callback.

That limitation is acceptable only if it is explicit and the following tests
show it covers target applications. If ordinary finite Flows repeatedly need
short-lived event waits and authors build incompatible polling/callback
wrappers, promote a generic Scope-owned subscription in Service/2.

### Mandatory evidence before deferral is accepted

1. Bridge a Cordis session service whose `changed` notification invalidates a
   revisioned snapshot. Drop and coalesce callbacks; the consumer must resync.
2. Bridge a Cordis bail/waterfall event as a typed callback method and preserve
   return/error behavior.
3. Register a Jig UI contribution with a callback Service and resource handle;
   cancel the consumer without explicit unregister and prove cleanup.
4. Crash callback consumer and provider independently; no registration or
   token survives the owner lifetime and no replacement is silent.
5. Implement a finite Flow waiting for one external state change using the
   documented v1 pattern. Measure whether it requires a bespoke service solely
   to wait.
6. Ask a second non-Cordis service ecosystem to implement the same cases. If it
   cannot do so without inventing a generic subscription internally, the
   deferral has failed its own “two ecosystems” criterion.

The current candidate fails evidence items 1–4 because F-1 and F-2 make the
callback and Mount owner paths incomplete. Fix those before deciding whether
generic subscriptions remain deferred.

---

## Medium-severity findings

### M-1 — Semantic descriptions remain a selection injection surface

Candidate descriptions are untrusted model input. Allowlisting the returned ID
prevents arbitrary execution but does not prevent a malicious description from
manipulating the model into selecting a lower-quality already-trusted provider.

#### Minimal fix and test

Serialize candidates in a fixed neutral format, separate policy instructions
from package text, cap text length, include source/trust evidence outside the
description, and regression-test prompt injection. Record enough evidence to
rerun selection. A model-selected package receives no new grant merely because
it won.

### M-2 — Hook deduplication depends on a user-controlled action key

`(Hook revision, event ID, action key)` deduplicates only when the Hook produces
the same action key after redelivery. A Hook using time, randomness, or changing
state may schedule duplicate derived Runs.

#### Minimal fix and test

Give each Hook delivery a host ledger. Default derived action keys to stable
Hook-call ordinals under that delivery, and require an explicit key for dynamic
fanout. Redeliver after a crash between scheduling and acknowledgement; the
same derived Runs must be returned rather than recreated.

### M-3 — Native and multi-platform exact packages lack a distribution rule

One root implementation cannot contain several native binaries. The candidate
mentions a native Runtime Provider and platform filtering but does not say how
one source locator resolves platform variants without reintroducing multiple
entrypoints or mutable index choice.

#### Minimal fix and test

For v1, require distinct immutable package revisions per platform and put
platform eligibility in inert package metadata/index evidence. The lock records
the selected variant and digest. Do not add a command matrix. Install the same
logical release on Linux, macOS, and Windows and verify deterministic variant
selection or explicit incompatibility.

### M-4 — JSON Schema evaluation needs resource and dialect limits

Untrusted contracts and value schemas can use deep recursion, pathological
regular expressions, huge numbers, unknown formats, or custom vocabularies.
“JSON Schema 2020-12” does not by itself guarantee that two validators assert
the same formats or terminate under the same budget.

#### Minimal fix and test

Contract/1 must name the required vocabularies, define format behavior, reject
unknown required vocabularies, close external `$ref`, and impose depth, size,
regex, and evaluation budgets. Use malicious schemas against two independent
validators and require matching accept/reject/resource-exhausted outcomes.

### M-5 — Source/update UX omits provenance and preview commands

Directly editable source plus staged three-way update is understandable only
if users can see BASE, source origin, local divergence, candidate upstream,
contract changes, and the activation that is actually running. `jig status`
alone is underspecified.

#### Minimal fix and test

The product needs read-only equivalents of:

```text
jig source <component>
jig diff <component>
jig update --preview
jig history <component>
jig rollback <activation>
```

Names are not normative; the visibility is. Test an edited imported Flow,
upstream contract-major change, failed Agent repair, and rollback. At every
point a user must identify editable source, pristine BASE, staged candidate,
active revision, and running pinned revision without reading `.jig` internals.

### M-6 — One exact implementation reduces binary portability more than stated

A package cannot ship deterministic Python and TypeScript implementations or
several native variants. Separate packages preserve clarity but fragment
ratings, provenance, semantic discovery, and local customizations.

#### Minimal fix and test

Keep the v1 one-implementation rule, but document package variants as distinct
revisions of one source lineage and ensure indexes can group without treating
them as compatible. Reconsider only after real authors publish duplicate
packages frequently; do not add multi-entrypoint selection preemptively.

### M-7 — Repair waiting has no durable continuation and may consume a process

The candidate admits the continuation is lost on crash. A repair Flow may take
minutes while the parent process remains alive and holds a runtime/sandbox
allocation. Large numbers of missing calls can exhaust resources even when
scheduler admission tokens are released.

#### Minimal fix and test

Bound concurrent waiting processes separately from execution admission,
surface resource cost, and prefer fail/retry for long repair policies. Start
many missing bindings, cancel half, crash the host, and verify no child dispatch
occurs after cancellation, installed candidates remain staged/traceable, and
the host does not deadlock or exhaust file/process limits silently.

### M-8 — Contract SemVer compatibility rules are not stated

The resolver trusts `^2.3.0`, but contract owners need rules for input
contravariance, output covariance, new named errors, new facts, handle
lifetime changes, and tightened JSON Schema constraints. Generic SemVer says
when to bump; it does not define compatibility for this API model.

#### Minimal fix and test

Publish a Contract/1 compatibility guide and schema-diff linter. The linter is
advisory; owner versioning plus conformance remains authoritative. Supply
fixtures for every allowed minor and required major change, and verify clients
generated for the lower bound remain valid against later versions in the
range.

---

## Low-severity findings

### L-1 — Markdown fallback metadata is unnamed

The candidate requires explicit acceptable fallback but does not define the
field or its exact interaction with outcomes and schemas. Name one inert field
and test that missing runtime never triggers it without project permission.

### L-2 — Request-ID prefix rules are unnecessary unless fully specified

“Disjoint prefixes” needs grammar, collision behavior, and maximum length.
Otherwise simply require each peer to use strings in its assigned namespace.

### L-3 — Runtime and contract ranges use different examples without one range grammar

Runtime uses `^2.0.0`; Services require explicit lower bounds such as
`^2.3.0`. Publish one minimal range grammar and exact prerelease/0.x behavior
instead of relying on npm library conventions.

### L-4 — Settings schema defaults are ignored but documentation generation may not be

If UI tools display JSON Schema `default` while Jig refuses to apply it,
authors will believe a Binding is complete when activation fails. Either forbid
`default` in settings schemas or label it documentation-only everywhere.

---

## All 18 adversarial scenarios

| # | Scenario | Hostile result | Severity | Minimum release proof |
|---:|---|---|---|---|
| 1 | `FLOW.md` only, no Agent | Preflight failure is defined, but safe YAML parsing and zero side effects are not yet specified. | High via H-3 | Discover and reject without loading code, resolving imports, creating a Run, or invoking a repair Agent. |
| 2 | Deno-only implementation, Bun-only host | Intended failure is correct only if independent hosts agree what the Deno Runtime Contract means. | High via H-2 | Two hosts reject before dependency preparation or launch using the same contract fixture. |
| 3 | Two plausible child providers | Deterministic filters precede optional model choice; malicious descriptions can still bias ranking. | Medium via M-1 | Injection corpus may change neither eligibility nor grants; no Agent yields explicit ambiguity. |
| 4 | No child; Agent configured/not configured | Wait repair is bounded and staged, but process/resource pressure and crash loss need proof. | Medium via M-7 | Test fail, manual repair, Agent repair, cancellation, timeout, host crash, and repair-cycle rejection. |
| 5 | External effect succeeds, reply window crashes | `uncertain` is the required state, but canonical request hashing and provider operation-ID propagation are unspecified. | High via H-10 | Kill at every ledger boundary; never redispatch an uncertain non-idempotent operation. |
| 6 | Cancellation with children/subprocesses | Root cancellation exists; selective component-originated cancellation does not. | High via H-1 | Cancel one parallel child/effect while its parent completes, then cancel the root and process tree. |
| 7 | Mutually dependent providers | Static and runtime cycles are rejected, but delegated callbacks add edges the current wire cannot create. | Fatal via F-1 | Exercise mount cycle, callback cycle, capacity-one provider cycle, and asynchronous non-waiting notification. |
| 8 | Mounted provider crashes | Registration loss is defined; Mount-owned background authority and cleanup are not. | Fatal via F-2 | Crash during background effect, invoke, fact append, status update, drain, and restart; no old binding heals. |
| 9 | Untrusted Flow opens direct I/O | Outer backend may block it, but raw `git`/helper authority can exceed the report. | High via H-6 | Escape suite covers direct and transitive filesystem/network/process paths. |
| 10 | Backend cannot enforce restriction | Fail-closed rule is stated. Its evidence schema and trusted override need protocol-level tests. | High via H-10 | Same grant plan reports identical categories; advisory/unavailable never silently launches untrusted code. |
| 11 | Durable fact triggers Hook twice | Scheduling key can dedupe only if action key is stable. | Medium via M-2 | Crash before and after derived-Run scheduling; redelivery returns identical actions. |
| 12 | Telemetry is dropped | No semantic consequence is claimed. | Low | Drop every telemetry frame under conformance; results, events, effects, and Hooks remain identical. |
| 13 | LOCAL and UPSTREAM conflict | Staging safely stops, contingent on one canonical package tree. | High via H-3 | Conflict in content, rename, mode, symlink, delete/add, and contract descriptor; active snapshot remains unchanged. |
| 14 | Clean merge breaks local intent | The architecture admits no proof; tests/review may catch it. | Medium via M-5 | A semantically broken clean merge must remain staged when a declared check fails; Agent review cannot bypass checks. |
| 15 | Two configurations of one package | Binding revisions express the case; config evaluation trust and visibility remain. | High via H-7 | Both Bindings pin distinct settings/digests and survive edit/apply/rollback without inheritance. |
| 16 | Missing `MAX_RETRIES` | Binding activation should fail; schema-default UI ambiguity remains. | Low via L-4 | Environment variable and schema default never satisfy a missing required setting. |
| 17 | Cordis realm exports one service | Simple methods can cross; callback events are impossible until F-1 and Mount background work until F-2. Full DSH client portability is overclaimed. | Fatal/High via F-1, F-2, H-11 | Export method, callback, fact, dynamic dependency, resource lease, provider loss, and cleanup while local objects remain invisible. |
| 18 | Minimal Run-only host | The modular conformance claim is plausible, but no independent protocol artifact exists yet. | High via H-10 | Third party implements Package/1 + Run/1 only, rejects unavailable events/effects/Services honestly, and runs reference components. |

---

## Required release sequence

Do not solve every medium issue before implementation. Do enforce this order:

### Gate 0 — Freeze no public version

Resolve F-1 and F-2 on paper and in two prototypes. If callback Services or
Mount ownership require a generic distributed object model, the Service
narrowing has failed and must be reconsidered before any `1.0` identifier is
published.

### Gate 1 — Portable artifacts

Define and test:

```text
Package snapshot and safe FLOW.md parser
Run/1 schemas, errors, cancellation, owner model
Runtime Contract/1 and provider suite
Service/1 schemas and owner model
Service Contract/1 meta-schema and handles
Fact/1 envelope
```

These are specifications, not Jig modules.

### Gate 2 — Independent implementations

Require:

- one non-Jig Run host;
- Caskada and plain Python Run components;
- one plain Service provider and one Cordis realm;
- TypeScript and Python contract clients;
- two runtime-provider implementations for at least one runtime contract.

Passing only reference-to-reference tests proves implementation consistency,
not portability.

### Gate 3 — Authority

Run the package extraction, config trust, sandbox escape, handle forgery,
contract authority, semantic-injection, and conformance-suite isolation tests.
No unsupported restriction may be reported as enforced.

### Gate 4 — Ecosystem claim

Import the named Cordis/DSH host and Jig UI examples with an explicit
compatibility report. Only then decide whether callback Services are sufficient
and generic subscriptions remain deferred.

### Gate 5 — Source ownership

Exercise install, direct edit, contract fork/version bump, preview update,
deterministic merge, Agent repair, activation drain, history, and rollback on
real Git, npm, OCI, and local sources.

---

## Final rejection conditions

The candidate must be rejected rather than patched incrementally if any of
these remain true after the release gates:

1. A delegated Service handle cannot be invoked without converting it into an
   ambient global slot.
2. A mounted provider can perform background work without a revocable Mount
   owner.
3. Two hosts can claim one Runtime Contract while launching observably
   different programs.
4. Content digests differ by source adapter or platform for the same admitted
   package tree.
5. A package can call an undeclared effect or a forged provider before host
   validation.
6. `run: [git]` reaches undeclared helper or network authority under an
   `enforced` report.
7. Same contract ID/version can change digest without quarantine and authority
   review.
8. A DSH compatibility claim depends on undeclared Cordis objects or silently
   excludes its client half.
9. A dropped callback or fact changes correctness without a resynchronization
   or durable-delivery contract.
10. A third-party host cannot implement the published boundary without Jig
    source code.

Until those conditions are falsified, the candidate is an architecture draft,
not a portable standard.
