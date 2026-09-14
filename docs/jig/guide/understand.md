---
title: How Jig works
---

# Put Agent intelligence inside your software

You already work with Agents, Skills, and code. Jig helps you bring them into
your software as methods you can call and combine. You supply an input, use
the result in your program, and choose where Agent interpretation helps.

**Jig is a host for methods that combine the flexibility of AI Agents with
the discipline of a traditional codebase.** Those methods are called **Flows**.
An executable Flow accepts input and returns an outcome and result. Inside,
it can use ordinary code, Agent judgment, or both. Other Flows call it through
the same boundary in each case.

## Compose the work through one interface

Imagine a support application asking a classifier which queue should inspect
an incoming request. It calls a named slot with the message:

```ts
return run.runChildFlow({
  operationId: 'classify-request',
  slot: 'classifier',
  input: run.input,
})
```

That caller can use a classifier written entirely in code, one that asks an
Agent, or one that combines both. A **Binding** configures the exact Flow behind
the slot. The caller receives the method's outcome and output without needing
to orchestrate its internal implementation.

The [request-triage example](./request-triage.md) demonstrates all three. Code
handles explicit labels, an Agent interprets messages, and the mixed method
uses code before asking an Agent. Each returns a suggested queue. The
application decides whether and how to act on it.

This is what **AI-native** means in Jig's architecture: code and Agent work
compose at the same level through the methods that contain them. Intelligence
can become part of a software system without making every caller an Agent
coordinator. The independent [FLOW standard](https://flow.jig.md/guide/understand)
supplies that method boundary; Jig supplies authorized execution around it.

## Let Agents reason within a role

A prompt can ask an Agent to stay on task. It cannot establish that the Agent
will always understand, resist injected instructions, or reach the right
conclusion. Those are reasons to make the surrounding system explicit.

A Flow's code can choose when to ask for judgment, validate returned data,
branch on a result, and stop at an authored limit. The Agent has room to
interpret within that method. Jig supplies only its admitted powers and
accounts for the work's execution lifecycle. Model output cannot grant new
authority by requesting it.

In the triage example, the method can suggest only one of three queue names.
It receives no refund or messaging capability. A valid suggestion can still
be wrong. The application needs its own policy before a classification can
cause a consequential action; even a correctly enforced power can be misused
within its scope.

Jig makes Agent work governable and composable. It does not make Agent judgment
correct. Result validation establishes shape; domain checks establish what
your application can safely conclude from it.

## Why a microkernel-inspired host?

We believe a small common execution core is a strong foundation for software
built with Agents. As methods grow more capable, the host should not need a
new primitive for every reasoning technique or workflow.

The architecture keeps responsibilities in four places:

| Part | Responsibility |
| --- | --- |
| Application | Purpose, domain rules, checks, and consequences |
| Flow | Method, code, prompts, Skills, and internal control |
| Operator | Agent clients, models, credentials, and authorized powers |
| Jig | Review, admission, exact binding, limits, containment, and execution lifecycle |

**Microkernel-inspired** describes this separation: Jig owns the common
execution boundaries while substantial capability lives in composed methods.
It does not prescribe a graph language or take over a Flow's internal program.
A repair procedure, a classifier, and a proposal workshop can use the same
host without becoming host features.

That is the architectural reason for building Jig: leave room for Agent
intelligence to develop inside methods while authority stays outside model
judgment. Minimalism concerns the responsibilities you need to understand;
the machinery enforcing them must still uphold its promises.

## Review the method, then run its accepted revision

![Editable source goes through jig review and approval before jig run executes the accepted revision. Jig validates the result and settles owned work before returning an outcome or failure.](./review-run.svg)

`jig review` captures the proposed source and configuration for inspection and
approval. `jig run` executes the accepted revision with its configured powers.
Changing the classifier behind a slot leaves the caller's code intact, but
still needs a new review. A matching interface does not authorize changed bytes.

Runs return an execution status, a method outcome, and output. A completed
method may report `blocked` or `limit`; an execution failure remains a failure.
Jig accounts for owned work through completion, cancellation, and cleanup.
Cancellation cannot retract a remote request already accepted by a provider
or undo a completed external effect. See [execution policy](../spec/project-policy.md)
and [results and recovery](./results.md) for the exact guarantees.

## Build a system you can direct

Begin with one useful method. Keep known procedure in code, add Agent judgment
where interpretation helps, and compose further methods when they contribute
capability. Their common boundary lets you change how the work happens while
keeping the surrounding application understandable.

A physical jig guides tools toward repeatable work. Jig takes its name from
that idea: help you put powerful methods to work under meaningful direction.
We call this **agency: power under control**.

[Run your first Flow](./index.md), then
[try one caller with three implementations](./request-triage.md).
For a larger application, follow [a tested patch](./tested-patch.md) or the
[support-case example](./support-case.md).
