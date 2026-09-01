# FLOW Capability Contract/1

**Status:** prerelease specification candidate. The checked-in
[`capability-contract-1.schema.json`](machine/capability-contract-1.schema.json)
machine schema uses the provisional identifier
`https://flow.jig.md/schemas/capability-contract-1.schema.json`; it has not been
published at that URI. Independent digest/Schema/1 fixtures and
consumer/provider conformance remain release gates.

Most Flows need no formal contract. Generic `flow/call` already means “perform
this bounded piece of work and return one outcome.” A Capability Contract is
for a stable machine interface which must be called repeatedly or precisely.

The division is:

```text
flow/call       open-ended work, selected by intent, no contract required
effect/call     a bound capability; local opaque or exact public contract
```

Complexity alone never requires a contract. A one-method contract is valid
when it is a stable reusable seam, such as the session-store example below,
rather than an ordinary child Flow disguised as an API.

## 1. Descriptor

One self-contained JSON descriptor is the only public interface format. The
sole normative session-store example is the parseable
[`session-store.capability.json`](examples/capability-contracts/session-store.capability.json),
whose Capability Contract/1 digest is
`sha256:95717125236427f83f401e2f942bb4df46e95867ac34828d719cc9795e5b3e98`.
This document does not duplicate the same public URI/version descriptor in a
Markdown block.

The descriptor is the authority for method names, wire value shapes, and named
errors. A contract's normative companion specification and conformance tests
may additionally define state machines, cross-field rules, ordering, and
atomicity which JSON Schema cannot express. They use the same owner-controlled
ID and exact version; changing those semantics requires a new version. The
descriptor digest prevents wire-shape equivocation, not behavioral fraud, so
publisher provenance and conformance evidence remain separate.

The descriptor defines only:

```text
owner-controlled absolute identity URI
exact SemVer interface version
closed named methods
input and output Schema/1 values
closed named application errors and their Schema/1 data
local definitions
```

`true` may replace any method/error schema, meaning any bounded FLOW JSON/1
value. This is the progressive starting point for an interface whose method
vocabulary is known before every value shape is. Replacing `true` with a
strict schema is an interface change and therefore needs a new exact version
and digest.

There is no loose/strict mode, second IDL, OpenRPC layer, external `$ref`,
inheritance, ranges, subtyping, callback, endpoint, provider, graph, GUI, or
selection declaration.

The root is a JSON object with exactly these members:

```text
$schema                  required exact URI
flowCapabilityContract   required integer 1
id                       required Contract ID
version                  required Contract Version
methods                  required non-empty method map
$defs                    optional local schema-definition map
```

`$schema` is exactly
`https://flow.jig.md/schemas/capability-contract-1.schema.json`. `methods` has
1–256 `LocalName` keys, where `LocalName` is a 1–64 character lower-ASCII slug
matching `[a-z0-9]+(?:-[a-z0-9]+)*`. Each method object has exactly `input`, `output`, and
`errors`; the first two are Schema/1 schemas and `errors` is a 0–128 member map
from `LocalName` to Schema/1 error-data schema. `$defs`, when present, has at
most 1,024 keys matching `[A-Za-z][A-Za-z0-9]{0,63}`, each containing one
Schema/1 schema. Definitions are referenced only as `#/$defs/<name>`.

The UTF-8 descriptor is at most 262,144 bytes and the complete embedded schema
graph must satisfy Schema/1's depth, node, reference, and keyword limits.
Unknown fields reject at every descriptor and method level.

### 1.1 Contract identity and version syntax

`id` is one canonical owner-controlled HTTPS URI. V1 admits only lower-ASCII
URIs of this form:

```text
https://<dns-name>/<segment>[/<segment>...]
```

The DNS name has at least two dot-separated labels. Each label matches
`[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?`. Each non-empty path segment matches
`[a-z0-9._~-]+`. User information, ports, IP literals, empty segments, `.` or
`..` segments, percent encoding, query strings, and fragments are forbidden.
Internationalized names use their lower-ASCII DNS form before publication.

Contract IDs compare as exact strings. Hosts perform no case folding, URI
normalization, redirect, DNS lookup, or network dereference when matching
them. The restricted spelling deliberately turns equivalent-looking URI
spellings into one obvious representation while retaining decentralized
owner namespaces.

`version` is the stable SemVer core form:

```text
(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)
```

It has exactly three decimal components, no leading zeroes except the single
digit `0`, no `v` prefix, and no prerelease or build suffix. Versions compare
as exact strings in Capability Contract/1; v1 defines no range or precedence
matching.

