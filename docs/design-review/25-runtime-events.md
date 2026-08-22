# Targeted ruling: executable runtimes and reliable events

## Final decisions

### Executable runtime

Use exactly one root implementation file, `flow` or `flow.<ext>`. Declare its
**portable runtime contract** in the already-required `FLOW.md`. Jig binds that
contract to one concrete local Runtime Provider during activation and pins the
result.

Do not put a command, argv, executable path, or entry filename in `FLOW.md`.
Do not put a FLOW directive in the implementation. Do not infer a runtime from
the file extension or ask the OS to interpret a shebang.

```text
FLOW.md runtime contract
        ↓ deterministic compatibility
project/host Runtime Binding
        ↓ exact local provider
fixed provider launch algorithm + the one flow file
```

This is the only option which is simultaneously self-describing before launch,
language-neutral, binary-compatible, free of arbitrary command execution, and
independent of host filesystem layout.

### Reliable events

Run/1 should have one semantic operation, `event/append`, whose successful
response means the fact and its deduplication result were journaled before
acknowledgement. Keep `telemetry/emit` as the lossy notification.

Reject an `accepted`-but-not-durable event tier. If a message is allowed to
vanish on restart, it cannot be the reliable cause of Hooks or recovery. If it
is merely useful while the process is live, it is telemetry.

Run/1 hosts must recognize `event/append` but need not offer an event journal.
A host without one returns `EVENT_JOURNAL_UNAVAILABLE` without accepting the
fact and can still conform to Run/1. Jig offers the operation and adds durable
Hook delivery; the portable method does not force every host to implement
Hooks, queries, replay, or a general event bus.

---

# A. Runtime declaration

## A.1 The three candidates

### Candidate 1: runtime requirement in `FLOW.md`

```markdown
---
flow: 1
name: comparison-research
description: Research and justify a comparison target.

runtime:
  contract: https://runtime-owner.example/contracts/deno
  version: ">=2 <3"
---
```

The implementation is found by one fixed convention:

```text
flow
flow.ts
flow.py
flow.exe
```

Exactly zero or one root file named `flow` or `flow.<single-suffix>` may exist.
Zero means an instruction-only package. One means an executable package and
requires `runtime`. More than one is a package error. The suffix is for humans
and tools; it never chooses the runtime.

The field identifies an execution-semantics contract, not a binary. It does not
contain argv, a shell command, an install command, a path, or a runner profile.

### Candidate 2: FLOW-owned first-line directive

For example:

```text
#!flow {"runtime":"deno","version":">=2 <3"}
```

This can be made deterministic if FLOW parses it rather than relying on OS
shebang semantics. It has one real advantage: the declaration and source bytes
are colocated.

It nevertheless loses:

- It changes the syntax contract of every source language and toolchain.
- Some interpreters accept a hashbang-like first line, some reject it, and some
  preprocessors, formatters, bundlers, or compilers remove it.
- A native binary cannot contain a textual first-line directive.
- A host may need to strip the line, creating different executed bytes, broken
  source maps, and a second digest question.
- Encoding markers, byte-order marks, line-length limits, and generated source
  become package-protocol concerns.
- It hides deployment metadata in code from package catalogues which should be
  able to inspect `FLOW.md` without reading or understanding implementations.

FLOW can specify around these problems, but doing so buys no capability because
`FLOW.md` is already mandatory.

### Candidate 3: runtime only in the project/host Binding

For example, the project says “run this `.ts` file with Bun” while the package
says nothing.

This is ergonomic for local code and wrong for distribution:

- an imported package cannot be classified before project customization;
- Deno-only and Bun-only implementations look identical;
- indexes cannot report runtime availability;
- every project must reverse-engineer or trust prose about the implementation;
- an extension or local default inevitably becomes the hidden selector.

The project must choose the concrete provider, but the package must declare the
portable contract that provider is required to implement.

## A.2 The chosen two-level model

“Abstract” and “concrete” must not be confused with “vague” and “exact.”

### Portable runtime contract

The package declares an owner-controlled contract identity plus compatible
contract version. The contract defines enough execution semantics to decide
compatibility, including:

