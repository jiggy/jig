---
title: How Jig works
description: See how code and Agent methods compose, who authorizes their powers, and what their results establish.
---

# Put Agent intelligence inside your software

You already work with Agents, Skills, and code.
Jig lets your software call and combine that work as reusable methods.
Your program supplies input, checks the result, and decides what happens next.

**Jig is a host for methods that combine AI Agent flexibility with procedures expressed in code.**
These methods are called **Flows**.
An executable Flow accepts input and returns an outcome and output.
It can use ordinary code, Agent judgment, or both.
Other Flows use the same calling boundary in each case.

## Compose the work through one interface

Imagine a support application choosing a queue for an incoming request.
Its coordinating Flow calls a classifier through a named **slot**:

```ts
return run.call({
  operationId: 'classify-request',
  slot: 'classifier',
  input: run.input,
})
```

The classifier can use code, an Agent, or both.
A **Binding** configures the exact Flow behind the slot.
The caller receives its outcome and output.
It does not need to coordinate the classifier's internal steps.

The [contact-import example](../examples/contact-import.md) demonstrates all three implementations.
Its importer calls a column mapper, then code validates the mapping and rows.
The result is a contact preview.
The application decides whether to import those proposed records.

This is what **AI-native** means here: code and Agent work compose through the same method boundary.
The independent [FLOW standard](https://flow.jig.md/guide/understand) defines that portable boundary.
Jig supplies authorized execution around it.
A common interface does not establish equal answers, cost, or required powers.

## Let Agents reason within a role

A prompt can ask an Agent to stay on task.
It cannot guarantee understanding, resistance to injected instructions, or a correct conclusion.
The surrounding system needs explicit procedures and authority boundaries.

A Flow's code chooses when to request judgment, validate data, branch, and stop.
The Agent has room to interpret within that method.
Jig supplies only its admitted powers and accounts for execution through completion or failure.
Model output cannot grant new authority by requesting it.

In this hypothetical classifier, the method can suggest only one of three queue names.
It receives no refund or messaging capability.
A valid suggestion can still be wrong.
The application needs its own policy before classification causes a consequential action.
A method can also misuse a correctly enforced power within its granted scope.

Jig makes Agent work governable and composable.
Result validation establishes shape.
Domain checks establish what your application can conclude from the result.
Neither execution control nor valid structure makes Agent judgment correct.

## Why a microkernel-inspired host?

We believe a small common execution core is a strong foundation for software built with Agents.
The host should not need a new primitive for every reasoning technique or workflow.

The architecture keeps responsibilities in four places:

| Part | Responsibility |
| --- | --- |
| Application | Purpose, domain rules, checks, and consequences |
| Flow | Method, code, prompts, Skills, and internal control |
| Operator | Agent clients, models, credentials, and authorized powers |
| Jig | Review, admission, exact binding, limits, containment, and execution lifecycle |

**Microkernel-inspired** describes this separation: Jig owns common execution boundaries, while composed methods supply substantial capability.
A Flow's program or runtime owns its internal control.
A repair procedure, classifier, and proposal workshop can use one host without becoming host features.
They do not need a Jig graph language.

This separation leaves room for Agent intelligence inside methods while authority stays outside model judgment.
A small set of responsibilities should make the system easier to understand.
The machinery enforcing them must still uphold its promises.

## Review the method, then run its accepted revision

![Editable source goes through jig review and approval before jig run executes the accepted revision. Jig validates the result and settles owned work before returning an outcome or failure.](../start/review-run.svg)

`jig review` captures proposed source and configuration for inspection and approval.
`jig run` executes the accepted revision with its configured powers.
Replacing the classifier can leave the caller's code intact, but still requires review.
A matching interface does not authorize changed bytes.

Runs return execution status, the method's outcome, and output.
A completed method may report `blocked` or `limit`.
An execution failure remains a failure.
Jig accounts for owned work through completion, cancellation, and cleanup.

Cancellation cannot retract a provider's accepted request or undo a completed external effect.
See [execution policy](../spec/project-policy.md) and [results](../build/results.md) for the exact guarantees.

## Build a system you can direct

Begin with one useful method.
Keep known procedure in code and add Agent judgment where interpretation helps.
Compose further methods when they contribute useful capability.
Their common boundary lets you change implementations while keeping the surrounding application understandable.

A physical jig guides tools toward repeatable work.
Jig takes its name from that idea: powerful methods under meaningful direction.
We call this **agency: power under control**.

[Run your first Flow](../start/index.md), then [try one caller with three implementations](../examples/contact-import.md).
For a larger application, follow [a tested patch](../examples/tested-patch.md) or the [support-case example](../examples/support-case.md).
