# Run Checkpoint

*Status: prerelease Jig native invocation contract.*

Retain completed work without treating interruption as success. A Flow invocation
saves a complete, bounded aggregate of evidence and deliverable bytes. Jig's
protected attempt owner commits those bytes before acknowledging them.
Later failure cannot turn unfinished scratch files into accepted progress.

## Declare and call

Copy the [descriptor](https://jig.md/contracts/run-checkpoint/contract.json)
into the Flow package and declare its local slot in `FLOW.meta.json`
(or optional Markdown frontmatter):

```json
{"uses":{"progress":{"contract":"./contracts/run-checkpoint/contract.json"}}}
```

The operator reviews this exact package and its selected routes before execution.
Checkpointing requires no writable attachment or output destination to save evidence, text, or already-held artifact views.
`--out` chooses a packet destination independently of retained checkpoint ownership.
The Flow selects neither a host path nor another Run.

```ts
const receipt = await run.call({
  operationId: 'progress:1',
  slot: 'progress',
  input: {
    sequence: 1,
    evidence: { completed: ['review'], pending: ['repair'] },
    files: { 'review.txt': reviewText },
    artifacts: { candidate: candidate.reference },
  },
})
```

Omit `artifacts` for an ordinary text/evidence save. The call returns
`{outcome:'done', output:{sequence, digest}}` after the protected owner holds an
immutable copy. The contract ID is `https://jig.md/contracts/run-checkpoint`,
version `0.1.0`, with canonical descriptor digest
`sha256:5e9304b91930242a6c09d3ea96376dfa64950abb39a083ec26eb39cff799b0b2`.
It uses ordinary Run/0 `flow/call`. FLOW does not require this Jig policy.

## Compose inside a Flow

A reviewed child `run.call()` target can declare and use Run Checkpoint unchanged.
Each invocation has its own sequence and latest aggregate under the original root attempt.
Repeated calls and siblings do not replace each other's accepted work.
Child failure does not erase an accepted checkpoint or make it a successful child result.

After the child settles, its immediate caller can use [Child Checkpoint](child-checkpoint.md) to read the latest accepted data.
That successful native call supplies a new held artifact for the complete saved tree.
The caller can inspect it, pass it through reviewed attachment routes, or save its own accepted aggregate.
The caller's checkpoint remains independent of the child's checkpoint.

A router Flow chooses whether the saved work is useful and whether another reviewed target should continue it.
Jig does not interpret application verdicts, choose replacement methods, or replay an uncertain operation.
Root cancellation still closes the complete execution tree and prevents further child work.

Applications can also use [`@jigging/jig/client`](execution-client.md) outside contained Flows.
Persist the original prepared ticket before submission and use it for later retrieval or export.
Those operations preserve the original execution status without restarting the method.

## Bounds and identity

- Sequence starts at 1 for each invocation and advances by one, up to 16 accepted saves.
  One root attempt retains at most 64 invocation scopes, including the root scope.
- Each complete input is at most 2 MiB of canonical JSON/0. Its `files` map
  contains at most 64 UTF-8 files totaling 1 MiB. Relative paths follow Jig's
  file-delivery path rules. Traversal and file/directory collisions are invalid.
- Jig retains the latest aggregate, not a history. Replacing it is bounded
  and atomic: rejection leaves the previous accepted aggregate unchanged.
- Optional `artifacts` maps at most eight lower-case LocalNames (1–64 characters)
  to opaque public `Artifact.reference` strings. Only this explicit Jig native
  control contract interprets those identities. The host resolves them against
  the saving invocation's held rights, rejecting guessed, released, and
  foreign references. No filesystem, launch, or onward delegation right is added.

  Associated trees appear beneath `artifacts/<LocalName>/`. Text files cannot use
  that namespace when associations are present. The aggregate has at most 64 files
  and 16 MiB, within the attempt's shared retained `artifactBytes` allowance.
  Retained final artifacts, checkpoint bytes, and their outstanding export loans
  share that allowance. It is not an additional checkpoint pool.
- One checkpoint operation may be in flight per invocation. It has separate control capacity from the two
  active worker branches, so occupied worker slots do not prevent saving.
  Application code serializes its own aggregate updates.
- Jig adds the actual Run ID, authenticated invocation ancestry, admitted method/configuration identity, JSON
  input digest, and captured attachment identities. The receipt digest is
  SHA-256 of the canonical retained identity, input, associations, and complete
  byte manifest (excluding the digest field itself).

The host validates bounds and identity, not arbitrary claims in `evidence`.
The application must associate a verdict with the exact candidate it checked.
A new candidate cannot inherit an earlier candidate's acceptance.

Ordinary operation-identity join/conflict rules apply. A cancelled request or
lost reply may have been accepted already. Inspect the accepted checkpoint after settlement.
Uncertain acknowledgement does not authorize automatic replay.

## Delivery and interruption

The single output packet includes `checkpoint`: the root scope's retained record with its digest and identity.
The field is `null` when this native invocation was bound but no save was accepted.
Child checkpoints never silently replace this root field or its fallback files.
On normal success, `files/` contains the accepted final
native output and selected forwarded artifacts. The checkpoint remains
separately identified in `result.json`.

If the root has no writable attachments and selects no final artifact results,
the packet uses the latest accepted checkpoint's files.
Without an accepted checkpoint, its file source is `none`.
An empty tree from a declared writable attachment remains a final output source.
These choices never change the successful execution terminal.

`delivery.source` names the exported file source: `final`, `checkpoint`, or
`none`. If the coordinator disappears after a successful terminal was committed
but before final files were delivered, known success is preserved.
In this case, `delivery.source: checkpoint` identifies the older saved bytes. They are not
represented as the missing final attachment.

On failed or lost execution, `files/` contains only the latest accepted
checkpoint's files. The execution remains failed or lost. Before publishing,
Jig must confirm fencing and cleanup of the complete owned execution tree.

After coordinator loss, the independent owner performs bounded recovery of
that exact Run under a new coordinator. It cannot submit or replay work.
Recovery has a 30-second ceiling, followed by the existing 20-second delivery
budget. Unconfirmed recovery or cleanup delivers no checkpoint files and
reports failure.

Publication remains atomic and no-replace. A destination collision preserves
the existing destination and reports delivery failure. Cancellation does not
revoke previously accepted progress or retract an already published packet.
The packet identifies what was retained even if its save acknowledgement was
lost. A lost publication acknowledgement may leave a complete packet at the
destination. Inspect it before starting another Run.

The protected record shares the original attempt's 48-hour retirement and quota
policy. The outer file-delivery owner remains publication and cleanup owner. It
reads the protected accepted checkpoint rather than maintaining an independent
latest truth. A lost save acknowledgement or original client/command does not
erase an accepted record. Ticket result retrieval and explicit checkpoint export
read that original attempt without dispatching or replaying it. Missing or corrupt
bytes report checkpoint unavailability separately and never rewrite a known
execution terminal.

Application ticket results include a bounded `checkpoints` inventory of retained scopes, sequences, and digests.
The separate `checkpointInventory` status is `available`, `expired`, or `unavailable`.
It describes metadata discovery, not retained file availability.

An unavailable inventory leaves `checkpoints` empty without discarding a known execution result or selected checkpoint detail.
An empty unavailable inventory does not prove that no save was accepted.

The optional `checkpointScope` selects checkpoint detail. Omission selects `root`.
Explicit checkpoint export accepts the same selector only with `source: 'checkpoint'`.
The export receipt identifies the selected scope.

All child records share the original attempt's lifetime, quota, cancellation, and cleanup requirements.
Parent success does not erase them, and reading or exporting them does not extend retention.

Native fencing and cleanup remain required before fallback
publication. Retention does not promise hardware-failure durability, arbitrary
scratch salvage, continuation, automatic retry, correctness, or permission to
apply a patch.
