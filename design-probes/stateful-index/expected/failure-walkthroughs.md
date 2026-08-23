# Expected failure walkthroughs

These are nonnormative design assertions.

## Crash boundaries around `upsert`

| Crash point | Durable provider state | Journal state | Required result |
|---|---|---|---|
| Before state replacement | Old state | No Event | Invocation fails or is lost; no mutation is inferred. |
| After state replacement, before append dispatch | New document plus pending entry | No Event | Invocation is uncertain/lost; a later Mount may publish the pending fact. |
| After append dispatch, before result is proven | New document plus pending entry | Unknown | Invocation and child effect are `UNCERTAIN`; never append again under a guessed result. |
| After append commit, before provider receives result | New document plus pending entry | Event committed | Same live-owner operation may recover the recorded result; after owner loss, replay is visibly at least once. |
| After result, before outbox cleanup | New document plus pending entry | Event committed | Recovery repeats the same provable operation when possible, then removes the entry. |
| After outbox cleanup, before invoke response | New document, no pending entry | Event committed | Provider execution happened; lost response makes the invocation uncertain, not rolled back. |

Jig does not inspect or repair provider state. The pending outbox is application
data. A new provider generation cannot inherit the old operation ledger
identity, so exactly-once Event publication is not claimed across replacement.

## Duplicate mutation input

- Same document ID, revision, and text returns the existing record and drains
  a matching pending Event if one remains.
- Same ID and revision with different text returns `revision-conflict`.
- A revision other than current plus one returns `stale-revision`.
- A new root attempt always uses a new Run submission key; Jig never silently
  retries an uncertain old invocation.

## Provider loss

Provider EOF loses the `index` export generation immediately. New consumer
resolution cannot use it. Already admitted invocations become terminal or
`PROVIDER_LOST`/`UNCERTAIN` according to their dispatch evidence. Restarting the
same package creates a new provider identity and does not heal old consumers.

## Cancellation

- Cancelling search terminates only search-owned work when the provider
  cooperates.
- Cancelling upsert after its state write cannot assert rollback and may leave
  a pending outbox entry.
- If one invocation cannot quiesce within its fixed grace period, Jig fences
  the shared provider generation and records collateral outcomes honestly.
- Cancelling the Mount closes every export and background recovery operation.

## Contract failures

- Different contract URI or version is incompatible.
- Same URI/version with different descriptor bytes is incompatible after
  canonical digest comparison.
- A consumer which carries only the method it happens to call does not match
  this provider's complete v1 contract.
- Semantic similarity never repairs any mismatch.

## Hook boundaries

An old-generation Event selected before replacement retains the old Hook
revision and target generation even if dispatch happens later. An Event from
the old source cannot enter a new Hook interval whose selector pins only the
replacement producer. At-least-once cross-generation publication may create a
new Event and therefore a new audit Run; application checks converge by
document revision.
