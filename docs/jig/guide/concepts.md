---
title: Concepts and questions
description: Plain-language definitions and common questions about Jig, Flows, Agents, authority, and results.
---

# Concepts and questions

Jig's core idea is agency: useful power under meaningful direction. These
terms explain the small set of responsibilities behind that promise.

## The core vocabulary

| Term | Meaning | Go deeper |
| --- | --- | --- |
| FLOW | Independent standard for packaging and invoking reusable methods | [FLOW documentation](https://flow.jig.md/guide/overview) |
| Flow | One packaged method, with its implementation and needed resources | [Your first Flow](./index.md) |
| Agent | Operator-selected intelligent work requested by a method | [Choose an Agent](./agents.md) |
| Binding | Reusable local configuration for a Flow | [Project authoring](../spec/project-sdk.md) |
| Capability | A configured interface through which a method requests a power | [Agent Run example](../contracts/agent-run.md) |
| Review | Inspecting a proposed revision before granting execution authority | [Review and run](./index.md#review-run-improve) |
| Admission | The host's recorded authorization of exact reviewed meaning | [Execution policy](../spec/project-policy.md) |
| Run | One bounded invocation and its owned execution | [Results](./results.md) |
| Outcome | The method's application-level result, such as `done` or `blocked` | [Results and recovery](./results.md) |
| Channel | A declared connection carrying bounded data during work | [Live progress](./channels.md) |
| Checkpoint | Accepted application output retained before final completion | [Run Checkpoint](../spec/run-checkpoint.md) |

## Do I need an Agent or a graph?

No. The first Flow uses ordinary code and no Agent. Use an Agent where judgment
or generation helps. Add a graph when its structure improves inspection,
testing, or reuse. [Choose a workflow structure](./workflow-design.md).

## Is Jig a workflow language?

Jig is a host. Your Flow's program or runtime owns its internal control, and
your application owns its purpose. You do not need a new Jig primitive for each
method. [How Jig works](./understand.md) explains the division.

## Does local software mean my data stays local?

Not necessarily. A remote Agent receives the data intentionally sent to its
provider. The operator chooses that provider and is responsible for its
suitability. [Agent configuration](./agents.md) identifies the available paths.

## Why did my source edit not change the next run?

Runs use the approved revision. Review and approve the source change before
running it. An edit proposes new meaning; it does not automatically acquire
execution authority.

## Can I automate review?

`jig review --yes` records explicit approval without an interactive prompt.
Use it only under authority already granted to the automation. It does not
grant resolution networking; [dependency review](./dependencies.md) explains
that separate permission.

## Does a successful command mean the task succeeded?

A method may execute correctly and return `blocked`. File delivery is also
separate from execution. Inspect the Run status, outcome, output, and delivery
information. [Results and recovery](./results.md) shows how.

## Can cancellation undo an external effect?

No. Cancellation must settle owned execution, but it cannot retract a remote
request already accepted or reverse a completed consequence. Uncertain work
must not be silently treated as successful or automatically replayed.

## Where is the supported platform list?

The [quickstart's supported-host section](./index.md#supported-host) owns that
list. FLOW SDK language availability is not evidence that Jig supports that
language or operating system.
