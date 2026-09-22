Input is an object containing a nonempty `message` of at most 4000 characters.
A `done` result contains `output.queue`: `billing`, `technical`, or `manual`.
`manual` is a completed suggestion to seek human classification, not a failure.
`blocked` and `limit` contain `output.reason`. Execution errors propagate.

This caller invokes exactly one child through its admitted `classifier` slot.
It returns the child result without interpreting the implementation. The host
validates the child result before the caller receives it. No message is sent
to a queue, and no refund, reply, or other business action is authorized.
