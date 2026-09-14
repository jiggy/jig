---
name: tested-project-patch
description: Turn one small Bun project and an issue into a patch with independent acceptance evidence.
attachments:
  source: read
  deliverables: read-write
outcomes:
  blocked: The defect was not reproduced or no acceptable patch was produced.
  limit: The Agent stopped at its limit.
---

Supply `issue` and `editPaths`, with a read-only source attachment containing
at most 16 UTF-8 files and 64 KiB. The root invokes its exact `repair` specialist
once with captured text and package-owned CLI acceptance cases. It does not
execute candidate code or give the specialist attachments.

Validate the returned evidence against the captured files and unchanged cases.
Each valid proposal becomes an applicable patch against the original. Only a
reproduced defect and independently accepted candidate earn `review.patch`.
Failed proposals remain inspectable. Nothing applies or merges a patch.

Cancellation and execution failures propagate. This example publishes final
results only; it declares no progress channel, batch mode, or checkpoint capability.
