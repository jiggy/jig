Input is an object containing a nonempty `message` of at most 4000 characters.
A `done` result contains `output.queue`: `billing`, `technical`, or `manual`.
`manual` is a completed suggestion to seek human classification, not a failure.
`blocked` and `limit` contain `output.reason`. Execution errors propagate.

A message beginning with `[billing]` or `[technical]` selects that queue,
ignoring capitalization and outer whitespace. Everything else goes to `manual`.
These labels are an example application convention, not verified intent.
This implementation does not request Agent work.

The optional `progress` channel uses the standard user-updates contract. **Request**
shows the prefix rule and queue suggestion. Jig renders these same semantic declarations
in terminal and web dashboards. Views preserve literal outcomes and explicit excerpts;
they do not execute actions or establish host success.
