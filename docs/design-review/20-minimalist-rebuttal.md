# Minimalist cross-examination: five boundaries that must stop moving

This memo does not restate the architecture. It resolves five remaining
disputes by identifying the invariant each mechanism must protect. I reverse
three positions from my first-round memo:

1. I now prefer one conventional `flow`/`flow.<ext>` over an exact argv field.
2. I now put a generic `effect/call` in Run/1.
3. I now require Jig v1 to ship stable Services support.

These reversals are not concessions to taste. The first follows from separating
a FLOW-owned launch convention from OS shebang semantics. The second follows
from recognizing host-mediated effects as the defining runner/host seam. The
third follows from taking Jig's claimed general-purpose and Cordis-compatible
scope seriously rather than treating Services as hypothetical.

## 1. Executable discovery: conventional file plus FLOW directive

### The strongest case for exact argv or `flow.json`

An argv descriptor is precise. It can say `deno run flow.ts`, works on Windows,
does not depend on executable bits, distinguishes Bun from Deno, and never
requires a shell. `flow.json` also keeps machine launch metadata out of a
human/Agent document and can hold feature and grant declarations. This is a
good conventional package-manager design.

Its cost is not the extra dozen bytes. Its cost is two authorities for one
implementation:

```text
flow.json says where execution begins
the package tree makes some other file look like execution begins
```

It permits hidden or arbitrary entry paths, makes a simple package three files
(`FLOW.md`, `flow.json`, implementation), and creates drift when an Agent or
human copies/renames the implementation but not the descriptor. Moving argv
into `FLOW.md` removes a file but still duplicates the entry filename.

### The decisive invariant

> A package has exactly one visually and mechanically authoritative executable
> entry, and resolving it never invokes a shell or guesses among runtimes.

### Decision

Package/1 reserves exactly one root entry candidate:

```text
flow
flow.<ext>
```

`FLOW.md` is explicitly excluded. Zero candidates means instruction-only. More
than one is an invalid package; there is no priority order. Logical names are
lowercase and package validation rejects case-folding collisions so the rule is
the same on Windows and case-sensitive filesystems.

A source entry may begin with a **FLOW runtime directive**:

```text
#!flow {"runtime":"deno","args":["run"]}
#!flow {"runtime":"bun"}
#!flow {"runtime":"python3"}
```

This is not claimed to be a POSIX shebang. The relevant facts are:

- POSIX does not standardize `#!` process launching;
- kernel argument splitting differs across systems;
- `/usr/bin/env` at that path is not a portable guarantee;
- `env -S` is not POSIX;
- Windows does not natively apply the convention.

None of those facts prevents FLOW from assigning meaning to first-line bytes in
a FLOW package. Jig reads the directive itself on every OS. It never invokes
`/usr/bin/env` and never asks the kernel to parse the line.

The directive grammar is deliberately closed:

- it must begin at byte zero and end on the first line;
- the suffix is a one-line JSON object;
- `runtime` is one logical runtime-provider ID;
- optional `args` is an array of literal strings;
- duplicate keys and any other fields are rejected;
- no interpolation, environment expansion, quoting language, or shell exists;
- the host resolves `runtime` through its allowlisted runtime registry;
- effective launch is the resolved runtime prefix, directive args, then the
  absolute entry path, with `shell: false`.

The selected runtime implementation and version are locked and journaled. A
missing pinned runtime means `implementation_unavailable`; a host never tries a
similar runtime.

The directive is a comment/hashbang only in languages whose parser accepts it.
The runtime adapter must declare that it accepts the FLOW directive. A compiled
native `flow`/`flow.exe` needs no directive. A source language that rejects such
a first line can use a tiny conventional launcher as `flow` or can force us to
revisit this choice with evidence; v1 does not add a sidecar escape hatch.

When the directive is absent:

- a native `flow` or `flow.exe` is launched directly;
- otherwise the host may use one explicit project-wide extension association,
  such as `.py -> python3`;
- absence of an unambiguous association is `implementation_unavailable`;
- extension selection is deterministic configuration, never semantic routing.

An unpinned `.ts` file thereby claims compatibility with the project's chosen
TypeScript runtime. Runtime-specific TypeScript should carry a directive. If it
uses Deno APIs without doing so and Bun fails, that is a package defect; Jig
must not retry under Deno after execution begins.

Markdown fallback remains invocation policy. It may occur before launch when
the runtime is unavailable and an instruction runner is configured. It never
occurs automatically after a process starts, because effects may already have
happened.

