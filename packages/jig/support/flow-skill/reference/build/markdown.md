---
title: Write a Flow in Markdown
description: Give instructions a callable input and result, then run them through a host's Markdown interpreter.
---

# Write a Flow in Markdown

A `FLOW.md` file packages instructions as a method another program can call.
The host's Agent interprets those instructions and returns an outcome with data.
Code and Markdown methods expose the same caller-facing boundary.

The illustrative classifier suggests a support queue from a supplied message.
The application decides whether to use that suggestion.

## What you need

Use a host that supports the [Markdown/0 profile](../spec/markdown-runtime.md) and supplies an authorized Agent.
For the Jig example below, first follow its [supported-host setup](https://jig.md/guide/#supported-host).
Install and authenticate the native Agent you choose during project initialization.

Markdown needs no SDK import in the package.
Its interpreter uses Agent reasoning and a bounded sequential profile.
Use a [code method](typescript.md) when the procedure needs enforced sequencing or concurrent work.
The [support reference](../reference/support.md) distinguishes the standard from a host's qualified runtimes.

## Write the instructions

Choose a directory outside the first tutorial's project.
Create a Jig project with an Agent:

```sh
jig init markdown-demo --agent
cd markdown-demo
mkdir -p flows/classify-request-markdown
```

Choose your Agent when prompted and follow the generated setup instructions.
Save this as `flows/classify-request-markdown/FLOW.md`:

```markdown title="FLOW.md"
---
name: classify-request
description: Suggest a support queue from a supplied customer message.
allowed-tools: ""
---
Read the message string in the invocation input.
Suggest billing for questions about charges, invoices, or payments.
Suggest technical for access problems or software errors.
Choose manual when the message is unclear or outside those categories.

Return outcome done. Set output to an object with one field, queue.
Its value must be billing, technical, or manual.
```

Keep this alternative separate from the code package in [Run your first Flow](https://flow.jig.md/start/run.md).
Each package has one implementation.
Markdown metadata lives in frontmatter, so this package needs no `FLOW.meta.json`.

`allowed-tools: ""` permits reasoning and a result while disabling resource reads and effect recipes.
This classifier needs only its supplied input.
Check [Skill compatibility](../reference/skill-compatibility.md) when adapting instructions that expect tools or other resources.

## Run and inspect the result

Review the source and invoke the method:

```sh
jig review --allow-resolution-network
jig run flow:flows/classify-request-markdown --input '{"message":"I was charged twice."}' --timeout 4m --json
```

Inspect the review and approve the intended source and grants.
The project supplies its configured Agent through Jig's default provider route.
The review's network option permits dependency resolution.
The classifier's declared restrictions still govern its own effects.

For this message, the expected method result is:

```json
{"outcome":"done","output":{"queue":"billing"}}
```

The host's response also reports execution status and diagnostics.
The Agent chooses the queue, so test its answer against the task's criteria.
The interpreter checks the result envelope. Your application judges the suggestion.
The timeout bounds the invocation, its dependencies, and cleanup.

## Make the instructions yours

Add an instruction to send refund requests to `billing`.
Review the change and run the method with `{"message":"Please refund my order."}`.
Check the queue and try ambiguous messages that should reach `manual`.
Use representative cases to evaluate whether the revised procedure helps.

An [optional invocation contract](validation.md) can constrain the input and complete result.
Use [outcomes](outcomes.md) when the method needs a declared response beyond `done`.
Schema validation checks structure, and task-specific checks assess the answer.

## Add capabilities when the task needs them

A Markdown method can call declared dependencies and exchange messages using exact `flow` recipes.
The host selects and authorizes their implementations.
See [Compose methods](compose.md), [Exchange messages](messages.md), and the [recipe reference](../reference/markdown.md).

The interpreter fixes each recipe's target and operand meaning before reasoning.
The Agent chooses whether and when to select a recipe.
Use code when required ordering must hold independently of that choice.

For an existing `SKILL.md`, follow [Bring a Skill](skills.md).
That guide checks the procedure's required inputs, resources, tools, results, and constraints before adaptation.
