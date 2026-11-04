# Run Checkpoint

*Status: prerelease Jig native invocation contract.*

Retain completed work without treating interruption as success. A root Flow
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

The operator reviews this exact package and invokes it as a root Run.
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

## Compose from an application

This profile is root-only. A child `run.call()` route cannot select a target that declares Run Checkpoint.
Review reports `PROJECT_CHILD_ROOT_ONLY` and identifies the unsupported dependency.
This restriction applies even when the child never calls its checkpoint slot.

An application can wrap the unchanged method through [`@jigging/jig/client`](execution-client.md#wrap-a-checkpoint-enabled-method).
The client runs in the application process, outside contained Flows.
The method remains a root target with its own accepted checkpoint, sequence, and artifact associations.
Another Flow does not inherit that checkpoint authority.

1. Move the wrapper's control logic into the application process.
   Remove the former child call, parent slot declaration, and route from the reviewed project.
   Review the method's Flow or Binding as a root target.
2. Persist the complete `Prepared` value before submission, using separate prepare/submit calls or `client.run(request, { persist })`.
3. After interruption, read `result` using the original ticket.
4. After confirmed cleanup, export an available checkpoint with `source: 'checkpoint'` to a new destination.

The [complete application call](execution-client.md#a-complete-application-call) and [checkpoint export example](execution-client.md#export-an-accepted-checkpoint) show these operations.
Retrieval and export preserve the original execution status without restarting the method.
They do not resume program execution or authorize automatic retry.

## Bounds and identity

- Sequence starts at 1 and advances by one, up to 16 accepted saves.
- Each complete input is at most 2 MiB of canonical JSON/0. Its `files` map
  contains at most 64 UTF-8 files totaling 1 MiB. Relative paths follow Jig's
  file-delivery path rules. Traversal and file/directory collisions are invalid.
- Jig retains the latest aggregate, not a history. Replacing it is bounded
  and atomic: rejection leaves the previous accepted aggregate unchanged.
- Optional `artifacts` maps at most eight lower-case LocalNames (1–64 characters)
  to opaque public `Artifact.reference` strings. Only this explicit Jig native
  control contract interprets those identities. The host resolves them against
  the current root participant's held rights, rejecting guessed, released, and
  foreign references. No filesystem, launch, or onward delegation right is added.

  Associated trees appear beneath `artifacts/<LocalName>/`. Text files cannot use
  that namespace when associations are present. The aggregate has at most 64 files
  and 16 MiB, within the attempt's shared retained `artifactBytes` allowance.
  Retained final artifacts, checkpoint bytes, and their outstanding export loans
  share that allowance. It is not an additional checkpoint pool.
- One save may be in flight. It has separate control capacity from the two
  active worker branches, so occupied worker slots do not prevent saving.
  Application code serializes its own aggregate updates.
- Jig adds the actual Run ID, admitted method/configuration identity, JSON
  input digest, and captured attachment identities. The receipt digest is
  SHA-256 of the canonical retained identity, input, associations, and complete
  byte manifest (excluding the digest field itself).

The host validates bounds and identity, not arbitrary claims in `evidence`.
The application must associate a verdict with the exact candidate it checked.
A new candidate cannot inherit an earlier candidate's acceptance.

Ordinary operation-identity join/conflict rules apply. A cancelled request or
lost reply may have been accepted already. Inspect the final checkpoint.
Uncertain acknowledgement does not authorize automatic replay.

## Delivery and interruption

The single output packet includes `checkpoint`: the retained record
with its digest and identity, or `null` when this native invocation was bound but no
save was accepted. On normal success, `files/` contains the accepted final
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

Native fencing and cleanup remain required before fallback
publication. Retention does not promise hardware-failure durability, arbitrary
scratch salvage, continuation, automatic retry, correctness, or permission to
apply a patch.