```text
source/binary format accepted
module and import semantics
fixed way the implementation path is presented
runtime configuration conventions
stdio and exit behavior required by FLOW Run/1
platform constraints, when intrinsic
```

`typescript` is too vague to be a valid contract for code using Deno imports.
`deno-runtime/2` is sufficiently exact. A provider implemented using another
engine may satisfy that contract only if it actually supplies the declared Deno
semantics and passes its conformance suite. Semantic similarity is irrelevant.

Contract identity is either FLOW-reserved or an owner-controlled URI. Package
names and first-installed-wins aliases are not runtime identities.

### Concrete Runtime Provider

A host/project Runtime Binding resolves the contract to one installed provider:

```text
provider package and digest
provider implementation version
resolved local runtime executable/binary
observed runtime version
fixed launch adapter
supported platforms
enforcement interactions with the Sandbox Backend
```

The package cannot choose `/usr/bin/deno`, search `PATH`, inject flags, invoke a
package-manager task, or expand a command template. A Runtime Provider owns one
fixed launch algorithm for its contract. Runtime-specific ordinary files such
as an import map or module lock are consumed only where the contract defines
them.

If two concrete providers satisfy the contract, an explicit project Runtime
Binding or still-valid lock decides. Jig does not ask a SemanticRouter which
executable should interpret code. An ambiguous runtime binding is a deterministic
preflight error.

This distinction gives the right portability:

```text
package chooses required execution semantics
project chooses local implementation of those semantics
host pins the exact launch result
```

The project may replace one conforming provider with another between active
revisions/Runs. It may not “override” a Deno contract with a Bun contract.

## A.3 Discovery and activation

Discovery executes no code and performs no dependency installation:

1. Parse the safe `FLOW.md` frontmatter.
2. List root files and require zero or one exact implementation candidate.
3. If no candidate exists, reject a `runtime` field and classify the package as
   instruction-only.
4. If a candidate exists, require one runtime contract and validate its
   identity/version syntax.
5. Resolve an explicit/locked concrete Runtime Provider.
6. Ask that provider to inspect compatibility without running package code.
7. Resolve settings, required host facilities, grants, and Sandbox Backend.
8. Create an immutable snapshot and activation record.

The activation record pins:

```text
FLOW.md digest and parsed runtime requirement
implementation relative path and digest
runtime contract identity/version
Runtime Provider identity/digest/version
resolved runtime binary and observed version
provider-generated launch-plan digest
Sandbox Backend and enforcement report
```

The active unit is the complete immutable snapshot, not separately mutable
metadata and code. This closes the check/use race.

### Launch

At Run start Jig asks the pinned Runtime Provider to instantiate its fixed
launch plan over the immutable implementation path and the already-approved
sandbox grants. The provider may derive internal flags needed to enforce those
grants, but package bytes cannot add argv.

If the exact provider or binary disappears after activation, the Run fails
`RUNTIME_UNAVAILABLE`. Jig does not bind a similar provider, follow a modified
`PATH`, fall back to Markdown, or re-activate implicitly.

A native `flow` file uses a native-runtime contract. Its provider inspects the
binary format, OS, architecture, and linkage requirements before activation.
This is something a first-line textual directive cannot represent uniformly.

## A.4 Updates

Runtime metadata and implementation bytes are separate authored concerns but
one activated revision:

- editing either changes the package digest;
- an active Run continues using its old snapshot and Runtime Binding;
- `jig apply` validates the new pair before publication;
- an upstream/local conflict in either `FLOW.md` or `flow.<ext>` remains a normal
  three-way source conflict;
- if an update changes the runtime contract, the candidate cannot activate
  until a compatible concrete provider and sandbox plan exist;
- rollback restores the prior complete snapshot and Runtime Binding.

No representation can prove that source truly uses only the declared runtime
API. If `FLOW.md` claims Bun while the body imports Deno-only modules, preflight
may pass and execution may fail. That is a false package declaration, just as a
binary may claim an ABI it does not follow. Contract tests and a smoke Run can
detect common cases; inventing a directive does not solve dishonesty.

## A.5 Security consequences

The chosen model removes package-controlled launch syntax. In particular:

