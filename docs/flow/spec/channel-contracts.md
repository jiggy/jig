# FLOW Channel Contract/1

> *Status: prerelease specification candidate for direct JSON channels.*

A named channel contract lets independently authored participants agree on
message meaning, not merely shape. Two `{text: string}` messages might mean
append a fragment or replace a snapshot. Equal schemas do not establish equal
protocols. Generic channels need no named contract.

## 1. Declarations

`FLOW.md` and Capability Contract/1 method objects may declare a `channels`
map. Each key is a `LocalName`; each value is a closed object:

| Field | Meaning |
| --- | --- |
| `direction` | Required `send` or `receive` |
| `required` | Boolean, default `true`; optional unwired ports are absent |
| `schema` | Optional inline Schema/1 item schema; omission means generic JSON/1 |
| `contract` | Optional package-local `./` descriptor reference, exclusive with `schema` |
| `delivery` | Optional `direct`; omission accepts the supported delivery profile |
| `start` | Receive-only `beginning` or `suffix`, default `beginning` |

Direct receivers start at sequence one. `suffix` does not enable subscriptions
or replay. Declarations describe requirements, not grants. A required port must
be connected before invocation; this does not guarantee its peer will succeed.
Channel names are local slots, not globally discoverable addresses.

References obey Package/1's canonical package-local reference rules. Hosts
resolve them within the exact calling/receiving package; no URI is fetched.

## 2. Descriptor and identity

A self-contained UTF-8 JSON/1 descriptor has exactly these fields:

| Field | Meaning |
| --- | --- |
| `$schema` | `https://flow.jig.md/schemas/channel-contract-1.schema.json` |
| `id` | Canonical [Capability Contract/1 identity URI](capability-contracts.md#11-contract-identity-and-version-syntax) |
| `version` | Exact three-component SemVer core, using the same syntax |
| `semantics` | Normative nonempty description, at most 16,384 UTF-8 bytes |
| `item` | One Schema/1 schema; `true` accepts any JSON/1 value |
| `$defs` | Optional local definitions under Schema/1's restrictions |

The complete descriptor is at most 262,144 UTF-8 bytes. Embedded schemas retain
Schema/1 graph, keyword and reference limits. Unknown fields reject. Machine
schema validation does not replace byte bounds or the schema-graph checks.
Examples and executable behavioral checks can live beside the descriptor.

Derive the digest over the complete descriptor, including `semantics`:

```text
sha256(UTF8("FLOW-Channel-Contract/1\0") || RFC8785(descriptor))
```

The result is `sha256:` plus 64 lowercase hexadecimal digits. Authors supply
the package-local reference, never a handwritten digest. Exact compatibility
compares `id`, `version` and digest. Descriptor identity is an agreement, not
proof that an implementation obeys it.

## 3. Matching and interpretation

A source becomes named only at creation. A later writer, reader or message
cannot silently rename it. For a named source, a transferred writer's port must
declare that exact contract. Named readers require the same exact source identity.
An unnamed source cannot satisfy a named reader even when schemas match.

Named sources may supply generic or schema-only readers. Two nontrivial item
schemas must have equal canonical content; omitted/`true` is generic. Hosts
do not infer subtyping or execute semantic prose as a validator. Direct late
binding validates the queued prefix before adding a reader constraint, and
later values satisfy the combined constraints. Invalid mapping rejects before
any right moves or new participant dispatches.

Forwarding an unused receive endpoint preserves its actual source identity.
Reading values and copying them into a new generic source does not. A converter
or named relay owns its own output meaning and validation.

Hosts enforce identity, item shapes, granted rights, delivery and start
position. Applications enforce correlation, ordering across messages, deltas
versus snapshots and domain completeness. Sequence one identifies this source's
origin, not complete upstream history. A clean channel end cannot establish a
successful Agent result, accepted application outcome or durable processing.

The exchange and lifecycle rules are in [Run/1](run-protocol.md#51-direct-channels).
This contract does not grant network access, session mutation or arbitrary
transports. Binary payloads and broadcast require separately specified support.
