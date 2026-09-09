---
title: Build with a team
description: Share reusable methods while keeping application policy, operator powers, and consequential decisions with their owners.
---

# Share methods. Keep clear ownership.

Jig's idea of agency applies when several people contribute to the same work.
A method author can supply expertise without choosing every consumer's
providers, credentials, or consequences.

This guide describes responsibilities for using the local host. It does not
introduce a hosted team service, shared accounts, or a multi-user control plane.

## Agree on the outcome and its owners

| Responsibility | The owner's decision |
| --- | --- |
| Application | Purpose, inputs, domain checks, delivery, and consequential actions |
| Method author | Reusable procedure, prompts, selected Skills, validation, and stopping rules |
| Operator | Agents, providers, credentials, host support, powers, and limits |
| Result recipient | Whether the outcome and its evidence justify the next action |

One person may fill every role. Explicit ownership becomes valuable when the
method author, data owner, and consequence owner differ.

## Share source that another operator can understand

Keep the method and its purpose together in a Flow. Use ordinary version
control for your application source and project policy. Use documented
[dependency preparation](./dependencies.md) rather than a private installation
path that colleagues must reconstruct.

A **Binding** is a reusable project-local configuration for a Flow. It can
supply settings and exact dependencies where customization earns its place;
it is not a requirement to create a configuration file for every component.
See [project authoring](../spec/project-sdk.md).

Credentials remain operator inputs. A committed project or portable lock does
not authorize execution on another host. Each operator reviews the source and
policy with their own configured powers.

## Make review part of change

Before running a revised method, use `jig review` to inspect the proposed
changes and approve the exact revision. Review source with normal development
tools as well as the CLI's change and policy summary. Editing source does not
silently change the approved version.

Applications can automate work within explicitly delegated authority. A human
prompt is not required at every interface, but approval flags do not invent
permission. For example, `--yes` records execution approval and does not grant
fresh dependency-resolution networking.

## Deliver evidence another person can use

The [tested-patch application](./tested-patch.md) returns proposed changes and
checks without mutating the original repository. Its application policy keeps
patch acceptance with the recipient. Your application should make its own
consequence policy equally clear.

Distinguish a successful Run from a useful domain outcome and from successful
file delivery. Name who handles a blocked result, cancellation, or uncertainty.
[Results and recovery](./results.md) explains these boundaries.

## Start with the smallest useful collaboration

Choose one repeatable task, one reusable method, and checks that matter to its
recipient. Add specialists when they need different evidence, expertise, or
powers. [Workflow structure](./workflow-design.md) helps decide when the extra
coordination earns its cost.
