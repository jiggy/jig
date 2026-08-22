# Minimalist refreeze audit

## Verdict: BLOCK

All six blockers from `61-minimalist-freeze.md` were corrected. The corrected
text now has one request owner, separates caller intent from later resolution,
declares dynamic dependencies, hashes package bytes portably, removes ambient
environment, removes per-slot semantic policy, and keeps telemetry deferred.

The adversarial reread found three remaining contradictions and two v1 features
without a required scenario. None requires a new general abstraction. Apply
the cuts below, then **PASS and freeze**.

## 1. BLOCK — a Service package has no configured-use object

The architecture defines a Flow Binding as the only configured-use
abstraction and exposes only `flows` in `defineJig`. A Service Mount nevertheless
requires the same exact package revision, settings, dependency slots,
attachments, grants, and fallback/runtime decisions. No public record supplies
them or tells Jig which imported Service packages are desired Mounts.

`modules: [services]` enables a host facility; it cannot infer a project's
configured session store or Cordis realm. This fails the named Cordis scenario
before `service/mount`: the host has a portable Service package but no inert
desired-state object from which to construct the mount request.

Adding a separate `ServiceBinding` would duplicate every field and violate the
one-configured-use decision.

### Minimal patch

Rename the public **Flow Binding** to **Binding** and make it the configured use
of any exact FLOW Package:

```text
Binding
    exact package revision
    complete settings
    slot bindings/discovery policy
    attachments
    grants
    instruction/runtime policy
```

The package determines which operation is legal:

- `flow/call`, a root Run, and a Hook target require a Run-capable Binding;
- Service activation and provider resolution require a Service-capable
  Binding;
- a Binding cannot be reinterpreted from one capability to the other.

Use one inert project map:

```ts
export default defineJig({
  bindings: { strictReview, sessions },
  hooks: [onInboxItem],
  modules: [events, services, agents, semanticRouter],
});
```

Do not add parallel `flows` and `services` configuration trees. Hooks and
Starters may present friendly views, but normalized desired state has one
Binding record.

## 2. BLOCK — Journal replay behavior has no descriptor authority

Service Contract/1 deliberately contains only method names, JSON shapes, and
named errors. Its digest covers that canonical descriptor; tests and prose are
explicitly only evidence. Section 9.2 then says the Journal contract's exact
URI/version/digest commits idempotent recovery behavior and recovery fixtures,
and uses that claim to authorize redispatch after `UNCERTAIN`.

Those statements conflict. Two providers can implement the identical
`append` input/output descriptor while one deduplicates by `callKey` and the
other appends twice. Contract/1 cannot authorize the exceptional replay rule
without regaining the behavioral-profile machinery the ballots removed.

The contradiction also leaked `callKey` and `requestDigest` into every provider
dispatch solely to support an externally mounted canonical Journal. No other
v1 method has a named use for those provider-visible fields.

### Minimal patch

In v1, the canonical Journal which drives Jig Hooks is host-native and shares
the kernel operation/outbox transaction. A conforming non-Jig host implements
the same canonical facility natively. A FLOW package still calls its exact
Journal slot through `effect/call`; this does not make the implementation a
mountable third-party provider.

Consequently:

- remove `callKey` and `requestDigest` from the universal Service/provider wire
  envelope; they remain internal operation-ledger values;
- remove mounted-Journal recovery lookup and exceptional redispatch;
- state that the official Journal method descriptor defines values while the
  Events/Hooks specification defines Jig/host behavior;
- require the host-native append and outer effect result to commit in the one
  kernel transaction;
- external stores may mirror Events but cannot acknowledge canonical append or
  drive Hooks in v1;
- change the conformance gate from “host-native and separately mounted
  Journals” to two independent hosts' native canonical Journals.

This preserves the required crash-safe Hook scenario and removes a behavioral
capability profile hidden inside Contract/1. A portable external Journal may be
standardized later only with an independently named behavioral conformance
surface.

## 3. BLOCK — Hook preflight requires rejected schema inference

Section 9.3 says activation verifies that a target Flow's concrete input schema
“validates” the Journal contract's complete Event value while also saying Jig
does not infer schema subtyping. At activation there is no Event value to
validate. Determining that every future Event accepted by the Hook selector is
accepted by an arbitrary target schema is precisely schema implication.

