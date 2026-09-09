---
name: threshold-search
description: Find the first Celsius threshold crossing by requesting only the readings needed for a bounded adaptive search.
channels:
  requests:
    direction: send
    delivery: direct
    contract: ./contracts/sample-request.json
  replies:
    direction: receive
    delivery: direct
    contract: ./contracts/sample-celsius.json
outcomes:
  blocked: Replies were missing, invalid, inconsistent with the conversation, or interrupted.
---

Input is `threshold` and 1–128 unique ordered sample identifiers in `samples`.
The caller promises the corresponding Celsius readings are nondecreasing.
This Flow receives identifiers, not the complete readings.

Perform a lower-bound search, making at most eight unique sequential requests.
Each answer determines the next request. Close requests when finished and
require reply EOF without extra records. Return the first reading at or above
the threshold, or `null` if no reading qualifies, plus every accepted observation.
On an invalid conversation retain that prefix with a `blocked` outcome and
`problem`; never infer a finding from partial evidence.

The named reply contract means Celsius, not just a matching object shape.
Channel completion is distinct from the dataset Flow's execution outcome;
the caller must await and verify both participants.
