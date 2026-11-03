---
title: Terms and common questions
description: Plain-language definitions and common questions about Jig, Flows, Agents, authority, and results.
---

# Terms and common questions

Use this reference to look up a term or answer a question while building.
[How Jig works](../understand/index.md) explains how these responsibilities fit together.
Jig calls their intended result **agency: power under control**.

## The core vocabulary

| Term | Meaning | Go deeper |
| --- | --- | --- |
| FLOW | Independent standard for packaging and invoking reusable methods | [FLOW documentation](https://flow.jig.md/guide/overview) |
| Flow | One packaged method, with its implementation and needed resources | [Your first Flow](../start/index.md) |
| Agent | An operator-selected intelligent worker invoked by a method | [Choose an Agent](../build/agents.md) |
| Binding | Reusable local configuration for a Flow | [Project authoring](../spec/project-sdk.md) |
| Capability | A configured interface through which a method requests a power | [Agent Run example](../contracts/agent-run.md) |
| Review | Inspecting a proposed revision before granting execution authority | [Review and run](../start/index.md#2-review-and-approve) |
| Admission | The host's recorded authorization of exact reviewed meaning | [Execution policy](../spec/project-policy.md) |
| Run | One bounded invocation and its owned execution | [Results](../build/results.md) |
| Outcome | The method's application-level result, such as `done` or `blocked` | [Results](../build/results.md) |
| Channel | A declared connection carrying bounded data during work | [Live progress](../build/channels.md) |
| Checkpoint | Accepted application output retained before final completion | [Run Checkpoint](../spec/run-checkpoint.md) |

## Do I need an Agent or a graph?

The [first Flow](../start/index.md) uses ordinary code and needs no Agent.
Use an Agent where judgment or generation helps.
Add a graph when its structure improves inspection, testing, or reuse.
[Choose a workflow structure](../understand/workflows.md) for your task.

## Is Jig a workflow language?

Jig is a host.
Your Flow's program or runtime owns its internal control.
Your application owns its purpose.
Methods do not need a new Jig primitive for each technique.
[How Jig works](../understand/index.md) explains the division.

## Does local software mean my data stays local?

A remote Agent receives the data intentionally sent to its provider.
The operator chooses that provider and is responsible for its suitability.
Local hosting does not establish local-only data processing.
[Agent configuration](../build/agents.md) identifies the available paths.

## Why did my source edit not change the next run?

Runs use the approved revision.
Review and approve the source change before running it.
Editing source proposes new meaning without authorizing it.

## Can I automate review?

`jig review --yes` records explicit approval without an interactive prompt.
Use it only under authority already granted to the automation.
It does not grant resolution networking.
[Dependency review](../build/dependencies.md) explains that separate permission.

## Does a successful command mean the task succeeded?

A method may execute correctly and return `blocked`.
File delivery is also separate from execution.
Inspect the Run status, outcome, output, and delivery information.
[Results](../build/results.md) shows how.

## Can cancellation undo an external effect?

Cancellation must settle owned execution.
It cannot retract an accepted remote request or reverse a completed consequence.
Preserve uncertainty instead of assuming success or automatically replaying work.

## Where is the supported platform list?

The [supported-host reference](../start/index.md#supported-host) owns that list.
A FLOW SDK can support a language without Jig supporting that runtime or operating system.
