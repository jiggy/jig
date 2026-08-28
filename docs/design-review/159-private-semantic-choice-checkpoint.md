# Private closed Semantic Choice checkpoint

**Status:** closed on 2026-08-28 in commit `8337350` for the pure canonical
value boundary. This is not a provider, resolver integration, durable decision,
project option, or public Decision Engine.

## 1. Exact operation

`choosePrivateSemanticCandidate` reparses the canonical Semantic Choice 1.0.0
descriptor and recompiles its `choose` input and output schemas. It snapshots
one ordinary JSON/1 request exactly once, validates it, preserves candidate
order, and rejects duplicate IDs by exact string equality before invoking one
synchronous injected deterministic chooser.

The returned value is independently snapshotted and validated. A selected ID
must occur in the frozen request; an unknown ID fails. `abstain` is returned
unchanged and does not imply fallback, clarification, ambiguity, or repair.
Descriptions and rationale remain data with no authority.

The extracted ordinary-JSON snapshot helper rejects proxies, accessors,
symbols, exotic objects, sparse arrays, cycles, and JSON/1 violations, then
returns detached deeply frozen values. Agent Run uses the same helper and its
focused regression corpus remains green.

## 2. Portable bound

Semantic Choice/1 deliberately admits between 2 and 256 candidates per
`choose` request. This is a portable operation bound, not a catalogue or
admitted-universe cap. A caller must never truncate, sample, retrieve, or batch
an exact survivor set to fit it. More than 256 survivors makes this chooser
inapplicable and must produce an explicit deterministic failure or ambiguity
under the future caller policy.

## 3. Evidence

The focused corpus passes 10 Semantic Choice tests and 9 Agent projection
regression tests. It proves:

- exact contract identity and schema reparse despite a forged schema map;
- request/result detachment, deep freezing, and accessor/proxy rejection;
- JSON/1 boundary error mapping;
- exact candidate order, opaque IDs, duplicate rejection, and the 2..256
  request bound;
- allowlist confinement and malformed-result rejection;
- exact abstention; and
- refusal of asynchronous callbacks in this deliberately pure checkpoint.

The Jig TypeScript build passes. Both new modules remain internal and absent
from package exports.

## 4. Deliberate stop

This checkpoint adds no project authoring field, lock member, database table,
effect dispatcher, Agent, Service, Sley dependency, or public export. The
current root child-Flow lifecycle owns one exact child operation and cannot
also represent a possibly-dispatched durable semantic decision. A future
resolver integration must first freeze complete candidate and rejection
evidence, persist decision dispatch/result/uncertainty separately, and reuse a
committed choice without reranking.

Agent-backed choice remains blocked by the operator-owned provider boundary in
review 158. Changing admitted candidate-universe authoring remains a separate
deterministic design question in review 101.

