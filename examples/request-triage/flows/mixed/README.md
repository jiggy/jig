Input is an object containing a nonempty `message` of at most 4000 characters.
A `done` result contains `output.queue`: `billing`, `technical`, or `manual`.
`manual` is a completed suggestion to seek human classification, not a failure.
`blocked` and `limit` contain `output.reason`. Execution errors propagate.

Recognize the same explicit prefixes as the code implementation. For other
messages, make one Agent call and validate its result. The direct branch uses
no Agent call. Agent interpretation remains uncertain; explicit prefixes are
also untrusted labels and neither branch authorizes action.

The optional `progress` channel uses the standard user-updates contract. **Request**
shows the code-first procedure and queue suggestion. Jig renders these same semantic
declarations in terminal and web dashboards. Views preserve literal outcomes and
explicit excerpts; they do not execute actions or establish host success.
