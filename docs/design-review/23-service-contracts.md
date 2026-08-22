# Service contract court: one exact portable boundary

## Verdict

The canonical portable Service/1 contract should be a small FLOW-owned JSON
descriptor whose value schemas are JSON Schema 2020-12.

It should not be OpenRPC, TypeSpec, Smithy, or a media-type-neutral interface.
Those formats can be authoring inputs or generated views, but the binding lock
must identify one canonical `service.contract.json` artifact.

The reason is specific, not aesthetic. Service/1 needs to describe:

```text
method input and output values
contract-defined errors
provider events and their delivery class
nominal resource and service handles
reverse callback interfaces
scope-owned cleanup
an executable conformance suite
```

OpenRPC describes ordinary JSON-RPC method surfaces well, but it has no
first-class direction, subscription, callback-handle, resource-lifetime, or
conformance model. If FLOW adopted it, every property that determines whether
two Service components can actually interoperate would live under `x-flow-*`.
Generic OpenRPC tooling would then understand the least important part and
silently ignore the most important part.

TypeSpec and Smithy can model more, but making either compiler ecosystem the
portable artifact would make a small host compile a source language merely to
learn whether two JSON-valued services are compatible. A media-type-neutral
descriptor would add codecs and negotiation to a boundary that is deliberately
JSON-valued.

The normative split is:

```text
FLOW.md
    declares consumer slots and provider descriptor paths

service.contract.json
    exact portable API and boundary semantics

JSON Schema 2020-12
    value validation

Service/1
    invocation, subscription, handle, and lifecycle behavior

conformance Flow
    behavioral verification without inventing a test DSL
```

Ordinary Flow calls remain contract-free. Local opaque services remain legal
inside one project or runtime, but they make no portable compatibility claim.

---

## 1. What the contract is—and is not

A Service contract answers one question:

> Can a consumer compiled against this interface call this provider through
> Service/1 with machine-checkable values and lifecycle expectations?

It does not answer:

```text
Which provider is best?
Where should the provider be downloaded from?
How is the provider implemented?
Which graph, plugin system, database, or UI framework is inside it?
Should the user trust its code?
```

Those belong respectively to selection, package provenance, the provider,
runner internals, and project policy.

### 1.1 When a contract is required

A public portable Service requires a contract when it crosses a FLOW boundary.
Examples include:

- a session store called repeatedly by several components;
- a command registry;
- a mounted Agent-session provider;
- a UI contribution service;
- a database-like service;
- a long-lived event source.

A Flow does not need a contract merely because it is complicated. This remains
valid and contract-free:

```text
Call a Flow that reviews this artifact.
```

It is a finite unit of work with the generic Run result and may be selected by
intent.

This needs a Service contract:

```text
Bind a reviewer exposing review, amend, status, and changed events for the
complete lifetime of this consumer.
```

The rule survives:

> Flows compose by intent. Public Services compose by contract.

### 1.2 Local opaque services

Cordis plugins inside one Cordis realm can continue exchanging arbitrary
objects, closures, classes, symbols, and Context-bound services. Jig-local code
can also use a project-owned service through an explicit local binding.

Such a service is **opaque**:

- it is not advertised as a portable provider;
- it cannot satisfy a public contract requirement by semantic resemblance;
- Jig cannot generate a portable client or adapter from it;
- it is not eligible for public catalogue compatibility claims;
- its use is recorded as local and nonportable.

A Cordis realm may contain fifty opaque services and export one contracted
serializable service. Only that one boundary belongs to Service/1.

There is no `any` or `opaque` public contract whose meaning is “trust me.” An
explicit project-local binding is the escape hatch; it does not weaken the
portable rule.

---

## 2. Candidate court

The candidates are judged against six requirements:

1. A small host can validate the artifact without a language compiler.
2. Methods, errors, events, and handles have portable semantics.
3. The descriptor matches Service/1 rather than an unrelated transport.
4. Exact bytes can be pinned and independently reproduced.
5. Client/server generation remains possible.
6. Ordinary Flow authors pay none of the cost.

### 2.1 OpenRPC

#### Strongest case

OpenRPC is an established, language-neutral JSON description of JSON-RPC APIs.
Its Method Object already has names, parameter descriptors, a result,
application errors, examples, links, and extension fields. It uses JSON Schema
for values and can drive documentation and code generation. Service/1 uses
JSON-RPC, so the superficial fit is excellent.

Adopting it would avoid appearing to invent another RPC description format.

