---
name: tested-project-patch
description: Turn a small Bun project and an issue into a reviewable multi-file patch with independent acceptance evidence.
attachments:
  source: read
  deliverables: read-write
outcomes:
  blocked: The defect was not reproduced or no acceptable patch was produced.
  limit: The Agent stopped at its limit.
---

Supply `issue` and `editPaths`, with a read-only source attachment containing
at most 16 UTF-8 files and 64 KiB. The root calls its exact `repair` specialist
with text and the package-owned CLI acceptance cases. It does not execute
candidate code or give the specialist attachments.

Each validated proposal becomes an applicable patch against the original.
Only consistent command identities, an observed original defect, and passing
independent assertions earn `review.patch`. Repository test output is useful
additional evidence, not an independent verdict. Failed proposals remain
inspectable. Operational failure exports no partial Flow files; available
terminal details may retain earlier attempts. Nothing applies or merges a patch.