This is a reversal of my Round-1 argv recommendation. I previously treated OS
shebang non-portability as if it prohibited a product-owned byte convention. It
does not. Once FLOW, rather than the kernel, parses the directive, the
conventional filename gives better locality with equal launch determinism.

### What would falsify this choice

Prototype at least twenty real entries across Bun, Deno, Python, shell,
Caskada, a compiled language, Windows, Linux, and macOS. Return to an argv field
or descriptor if any of the following is common rather than exceptional:

- source parsers cannot retain the directive without generated shadow files;
- runtime arguments require the entry path in several different positions;
- one package genuinely needs a platform matrix rather than one runtime ID;
- authors routinely need more than one executable entry;
- tooling cannot preserve the directive during format/build operations.

Do not add incremental exceptions before that prototype. Either the convention
works as one rule or argv wins.

## 2. `effect/call` and `event/emit` in Run core

### The strongest case for extension-specific methods only

JSON-RPC already permits `agent/run`, `git/commit`, or `events/append`. Exact
extension methods are self-describing, independently versioned, and avoid a
generic service locator. A generic `effect/call` can become an untyped tunnel
with strings for provider, operation, and payload. `event/emit` is especially
dangerous because “event” is often mistaken for a durable fact, leading Hooks
to depend on lossy telemetry.

### The decisive invariant

> Run/1 must express the one universal control transfer from a runner that
> retains its continuation to a host that owns external authority, without
> standardizing the external authorities themselves.

### Decision

`effect/call` belongs in Run/1. It is the effect envelope, not a universal
effect catalogue:

```json
{
  "scopeId": "S-17",
  "effectId": "R-4/build/1",
  "slot": "builder-agent",
  "operation": "run",
  "input": {}
}
```

The slot is prebound in the Run Context or fails explicitly. The host mediates
the call, journals intent/result, applies grants, and returns serialized data.
Local projects may use an informal slot. Portable reusable components may
declare an exact extension or Service contract for that slot. Run/1 does not
decide the operation schema.

This generic envelope is smaller than making every runner SDK implement and
intercept an open set of top-level JSON-RPC methods. It also gives every effect
the same cancellation, idempotency, journal, grant, and provider-binding
semantics. `flow/call` remains separate because it creates a child Run with a
domain outcome and parent/child lifecycle, not merely a provider operation.

This reverses my Round-1 exclusion. Host-mediated effects are not an optional
Jig feature; they are the reason an external runner boundary can remain both
powerful and least-authority.

`event/emit` also belongs in Run/1, but only under a deliberately weak contract:

```json
{
  "scopeId": "S-17",
  "type": "caskada.node.started",
  "data": {}
}
```

It is a JSON-RPC notification. It may be sampled, reordered, or dropped. It has
no acknowledgement, effect ID, replay, or Hook guarantee. A conforming program
cannot make a correctness decision based on delivery. Stderr remains plain
logs; `event/emit` supplies structured observation and progress.

A durable fact is an acknowledged `effect/call` to a bound event-journal slot.
The name `event/emit` does not promote telemetry into a fact. Specifications and
SDKs must use the terms **observation** and **durable fact** consistently.

Core is therefore still only:

```text
flow/run
flow/cancel
flow/call
effect/call
event/emit
final outcome/error
```

There is no `effect/provide`, subscription, callback, middleware, or event query
in Run/1.

### What would falsify this choice

Implement the same Agent call, filesystem mediation, and HTTP call in Caskada,
plain Python, and a simple non-Jig host. Remove `effect/call` if exact extension
methods produce smaller SDKs and equally uniform idempotency/grant behavior.
Move an operation to Services if the envelope repeatedly needs streaming,
subscriptions, callbacks, provider-owned handles, or a lifecycle beyond its
Run.

Remove `event/emit` from core if two independent hosts cannot implement it as a
strictly ignorable notification, or if real users repeatedly build correctness
on it despite the conformance tests and vocabulary. Do not solve that misuse by
adding durability to the notification.

## 3. Services and the Jig v1 stability bar

### The strongest case for an experimental Services release

Long-lived providers introduce mounts, readiness, calls in both directions,
dependency cycles, draining, provider loss, contract identity, and trust. None
is needed to run a one-file Flow. Stabilizing those semantics before multiple
implementations exist risks freezing an imagined plugin system. Package/1 and
Run/1 could ship sooner while Services incubates independently.

### The decisive invariant

> A product cannot call itself a general-purpose, deeply extensible Cordis peer
> while its only stable lifetime is one process invocation.

### Decision