#### Failure under the actual boundary

OpenRPC's model is a collection of methods on one JSON-RPC endpoint. Service/1
instead invokes named operations through a pinned provider binding. Several
differences are material:

- OpenRPC method parameters model JSON-RPC positional or by-name arguments;
  Service/1 has one canonical JSON `input` value.
- OpenRPC application errors allocate integer codes and leave `data` as an
  arbitrary value; FLOW needs stable contract error names with schemas while
  reserving transport errors for Service/1.
- A method without a result can be described as a notification, but OpenRPC
  does not say whether it travels provider-to-consumer or
  consumer-to-provider.
- It does not define named event subscriptions, durable facts versus lossy
  signals, subscription ownership, or redelivery.
- It does not define nominal callback/service handles or provider-owned
  resource handles.
- It does not define Scope cleanup or which side owns a returned handle.
- Examples are not a behavioral conformance suite.
- `servers`, discovery, links, and endpoint variables are irrelevant because
  Jig supplies an opaque binding rather than a URL.

FLOW could add all of those as OpenRPC specification extensions. That would
produce an OpenRPC-shaped document whose compatibility-critical semantics are
not OpenRPC. A tool that ignores unknown extensions could generate a client
that appears valid but leaks registrations or cannot receive callbacks.

#### Ruling

Do not make OpenRPC canonical. Provide a deterministic projection from a FLOW
Service contract to OpenRPC for the subset consisting of ordinary methods.
OpenRPC documentation and client tools remain useful, but their output is not
binding evidence.

This conclusion is based on OpenRPC 1.4.x's actual Method, Content Descriptor,
Error, notification, and `x-` extension model—not on a general objection to
reuse.

### 2.2 A thin JSON-Schema wrapper

#### Strongest case against it

A new descriptor means a new meta-schema, documentation, compatibility policy,
validator suite, generators, and long-term governance burden. Poorly scoped,
it would become another underpowered IDL and repeat OpenRPC badly.

#### Why it wins

The required wrapper is not a general IDL. It has only these semantic objects:

```text
identity
version
methods
errors
events
handle types
conformance
schemas
```

All value typing remains standard JSON Schema 2020-12. The wrapper does only
what JSON Schema cannot do: name operations, attach direction/delivery
semantics, define nominal handles, and point to a conformance Flow.

A host can parse and validate it as JSON without executing project code or
installing an IDL compiler. The exact descriptor aligns with the exact
Service/1 wire model, so no projection ambiguity exists at binding time.

#### Ruling

Adopt this as the canonical artifact, but call it a **descriptor**, not a new
source IDL. Keep its meta-schema deliberately closed and versioned.

### 2.3 TypeSpec or Smithy as canonical source IDL

#### Strongest case

Both are much more mature modeling systems than a small FLOW descriptor.

TypeSpec supplies operations, rich types, version projections, libraries, and
emitters. Its events library can model event unions. Smithy supplies services,
operations, resources, errors, traits, model validation, and simplex or duplex
event streams. Both can generate clients and servers for multiple languages.

For a large contract owner, authoring a session or UI service in one of these
languages may be substantially better than hand-maintaining JSON Schema.

#### Failure as the portable artifact

The source language and its compiler/library versions become part of every
host's compatibility path. An independent host must either embed the toolchain
or trust precompiled output whose canonical semantics have not been selected.

TypeSpec requires FLOW-specific libraries and an emitter for Service/1 events,
handles, and errors. Compiler, library, and emitter versions can affect output.
Smithy is protocol-agnostic until a protocol trait supplies serialization and
its standard event-stream model describes transport streams rather than
Scope-owned Service subscriptions. It too would need FLOW-specific traits and
a protocol implementation.

Neither eliminates FLOW's semantic work. Both move it into a compiler plugin.

#### Ruling

Support TypeSpec and Smithy as optional authoring sources. Contract publishers
commit the emitted `service.contract.json`, and the emitted descriptor—not the
source model or compiler version—is the artifact a provider implements and a
consumer locks.

An official emitter is valuable after the descriptor is stable. It is not a
prerequisite for a small host.

### 2.4 A media-type-neutral descriptor

#### Strongest case

Future providers may want CBOR, Protocol Buffers, binary streams, images, or
custom domain payloads. A descriptor that names a media type and an associated
schema language appears more future-proof than JSON Schema.

#### Failure in v1

Service/1 values travel in a JSON-RPC boundary. Allowing each method to choose
its own payload media type would require:

