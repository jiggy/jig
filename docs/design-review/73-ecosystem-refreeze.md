# Ecosystem re-freeze audit

## Verdict: BLOCK

The previous Runtime-bundle, conformance-firewall, and Starter-transaction
blocks are corrected. Four release-boundary patches remain. They require no new
general callback, subscription, telemetry, graph, registry, or package-manager
surface.

## 1. Journal behavior has no compatible identity under Service Contract/1

### Block

Section 7 defines exact Service Contract compatibility as the canonical digest
of the small method/schema descriptor. It explicitly excludes facts,
behavioral conformance executables, and other service semantics from that
descriptor.

Section 9 then says the official Journal contract's same
URI/version/digest commits all of the following:

```text
atomic (callKey, requestDigest, Event, receipt) storage
idempotent append and collision behavior
recovery lookup or authorized redispatch
ordering and Hook visibility
recovery fixtures
```

Those claims cannot both be true. Two providers can expose byte-identical
Service Contract descriptors while implementing incompatible append recovery.
Conversely, making the descriptor digest silently cover external behavioral
material changes the Contract/1 identity model after independent consumers
have implemented it.

There is a second atomicity conflict. Hook interval publication is ordered in
one Jig database transaction, while section 15 requires a separately mounted
Journal to participate in concurrent Event/Hook-boundary tests. The listed
Journal methods provide no linearizable barrier or transaction spanning the
external provider and Jig's activation database. “No database lock across an
external call” correctly forbids pretending otherwise.

### Required patch

Define **Journal/1 as a separately conforming behavioral capability profile**:

1. Its immutable bundle root commits to the exact Service Contract descriptor,
   Event schema, namespace/authority rules, ordering, append idempotency,
   recovery rules, limits, normative text, and black-box crash fixtures.
2. A portable Journal slot pins both the ordinary Service Contract tuple and
   the exact Journal/1 profile tuple. A provider must advertise both. Contract
   matching proves method/value compatibility; Journal-profile matching proves
   the additional behavior. Do not overload `Service Contract.digest`.
3. Add explicit `FLOW Journal/1 Provider` and host/consumer conformance labels
   and fixtures.
4. In Jig v1, only the host-integrated canonical Journal/outbox may drive
   Hooks. A mounted Journal may implement portable append/query/wait and may
   mirror canonical Events, but it cannot establish the activation/Hook
   boundary unless a future profile supplies a proven linearizable barrier.
5. Revise gate 7 so mounted Journals are tested for call-key recovery, while
   Hook interval atomicity is tested against the host-integrated canonical
   Journal. Do not claim one cross-database transaction.

This keeps `event/append` out of Run/1 and does not move Journal into every Run
host. A package requiring Journal/1 preflights as an optional profile exactly
like any other unsupported capability.

### Release test

Give two providers the same method descriptor but different duplicate-append
behavior; only the provider matching the exact Journal profile may bind. Kill
the mounted provider and host at every external-commit/outer-commit boundary
and require the specified recovery result. Concurrently switch a Hook revision
and append through the canonical host Journal; every Event must select exactly
the old or new interval. A mounted provider must not be accepted as the Hook
ordering authority in v1.

## 2. Hook activation requires schema reasoning Package/1 rejects

### Block

Section 3 correctly states that Jig validates concrete input values and does
not infer JSON Schema subtyping. Section 9 nevertheless requires activation to
prove that a target input schema “validates the Journal contract's complete
Event value.” At activation there is no concrete Event value. Proving that one
schema accepts every value admitted by another schema is schema containment,
the exact operation the architecture excludes.

Independent hosts will otherwise choose incompatible rules: schema equality,
heuristic subtyping, one example value, or no check.

### Required patch

Remove schema compatibility from Hook activation. The v1 rule is:

1. Activation proves only that the exact Hook type, Journal partition, and
   target Flow Binding exist.
2. When a selected concrete Event is committed, Jig atomically creates the one
   derived Run record and validates that exact Event value against the target's
   `input.schema.json`, using the normal Package/1 value-validation rule.
3. Validation failure makes that same derived Run terminal with
   `INVALID_INPUT` and a durable Hook diagnostic. It does not retry selection,
   transform the Event, or create another Run.
