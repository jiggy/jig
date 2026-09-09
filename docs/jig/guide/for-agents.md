---
title: Documentation for agents
description: Discover and consume Jig's public documentation as focused Markdown, with authority and support boundaries preserved.
---

# Give your Agent the right context

The same documentation is available to people and software. Fetch a focused
guide for one task, or use the full bundle when you need broad context.
No account, API key, or JavaScript execution is required to read these files.

| Resource | Use it for |
| --- | --- |
| [Documentation index](https://jig.md/llms.txt) | Discover all public pages and select what matters |
| [Full documentation](https://jig.md/llms-full.txt) | Read the complete public site when context size permits |
| [Getting started as Markdown](https://jig.md/guide/index.md) | Create, review, run, and adapt the first Flow |
| [Task map as Markdown](https://jig.md/guide/overview.md) | Find a guide by the consumer's intended outcome |

On a guide or specification, **Copy Markdown** copies its actual Markdown
content. **View Markdown** opens the plain-text page. For example,
`https://jig.md/guide/agents` has a Markdown version at
`https://jig.md/guide/agents.md`.

## Start from the user's task

A useful starting instruction for an Agent working in your own project:

```text title="Documentation context"
Read https://jig.md/llms.txt and fetch the pages needed for my task.
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

- **Authoring:** [first Flow](./index.md), [dependencies](./dependencies.md), and [project SDK](../spec/project-sdk.md).
- **Agent setup:** [operator configuration](./agents.md) and [Agent Run contract](../spec/agent-run.md).
- **Application integration:** [files](./files.md), [progress](./channels.md), and [results](./results.md).
- **Review and execution:** [execution policy](../spec/project-policy.md).
- **Portable FLOW meaning:** use [FLOW's separate index](https://flow.jig.md/llms.txt).

## Preserve the distinctions

Specifications define exact requirements. Guides describe the documented
surface and prerequisites. Research pages describe possibilities, not supported
features. Package versions in source may be candidates awaiting publication.

A generated answer is not execution evidence. A package name is not permission.
An interrupted or uncertain operation is not an instruction to replay it.
Use [results and recovery](./results.md) to decide the appropriate next step.

The index and bundle are generated from public pages. Internal repository work
contracts are excluded; your project can keep its own instructions separately.