```text
codec negotiation
schema-language negotiation
canonicalization per representation
cross-codec conformance tests
security review of decoders
adapter rules for semantically equivalent representations
```

That is not future-proofing; it is freezing complexity before evidence.

Binary and very large values should cross as granted attachment or resource
handles whose metadata can include a media type. The method input still
contains a JSON handle. If a later Services transport proves that native CBOR
or Protobuf values are necessary, it can define a separately conforming
descriptor profile and explicit adapter rules.

#### Ruling

Do not make the v1 descriptor media-type-neutral. One boundary value model is
a portability feature.

---

## 3. Normative Service Contract/1 artifact

### 3.1 File and media type

The recommended file name is:

```text
service.contract.json
```

Packages providing several contracts may use:

```text
contracts/sessions.service.json
contracts/commands.service.json
```

The canonical media type is:

```text
application/vnd.flow.service-contract+json;version=1
```

The root object has this shape:

```json
{
  "$schema": "https://flow.example/schemas/service-contract-1.json",
  "flowService": 1,
  "id": "https://example.org/contracts/session-store",
  "version": "1.2.0",
  "summary": "Long-lived access to session state and change signals.",
  "methods": {},
  "events": {},
  "handles": {},
  "conformance": {
    "flow": "./conformance",
    "digest": "sha256:..."
  },
  "$defs": {}
}
```

Required fields are:

```text
$schema
flowService
id
version
methods
```

`events`, `handles`, `conformance`, `$defs`, `summary`, and `description` are
optional. Unknown unnamespaced fields are errors. Vendor annotations use
`x-<owner>-<name>` and do not affect compatibility unless a future contract
version promotes them.

The descriptor is self-contained. In Contract/1, JSON Schema `$ref` values may
resolve only within the descriptor. This prevents a compatibility decision
from depending on mutable remote schema retrieval. A publisher can use a
source IDL with imports, but its emitted artifact must bundle the schema
closure.

### 3.2 A complete session example

```json
{
  "$schema": "https://flow.example/schemas/service-contract-1.json",
  "flowService": 1,
  "id": "https://example.org/contracts/session-store",
  "version": "1.2.0",
  "summary": "Read sessions and observe invalidation signals.",
  "methods": {
    "list": {
      "input": { "$ref": "#/$defs/ListInput" },
      "output": { "$ref": "#/$defs/ListOutput" },
      "errors": {
        "cursor_expired": {
          "data": { "$ref": "#/$defs/CursorExpired" }
        }
      }
    },
    "read": {
      "input": { "$ref": "#/$defs/ReadInput" },
      "output": { "$ref": "#/$defs/Session" },
      "errors": {
        "not_found": {
          "data": {
            "type": "object",
            "properties": {
              "sessionId": { "type": "string" }
            },
            "required": ["sessionId"],
            "additionalProperties": false
          }
        }
      }
    }
  },
  "events": {
    "changed": {
      "delivery": "signal",
      "data": {
        "type": "object",
        "properties": {
          "revision": { "type": "integer", "minimum": 0 },
          "sessionId": { "type": "string" }
        },
        "required": ["revision"],
        "additionalProperties": false
      }
    }
  },
  "conformance": {
    "flow": "./conformance",
    "digest": "sha256:9c..."
  },
  "$defs": {
    "ListInput": {
      "type": "object",
      "properties": {
        "cursor": { "type": "string" },
        "limit": { "type": "integer", "minimum": 1, "maximum": 1000 }
      },
      "additionalProperties": false
    },
    "ListOutput": {
      "type": "object",
      "properties": {
        "sessions": {
          "type": "array",
          "items": { "$ref": "#/$defs/Session" }
        },
        "nextCursor": { "type": "string" }
      },
      "required": ["sessions"],
      "additionalProperties": false
    },
    "ReadInput": {
      "type": "object",
      "properties": {
        "sessionId": { "type": "string" }
      },
      "required": ["sessionId"],
      "additionalProperties": false
    },
    "Session": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "revision": { "type": "integer", "minimum": 0 }
      },
      "required": ["id", "revision"],
      "additionalProperties": false
    },
    "CursorExpired": {
      "type": "object",
      "properties": {
        "restartFrom": { "type": "string" }
      },
      "required": ["restartFrom"],
      "additionalProperties": false
    }
  }
}
```

The `changed` event is deliberately a signal. Missing or coalescing it cannot
lose session state: a consumer calls `list` or `read`, compares revisions, and
resynchronizes. A contract that requires every event as a durable fact declares
`delivery: "fact"` instead.

