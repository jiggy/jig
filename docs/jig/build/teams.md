---
title: Build with a team
description: Share reusable methods while keeping application policy, operator powers, and consequential decisions with their owners.
---

# Share methods with a team

Share a reusable method while each operator chooses its local powers.
Your team can review source together and give the result recipient evidence for their next decision.
A method author contributes expertise without choosing every consumer's providers, credentials, or consequences.

This guide covers collaboration through source and the local host.
Jig provides no hosted team service, shared accounts, or multi-user control plane.

## Agree on the outcome and its owners

| Responsibility | The owner's decision |
| --- | --- |
| Application | Purpose, inputs, domain checks, delivery, and consequential actions |
| Method author | Reusable procedure, prompts, selected Skills, validation, and stopping rules |
| Operator | Agents, providers, credentials, host support, powers, and limits |
| Result recipient | Whether the outcome and its evidence justify the next action |

One person may fill every role.
Agree on ownership when the method author, data owner, and consequence owner differ.

## Share source that another operator can understand

Keep the method and its purpose together in a Flow.
Use ordinary version control for application source and project policy.
Use documented [dependency preparation](./dependencies.md), so colleagues can reproduce the installation.

A **Binding** is reusable project-local configuration for a Flow.
It supplies settings and exact dependencies where customization is useful.
Create one for a meaningful configured use rather than every component.
See [project authoring](../spec/project-sdk.md).

Credentials remain operator inputs.
A committed project or portable lock does not authorize execution on another host.
Each operator reviews source and policy with their own configured powers.

## Make review part of change

Before running a revised method, inspect the proposal with `jig review`.
Review source with normal development tools as well as the CLI summary.
Approve the exact revision under the applicable authority.
Editing source does not silently change the approved version.

Applications can automate work within explicitly delegated authority.
They do not need a human prompt at every interface.
Approval flags do not invent permission.
For example, `--yes` records execution approval without granting fresh dependency-resolution networking.

## Deliver evidence another person can use

The [tested-patch application](../examples/tested-patch.md) returns proposed changes and checks without mutating the original repository.
Its application policy keeps patch acceptance with the recipient.
Make your application's consequence policy equally clear.

Distinguish successful execution, a useful domain outcome, and confirmed file delivery.
Name who handles a blocked result, cancellation, or uncertainty.
[Results and recovery](./results.md) explains these boundaries.

## Start with the smallest useful collaboration

Choose one repeatable task, one reusable method, and checks that matter to its recipient.
Add specialists when they need different evidence, expertise, or powers.
[Workflow structure](../understand/workflows.md) helps decide when additional coordination earns its cost.
