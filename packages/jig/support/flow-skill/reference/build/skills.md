---
title: Bring a Skill
description: Adapt a Skill into a callable Markdown method with explicit input and a result your application can use.
---

# Bring a Skill

Give a useful Skill a defined input and result so software can call the procedure.
This tutorial adapts a small request-classification Skill into a Markdown Flow.
Its queues illustrate an application choice, rather than a FLOW requirement.

## What you need

Use a host with Markdown/0 support and an authenticated supported Agent.
This example uses [Jig's Markdown setup](https://jig.md/guide/markdown).
Check [current support](../reference/support.md) before choosing a host.

Inspect the Skill's required tools, resources, and session assumptions before adapting it.
The current interpreter supports bounded reasoning and package-local text resources.
The [compatibility reference](../reference/skill-compatibility.md) lists script, tool, and package restrictions.

## Start with the procedure

Choose a directory outside the first tutorial's project.
Create a project with an Agent configuration:

```sh
jig init flow-instructions --agent
cd flow-instructions
mkdir -p skills/classify-request flows/classify-request-markdown
```

Choose your installed Agent when prompted and complete the generated README's prerequisites.
The host supplies the Agent to its Markdown interpreter.

Save this illustrative Skill as `skills/classify-request/SKILL.md`:

```markdown
---
name: classify-request
description: Suggest a review queue for a customer request.
allowed-tools: ""
---
Classify the supplied customer message.
Choose billing for payment or invoice questions, technical for access or product
problems, and manual when the message needs a person's judgment.
Suggest a queue without taking action on the customer's account.
```

This Skill requires only the supplied message and Agent reasoning.
Its empty tool declaration permits reasoning and returning a result while preventing resource reads and effect recipes.
Skills needing scripts or external tools require a different supported execution path.

## Define the invocation

Copy the Skill into its own Flow package:

```sh
cp skills/classify-request/SKILL.md flows/classify-request-markdown/FLOW.md
```

Append these instructions to `FLOW.md`:

```markdown
Receive an invocation input object with a message string.
Return outcome done with an output object containing queue.
Set queue to billing, technical, or manual using the classification guidance.
```

The package now has one implementation, `FLOW.md`.
The added instructions connect the procedure to the caller's input and result.
Review the whole procedure when adapting a real Skill, including its referenced resources and restrictions.

## Run and check the task

Review the project, inspect the proposed source and grants, and approve the intended work:

```sh
jig review --allow-resolution-network
jig run flow:flows/classify-request-markdown --input '{"message":"I was charged twice."}' --timeout 4m --json
```

An appropriate method result is:

```json
{"outcome":"done","output":{"queue":"billing"}}
```

The host also reports execution status and diagnostics.
Check that the invocation succeeded and that the suggestion fits the supplied message.
Agent reasoning can produce an unsuitable answer even when the result has the right shape.

Try a message with too little context, such as `"Please help."`.
Check whether the method chooses `manual` rather than inventing a billing or technical problem.
Test representative requests and the Skill's important constraints before using its suggestions.

## Build on the method

Follow the [application tutorial](https://flow.jig.md/start/application.md) from the `flow-instructions` project directory.
Set its target to `flow:flows/classify-request-markdown` and allow time for Agent reasoning, for example `durationMs: 240_000`.
Keep its execution, cleanup, outcome, and output checks.
The calling boundary stays the same even though an Agent interprets the instructions.
[Validate its inputs and results](validation.md) when callers need a checked data shape.

For work requiring another capability, [declare a dependency and compose methods](compose.md).
The host must support and authorize that dependency.
Adapting a Skill changes its execution setting, so judge the completed task as well as package acceptance.
