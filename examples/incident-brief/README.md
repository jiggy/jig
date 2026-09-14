# Prepare an incident brief across a worker handoff

Two workers use supplied incident facts: one drafts a brief and hands its
conversation to a fresh successor; the other independently lists questions
for human review. The application keeps current files and later corrections
separate from the generated summary, and retains each worker's outcome.

After the repository's ordinary workspace setup, configure the included
Agent Binding and your native client as described in the
[conversation guide](../../docs/jig/guide/conversations.md). Then, here:

```sh
jig review
jig run binding:brief --input @input.json --timeout 3m
```

The synthetic fixture corrects 600 affected requests to 48 and keeps the cause
uncertain. A successful result contains the proposed brief, its predecessor
settlement, the exact handoff snapshot and a separate list of review questions.
`blocked` retains the other worker's result and available unsuccessful work.
These are suggestions, not independently verified facts or published messages.

The drafting worker starts from earlier context, asks the same Agent for a
summary after that turn settles, closes that conversation, and waits for its
actual invocation result. Only then does it start one successor with the
summary plus unchanged earlier context, current file text and ordered later
instructions. It uses at most three requested turns; the other worker uses one.
All calls share the original root deadline and its aggregate host limits.

Try changing `laterInstructions` to require a different audience or a corrected
measurement. Revisions must increase; duplicated revisions fail before Agent
work. Lowering `turnBudget` below three prevents the drafting handoff from
starting while still permitting the independent one-turn branch.

This is an authored in-Run summary handoff, not restoration of a stored native
session. Input file text is supplied data, not live filesystem access; later
instructions are an explicit input snapshot, not an interactive inbox. Model
obedience and usefulness need their own evaluation. Root interruption can
prevent the final packet from arriving; this example adds no durable store.

See [the worker](flows/worker/work.ts) for the lifecycle and
[its tests](test/handoff.test.ts) for failures and sibling independence.
