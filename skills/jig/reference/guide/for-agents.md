---
title: Documentation for agents
description: Install FLOW and Jig authoring skills, or read focused Markdown documentation for your task.
---

<!-- Generated from docs/jig/guide/for-agents.md. Edit the source, then run just sync-skills. -->


# Give your Agent the right context

The same documentation is available to people and software. Fetch a focused
guide for one task, or use the full bundle when you need broad context.
You need no account, API key, or JavaScript execution to read these files.

## Install authoring skills

For a new Jig project, install the FLOW and Jig skills for your development Agent.
Run the standard skills CLI from the project's directory:

```sh
npx skills add jiggy/flow --skill flow
npx skills add jiggy/jig --skill jig
```

The FLOW skill teaches portable method design, naming, decomposition, composition, and implementation.
The Jig skill teaches project creation, local configuration, review, execution, and recovery.
Use both when building a Jig application from reusable Flows.
Use Jig's skill alone for host tasks that do not change those methods.

Each skill bundles its references inside its installable directory.
Agents can load the relevant guidance when the task needs it.
Your project's instructions still own its domain, acceptance criteria, and delegated authority.
Start project decisions with [project design](design.md).

These skills guide your development Agent.
To configure an Agent used by a running Flow, follow [Agent setup](agents.md).
To supply Skill contents during a method invocation, follow [Agent method guidance](agent-method.md).
Installing an authoring skill grants no execution authority.

## Read documentation as Markdown

| Resource | Use it for |
| --- | --- |
| [Documentation index](https://jig.md/llms.txt) | Discover all public pages and select what matters |
| [Full documentation](https://jig.md/llms-full.txt) | Read the complete public site when context size permits |
| [Getting started as Markdown](index.md) | Create, review, run, and adapt the first Flow |
| [Task map as Markdown](https://jig.md/guide/overview.md) | Find a guide by the consumer's intended outcome |

On a guide or specification, **Copy Markdown** copies its actual Markdown
content. **View Markdown** opens the plain-text page. For example,
`https://jig.md/guide/agents` has a Markdown version at
`https://jig.md/guide/agents.md`.

## The architecture to preserve

Executable Flows give code, Agent judgment, and mixed methods one boundary for
input, outcome, and result. Compose through the method's contract.
Do not require a different calling model because its implementation uses an Agent.
FLOW owns the portable boundary. Jig owns local authority and execution lifecycle.
A shared interface does not establish equal judgment, cost, or required powers.

See [how Jig works](https://jig.md/guide/understand.md) and
[one caller, three implementations](https://jig.md/guide/contact-import.md). Changes to an implementation
or Binding still need review. A matching contract does not authorize new bytes.

## Start from the user's task

A useful starting instruction for an Agent working in your own project:

```text title="Documentation context"
Read https://jig.md/llms.txt.
Fetch the pages needed for my task.
Begin with the task map and supported-host requirements.
Use documented public interfaces and the exact supported package revision.
Keep domain logic in the application or Flow. Let the operator select Agents,
credentials, and powers. Respect the authorization already provided.
Distinguish execution status, application outcome, and output delivery.
Report missing prerequisites and uncertain effects without inventing success.
```

This is documentation context, not permission to run commands, send data, or
change a host. Your application's instructions and operator authorization
supply that authority.

## Select context by responsibility

- **Authoring:** [project design](design.md), [first Flow](index.md), [dependencies](dependencies.md), and [project SDK](../spec/project-sdk.md).
- **Agent setup:** [operator configuration](agents.md) and [Agent Run contract](../spec/agent-run.md).
- **Application integration:** [files](files.md), [progress](channels.md), and [results](results.md).
- **Programmatic execution:** [application client](../spec/execution-client.md) for invoking Jig and recovering retained attempts.
- **Review and execution:** [execution policy](../spec/project-policy.md).
- **Portable FLOW meaning:** use [FLOW's separate index](https://flow.jig.md/llms.txt).

## Preserve the distinctions

Specifications define exact requirements. Guides describe the documented
surface and prerequisites. Research pages describe possibilities, not supported
features. Package versions in source may be candidates awaiting publication.

A generated answer is not execution evidence. A package name is not permission.
An interrupted or uncertain operation is not an instruction to replay it.
Use [results and recovery](results.md) to decide the appropriate next step.

The site generates the index and bundle from public pages.
It excludes internal repository work contracts. Your project can keep its own instructions separately.