Two hosts can therefore diverge: one rejects a perfectly usable broad object
schema, while another incorrectly accepts a narrower schema which later rejects
an Event.

### Minimal patch

At activation, verify only that the target Binding exists and is Run-capable.
For each selected committed Event, create or recover the unique derived Run and
apply ordinary Run input validation to that actual, unaltered Event. If it
fails, the same derived Run record becomes `BLOCKED`/`INVALID_INPUT`; redelivery
does not create another Run.

Do not add Hook mappings, schema-subtyping machinery, or an Event transformation
language to recover early validation.

## 4. CUT — Grant Profiles are an unneeded sixth v1 standard

The layer model and conformance claims name Package, Runtime, Run, Service, and
Service Contract. Section 11 adds a separately conforming Grant Profile bundle
with its own identity, schema, normative semantics, evidence grammar, escape
suite, provider claim, and root digest. It is absent from the release labels
and no named v1 scenario requires granting raw network or subprocess authority
to untrusted component code.

The named security scenarios require the opposite: direct undeclared I/O must
fail, and an unenforceable sandbox must fail closed. Agent, Git, database, and
network work already cross mediated effect slots. Runtime dependency
preparation has its own separately authorized host phase.

### Minimal patch

Remove `permissions.profiles` and the Grant Profile standard from portable v1.
The v1 package permission vocabulary remains named attachment read/write; raw
network and child-process access are denied for untrusted components.
Project-local exact-digest trust may run with wider authority, but it is
reported as nonportable and not sandboxed. Portable packages use mediated
effects.

Move Grant Profiles to the evidence-gated deferral list. Promote one only after
two Sandbox Backends pass the same authority and escape suite for a real
package which cannot use an effect provider. Do not add a sixth conformance
label merely to preserve the current example.

## 5. CUT — Hook replay and named Journal partitions have no v1 scenario

The inert Hook decision requires only:

```text
one committed event type -> one exact Run-capable Binding
```

The corrected text additionally defines named Journal partitions, Hook
partition binding, replay IDs, replay ranges, and alternate uniqueness keys.
The Hook authoring surface contains no partition selector, and none of the
required scenarios needs multiple canonical Journals or Hook replay.

This is not harmless prose. With two partitions, the same event type and
position can exist twice, but the inert Hook has no field specifying which
stream it observes. Hosts may select differently. Replay IDs add a second path
for creating derived Runs after the ballot deliberately reduced Hook to one
mapping and one uniqueness key.

### Minimal patch

V1 has one canonical ordered Journal per Jig project. Its position is monotonic
within that project. Hook activation intervals use that one position space.
Remove partition selection and the explicit replay paragraph.

An operator who intentionally wants another Run may start the target Binding
with an archived Event through the ordinary Run interface. That is a new Run,
not Hook redelivery or a second Hook identity rule.

## Prior freeze audit verification

| Prior issue | Result |
|---|---|
| Waiting operation hashed an unknown Binding | PASS: caller digest and one-time resolution are separate. |
| Dynamic Service dependency undeclarable | PASS: `binding: dynamic`, static default. |
| Platform-relative executable mode in package digest | PASS: all source mode bits ignored. |
| Binding intent/per-slot semantic engine duplicated call intent | PASS: `discover` carries policy only. |
| Ambient environment permission had no value source | PASS: removed; fixed Runtime entries only. |
| Event/1 and shipped telemetry survived deferral | PASS: Journal owns Event value; Telemetry/1 remains deferred. |
| Outbound-call field overstatement | PASS. |
| Status revision contradiction | PASS. |
| Dynamic dependency operation not pinned | PASS. |
| Unspecified Run feature bag | PASS. |

## Refreeze decision after patches

After these five patches: **PASS**.

The surviving public model is then closed:

```text
Package
    source and declared needs

Binding
    one configured Run or Mount use

live inbound request
    wire ownership

operation record
    caller intent, one resolution, uncertainty

effect slot
    all host-mediated work

host-native Journal + inert Hook
    durable fact and one derived Run

Service Contract
    JSON methods, values, and errors
```

Do not compensate for these cuts with a second Binding type, a Hook expression
language, a generic behavior profile, or a portable raw-authority shorthand.
Those would restore exactly the duplicated concepts this audit removes.