Services remains a separate protocol and conformance claim, but a stable Jig
v1 must implement a stable Services/1. “Separate” is a portability boundary,
not permission for Jig's central product promise to remain experimental.

The release order should therefore be evidence-gated rather than
calendar-gated:

1. Package/1 and Run/1 implementations are built.
2. A Cordis realm exposes one contracted serializable service.
3. An unrelated implementation (for example a Python session store or
   database-backed provider) implements the same lifecycle suite.
4. Crash, cancellation, dependency-cycle, provider-loss, and concurrent-call
   tests pass.
5. Only then is the complete Jig release called v1 stable.

A third-party host can still claim `Package/1 + Run/1` without Services. No
package may claim generic “FLOW compliant”; conformance is a vector.

Services/1 should remain smaller than Cordis:

```text
service/mount      create a service instance and return readiness
service/invoke     host/consumer invokes a declared operation
service/call       provider invokes a pinned required service
service/unmount    drain and close the instance
provider_lost      explicit terminal availability state
```

Public boundaries are static and serializable. Dynamic local Cordis services,
Fibers, closures, classes, React objects, and event modes stay inside the realm.
Exact contract compatibility is deterministic; semantic routing only ranks
already compatible provider instances.

Required mount-dependency cycles fail before activation. Runtime synchronous
wait cycles fail rather than deadlock. A provider crash invalidates existing
pinned bindings; it never silently rebinds consumers mid-Scope.

This strengthens Round 1. Deferring stable Services would optimize spec purity
at the expense of never testing whether Run, Scope, binding, and cancellation
actually compose with the hardest promised use case.

### What would falsify this choice

Build the Cordis and unrelated-provider prototypes before freezing names. Drop
Services/1 if both can be represented as ordinary long-lived Runs plus
`effect/call` with no extra public lifecycle and no ambiguous ownership. Delay
Jig v1 if the prototypes require transparent in-process objects or distributed
state restoration, because those are evidence that the proposed boundary is
wrong, not reasons to standardize more fields.

Conversely, if only Cordis can implement the draft cleanly, it is Cordis-shaped
and not ready for stability.

## 4. Scope, Context, and Mount: expose semantics, not management APIs

### The strongest case for hiding all three

A one-shot Run already owns its process, children, directory, and effects. Its
request parameters already contain input and configuration. Adding `Scope`,
`Context`, and `Mount` can turn simple execution into enterprise dependency
injection vocabulary. If no operation independently manipulates an object, a
new public noun may be ceremony rather than capability.

### The decisive invariant

> Every resource has exactly one lifetime owner independent of the transport
> connection, while concepts with no independent behavior remain projections
> rather than protocol objects.

### Decision

Round 1 over-hid Scope and Mount.

**Scope is a normative semantic and wire identifier.** A Run or Mount receives
one host-created root `scopeId`; effects, child Runs, Agent sessions, leases,
and registrations identify the owning Scope. Closing the owner closes its
children. The stdio connection is never the owner. There is no general
`scope/open`, mutable scope object, or user-created arbitrary lifetime in v1.
Scope is visible because both Run/1 and Services/1 need the same authority and
cleanup boundary.

**Context is an SDK projection, not an independently versioned protocol
object.** `flow/run`/`service/mount` parameters contain immutable input,
settings, slot bindings, roots, grants, IDs, and cancellation access. An SDK
should expose those conveniently as `Context`, especially for Caskada and
Cordis adapters. The wire does not need `context/get`, inheritance, ambient
proxies, or distributed object semantics.

**Mount is a public Services/1 lifecycle.** `mountId` identifies one configured
long-lived provider instance. Mount readiness, draining, unmount, and provider
loss cannot be encoded honestly as a completed one-shot Run. Mount does not
belong in Run/1 and is not required by a Run-only host.

Run and Mount are activities. Scope is their ownership boundary. Context is
their immutable view. This vocabulary earns its place without becoming an API
for arbitrary lifetime manipulation.

### What would falsify this choice

Instrument the Run scheduler, Agent provider, Cordis adapter, and Service host.
Remove `scopeId` from the wire if `runId`/`mountId` alone always identify
authority and cleanup without translation tables, especially when one provider
serves concurrent Scopes. Promote Context beyond an SDK projection only if a
component must query or derive Context dynamically across the boundary.

If a long-lived provider can return a final Run response while remaining
callable without relying on its process connection as identity, Mount may be
unnecessary. The prototype must demonstrate cancellation, replacement, and
provider loss, not merely the happy path.

## 5. Flow Bindings, settings, and sandbox grants

