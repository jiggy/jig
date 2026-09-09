---
name: sample-reader
description: Answer bounded requests for Celsius readings from this invocation's explicit dataset.
channels:
  requests:
    direction: receive
    delivery: direct
    contract: ./contracts/sample-request.json
  replies:
    direction: send
    delivery: direct
    contract: ./contracts/sample-celsius.json
outcomes:
  blocked: A request was invalid, repeated, unknown, over budget, or the exchange was interrupted.
---

Input is `samples`: 1–128 unique `{sample, celsius}` readings. Answer at most
eight unique requests by copying the corresponding reading. Requests are
sequential; each answer carries its sample identifier. This package does not
interpret a threshold or choose the investigation.

Request EOF closes the reply stream. Return the identifiers served, separately
from channel completion. Unknown and repeated identifiers fail visibly; they
are never paths, commands, or requests to discover more data.
