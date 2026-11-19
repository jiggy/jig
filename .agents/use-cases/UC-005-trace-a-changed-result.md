# UC-005 Find the consumers of a changed result

> “Assessment can now ask for more evidence. Pause intake whenever it gets that answer. Approved cases should still proceed to credit checking.”

**Actor and goal.** A coding agent needs to find every configured caller whose next action depends on the new assessment result.

## Starting situation

Several intake workflows share an assessment Flow. One caller decides whether to call credit directly.
Another returns the assessment result to a parent that makes the decision. A search for the assessment call alone misses that parent.

## Main scenario

1. Starting from assessment, the agent finds its declared results, its configured uses, and the slots through which callers reach each use.
2. For each caller it follows what happens to the result. A caller may branch, forward the result, or translate it into a different status.
3. It locates the decision that would send the new result to credit, including any default branch. It identifies which owners already pause and which need an edit.

## Alternatives and success

The contract may allow an outcome while the assessment's implementation is opaque. The agent can still trace what the caller would do **if** it received that outcome.
A direct request to assessment exposes its own result to the invoker. Consumers outside the captured application remain unknown.
Before editing, the agent can trace the new answer to each known intake decision and point to the approved route each must preserve.

## Related specification and evidence

[JOB-001](JOB-001-locate-a-workflow-edit.md) · [FEAT-001 Flow inspection](JOB-001-locate-a-workflow-edit.md#feat-001-flow-inspection)

The scenario `a grandchild contract alternative remains conditional in its callers` follows a permitted outcome through a translation and a forwarding caller. [Conditional caller scenario](../../packages/jig/test/portable/flow-behavior.test.ts#L1792)
The scenario `a known undeclared outcome is refused both directly and through its caller` exercises the result contract at both entrypoints. [Contract scenario](../../packages/jig/test/portable/flow-behavior.test.ts#L1136)