### 3.3 Method rules

Each method has:

```json
{
  "input": {},
  "output": {},
  "errors": {}
}
```

`input` and `output` are JSON Schema 2020-12 schemas. They describe the single
JSON values carried by `service/invoke`; they do not restate JSON-RPC parameter
structure. A no-input method normally accepts an empty object. A no-value
result uses JSON `null` explicitly.

Method names are unique within the contract and are stable API identifiers.
The host rejects an undeclared method before provider dispatch. Input is
validated before dispatch; output and declared error data are validated before
delivery to the consumer.

`errors` is a map from stable string name to an error data schema. Human error
messages are diagnostic and non-normative. JSON-RPC framing errors,
`provider_lost`, cancellation, deadlines, invalid handles, and host policy
denials are Service/1 errors rather than contract-defined application errors.

`service/invoke` keeps those layers distinct. Its successful JSON-RPC result is
one of:

```json
{
  "ok": true,
  "output": {}
}
```

```json
{
  "ok": false,
  "error": {
    "name": "not_found",
    "message": "Session does not exist.",
    "data": {
      "sessionId": "S-9"
    }
  }
}
```

The JSON-RPC `error` member is reserved for Service/1 transport, lifecycle,
binding, validation, and policy failures. This avoids allocating global integer
codes for every contract and lets SDKs expose a typed application-error union.

A provider must not manufacture a new application error name. A caller must
still handle generic Service/1 failure, because no contract can prevent a
process crash or policy cancellation.

### 3.4 Events and subscriptions

Events are not disguised methods and not ambient global topics. A declared
event has a data schema and one explicit delivery class:

```text
signal
    Live invalidation/observation. May be coalesced, reordered, or dropped.
    A consumer cannot rely on it for correctness and must be able to resync.

fact
    Provider publication is acknowledged only after durable host acceptance.
    Delivery to a live subscription is at least once and carries an event ID.
    Duplicate handling is required.
```

Service/1 owns generic subscription mechanics rather than requiring every
contract to invent `subscribe`, `unsubscribe`, and callback methods:

```text
service/subscribe(binding, event names)
    returns a Scope-owned subscription handle

service/event
    provider -> host publication and host -> subscribed consumer delivery

service/unsubscribe(handle)
    optional early release; Scope closure always releases it
```

For a `fact`, provider-to-host publication is an acknowledged request with an
operation ID and lowers to the Run/1 durable fact semantics. Host-to-consumer
delivery is acknowledged and may repeat after failure. Hooks see the committed
fact only after acceptance.

For a `signal`, both publication and delivery are notifications. It never
triggers a durable Hook and cannot be used as a required transition.

Subscriptions select only event names declared by the pinned contract. The
host validates event data and namespaces it by contract identity, exact
version, provider instance, and event name. Provider replacement never
silently moves a live subscription to a new instance.

Contract/1 does not promise infinite retention or arbitrary replay across a
new Scope. A service needing historical change recovery exposes a cursor-based
method such as `changesSince` in addition to facts or signals.

### 3.5 Resource and callback handles

JSON can carry opaque handles without pretending that closures or in-process
objects are serializable. Contract/1 defines two nominal handle kinds:

```text
resource
    Issued by one provider instance, passed back only where the same contract
    declares it, and released when its owner Scope closes.

service
    An opaque binding to an already-published provider implementing another
    exact Service contract compatible with a declared range.
```

Handle types are declared once:

```json
{
  "handles": {
    "PanelRegistration": {
      "kind": "resource"
    },
    "PanelCallbacks": {
      "kind": "service",
      "contract": {
        "id": "https://example.org/contracts/panel-callbacks",
        "version": "^1"
      }
    }
  }
}
```

A schema position refers to the nominal type with the Contract/1 JSON Schema
annotation:

```json
{
  "type": "string",
  "x-flow-handle": "PanelRegistration"
}
```

`x-flow-handle` is a normative Contract/1 annotation, not a vendor extension.
The JSON representation is an opaque host-issued string. JSON Schema checks
the JSON type; the host checks token authenticity, kind, provider instance,
nominal type, contract compatibility, and live Scope. A copied or invented
string presented outside its granted Scope fails. Inside that Scope the token
is a bearer capability and must be redacted from logs and untrusted telemetry.

