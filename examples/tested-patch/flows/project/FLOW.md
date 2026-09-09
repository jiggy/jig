---
name: tested-project-patch
description: Turn a small Bun project and an issue into a reviewable multi-file patch with independent acceptance evidence.
attachments:
  source: read
  deliverables: read-write
uses:
  progress:
    contract: ./contracts/run-checkpoint.capability.json
channels:
  progress:
    direction: send
    required: false
    delivery: direct
    schema:
      type: string
      maxLength: 256
outcomes:
  blocked: The defect was not reproduced or no acceptable patch was produced.
  limit: The Agent stopped at its limit.
---

Supply `issue` and `editPaths`, with a read-only source attachment containing
at most 16 UTF-8 files and 64 KiB. The root calls its exact `repair` specialist
with text and the package-owned CLI acceptance cases. It does not execute
candidate code or give the specialist attachments.

For a single issue, the exact `monitor` child receives only the specialist's
phase records. Its selected text reaches this root through a separate channel.
Print it as diagnostics, or forward it to a connected `progress` output. Monitor
failure marks presentation incomplete without substituting for the separately
awaited repair result. Validated repair evidence is checkpointed as soon as
the specialist settles. The monitor has no source or execution powers.

Alternatively supply `jobs`, at most two independently captured projects, each
with an `id`, relative `directory`, named fixed `checks`, `issue`, `editPaths`,
and optional `cancelAfterMs`. Both use the same exact specialist; failed workers
do not erase settled siblings. Results and patches remain separately identified.
Overlapping paths are reported, not merged or tested as a combined candidate.
Batch runs use both child positions for repair; no monitor is started.

Each validated proposal becomes an applicable patch against the original.
Only consistent command identities, an observed original defect, and passing
independent assertions earn `review.patch`. Repository test output is useful
additional evidence, not an independent verdict. Failed proposals remain
inspectable. Each settled job checkpoints a complete aggregate. On interruption,
the latest accepted aggregate survives while the independent command owner lives;
only those saved files are delivered after cleanup, with the unsuccessful Run
outcome preserved. Nothing applies or merges a patch.
