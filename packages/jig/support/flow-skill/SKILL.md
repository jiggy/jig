---
name: flow
description: FLOW design and authoring. Use when designing, creating, composing, refactoring, or reviewing Flows, or adapting Skills into Flows.
---

# Design, create, and review Flows

## 1. Establish the method

Read the [design guide](reference/build/design.md) before choosing boundaries or reviewing an existing design.
Use the [agent guide](reference/for-agents.md) for FLOW's scope and execution assumptions.
For an existing package, inspect its entrypoint, declarations, resources, and dependency calls.
Identify the requested input, expected result, required effects, and failure cases.
Complete this step when the caller's need and the method's acceptance criteria are explicit.

## 2. Design the boundaries

Apply the design guide's principles to the actual task.
Identify the application's domain and choose the level of abstraction its components should expose.
Describe each proposed component's purpose, input, result, outcomes, dependencies, effects, and state ownership.
Use a short outline or existing package documentation, without adding a required design artifact.

Apply the guide's [naming guidance](reference/build/design.md#choose-short-clear-names) to each component.
Check for further useful splits under its [decomposition rules](reference/build/design.md#choose-meaningful-small-pieces).

Choose small, cohesive capabilities and explain which knowledge each boundary hides from its caller.
Make a composed Flow expose a clear capability while owning its children's coordination.
Identify which policy, integration, or observation changes should remain independent.
Choose calls or explicit channel ports for each relationship, keeping required work visible.

For an existing design, identify hidden assumptions, coupled changes, and responsibilities worth separating before proposing a refactor.
Keep private helpers private when extraction would add wiring without reducing consumer knowledge.
Complete this step when the decomposition is understandable from its public promises and each extracted boundary has a concrete purpose.

## 3. Choose the implementation

Read [Package/0](reference/spec/package-format.md) before implementing or judging package mechanics.

When choosing an implementation, check [runtime support](reference/reference/support.md) for the intended host.
Confirm support in the chosen host and any SDK the method uses.
Read each relevant branch before editing or judging its behavior.

| Task | Reference |
| --- | --- |
| Markdown instructions or recipes | [Markdown guide](reference/build/markdown.md) and [Markdown/0](reference/spec/markdown-runtime.md) |
| TypeScript or JavaScript implementation | [TypeScript guide](reference/build/typescript.md) |
| Python implementation | [Python guide](reference/build/python.md) |
| Existing Skill adaptation | [Adaptation guide](reference/build/skills.md) and [Skill compatibility](reference/reference/skill-compatibility.md) |
| Code dependencies, cancellation, or artifact handling | [Composition](reference/build/compose.md), [outcomes](reference/build/outcomes.md), and [Run SDK/0](reference/spec/run-sdk.md) |
| Input/result validation, custom outcomes, caller ports, or shared interfaces | [Invocation Contract/0](reference/spec/invocation-contracts.md) |
| Schema declarations or configurable implementation settings | [Schema/0](reference/spec/schema-files.md) |
| Message channels | [Channel Contract/0](reference/spec/channel-contracts.md) |

For Skill adaptation, account for every required tool, input, output, and restriction before proceeding.
Complete this step when the selected references cover the implementation, required declarations, and any unsupported requirements.

## 4. Implement or review

For authoring, implement the chosen boundaries and declarations using the selected guides.
Keep inputs explicit, dependencies replaceable where required, and effects and failure handling with their identified owners.

For review, assess architectural quality using the design guide's concrete probes.
For review, compare every entrypoint, declaration, dependency, and claimed capability with its owning specification.
Distinguish design findings from specification violations.
Report the affected caller, consequence, evidence, and smallest useful correction for each finding.
Complete this step when the method is implemented or findings are substantiated, with justified design tradeoffs recorded.

## 5. Verify the result

Use the target project's checks and the selected guide's execution path.
Exercise representative input and the failure cases affected by the change.
Apply the relevant [design probes](reference/build/design.md#review-the-design-with-concrete-changes) to the implemented boundaries.
Check independent use and relocation when claiming portability, and substitution when claiming replaceability.

For review, run checks needed to substantiate findings.
Inspect the returned outcome, output, and task evidence.
Complete this step when those checks pass and required constraints hold.
If execution is unavailable, report the missing support and distinguish inspection from execution.