A callback is therefore not a function serialized into JSON. A long-lived
consumer publishes a callback Service with its own contract and passes a
`service` handle. The callee invokes it through the host. This gives callbacks
the same binding, version, cancellation, permission, and cleanup rules as every
other Service call.

Contract/1 does not add dynamic anonymous callback publication. In Services/1,
the callback handle refers to a provider already published by the consumer's
mounted component. If real UI integrations cannot work under that constraint,
a later scoped-publication extension must prove its lifecycle separately.

### 3.6 UI registration example

A UI contribution service can declare:

```json
{
  "methods": {
    "registerPanel": {
      "input": {
        "type": "object",
        "properties": {
          "panel": { "$ref": "#/$defs/PanelDescriptor" },
          "callbacks": {
            "type": "string",
            "x-flow-handle": "PanelCallbacks"
          }
        },
        "required": ["panel", "callbacks"],
        "additionalProperties": false
      },
      "output": {
        "type": "string",
        "x-flow-handle": "PanelRegistration"
      }
    },
    "unregisterPanel": {
      "input": {
        "type": "string",
        "x-flow-handle": "PanelRegistration"
      },
      "output": { "type": "null" }
    }
  },
  "handles": {
    "PanelRegistration": { "kind": "resource" },
    "PanelCallbacks": {
      "kind": "service",
      "contract": {
        "id": "https://example.org/contracts/panel-callbacks",
        "version": "^1"
      }
    }
  }
}
```

If `unregisterPanel` is never called, Scope closure releases the registration.
If the callback provider disappears, calls fail `provider_lost`; the UI service
does not silently bind a semantically similar provider.

The `PanelDescriptor` must be serializable. A raw React component, closure, DOM
node, or Cordis service object does not cross this boundary. Jig may define a
host-specific UI descriptor or trusted client-module convention separately.

---

## 4. Identity, versions, ranges, and digests

These four identities must remain separate:

```text
contract identity
    https://example.org/contracts/session-store

contract interface version
    1.2.0

contract descriptor digest
    sha256:...

provider package revision
    source locator + package digest
```

### 4.1 Owner-controlled identity

`id` is an absolute URI without a version embedded by FLOW convention. Public
contracts should use HTTPS under an origin controlled by the contract owner.
Git-hosted owners may use a stable HTTPS repository URI. Private contracts may
use an organization-controlled URI even when hosts resolve it only from local
indexes.

The URI is an identifier, not an instruction to fetch during execution. A
provider or catalogue supplies the descriptor artifact. Trust policy decides
whether the publisher is authorized to speak for that URI through origin
proof, signatures, configured trust roots, or index attestations.

Possessing a string that begins with another organization's domain is not
ownership proof.

### 4.2 Exact interface versions

The descriptor `version` is a complete SemVer 2.0.0 version. Contract versions
and package versions are independent.

For Contract/1, a consumer requirement supports only:

```text
X.Y.Z
    exact stable version

^X
    any stable version >= X.0.0 and < (X+1).0.0, where X >= 1
```

The compact grammar deliberately excludes wildcard unions, prerelease
selection, hyphen ranges, implicit latest, and arbitrary comparator algebra.
An exact prerelease may be used only under an explicit project-local policy;
it is not selected by `^X`.

If implementation evidence requires lower bounds within one major, `^X.Y.Z`
can be added later. V1 should not inherit an entire package manager's range
grammar merely to express the common compatibility claim.

Semantic version numbers are a promise by the contract owner, not a schema
equivalence proof. A major change is required when an existing conforming
consumer could no longer communicate correctly. Adding an optional method or
explicitly subscribed event can be minor; removing or changing existing
semantics is major. Automated schema diffing may warn but cannot authorize a
binding.

### 4.3 Exact descriptor digests

The descriptor digest is SHA-256 over the RFC 8785 JSON Canonicalization Scheme
representation of the self-contained descriptor. It is not written inside the
descriptor, which would be self-referential.

The textual form is `sha256:` followed by 64 lowercase hexadecimal digits.

The binding lock stores:

```json
{
  "contract": {
    "id": "https://example.org/contracts/session-store",
    "version": "1.2.0",
    "digest": "sha256:..."
  },
  "provider": {
    "package": "git+https://example.org/session-sqlite",
    "revision": "...",
    "digest": "sha256:..."
  }
}
```

Two different descriptor digests claiming the same contract `id` and exact
`version` are not alternatives for semantic routing. They are identity
equivocation or a corrupt index and must be quarantined pending an explicit
trust decision.

