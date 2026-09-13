---
name: request-triage-code
description: Recognize explicit support labels using ordinary code.
outcomes:
  blocked: The selected method cannot classify the request.
  limit: The selected method reaches its execution limit.
---

Input is an object containing a nonempty `message` of at most 4000 characters.
A `done` result contains `output.queue`: `billing`, `technical`, or `manual`.
`manual` is a completed suggestion to seek human classification, not a failure.
`blocked` and `limit` contain `output.reason`. Execution errors propagate.

A message beginning with `[billing]` or `[technical]` selects that queue,
ignoring capitalization and outer whitespace. Everything else goes to `manual`.
These labels are an example application convention, not verified intent.
This implementation does not request Agent work.
