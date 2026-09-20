# FLOW Invocation Contract/1

> *Status: prerelease specification candidate. The structural companion is
> [`invocation-contract-1.schema.json`](https://flow.jig.md/schemas/invocation-contract-1.schema.json).*

An invocation contract describes the input, complete result and caller ports of
one finite call. A Flow may use the same interface whether its host selects an
ordinary Flow or a trusted native implementation. Interface equality does not
establish implementation trust, execution authority or a shared lifetime.

Most Flows need no named agreement. Optional root `FLOW.contract.json` is the sole
invocation declaration owner:

| Need | Declaration |
| --- | --- |
| Unconstrained finite work | No descriptor: bounded JSON/1 input, implicit `done` and bounded JSON/1 output, no declared ports or custom outcomes. |
| Local validation, ports or custom outcomes | An anonymous `FLOW.contract.json` containing the needed declarations. |
| Independently agreed interface | The same descriptor with an exact `id` and `version`. |

Package metadata declares dependencies and readable purpose; it does not repeat
invocation declarations. `settings.schema.json` separately validates complete
immutable implementation settings. Two implementations of the same interface
may need different settings and grants. Neither is inherited through a match.

## 1. Descriptor

The descriptor is an object whose required `$schema` is exactly
`https://flow.jig.md/schemas/invocation-contract-1.schema.json`. Unknown fields,
root booleans or null, and missing or wrong discriminators reject. Original
UTF-8 bytes must pass JSON/1, including duplicate-member checks, before parsing
loses that evidence.

Shared root fields are:

| Field | Rule |
| --- | --- |
| `$schema` | Required exact discriminator. |
| `id`, `version` | Both absent for an anonymous contract, or both present with the exact syntax below. Never fetched. |
| `$defs` | Optional shared Schema/1 definitions, at most 1,024 entries. |

The **single form** has these shared fields and the fields of one operation.
A root containing only the discriminator is a valid anonymous contract. This
is the only initially executable form; it accepts no operation selector.

The **named form** has the shared fields and a nonempty `operations` map of
at most 256 `LocalName` keys to operation objects. It cannot contain any root
operation fields. Structural validators recognize this form, but the initial
execution profile must report it unsupported during qualification, before
dispatch. There is no default operation, implicit first key, synthetic `run`
alias, or mixed default-plus-named form. A named key `run` is an ordinary name.
No named-call SDK field or handler overload belongs to the initial profile.

An identified single-form descriptor may additionally contain a root `features`
map. Each key is a `LocalName` and each value is a nonempty description of
1–16,384 Unicode scalars. The map has at most 256 entries. It names optional
implementation behaviors whose exact obligations belong to the contract's
behavioral specification; descriptions are text, not executable predicates or
schemas. `features` requires both `id` and `version`, including when empty.
Anonymous descriptors, named-form roots and named operation objects cannot
contain it. There are no operation-specific feature declarations.

An omitted or empty catalog defines no feature names; both forms are valid but
have distinct identities. Null, non-object catalogs, invalid names, duplicate
members and nontext descriptions reject. The existing descriptor byte and
JSON/1 limits apply; catalog descriptions do not add Schema/1 graph nodes.

One operation object has only:

| Field | Rule |
| --- | --- |
| `input` | Optional embedded Schema/1. Absence accepts any bounded JSON/1 input. |
| `result` | Optional embedded Schema/1 for the complete `{outcome, output}` result. Absence retains the base envelope and outcome checks. |
| `outcomes` | Optional map of custom `LocalName` outcomes to nonempty descriptions. |
| `channels` | Optional directional [Channel Contract/1 declarations](channel-contracts.md#1-declarations). |
| `attachments` | Optional map of required caller-port `LocalName`s to exactly `read` or `read-write`. |

`done` is implicit. Custom outcome descriptions contain 1–16,384 Unicode
scalars; `done`, `failed`, `cancelled` and `error` cannot be declared custom
outcomes. Vocabulary is explicit: a result schema does not declare outcomes,
and a declared outcome does not override the result schema. Operational
failure cannot be disguised as a domain outcome.

Outcomes, channels and attachments each have at most 256 entries per operation.
Omitted and empty maps both declare no members but have distinct identities;
null maps reject. Channel defaults remain `required: true`, receive
`start: beginning`, and either supported delivery when omitted.

An attachment mode is both the requested access and the maximum exposed to the
callee. Supply that mode or reject before effects. A read port remains read-only
even over a writable source. Unknown mappings, implicit extra ports, host paths
in the descriptor and automatic grant inheritance are forbidden. Private backing
resources remain reviewed implementation dependencies; they are not undeclared
caller requirements. The initial `flow/call` has no attachment-transfer field;
an attachment-bearing route needs an independently qualified host mapping.

Input/result schemas use the closed embedded [Schema/1](schema-files.md)
dialect, without a file-root `$schema`. Their references resolve solely against
the descriptor's `$defs`. Inline channel schemas are reference-free: `$ref` and
`$defs` in schema-keyword positions reject. Literal message property names and
inert annotation/example data with those spellings remain ordinary data.
Reusable channel schemas use a separate complete Channel Contract, with its
own definition namespace.

Omission and explicit `true` accept the same base-valid values but identify
different descriptors. `false` is valid and accepts no value. No defaults,
satisfiability inference, output-by-outcome shorthand, overloads, inheritance,
subtyping, runtime selection, credentials, providers or stateful flags exist.

### 1.1 Contract identity and version syntax

`id` is one canonical owner-controlled lower-ASCII HTTPS URI:

```text
https://<dns-name>/<segment>[/<segment>...]
```

The DNS name has at least two dot-separated labels. Each label matches
`[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?`; each nonempty path segment matches
`[a-z0-9._~-]+`. User information, ports, IP literals, empty segments, `.` or
`..` segments, percent encoding, query strings and fragments are forbidden.
Internationalized names use their lower-ASCII DNS form before publication.

`version` has exactly three decimal components:

```text
(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)
```

No leading zeroes except the digit `0`, `v` prefix, prerelease or build suffix
are allowed. All grammars match complete strings. IDs and versions compare
exactly; there is no normalization, redirect, DNS lookup, network dereference,
range matching or version precedence calculation.

## 2. Offline channel closure and exact digest

An invocation descriptor may reference complete Channel Contract/1 files.
Resolve every reference relative to the invocation descriptor's containing
directory in the immutable package, including optional ports and unselected
named operations. Input or settings never supply the reference base.

References begin with exact `./` and use Package/1 canonical downward-only
paths without C0 controls or DEL. No `..`, decoding, normalization, special file or package escape is
allowed. Strip the one `./` prefix to obtain the descriptor-relative logical
path. Deduplicate repeated paths; two different paths with equal content remain
separate entries. Every target is a complete valid Channel Contract, whose
Schema/1 references are internal, so this is not a recursive file graph.

For example, moving `FLOW.contract.json` and its referenced `contracts/events.json`
together beneath `interfaces/reviewer/` preserves interface identity. Runtime
channel creation still accepts the package-relative path
`./interfaces/reviewer/contracts/events.json`; there is no fragment selector,
extraction, alias manifest or lookup API.

The sole canonical preimage is:

```text
UTF8("FLOW-Invocation-Contract/1\0") || RFC8785({
  descriptor: complete parsed invocation descriptor,
  channelContracts: {
    descriptorRelativePath: complete parsed channel descriptor,
    ...
  }
})
```

`\0` denotes one NUL byte. `channelContracts` is present even when empty.
The public digest is SHA-256 of that preimage, rendered as `sha256:` followed
by 64 lowercase hexadecimal digits. There is no bare-descriptor digest.

Identity includes the entire descriptor and channel closure: annotations,
the complete feature catalog, optional ports, unselected operations, internal
paths and referenced content.
Containing-directory location, source line endings and unrelated package files
do not enter the invocation digest. Package/1 separately covers exact
implementation bytes. A package, runtime, source or host-storage digest cannot
substitute for this domain-separated interface digest.

Validate each original invocation and channel document at at most 262,144 UTF-8
bytes. The complete derived wrapper also satisfies JSON/1. At most 64 distinct
descriptor-relative channel paths may occur, and the entire domain-separated
canonical preimage is at most 1,048,576 bytes, including its NUL, wrapper/path
keys and all content. Path byte and Unicode constraints apply independently of
the structural meta-schema.

One invocation Schema/1 graph shares 4,096 schema nodes and depth 64 across all
input/result/inline-channel schemas and definitions, including unused
definitions and unselected operations. Each referenced Channel Contract has its
own independently bounded graph and namespace. All references must resolve and
be acyclic. The 1,000,000-work-unit budget applies to each actual value
validation, not the Run lifetime or every operation's schema. Cache keys and
diagnostic pointers retain the owning descriptor; equal local pointers from
different documents never alias.

## 3. Matching, dependencies and execution

Named compatibility is exact `id`, `version` and resolved digest. Anonymous
contracts validate a particular package's invocation; they cannot satisfy a
named dependency. An interface's companion behavioral specification and
conformance checks may add observable requirements beyond JSON Schema. Descriptor
equality proves declared requirements, not behavioral honesty or publisher trust.

Different digests under one ID/version are incompatible. A source or trusted
authority claiming both has equivocated in that authority domain. An unrelated
untrusted claimant cannot quarantine an independently trusted exact match.
Every offered named operation must implement its declared behavior; a partial
implementation cannot claim the whole interface. A feature catalog names only
optional implementation behaviors. Every implementation must fulfill the
baseline interface and each feature it claims. Omitting a feature never waives
required ports, input/result validation, outcomes, finite ownership or other
mandatory obligations, and cannot select a subset of named operations. The
contract's behavioral specification defines how an unsupported optional request
is refused; feature metadata cannot invent a weaker baseline.

Consumers name slots through [Package/1 metadata](package-format.md):

```yaml
uses:
  reviewer:
    contract: ./interfaces/reviewer/contract.json
    requires: [conversation]
  archive: {}
```

Here the referenced reviewer contract must define `conversation` in its feature
catalog. `requires` is optional; ordinary callers omit it. A package offering
that exact named single-form contract may declare `supports: [conversation]`
in its own metadata. [Package/1](package-format.md#dependencies) owns the bounded
list grammar. Support and requirement names must belong to their own offered
or expected catalog before route matching. Unknown names reject, even if both
parties repeat the same unknown spelling or no selected caller uses the claim.

After exact interface matching, every required feature must occur in the
selected implementation's declared support. Missing support remains undeclared,
not universal; it and an explicit empty support set fail nonempty requirements.
No requirements means no optional feature check. There are no implied features,
alternatives, negation, numeric predicates or support inheritance. Missing
required support prevents the consuming target's qualification before its code
or instructions run, and unavailable dependencies propagate through the selected
graph without silently changing a selected implementation.

`supports` is an implementation's unconditional mechanism claim across all
settings accepted by its own settings contract. An accepted setting that removes
the claimed mechanism makes the declaration nonconforming. A conditionally
implemented feature must remain unclaimed, use narrower accepted settings, or
belong to a separately authored implementation. Static matching validates
declarations, not their behavioral honesty. Independently selected resources,
granted limits, client negotiation and runtime failure remain separate facts;
an honest refusal or unavailable result permitted by the behavior does not itself
contradict mechanism support. Hosts cannot infer an arbitrary wrapper's support
from its dependencies, settings values, package name or source code.

The contract reference is package-relative. The consumer carries the complete
descriptor and its channel closure offline; authors do not copy IDs, versions
or digests into metadata. `{}` declares an uncontracted local slot without an
interchangeability claim. Omission of a contract never discovers or selects a
provider. There is one slot namespace and no second local-effect marker.

Hosts select exact Flow or native implementations under their existing authority.
A named expectation plus an explicit Flow mapping describes a typed Flow
dependency. That mapping must match the offered interface and qualified resources;
an unsupported explicit selection cannot fall back to another implementation.
Any native default must be an already supported, independently qualified host
route. FLOW defines no provider registry or native discovery framework.

Qualification, caller context, execution, grants, dispatch, provenance and
cleanup must use the same selected admitted implementation and configuration.
A descriptor digest cannot select privileged control capacity or prove native
evidence. Native credentials, retention owners and process collectors need not
become ordinary Flow processes. A same-shaped Flow result is not host evidence.

Before effects, check actual required ports, selected-route support, input and
authority. Optional channel support can depend on that selected route: omission
may qualify, while supplying an unsupported endpoint must reject before transfer
or dispatch. Review exposes requirements and actual limitations without secrets
or private host paths. Interface equality grants no operation, filesystem access
or inherited authority.

Feature qualification establishes declared compatibility, not operational
readiness or future success. Required support cannot grant a larger allowance,
establish current authority, or guarantee retained state. Actual request and
result validation and all authority and settlement checks remain necessary.
Adding or editing a catalog changes the existing invocation digest; all matching
participants must carry the same updated descriptor and closure. Changing
implementation support or dependency requirements changes package meaning but
does not create another invocation digest or a compatibility alias.

## 4. Calls, outcomes and finite ownership

The initial call is [Run/1 `flow/call`](run-protocol.md#4-flowcall), projected as
`run.call(...)` in both SDKs. Required operation identity, slot and input plus
optional advisory intent and channels produce one complete normal
`{outcome, output}` result. There is no method selector, successful-value wrapper,
declared-error exception or automatic outcome conversion.

Domain refusal is an explicitly declared normal outcome. For example, a
session-store lookup returns `done` with the record or `not-found` with its
declared data. Operational failures retain Run/1 JSON-RPC errors and ordinary
language recovery. Root cancellation, fatal transport, uncertain ownership,
live abandonment and failed cleanup still prevent success.

Operation identity belongs to the authenticated invoking participant. Exact
duplicates join the same established selection and do not transfer moved rights
again; altered input, slot, intent or endpoint-map presence conflicts. The exact
comparison and cancellation races remain [Run/1](run-protocol.md#6-operation-identity).

Each ordinary call creates a fresh finite invocation. Package/Binding names,
future operation names, string session IDs and channel tokens do not create a
shared instance. Continuing services require separately defined caller,
ordering, shutdown and uncertainty semantics; this contract adds no session
manager, daemon lifetime, scheduler or generic storage authority.

## 5. Required conformance

Conforming implementations must establish:

1. Plain and anonymous calls need no named contract; only exact named matches
   satisfy named dependencies.
2. Single/named forms are disjoint, and the initial profile rejects named
   execution before effects. Unsupported selectors reject at their call boundary.
3. Explicit outcomes, complete results, false schemas and absent declarations
   retain their exact meanings; no defaults or wrapper conversions occur.
4. Duplicate JSON members, bounds, dangling/cyclic references and inline channel
   references reject, including in unused definitions and operations.
5. TypeScript and Python derive equal domain-separated closure digests; complete
   relocation preserves identity, while changed referenced content or paths does not.
6. Every referenced channel, optional port and operation enters identity, with
   exact deduplication, graph namespaces and aggregate preimage limits.
7. Wrong ports, grants, explicit selections or named matches fail before effects;
   native evidence and authority cannot be manufactured by interface equality.
8. Caller-scoped duplicates, changed optional-key presence, cancellation, late
   disposal, forgotten live work and uncertainty preserve Run/1 ownership.
9. Feature catalogs occur only on identified single-form roots, obey name,
   description and entry bounds, and reject unknown structure. Omission, empty
   catalogs, names and descriptions retain their exact identity consequences.
10. Support and requirements use their exact contract's closed catalog; unknown
    names and missing required support reject before caller execution. Ordinary
    callers need no feature declarations, and matching grants no authority or
    verified behavior across implementation settings.

The [session-store descriptor](https://github.com/jiggy/jig/blob/main/docs/flow/spec/examples/invocation-contracts/session-store.contract.json)
illustrates one named single operation with a normal `not-found` outcome.