Keep prose, examples, and conformance fixtures beside the descriptor rather
than inside it. Capability Contract/1 is closed: an unknown descriptor or
method field is invalid. Only Schema/1's explicitly admitted annotations may
appear inside embedded schemas, and they remain part of the exact descriptor
identity.

## 2. Values and errors

Embedded schemas use the same closed, bounded Schema/1 dialect as
`*.schema.json`, without repeating the file-root `$schema`. Only local
`#/$defs/...` references are allowed.

Method success and named application failure are tagged values:

```json
{ "value": { "sessionId": "s-1" } }
```

```json
{ "error": { "name": "not-found", "data": { "sessionId": "s-1" } } }
```

JSON-RPC errors remain reserved for protocol, validation, authority,
cancellation, capacity, and provider-loss failures.

## 3. Exact identity and digest

Public compatibility in v1 is exact:

```text
contract URI + exact SemVer + exact descriptor digest
```

The descriptor never contains its own digest. The digest string is
`sha256:<64-lowercase-hex>` and is calculated over the complete parsed
descriptor:

```text
SHA-256(
  UTF8("FLOW-Capability-Contract/1\0")
  || RFC8785(full descriptor)
)
```

The domain separator prevents another SHA-256-bearing object from being
substituted. A package, lock, source, prepared-tree, runtime, or internal CAS
digest cannot satisfy the contract digest.

Any descriptor change—including `$schema` or Schema/1 annotations—changes
the digest. This avoids a second normative “semantic projection” algorithm and
makes equivocation detection exact. Documentation which should not change
interface identity belongs outside the descriptor.

Two descriptors claiming the same URI/version but deriving different digests
are incompatible. A publisher, trusted index, or source revision claiming both
is reported as equivocation in that authority domain. The mere presence of an
untrusted conflicting package does not globally quarantine an otherwise exact
trusted match; that would make namespace squatting a denial-of-service tool.
The digest proves descriptor identity, not publisher authority, provider
behavior, quality, or semantic substitutability. Provenance and trust are
recorded separately.

V1 has no compatible version ranges. Versions 1 and 3 do not satisfy a request
for version 2. A provider may expose several exact descriptors; an adapter
which consumes one exact version and provides another is an ordinary explicit
provider.

## 4. Package declarations and loading

A portable consumer carries the complete descriptor it expects inside its own
package and references those bytes from `FLOW.md`:

```yaml
uses:
  sessions:
    contract: ./contracts/session-store.capability.json
```

The local name `sessions` is a consumer slot, not a global identity. The path
uses the Package/1 author-reference grammar: exact `./` prefix followed by
canonical logical path segments. The prefix is stripped once without any
other normalization, decoding, or case folding. The reference is confined to
the same immutable staged package and resolves by exact case to one regular
JSON file. Jig validates it before code loads and derives the contract URI,
exact version, and canonical descriptor digest. Authors never copy a hash,
URI, or version into the reference. A project-local nonportable effect may use
an explicit `local: true` declaration instead; missing a descriptor never
means “weak public contract.”

Carrying the descriptor is intentional progressive disclosure. Most Flows
carry none. A Flow which depends on a strict capability seam pays for one small,
self-contained, offline-inspectable interface. Internal content-addressed
storage may deduplicate identical copies; v1 does not add a contract package
manager, ambient contract catalogue, or network fetch to save those bytes.

Capability Contract/1 does not define provider declaration, discovery,
registration, lifecycle, or locking. Before dispatch, a host which binds the
slot must independently establish a trusted provider and match the provider's
exact contract URI, version, and descriptor digest. The identity URI is never
an instruction to fetch from the network.

## 5. Required conformance cases

1. An ordinary child Flow runs without a contract.
2. A local opaque effect has no portability claim and cannot masquerade as a
   public contract.
3. `true` schemas accept bounded JSON/1 while unknown methods/errors still
   reject.
4. Strict schemas validate inputs, successes, and named error data.
5. Changing any descriptor value under one URI/version makes the descriptors
   incompatible and reports equivocation only for a source or authority which
   claims both.
6. Versions 1 and 3 do not satisfy exact version 2.
7. Independent TypeScript and Python implementations compute the same
   domain-separated full-descriptor digest.
8. Another SHA-256-bearing object cannot substitute for the contract digest.
9. A consumer resolves its exact descriptor offline without dereferencing the
   identity URI; a trusted provider claim matches the same exact triple.
10. An untrusted conflicting claimant cannot globally quarantine an exact
    trusted consumer/provider match.
11. Descriptor validation occurs before provider execution.
