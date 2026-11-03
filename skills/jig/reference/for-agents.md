---
title: Documentation for agents
description: Install FLOW and Jig authoring skills, or read focused Markdown documentation for your task.
---

# Give your Agent the right context

People and software use the same task paths and exact contracts.
Fetch focused pages for the task before loading the full documentation bundle.
These public files require no account, API key, or JavaScript execution.

## Install authoring skills

For a new Jig project, install both authoring skills in your development Agent.
Run these commands from the project directory:

```sh
npx skills add jiggy/flow --skill flow
npx skills add jiggy/jig --skill jig
```

| Skill | Use it for |
| --- | --- |
| FLOW | Portable method design, naming, decomposition, composition, and implementation. |
| Jig | Project creation, local configuration, review, execution, and recovery. |

Use both when building an application from reusable Flows.
Use Jig's skill alone for host tasks that do not change methods.

Each skill bundles its references inside its installable directory.
Load the relevant guidance when the task needs it.
Your project's instructions still own its domain, acceptance criteria, and delegated authority.
Start project decisions with [project design](build/design.md).

These skills guide your development Agent.
To configure an Agent used by a running Flow, follow [Agent setup](build/agents.md).
To supply Skill contents during a method invocation, follow [Agent method guidance](build/agent-method.md).
Installing an authoring skill grants no execution authority.

## Read documentation as Markdown

| Resource | Use it for |
| --- | --- |
| [Documentation index](https://jig.md/llms.txt) | Discover all public pages and select what matters |
| [Full documentation](https://jig.md/llms-full.txt) | Read the complete public site when context size permits |
| [Getting started as Markdown](start/index.md) | Create, review, run, and adapt the first Flow |
| [Task map as Markdown](https://jig.md/documentation.md) | Find a guide by the consumer's intended outcome |

On a guide or specification, **Copy Markdown** copies its Markdown content.
**View Markdown** opens the plain-text page.
For example, `https://jig.md/build/agents` has a Markdown version at `https://jig.md/build/agents.md`.

## Start from the user's task

Give your development Agent focused instructions such as these:

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

These instructions supply documentation context.
Your application's instructions and operator authorization govern commands, data transfer, and host changes.

## Select context by responsibility

- **Authoring:** [project design](build/design.md), [first Flow](start/index.md), [dependencies](build/dependencies.md), and [project SDK](spec/project-sdk.md).
- **Agent setup:** [operator configuration](build/agents.md) and [Agent Run contract](spec/agent-run.md).
- **Application integration:** [files](build/files.md), [progress](build/channels.md), and [results](build/results.md).
- **Programmatic execution:** [application client](spec/execution-client.md) for invoking Jig and recovering retained attempts.
- **Review and execution:** [execution policy](spec/project-policy.md).
- **Portable FLOW meaning:** use [FLOW's separate index](https://flow.jig.md/llms.txt).

## The architecture to preserve

Executable Flows give code, Agent judgment, and mixed methods one boundary for input, outcome, and output.
Compose through the method's contract.
Do not require a different calling model because its implementation uses an Agent.
FLOW owns the portable boundary. Jig owns local authority and execution lifecycle.
A shared interface does not establish equal judgment, cost, or required powers.

See [how Jig works](https://jig.md/understand/index.md) and [one caller, three implementations](https://jig.md/examples/contact-import.md).
Changes to an implementation or Binding still need review.
A matching contract does not authorize new bytes.

## Preserve the distinctions

Specifications define exact requirements.
Guides describe the documented surface and prerequisites.
Research pages describe possibilities, not supported features.
Package versions in source may be candidates awaiting publication.

Keep generated answers distinct from execution evidence.
Package names grant no permission.
Preserve uncertainty after interruption or possible effects.
Use [results and recovery](build/results.md) to choose the next step without automatically replaying work.

The site generates the index and bundle from public pages.
It excludes internal repository work contracts.
Keep your project's own instructions separately.
