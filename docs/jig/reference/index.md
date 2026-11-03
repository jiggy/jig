---
title: Jig reference
description: Look up settings, limits, troubleshooting guidance, vocabulary, application APIs, and exact host contracts.
---

# Reference

Find settings, limits, terms, troubleshooting guidance, and exact requirements here.
To create or extend an application, follow [Start here](../start/index.md) or [Build](../build/index.md).

## Everyday lookup

| Question | Reference |
| --- | --- |
| Can my host run Jig? | [Supported hosts](../start/index.md#supported-host) |
| Which settings can I change? | [Settings and configuration](./configuration.md) |
| What are the defaults and supported overrides? | [Limits](./limits.md) |
| What does a term mean? | [Glossary and questions](./glossary.md) |
| How do I interpret a run's result? | [Results](../build/results.md) |
| How do I diagnose a failure or recover safely? | [Troubleshooting](./troubleshooting.md) |
| What interface can my application call? | [Application client](../spec/execution-client.md) |

## Exact host contracts

Specifications define requirements for Jig's current provisional interfaces.
Reader guides explain how to use them without changing their authority.

| Area | Specifications | Practical guide |
| --- | --- | --- |
| Project declarations and execution | [Project authoring](../spec/project-sdk.md), [execution policy](../spec/project-policy.md) | [Project design](../build/design.md) |
| Resource authority | [Grants](../spec/grants.md) | [Files](../build/files.md), [HTTP](../build/http.md) |
| Application invocation and recovery | [Execution client](../spec/execution-client.md) | [Call from your application](../start/application.md) |
| Agent work | [Agent Run](../spec/agent-run.md), [Finite ACP](../spec/finite-acp.md) | [Add an Agent](../build/agents.md), [conversations](../build/conversations.md) |
| Network and commands | [HTTP Request](../spec/http-request.md), [Project Command](../spec/project-command.md) | [Delegate HTTP](../build/http.md), [tested patch](../examples/tested-patch.md) |
| Dependency-backed checks | [Project Evaluation](../spec/project-evaluation.md) | [Contact import](../examples/contact-import.md) |
| Generated declarations | [Contract authoring](../spec/contract-authoring.md) | [Author contracts](../build/contracts.md) |
| Messages and progress | [Channels](../spec/channels.md), [reporting](../spec/reporting.md) | [Live progress](../build/channels.md) |
| Retained output | [Run Checkpoint](../spec/run-checkpoint.md), [display archives](../spec/display-archive.md) | [Results](../build/results.md) |
| Terminal and browser presentation | [CLI experience](../spec/cli-experience.md), [web display](../spec/web-display.md) | [Configuration](./configuration.md) |

## Named capability contracts

The [contract directory](../contracts/index.md) explains identities and links to exact downloadable descriptors.
An identity page is documentation, rather than an invocation endpoint.
Fetching a descriptor grants no authority to execute its capability.

## Portable FLOW contracts

[FLOW specifications](https://flow.jig.md/spec/) own portable packages, invocation, values, schemas, and SDK meaning.
Jig's host contracts add local review, authority, and lifecycle around that independent boundary.