4. Tooling may recommend the canonical Event schema or test fixtures, but must
   not claim general containment proof.

An alternative exact-equality rule for one canonical Event input schema would
also be implementable, but it is less ergonomic and must be chosen explicitly
if preferred. The current hybrid is not conformable.

### Release test

Use target schemas which are equal, narrower, wider, absent, and contain
unsupported/expensive constructs. Two hosts must make the same activation and
per-Event decision without running a schema-subtyping algorithm. Redelivery of
an invalid Event must return the same failed derived Run.

## 3. Draining a Mount has two contradictory invocation-admission readings

### Block

Section 6 says both:

- existing pinned **invocations** and Mount work may continue during drain; and
- the old Mount remains available to pinned **consumers** until they drain.

Those are materially different. Under the first reading, an existing consumer
binding cannot start another call after drain begins. Under the second, it can
continue issuing calls until it releases its binding lease. Both are common
service-drain models, and independent hosts will implement both.

This ambiguity affects rolling updates: a long-lived Cordis consumer may need
several calls after the new Mount is published, while an immediate-invocation
drain would break it despite the “pinned consumer” promise.

### Required patch

Choose and state one admission rule. The least disruptive rule for the current
design is:

```text
active Mount
    new bindings and invocations allowed

draining Mount
    no new consumer binding leases
    existing live binding leases may start new invocations
    admitted invocations and bounded Mount work may complete

drain deadline or final lease release
    close invocation admission
    cancel remaining invocations/work
    cancel the pending mount request
```

Removing an export through `service/status` remains immediate withdrawal for
that generation and therefore overrides graceful Mount drain for affected
bindings. A provider that wants graceful replacement keeps the old export
available on the old Mount.

Define exactly what releases a consumer binding lease and ensure a crashed
consumer releases it through fencing. Record the drain deadline in the local
activation; it is policy, not provider-selected protocol data.

### Release test

Bind a long-lived consumer to Mount A, publish Mount B, begin draining A, then
invoke A again through the existing binding while a new consumer attempts to
bind. The existing call must be admitted and the new binding must select B.
Release the old lease and require A to stop. Repeat at the deadline and on
consumer crash; no post-close invocation may reach provider code.

## 4. Grant Profile claims are absent from the conformance boundary

### Block

Section 11 correctly makes Grant Profiles immutable, separately conforming
security claims with exact escape suites. Package/1 can require them. Section
15 nevertheless publishes no Grant Profile/Sandbox Backend conformance label
or release gate. “FLOW compatible” is rejected as too vague for Run and
Service, but the more security-sensitive enforcement claim remains unnamed.

An independent host therefore has no standard way to advertise that it can
enforce the exact network/tool profile a package requests, and users cannot
distinguish “profile understood” from “escape suite passed.”

### Required patch

Add a separately gated claim such as:

```text
FLOW Grant Profile/<id>/<version>/<root-digest> Enforcer
    platform + Sandbox Backend revision
```

The conformance record must bind the exact immutable profile bundle, platform,
backend/runtime preparation path, escape-suite revision and results, and any
mediated gateway identity. It must not imply support for another profile or
platform.

Add a release gate requiring the reference backend and one independent backend
or independently reviewed implementation path to pass the exact profile's
direct and transitive escape fixtures. A Run host without the claim remains
conforming and rejects the requested profile before preparation/launch.

### Release test

Advertise the same Grant Profile through two backends, one of which allows a
descendant/helper bypass. Only the passing backend may emit the conformance
claim. Change any normative profile artifact without changing its friendly
version and require a new root identity; reuse of the old claim must fail.

## Re-freeze condition

After these four patches, the corrected architecture passes this ecosystem
audit. In particular, no further release-boundary correction is required for:

- canonical Package identity and direct-edit/update provenance;
- immutable Runtime bundle identity;
- Run/Contract/Service conformance layering and Service optionality;
- exact public contract matching and equivocation handling;
- the explicit Cordis/DSH callback/UI nonclaims;
- powerless semantic ranking and staged repair; or
- inert, explicitly approved Starter initialization.

All existing conformance gates still have to pass before a `1.0` label. This
audit does not convert architecture prose into a protocol specification.
