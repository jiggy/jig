---
title: Build with Jig
description: Add Agent work, compose methods, supply files, and handle outcomes in your application.
---

# Build with Jig

Build an application from methods with clear inputs, results, and responsibilities.
Keep domain decisions in your application and give each method only the powers it needs.

Complete [your first run](../start/index.md), then [call it from your application](../start/application.md).
These tutorials establish the review-and-run loop used throughout this section.

## Add and compose methods

| Task | Guide |
| --- | --- |
| Choose an API or native client and write a support-reply method | [Add an Agent](./agents.md) |
| Choose among eligible methods and recover partial work | [Select and recover methods](./semantic-routing.md) |
| Call another Flow and handle its complete result | [Compose methods](./compose.md) |
| Write instructions or adapt a Skill | [Markdown methods](./markdown.md) |
| Customize Agent instructions, Skills, or reply shapes | [Reuse the Agent method](./agent-method.md) |
| Use libraries and locked dependencies | [Prepare dependencies](./dependencies.md) |
| Generate contracts and editor types from TypeSpec | [Author contracts](./contracts.md) |

Portable method authoring belongs to [FLOW](https://flow.jig.md/).
Jig adds reviewed local configuration, powers, and execution around those methods.

## Work with data and effects

| Task | Guide |
| --- | --- |
| Read captured inputs and deliver artifacts | [Work with files](./files.md) |
| Make authorized requests without exposing credentials | [Delegate HTTP access](./http.md) |
| Report progress and render application views | [Show live progress](./channels.md) |
| Interpret outcomes and inspect retained evidence | [Results](./results.md) |
| Diagnose failures and recover safely | [Troubleshooting](../reference/troubleshooting.md) |

## Continue Agent work

Start with [a two-turn conversation](./conversations.md).
Use [conversation control](./conversation-control.md) when work needs interruption or direct channel composition.
[Handoff](./conversation-handoff.md) transfers application-approved context to a fresh conversation.
[Restoration](./conversation-restoration.md) uses qualified native retained state.
These mechanisms have different authority and lifetime limits.

## Keep the application understandable

[Project design](./design.md) explains component boundaries and meaningful configuration.
[Working together](./teams.md) assigns source, policy, and operator responsibilities.
[Workflow structure](../understand/workflows.md) helps you choose code, Agent judgment, and coordination for the task.

Try a [complete example](../examples/index.md) to see these choices together.
