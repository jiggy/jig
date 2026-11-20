# UC-002 Change selected calls through one slot

> “Send post-edit chapters to the specialist reviewer, including resumed chapters. Keep developmental and whole-book reviews with their current reviewer.”

**Actor and goal.** A coding agent needs every call that makes the requested kind of review. Searching for the shared reviewer also finds unrelated requests.

## Starting situation

In the publishing example, the producer delegates three reviews through one slot.
A chapter call chooses developmental or post-edit review from the chapter's state.
A second chapter call requests post-edit review. A whole-book call can also request post-edit review.

## Main scenario

1. The agent finds all three authored calls through the producer's review slot.
2. It reads the chapter or book scope alongside the purpose at each call, including the resumed-chapter path.
3. It follows any dispatch helper from the caller's arguments to the actual request.

## Alternatives and success

The mixed chapter call needs a conditional change. The second chapter call belongs in scope.
Rebinding the whole review slot would also redirect the developmental and whole-book reviews.
If a later input field can override an earlier value, the agent can locate that expression before treating the value as settled.
Before editing, it can name both affected chapter sites and explain which calls through the very same slot it will preserve.

## Related specification and evidence

[JOB-001](JOB-001-locate-a-workflow-edit.md) · [FEAT-001 Flow inspection](JOB-001-locate-a-workflow-edit.md#feat-001-flow-inspection)

The portable scenario `caller slot groups compare authored literals and identify guarded or overridden fields` exercises the three-site chapter and book pattern.
It checks grouping, conditional purposes, possible overrides, and links to omitted sites. [Executable scenario](../../packages/jig/test/portable/flow-behavior.test.ts#L611)