### The strongest case that these are bloat

A caller can pass all values as input, invoke a package path directly, and let
the OS sandbox configuration live in Jig. “Binding”, “settings”, “slots”, and
“grants” can look like a dependency-injection framework grafted onto a minimal
Flow. Permission vocabularies are notoriously platform-specific and often
produce security theatre.

### The decisive invariant

> A reusable configured use must be reproducible independently of each caller,
> and an executable receives no ambient authority that is absent from its
> recorded grant.

### Decision

All three concepts survive, but only at their narrowest boundary.

### Flow Binding

A Flow Binding is a Jig project object, not a Package/1 requirement:

```text
project-local ID
+ exact package snapshot
+ immutable settings
+ slot bindings
+ grant policy
+ optional local routing description
```

Runs target a Binding. Two Bindings can configure the same package differently
and appear as distinct semantic-router candidates. The binding lock records the
resolved serializable definition. There is no global namespace, implicit
inheritance, deep merge, or runtime mutation.

Calling this object a Binding is preferable to overloading package identity.
Whether authors write a small TypeScript helper or inert JSON is Jig ergonomics;
both must resolve once to the same serializable record before activation.

### Settings

Settings are immutable per Binding; input varies per Run. Parent settings do
not flow into children. Missing required settings fail schema validation or
implementation validation before effects. Defaults live in implementation
code, not JSON Schema annotations, environment variables, or Jig magic.

This distinction is not ceremony. Without it, every caller repeats
configuration, semantic routing cannot distinguish “review-fast” from
“review-strict”, and provenance cannot reproduce the selected use.

### Grants

The portable grant algebra is resource-oriented and monotonic:

```text
resource kind + selector + access mode + minimum enforcement
```

The initial kinds should be no larger than:

```text
filesystem root: read | write
network destination: connect
process executable: spawn
environment key: read
secret handle: use
```

Package snapshot read/execute and protocol stdio are baseline launch authority.
Everything else is explicit. Agent, child-Flow, and Service access normally
arrives through bound slots and `effect/call`, not raw OS authority.

The package may declare minimum needs for preflight; the Binding supplies the
project maximum. Effective grants are their checked intersection. A child Scope
receives an explicit subset, never ambient inheritance. No negative rules,
boolean policy expression language, role hierarchy, or YAML condition system
belongs in FLOW.

Every backend reports each effective restriction as `enforced`, `mediated`,
`advisory`, or `unavailable`. `Mediated` is not adequate if raw bypass remains
possible. Untrusted execution is refused unless the project's minimum
enforcement is met; trusted override is explicit and journaled.

These are Jig security semantics and Run Context fields. Run/1 transports the
effective result; it does not standardize Linux namespaces, containers,
AppContainer, network proxies, or policy authoring.

### What would falsify this choice

Test two differently configured bindings of one package, nested child calls,
and Linux/macOS/Windows sandbox backends.

- Collapse Binding into a plain invocation alias if settings, slots, grants,
  identity, and selection evidence never need a shared stable lifetime.
- Collapse settings into input if no real project reuses a configured Flow
  across Runs or routes between configurations.
- Move a grant kind to a named extension if two enforcing backends cannot give
  its selector/access mode the same security meaning.
- Reject the portable grant algebra entirely if the UI cannot explain effective
  authority without backend-specific caveats. Do not compensate by adding a
  larger universal policy language.

## Consolidated ruling

The smallest architecture that passes these disputes is not the one with the
fewest nouns. It is the one in which each remaining noun protects a distinct
invariant:

```text
flow.<ext> + #!flow directive
    one authoritative executable and exact runtime intent

Run
    one execution and domain outcome

Scope
    authority and cleanup ownership across Run and Service

Context
    immutable SDK view, not a remote object

effect/call
    runner-to-host authority transfer

flow/call
    child execution and outcome

event/emit
    explicitly lossy observation

Mount / Services
    long-lived serializable provider lifecycle

Flow Binding + settings + grants
    reproducible project use and least authority
```

Delete `flow.json`, exact entry argv in frontmatter, POSIX shebang claims,
extension-specific top-level effect methods, durable-event semantics in
`event/emit`, arbitrary Scope APIs, Context proxies, implicit settings,
permission DSLs, and the idea that stable Services can be postponed until after
a supposedly general-purpose Jig v1.

The hard boundary remains unchanged:

> FLOW standardizes execution, ownership, host effects, observation, and an
> optional-but-stable service profile. Jig owns policy, selection, durability,
> sandbox implementation, repair, and project authoring. Runners own control.