- no shell parsing or string interpolation exists;
- no package-controlled argv can add `--allow-all`, preload libraries, change
  config, or execute another file;
- no inherited `PATH`, environment, or file descriptor selects the runtime;
- dependency preparation and package-manager hooks are separately authorized
  installation effects, never discovery or launch;
- the Runtime Provider is trusted host code and is pinned/audited separately
  from the untrusted Flow;
- the Sandbox Backend, not runtime flags alone, supplies the enforcement claim;
- a malicious edit cannot race preflight because launch uses the content
  snapshot that was checked.

Runtime configuration files can still be dangerous. A Runtime Provider must
define exactly which conventional files it reads and must invoke the one Flow
implementation directly rather than a package-defined task or script alias.

## A.6 Counterexamples which decide the ruling

### Generic `typescript` runtime

```text
runtime: typescript
flow.ts imports npm:, Deno KV, and Deno permission APIs
host chooses Bun
```

The runtime label was not a compatibility contract, so deterministic preflight
was impossible. This rejects vague abstract bindings, not abstraction itself.

### Concrete executable path in the package

```text
runtime: /home/alice/.deno/bin/deno
```

The package is not portable, leaks host layout into source, and bypasses the
project's trusted provider registry. This rejects concrete package launchers,
not concrete host pinning.

### First-line directive through a build tool

The source directive declares Deno, a bundler emits a JavaScript artifact
without the first line, and Jig is asked to run the output. Either the build
silently changed the runtime declaration or the host must maintain directive
provenance outside the file. The supposed single authority has already split.

### Runtime selected by suffix

Two machines associate `.ts` with Bun and Deno respectively. The same digest
has different module and permission semantics. This is not portable execution.

## A.7 Falsifying conformance tests

1. **Deno/Bun:** A package declares the Deno contract and contains a sentinel
   side effect. On a Bun-only host activation fails before any process or
   preparation step runs and no sentinel appears.
2. **No package argv:** Put command syntax, interpolation, and a fake shebang in
   the implementation. None may alter the Runtime Provider's recorded launch
   plan.
3. **Ambiguous concrete providers:** Install two providers for the same runtime
   contract with no explicit Binding. Activation fails deterministically rather
   than using `PATH`, registration order, or semantic routing.
4. **Mutable-source race:** Activate, then edit both runtime metadata and code.
   A Run must use the old metadata, bytes, provider, and launch-plan digest.
5. **One implementation:** Packages with both `flow.ts` and `flow.py`, a flow
   file without `runtime`, or `runtime` without a flow file are rejected.
6. **Native compatibility:** A binary for the wrong architecture is rejected in
   inspection without execution.
7. **Provider substitution:** Remove the pinned provider after activation while
   another compatible provider remains. The Run fails unavailable; it does not
   switch until explicit reconciliation creates a new active revision.
8. **Configuration escape:** A runtime config attempts to redirect launch to a
   second script. The provider must still launch the pinned implementation or
   reject the config.

If these tests require interpreting source imports, allowing package argv, or
consulting ambient executable associations, the runtime contract is not exact
enough or the provider boundary is not real.

---

# B. Reliable events

## B.1 Reject the two-level `accepted`/`durable` event

An acknowledged but volatile semantic event creates an attractive nuisance.
Consider:

```text
Flow emits build.completed with guarantee=accepted
host acknowledges
live Hook starts a deployment
host crashes before retaining the event/delivery record
```

After restart there may be a deployment with no causal fact, or a retried Flow
may emit a second event and start another deployment. The acknowledgement gave
the producer confidence without giving recovery an authority.

Alternatively:

```text
host acknowledges accepted
host crashes before any Hook sees it
```

The producer may have completed while required project policy never ran. If the
producer was not allowed to rely on that policy, the event was observational
and belonged in telemetry. If it was allowed to rely on publication, the
guarantee was inadequate.

Two guarantee levels also spread branching into packages and conformance:

```text
what does this Flow do after an accepted-but-not-durable acknowledgement?
may this Hook trigger correctness-sensitive work?
does retry create a new event after host epoch change?
which level did the package require and where was it declared?
```

There is no useful portable middle category. Remove it.

## B.2 The single operation

Run/1 defines:

```text
event/append      component -> host request
telemetry/emit    component -> host notification
```

`event/append` parameters are:

```json
{
  "ownerRequestId": "h:run:17",
  "operationId": "build-completed:1",
  "type": "example.org/build.completed",
  "data": {},
  "causedBy": "E-70",
  "correlationId": "C-42"
}
```

Success returns:

```json
{
  "eventId": "E-81"
}
```

There is no guarantee parameter because success has one meaning:

> The immutable event, its stable ID, and the operation-deduplication result
> were committed to the host's durable journal before the response was sent.

“Durable” means recoverable after process/host restart on the storage fault
model claimed by that host and retained according to its disclosed event
retention policy. It does not mean immortal, globally replicated, or immune to
hardware loss. A conformance claim identifies the tested storage profile.

The append is a semantic host effect and uses the same operation-ID discipline
as `effect/call`, but deserves a first-class method because the event envelope,
causality, namespace authority, and journal-before-ack rule are universal.

`telemetry/emit` has no acknowledgement, stable event ID, deduplication, or
delivery promise. Progress, logs, token deltas, and sampled traces use it. A
dropped telemetry notification cannot change correctness.

## B.3 A small host remains small

Run/1 defines the method and its success semantics; it does not require every
host to provide the facility.

- A host with no event journal returns `EVENT_JOURNAL_UNAVAILABLE` before any
  side effect.
- A package/Flow Binding that declares reliable events required fails preflight
  on that host.
- An undeclared dynamic append receives the same runtime error.
- The host may still execute exact leaf Runs, child calls, and other granted
  effects.

This is not a weaker semantic tier. It is ordinary feature availability: the
host either accepts a durable append or it does not accept an event.

The baseline portable guarantee ends at append. Run/1 does not require event
query, replay, filtering, subscription, Hook registration, Hook execution, or
cross-host replication.

Jig adds:

```text
transactional event and operation journal
host lifecycle events committed with their state changes
query/replay APIs for local components
at-least-once Hook delivery records
idempotent Hook-to-Run scheduling keys
causal-depth and loop policy
retention/compaction policy
```

Those are Jig product guarantees. They do not change what an
`event/append` success means.

## B.4 Event state and crash behavior

For Jig, event publication is:

```text
received
  -> validated
  -> transaction(event row + unique operation row + response value)
  -> committed
  -> acknowledged
```

The unique key is `(owner invocation/request, operationId)` and stores a
canonical digest of type, data, and causality. Same key plus same digest returns
the same `eventId`. Same key plus changed data is `OPERATION_ID_REUSED`.

Crash cases:

- **Before transaction commit:** no event exists; recovery may safely accept
  the original append again.
- **After commit, before response:** the event exists. If only the response is
  lost while the invocation remains live, a repeated request returns the same
  event ID. If the host process itself dies, the opaque Run becomes `lost`, but
  the event and subsequent Jig Hook delivery survive; Jig does not pretend the
  component continuation can reconnect.
- **After response:** the journal remains authoritative even if the component
  crashes before its own next instruction.
- **Whole Run retried as a new invocation:** Run/1 does not promise cross-Run
  deduplication. A domain needing it supplies a stable domain key through its
  event contract or reconciles duplicates.

Because Jig's local journal transaction determines commit unambiguously, this
operation does not become “indeterminate” at the database crash boundary. A
host proxying append to a remote journal must use that journal's receipt or
return an indeterminate host failure; it may not acknowledge before certainty.

## B.5 Cancellation and ordering

Cancellation races with one commit point:

- cancellation wins before commit: no event is appended and the request is
  cancelled;
- commit wins first: the append succeeds durably; cancellation cannot retract a
  fact;
- a response lost after commit is recovered by the operation ID.

Per-producer program order is the order in which Jig commits requests received
serially from that producer. Concurrent appends have no global semantic order
beyond journal sequence. Causality uses `causedBy` and `correlationId`, not
wall-clock timestamps.

The host must acknowledge immediately after commit. It must not await any Hook,
subscriber, child Run, GUI, or provider reaction. This prevents cycles such as:

```text
A appends event
Hook calls A
A cannot answer because append waits for Hook
```

