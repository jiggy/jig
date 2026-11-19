# UC-003 Change one configured use of a shared Flow

> “Use the stricter validator for audit imports. Standard imports should keep their current validator.”

**Actor and goal.** A coding agent must locate the choice specific to audit imports. Both imports use the same implementation.

## Starting situation

A Binding is a configured use of a Flow. In this example, the audit and standard Bindings delegate through the same named validation slot.
The agent may first encounter the shared source file or a caller that selects one of the Bindings.

## Main scenario

1. The agent identifies both configured uses of the import Flow and the callers that select each.
2. It compares the effective settings and the target selected for the validation slot.
3. It locates the audit Binding's selection and traces the standard import to its current validator.

## Alternatives and success

If two callers select the same Binding, changing its slot would affect both callers.
The agent locates their caller-side selections to see where the requested difference can be expressed.
Before editing, it can identify the intended use and the sibling route to preserve, even when both reach the same package.

## Related specification and evidence

[JOB-001](JOB-001-locate-a-workflow-edit.md) · [FEAT-001 Flow inspection](JOB-001-locate-a-workflow-edit.md#feat-001-flow-inspection) · [Binding declaration](../../docs/jig/spec/project-sdk.md#binding-declaration)

The portable scenario `focused orientation shows distinct slots and variant callers before analysis` exercises two Bindings of the same writer.
It checks that the selected declaration, differing settings, slot selections, and callers appear together. [Executable scenario](../../packages/jig/test/portable/flow-behavior.test.ts#L414)
A direct setting check can also link to the Binding declaration that supplies its captured value. [Setting check scenario](../../packages/jig/test/portable/flow-behavior.test.ts#L241)
