---
name: batch-repair-proof
description: Exercise parallel contained repair and checkpoint delivery in host tests.
attachments:
  source: read
  deliverables: read-write
uses:
  progress:
    contract: ./contracts/run-checkpoint.capability.json
outcomes:
  blocked: At least one job did not produce an acceptable patch.
  limit: An Agent stopped at its limit.
---

Synthetic host-test root. Assemble over the public tested-patch fixture using
its current source-capture, evidence, and repair implementation. Invoke two
jobs and retain accepted checkpoint aggregates. This is not a public tutorial.
