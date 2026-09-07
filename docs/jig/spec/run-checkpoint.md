# Run Checkpoint

*Status: prerelease Jig capability contract.*

Retain completed work without treating interruption as success. A root Flow
saves a complete, bounded aggregate of evidence and deliverable bytes. Jig's
independent command owner accepts those bytes before acknowledging them.
Later failure cannot turn unfinished scratch files into accepted progress.

## Declare and call

Copy the [descriptor](https://jig.md/contracts/run-checkpoint.capability.json)
into the Flow package and declare its local slot:

```yaml
uses:
  progress:
    contract: ./contracts/run-checkpoint.capability.json
attachments:
  deliverables: read-write
```

The operator reviews this exact package and invokes it with `--out`. This
profile is root-only; an attachment-less or child invocation cannot acquire
the capability. The Flow selects neither a host path nor another Run.

```ts
const receipt = await run.callCapability({
  operationId: 'progress:1',
  slot: 'progress',
  method: 'save',
  input: {
    sequence: 1,
    evidence: { completed: ['review'], pending: ['repair'] },
    files: { 'review.txt': reviewText },
  },
})
```

`save` returns `{sequence, digest}` after the independent owner holds an
immutable copy. The contract ID is `https://jig.md/contracts/run-checkpoint`,
version `1.0.0`, with canonical descriptor digest
`sha256:e7961d96842dc07bf2932f2979b2145301e4071093435e0e4e842a057896c201`.
It uses ordinary Run/1 `capability/call`; FLOW does not require this Jig policy.

## Bounds and identity

- Sequence starts at 1 and advances by one, up to 16 accepted saves.
- Each complete input is at most 2 MiB of canonical JSON/1. Its `files` map
  contains at most 64 UTF-8 files totaling 1 MiB. Relative paths follow Jig's
  file-delivery path rules; traversal and file/directory collisions are invalid.
- Jig retains the latest aggregate, not a history. Replacing it is bounded
  and atomic: rejection leaves the previous accepted aggregate unchanged.
- One save may be in flight. It has separate control capacity from the two
  active worker branches, so occupied worker slots do not prevent saving.
  Application code serializes its own aggregate updates.
- Jig adds the actual Run ID, admitted method/configuration identity, JSON
  input digest, and captured attachment identities. The receipt digest is
  SHA-256 of canonical `{identity, sequence, evidence, files}` bytes.

The host validates bounds and identity, not arbitrary claims in `evidence`.
The application must associate a verdict with the exact candidate it checked.
A new candidate cannot inherit an earlier candidate's acceptance.

Ordinary operation-identity join/conflict rules apply. A cancelled request or
lost reply may have been accepted already. Inspect the final checkpoint;
uncertain acknowledgement does not authorize automatic replay.

## Delivery and interruption

The existing single output packet includes `checkpoint`: the retained record
with its digest and identity, or `null` when this capability was bound but no
save was accepted. On normal success, `files/` contains the final writable
attachment; the checkpoint remains separately identified in `result.json`.
`delivery.source` names the exported file source: `final`, `checkpoint`, or
`none`. If the coordinator disappears after a successful terminal was committed
but before final files were delivered, that known success is preserved while
`delivery.source: checkpoint` identifies the older saved bytes. They are not
represented as the missing final attachment.

On failed or lost execution, `files/` contains only the latest accepted
checkpoint's files. The execution remains failed or lost. Before publishing,
Jig must confirm fencing and cleanup of the complete owned execution tree.
After coordinator loss, the independent owner performs bounded recovery of
that exact Run under a new coordinator; it cannot submit or replay work.
Recovery has a 30-second ceiling, followed by the existing 20-second delivery
budget. Unconfirmed recovery or cleanup delivers no checkpoint files and
reports failure.

Publication remains atomic and no-replace. A destination collision preserves
the existing destination and reports delivery failure. Cancellation does not
revoke previously accepted progress or retract an already published packet.
The packet identifies what was retained even if its save acknowledgement was
lost. A lost publication acknowledgement may leave a complete packet at the
destination; inspect it before starting another Run.

These guarantees last while the independent command owner remains alive.
They do not cover its own death, machine crashes, arbitrary scratch salvage,
durable continuation, or automatic retry. Retention proves stored bytes, not
their correctness or permission to apply a patch.
