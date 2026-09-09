---
title: Documentation for agents
description: Read FLOW's exact public meaning as Markdown, with an index and complete bundle generated from the documentation.
---

# Read FLOW as Markdown

Agents and developers share the same public source of truth. Each page has a
plain-text Markdown version, and the site publishes a generated index and
full-content bundle. Reading them requires no account or API key.

| Resource | Use it for |
| --- | --- |
| [Documentation index](https://flow.jig.md/llms.txt) | Discover the relevant guide or exact contract |
| [Full documentation](https://flow.jig.md/llms-full.txt) | Read the whole site when your context budget permits |
| [Task map as Markdown](https://flow.jig.md/guide/overview.md) | Select a path for authoring or implementation |
| [Specification map as Markdown](https://flow.jig.md/guide/index.md) | Find every normative boundary |

**Copy Markdown** copies the page content. **View Markdown** opens its
plain-text version. The HTML page `/spec/run-protocol` corresponds to
`/spec/run-protocol.md`.

## A focused starting instruction

```text title="Documentation context"
Read https://flow.jig.md/llms.txt and fetch the pages relevant to my task.
Use the exact public specification for package or protocol requirements.
Keep FLOW independent of host admission, providers, credentials, and policy.
Distinguish SDK availability from a host's supported implementations.
Do not infer permission to execute from a package's declared capabilities.
Validate against the public conformance material for the selected revision.
```

These instructions supply context, not execution authority. The consumer and
receiving host remain responsible for their powers.

## Choose only the context you need

- **Package author:** [authoring path](./start.mdx), [Package/1](../spec/package-format.md), and your SDK guide.
- **Host implementer:** [Run/1](../spec/run-protocol.md), [JSON/1](../spec/json-values.md), and the public conformance corpus.
- **SDK implementer:** [Run SDK/1](../spec/run-sdk.md) together with Run/1.
- **Interface author:** [capability contracts](../spec/capability-contracts.md) or [channel contracts](../spec/channel-contracts.md).

Jig's operator configuration belongs in [Jig's documentation](https://jig.md/guide/for-agents).
It is not a portable FLOW requirement.

## Check meaning before assuming support

The specifications are prerelease. A source SDK candidate may not yet be
published, and a host may support only a subset of implementations. Use a
qualified revision and report missing support directly.

The public Markdown includes explanatory pages and normative specifications;
the latter define exact requirements. The site does not include internal
repository instructions or transfer a method author's authority to its reader.
