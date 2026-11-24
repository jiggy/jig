---
title: FLOW for agents
description: Select focused Markdown, install the FLOW authoring skill, and follow the same task guides as human readers.
---

# Read and author with an agent

Agents and developers share the same public documentation.
Every page has a Markdown version, and the site publishes an index and full bundle.
Choose the pages needed for the task.

| Resource | Use it to… |
| --- | --- |
| [Documentation index](https://flow.jig.md/llms.txt) | Find a task guide, reference, or exact contract. |
| [Complete documentation](https://flow.jig.md/llms-full.txt) | Read the whole public site when context permits. |
| [Start here as Markdown](https://flow.jig.md/start/index.md) | Choose first use, Skill adaptation, or authoring. |
| [Reference as Markdown](https://flow.jig.md/reference/index.md) | Find APIs, compatibility information, and normative specifications. |

**View Markdown** opens the current page's plain-text resource.
For example, `/build/compose` corresponds to `/build/compose.md`.
Interactive examples retain all variants in that resource.

## Install the authoring skill

The `flow` skill helps an agent design, create, adapt, change, and review Flow packages.
Install it with:

```sh
npx skills add jiggy/flow
```

Select `flow` when prompted.
Invoke it by name, or use an agent that supports automatic skill discovery.
The installed skill includes focused references from the canonical documentation.
Executing a package requires a compatible host and the appropriate authority.

## Select context for the task

| Task | Start with |
| --- | --- |
| Use a method in an application | [First run](https://flow.jig.md/start/run.md), then [application consumption](https://flow.jig.md/start/application.md). |
| Adapt a Skill | [Bring a Skill](build/skills.md) and [compatibility](reference/skill-compatibility.md). |
| Create or review a package | [Design guidance](build/design.md), your [authoring format](https://flow.jig.md/build/index.md), and [Package/0](spec/package-format.md). |
| Combine methods | [Composition](build/compose.md), [outcomes](build/outcomes.md), and the [SDK reference](reference/sdk.md). |
| Implement support | The [implementation path](https://flow.jig.md/implement/index.md) and its linked exact contracts. |
| Check an exact rule | The owning [specification](https://flow.jig.md/reference/index.md) and machine companion. |

## Keep assumptions explicit

Give an agent a focused starting instruction:

```text
Read https://flow.jig.md/llms.txt and select the pages needed for this task.
Use the owning specification for exact package and protocol requirements.
Check the selected host's actual runtime and interface support.
Keep the method's procedure separate from host permissions and providers.
Label domain examples as examples and verify the task's expected result.
```

Documentation supplies meaning and context.
The receiving host and operator retain authority over execution.
Distinguish SDK availability, installed-host support, protocol conformance, and a useful task result when reporting evidence.