Whitespace or object-key order does not create a false mismatch because the
digest uses canonical JSON. Semantically altered content necessarily changes
the digest and, under SemVer, must be published as a new version.

### 4.4 Binding algorithm

For each consumer Service slot:

1. Match the contract `id` exactly.
2. Parse the provider's exact contract version.
3. Check the consumer's exact or `^X` range.
4. Verify the canonical descriptor digest and publisher authorization.
5. Verify platform, trust, grants, availability, and relevant conformance
   evidence.
6. Apply an explicit project binding when present.
7. Use semantic ranking only if several already-compatible providers remain.
8. Lock the provider revision and descriptor digest for the consumer Scope.

The SemanticRouter never decides contract equivalence, major-version
compatibility, digest conflicts, or trust.

---

## 5. Conformance without a test language

JSON Schema proves value shape. It does not prove that `read` returns the
requested session, a registration is released, events have the promised
meaning, or an adapter preserves behavior.

Contract/1 therefore makes conformance a first-class reference to an ordinary
Flow package:

```json
{
  "conformance": {
    "flow": "./conformance",
    "digest": "sha256:..."
  }
}
```

The conformance directory is a normal FLOW package containing any fixtures,
scripts, and executable needed by the contract owner. The host starts it with
the candidate provider forcibly bound to the reserved local slot `subject`.
The suite returns a machine-readable report through its ordinary Run output.

A suite used for a `contract-tested` claim must have an exact executable
implementation. A `FLOW.md`-only instructional suite may assist a human or
Agent review, but its result is advisory because interpretation is not a
repeatable conformance oracle.

This reuses:

```text
Run isolation
Service binding
attachments and fixtures
Agent-free exact execution
outcomes and journals
package content digests
```

It avoids inventing assertions, variables, interaction traces, and event
timing inside the contract JSON.

The descriptor remains valid without a conformance Flow, but the provider can
claim only:

```text
descriptor-valid
```

not:

```text
contract-tested
```

Public indexes and high-trust projects may require a pinned conformance suite
for stable contracts. A passing suite is evidence, not a mathematical proof.
The lock records:

```text
contract digest
suite package digest
provider package digest
test result digest
host/runtime versions
time and attesting identity
```

A provider's self-attestation and an independent attestation are distinct
policy inputs.

Schema-level generated tests should additionally verify:

- every method rejects invalid input before provider dispatch;
- successful outputs satisfy their declared schemas;
- declared error data satisfies its schema;
- undeclared methods, errors, and events are rejected;
- forged, expired, wrong-provider, and wrong-nominal-type handles fail;
- Scope closure releases resource and subscription handles;
- fact events deduplicate and signal events may be dropped without violating
  the suite.

---

## 6. FLOW.md declaration surface

Only packages that consume or provide Services need Service metadata.

```yaml
services:
  use:
    sessions:
      contract: https://example.org/contracts/session-store
      version: ^1

  provide:
    sessions: ./contracts/sessions.service.json
```

`sessions` is a package-local slot/provider name. It is not a global identity.

A consumer may describe why it uses the slot in Markdown for humans and
selection diagnostics, but natural language never changes compatibility. A
provider may advertise cost, quality, or implementation details in its package
description, but those never change the contract it implements.

A configured project instance may pin:

```ts
export default defineProject({
  services: {
    "task-board/sessions": bindService({
      consumer: "task-board#sessions",
      provider: "session-sqlite#sessions",
      config: {
        file: "./state/sessions.db",
      },
    }),
  },
});
```

The project configuration chooses one installed provider and supplies inert
configuration. It does not restate methods, schemas, or contract identity.
Those come from the consumer requirement, provider descriptor, and lock.

Ordinary child Flow slots retain their contract-free binding surface and must
not be placed under `services` merely to obtain stricter routing.

---

## 7. Required scenario judgments

### 7.1 `review@^2` with only providers 1 and 3

Suppose the consumer requires:

```yaml
contract: https://example.org/contracts/review
version: ^2
```

Installed providers advertise exact versions `1.8.0` and `3.1.0`.

The result is:

```text
capability.binding.missing
```

Both providers are reported as near misses. Neither enters semantic ranking.
Version 3 is not “better,” and a SemanticRouter cannot waive the major mismatch.

The deterministic recovery choices are:

1. install a 2.x provider;
2. explicitly upgrade and patch the consumer to contract 3;
3. install or generate an adapter that provides 2 and consumes 3;
4. leave the component pending;
5. ask the user.