Hooks fan out after commit. Their failures cannot roll back the fact.

Host-owned namespaces are protected. Components cannot forge `jig.run.completed`
or another provider's lifecycle events; their Run grants determine publishable
namespaces. Payload schemas are optional event contracts, not inferred from the
type string.

## B.6 Hook crash semantics

Jig's Hook table uses:

```text
(Hook revision, eventId, action key)
```

Delivery is at least once. Starting a Flow from a Hook is a transactional or
idempotent scheduler call keyed by that tuple. If Jig crashes after creating
the derived Run but before acknowledging Hook delivery, redelivery finds the
same Run. Hook code can still observe the event twice and must not perform raw
external effects without its own idempotency.

The event append response says nothing about Hook completion. A Flow requiring
another operation to finish must call it or await an explicit later fact; it
must not assume that appending an event synchronously ran policy.

## B.7 Counterexamples which decide the ruling

### Acknowledged progress

A UI wants confirmation that a progress update reached the host. Making this a
volatile fact merely to obtain an acknowledgement mixes transport feedback with
semantic publication. If receipt matters operationally, use a bounded
request/response UI effect. Ordinary progress remains telemetry.

### Host with no disk

An embedded host can run a deterministic leaf Flow but has no durable store. It
cannot truthfully acknowledge semantic facts. Returning unavailable is a more
portable result than inventing an “accepted” event whose recovery behavior
differs from Jig.

### Append waits for deployment Hook

The deployment calls back into the emitting service. Waiting for it makes the
event journal part of the control-flow cycle and can deadlock. Journal commit,
not reaction completion, is the acknowledgement boundary.

### Component emits host lifecycle fact

An untrusted component emits `jig.run.completed` before it finishes. If event
namespaces are not grant-protected, Hooks see a forged system fact. The host,
not the component, owns host lifecycle events.

## B.8 Falsifying conformance tests

1. **Commit/response boundary:** First drop the response after commit while the
   invocation remains live and retry the identical operation; exactly one event
   exists and the same `eventId` is returned. Separately kill and restart the
   host after commit; the opaque Run is `lost`, but the one event remains and
   its pending Jig Hook delivery resumes.
2. **Pre-commit crash:** Kill before commit, restart, and retry. Exactly one new
   event is committed; no phantom event exists from the first attempt.
3. **Changed duplicate:** Reuse the operation ID with changed payload. The host
   rejects it and the journal remains unchanged.
4. **Blocking Hook:** A Hook blocks forever or synchronously calls the emitter.
   Append still acknowledges after journal commit and before the Hook finishes.
5. **Cancellation race:** Kill at every instruction boundary around commit.
   Recovery shows either no event plus cancellation or one committed event plus
   stable success—never an acknowledged missing event or a duplicated event.
6. **No journal:** A Run/1 host without event storage returns
   `EVENT_JOURNAL_UNAVAILABLE` and performs no listener callback. It remains
   conforming but cannot satisfy a package requiring reliable events.
7. **Telemetry loss:** Drop every `telemetry/emit`; Run outcome, event journal,
   and Hook scheduling are unchanged.
8. **Namespace forgery:** A component without the system namespace grant cannot
   append a host lifecycle type.
9. **Hook restart:** Crash after derived Run creation but before Hook delivery
   acknowledgement. Redelivery resolves to the same derived Run.
10. **Retention disclosure:** Restart within the host's advertised retention
    window and retrieve the event by ID. A missing event falsifies the host's
    storage profile.

---

# Resulting minimal boundary

The executable design has one source of meaning and one source of code:

```text
FLOW.md
    semantic description + portable runtime requirement

flow[.<ext>]
    the only executable implementation

Runtime Binding
    project/host choice of a conforming concrete provider
```

There is no launcher manifest, package argv, runtime guess, or OS shebang
contract.

The Run/1 outward channels have one semantic distinction:

```text
event/append
    acknowledged only after durable journal commit

telemetry/emit
    unacknowledged and disposable
```

There is no volatile “fact” tier. A small host may decline reliable events;
Jig accepts them durably and layers Hooks on the journal. This is both smaller
and safer than accepted-vs-durable negotiation.
