# UC-006 Change a repeat and its exits

> “Give a rejected draft one revision and review it again. Publish on approval. Send a second rejection to the editor.”

**Actor and goal.** A coding agent needs to find who schedules another review and who decides between publication and referral.

## Starting situation

A publishing workflow reviews each draft, publishes an approval, and sends a rejection straight to the editor.
The owner wants one chance to revise. The same review call can run twice for a draft.

## Main scenario

1. The agent follows the review result back to the caller that chooses publication or referral.
2. It locates where to distinguish the first review from the second and where a revised draft will re-enter review.
3. It follows approval on either attempt to the same publication step. A second rejection goes to referral without publication.

## Alternatives and success

A reviewer failure can have its own handler. The agent checks that path separately from an ordinary rejection.
If a helper controls the number of attempts and its behavior is unknown, the agent identifies the helper as the next source to read.
Before editing, it can identify the repeat, both exits, and the caller that can enforce the one-revision limit.

## Related specification and evidence

[JOB-001](JOB-001-locate-a-workflow-edit.md) · [FEAT-001 Flow inspection](JOB-001-locate-a-workflow-edit.md#feat-001-flow-inspection)

The scenario `a finite array repeats the same call site and an early return skips later iterations` covers repetition and early exit. [Repeat scenario](../../packages/jig/test/portable/flow-behavior.test.ts#L2314)
The scenario `after a cutoff a repeat links its configured call, loop condition and authored exits` checks source navigation when the loop cannot be interpreted. [Source navigation scenario](../../packages/jig/test/portable/flow-behavior.test.ts#L2350)
The scenario `equivalent suffixes converge while different return values keep separate continuations` checks when paths may share a continuation. [Convergence scenario](../../packages/jig/test/portable/flow-behavior.test.ts#L2502)