A provider may advertise both exact v2 and v3 descriptors only if it really
implements both surfaces and can be tested against both suites. Package version
3 does not imply contract version 3, and contract version 3 does not prevent a
single package from also implementing 2.

### 7.2 Cordis session service with `changed` events

The Cordis realm retains its native session object and local event bus. The
FLOW adapter exports only the serializable `session-store` methods and
`changed` event declared above.

On mount:

1. The adapter publishes the exact contract ID, version, and digest.
2. A consumer subscribes to `changed` through Service/1.
3. The adapter converts the Cordis event to the declared JSON data.
4. Because this contract calls it a `signal`, forwarding may coalesce or drop.
5. The consumer sees a revision and rereads state through `read` or `list`.
6. Scope close disposes the subscription and Cordis listener.

If the contract instead declares `fact`, the adapter must durably publish and
await host acceptance. A synchronous local Cordis emitter that cannot meet
that requirement cannot honestly export the fact variant. The descriptor
makes that incompatibility visible rather than pretending all “events” are the
same.

Cordis services not explicitly exported remain opaque and require no contract.

### 7.3 UI registration with callbacks and a resource handle

The task-board component is itself mounted and publishes a contracted
`panel-callbacks` Service. It calls `registerPanel` with:

```text
serializable panel descriptor
opaque callback Service handle
```

The UI provider validates that the callback handle implements a compatible
callback contract. It returns a nominal `PanelRegistration` resource handle.

The UI provider can call back only through that handle's pinned provider.
Unregistering or closing the task-board Scope releases the registration.
Provider crashes produce explicit lost-handle/provider errors; there is no
silent replacement.

This supports a deep extension boundary without claiming that React
components, Cordis Contexts, or arbitrary closures are portable.

### 7.4 Generated v3-to-v2 compatibility adapter

An Agent may generate a package that:

```text
provides review contract 2.x exactly
uses review contract 3.x exactly
translates methods, outputs, errors, facts/signals, and handles
```

The adapter is a normal provider with its own source, digest, permissions,
configuration, and trust decision. The lock records the complete chain:

```text
consumer --review@2--> adapter --review@3--> provider
```

Generation does not establish compatibility. Before activation Jig:

1. validates both descriptors;
2. checks every v2 method has a translation;
3. checks declared output/error/event schemas where structural mapping is
   provable;
4. runs the v2 conformance Flow against the adapter;
5. runs adapter-specific edge cases for changed semantics and handles;
6. stages it under least authority;
7. requires the configured trust or approval policy;
8. publishes a new immutable provider revision.

If v3 removed information required to produce a valid v2 response, the adapter
must fail its build or return an allowed v2 error. It cannot fabricate semantic
equivalence from matching field names.

The SemanticRouter may discover a candidate adapter-generation Flow. It does
not insert the generated adapter invisibly inside an active call.

---

## 8. Explicit exclusions

Service Contract/1 does not include:

### Endpoint or transport descriptions

No URLs, ports, server variables, HTTP verbs, content negotiation, or
authentication schemes. Jig binds an opaque provider; Service/1 owns transport
semantics.

### Provider discovery or selection policy

No costs, scores, semantic intents, preferred implementations, fallbacks, or
registry locations in the contract. These are package/project data.

### Ordinary Flow schemas

No contract requirement for a finite Flow invocation. Optional Run input,
config, and output schemas are separate and do not turn a Flow into a Service.

### Graphs, Tasks, Agents, GUI, or Cordis concepts

Those may appear in contracts owned by their ecosystems, but Contract/1 has no
special ontology for them.

### Arbitrary code, expressions, or policy

No mappers, availability predicates, lifecycle scripts, YAML expressions, or
provider-selection rules. The descriptor is inert.

### Structural compatibility inference

The host does not decide that two different contract IDs or majors are
compatible because their JSON Schemas look similar. An explicit adapter or
owner-published compatible version is required.

### Universal streaming

V1 supports request/response methods and named service events. Byte streams,
duplex media streams, backpressure protocols, and arbitrarily negotiated
codecs require a later profile or a resource handle.

### Dynamic anonymous callbacks

Callbacks are handles to already-published contracted Services. Arbitrary
per-call closure export is not part of Services/1.

### Exactly-once delivery or transparent state restoration

Fact delivery is at least once. Provider loss is explicit. A restarted
provider is a new instance unless a service-specific recovery protocol says
otherwise.

### A central contract registry

Indexes may discover contract artifacts and attest owners, but the canonical
identity remains owner-controlled and the lock pins exact content.

---

## 9. Adoption and falsification

### Why this is not overstandardization

The descriptor is invisible to ordinary Flow authors. A developer encounters
it only when exporting a structured long-lived boundary—the point at which
method names, data shapes, errors, callbacks, and cleanup are already real API
obligations.

The portable parser needs JSON, a fixed meta-schema, JSON Schema 2020-12, and
SemVer comparison. It does not need Jig, Node.js, an IDL compiler, an OpenRPC
server, or a registry client.

### Why less specification fails

If FLOW standardizes only method names and JSON Schemas:

- `changed` can mean durable fact on one host and droppable notification on
  another;
- a callback handle has no nominal interface;
- a registration leaks because no owner is defined;
- a v3 provider is selected for a v2 consumer by optimistic similarity;
- passing examples are mistaken for behavioral conformance;
- local Cordis objects are advertised as portable despite being impossible to
  serialize.

### Why more specification fails

If Contract/1 adds resources, authentication, endpoints, codecs, graph
topology, package installation, rich version projections, or an assertion DSL,
it becomes a second application framework and excludes small hosts.

### Release gates

Do not freeze Contract/1 until all of these pass:

1. A plain TypeScript provider and a Cordis realm provider implement the same
   session contract and pass the same conformance Flow.
2. A Python consumer can invoke both from only the descriptor and Service/1
   SDK, without Jig-specific types.
3. `review@^2` rejects providers 1 and 3 deterministically on two independent
   hosts.
4. A UI registration is released after cancellation even when the consumer
   never calls `unregisterPanel`.
5. A forged resource token and a callback handle implementing the wrong
   contract fail before provider dispatch.
6. A fact event survives the provider-response crash window and may be
   delivered twice; a signal can be dropped without breaking its conformance
   suite.
7. A generated v3-to-v2 adapter fails when it cannot preserve one required v2
   behavior and passes only after the contract-owned suite agrees.
8. A contract authored in TypeSpec or Smithy emits byte-identical canonical
   JSON on two supported toolchains after RFC 8785 canonicalization.
9. An OpenRPC projection generates a usable ordinary-method client while
   clearly warning that FLOW handles and subscriptions require the Service/1
   SDK.
10. A Cordis realm retains an opaque local service that never appears in the
    FLOW provider catalogue.

### Falsifier

Reverse this recommendation if two independent implementations show that a
strict OpenRPC profile can represent events, subscriptions, nominal callback
and resource handles, Scope cleanup, and conformance without compatibility
semantics being hidden in ignored extensions.

Also reconsider the descriptor if its stable meta-schema grows beyond the
small boundary above or if independent hosts need a FLOW-specific compiler
rather than ordinary JSON Schema validation. That would mean the “thin
wrapper” has become the bespoke IDL this decision is intended to avoid.

---

## Final recommendation

Adopt **FLOW Service Contract/1** as a self-contained JSON descriptor with:

```text
owner-controlled URI identity
exact SemVer interface version
RFC 8785 canonical SHA-256 digest
JSON Schema 2020-12 method input/output/error data
explicit signal/fact event semantics
nominal Scope-owned resource and Service handles
optional digest-pinned conformance Flow
```

Use OpenRPC as a generated method-documentation view. Use TypeSpec and Smithy
as optional authoring sources. Reject media-type neutrality in v1. Keep local
opaque services local and ordinary Flow calls contract-free.

The core rule is:

> A contract formalizes only the serializable long-lived seam. It neither
> formalizes the work performed by a Flow nor the objects a runtime keeps on
> its own side of that seam.

## Primary standards consulted

- [OpenRPC Specification 1.4.x](https://spec.open-rpc.org/)
- [JSON Schema 2020-12](https://json-schema.org/specification)
- [JSON Schema Core and custom vocabularies](https://json-schema.org/draft/2020-12/json-schema-core)
- [TypeSpec operations](https://typespec.io/docs/language-basics/operations/)
- [TypeSpec events](https://typespec.io/docs/libraries/events/reference/decorators/)
- [TypeSpec versioning](https://typespec.io/docs/libraries/versioning/guide/)
- [Smithy 2.0 service types](https://smithy.io/2.0/spec/service-types.html)
- [Smithy 2.0 event streams](https://smithy.io/2.0/spec/streaming.html)
- [Semantic Versioning 2.0.0](https://semver.org/)
- [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/info/rfc8785/)
