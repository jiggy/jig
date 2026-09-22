---
title: Agent Run contract
description: What the Agent Run contract ID means, how Flows use it, and where to find its descriptor and instructions.
---

# Agent Run contract

Agent Run lets a Flow ask an operator-selected Agent for a bounded response.
The Flow supplies instructions, any selected package-local Skills, and an
optional structured-result schema. The operator chooses the Agent, model,
credentials, and endpoint.

The ordinary HTTP and native [Agent Flows](../guide/agent-method.md)
share this interface. Selected Skill contents are explicit caller data, not
host-attested provenance. Consumers independently check structured answers;
the operator chooses an implementation and grants its required resources.

## Why did this address bring me here?

`https://jig.md/contracts/agent-run` identifies the shared **interface**, not
an Agent server or an API endpoint. You may have found it in a
`FLOW.contract.json` file inside a Flow package.

That file is a local copy of the interface the Flow expects, not a new Agent
implementation. Jig matches its contract ID, exact version, and canonical
descriptor digest against the selected Flow implementation. Copying the file does
not provide an Agent or grant permission to use one.

The descriptor also names optional `events`, `conversation`, and `sessions`
behavior. Implementations declare what they support; callers declare what they
require. Jig can reject mismatching declarations before a caller starts, but
matching claims establish neither implementation honesty nor resource authority.
The [feature definitions](../spec/agent-run.md#declare-required-agent-behavior)
explain the separate turn, retention and execution limits.

This page is an explanatory guide. Jig does not fetch it to resolve an
invocation, and changing this page does not change the contract. Matching uses
the package-local descriptor offline. The ID names the contract across
versions; the descriptor carries the version and exact interface.

## Where to go next

- **Use the invocation:** read the [Agent Run specification](../spec/agent-run.md)
  for request and result fields, Skills, limits, and failure behavior.
- **Configure an Agent:** follow the
  [Agent configuration guide](../guide/agents.md).
  Do not use this contract ID as your provider's base URL.
- **Get the interface file:** download the
  [Agent Run JSON descriptor](https://jig.md/contracts/agent-run/contract.json).
  Keep its referenced [events](https://jig.md/contracts/agent-run/contracts/acp-public-updates.json),
  [commands](https://jig.md/contracts/agent-run/contracts/agent-commands.json), and
  [replies](https://jig.md/contracts/agent-run/contracts/agent-replies.json)
  descriptors beside it under `contracts/`, preserving their filenames. Copy
  the complete bundle into the Flow package and reference the invocation descriptor from
  `flow.meta.json` (or Markdown frontmatter), as the specification shows.
- **See it in an application:** try the
  [support-case application](../guide/support-case.md).
- **Continue or restore work:** read [Agent conversations](../guide/conversations.md).
  Native restoration is a source candidate requiring a separately reviewed
  retention grant and a single-use reference. Its receipt appears only in the
  final invocation output; an individual answer does not prove retention.
- **Understand contract matching:** read
  [FLOW Invocation Contract/1](https://flow.jig.md/spec/invocation-contracts).

The interface is a prerelease candidate. Check the specification and your
installed host's supported contract before adopting a descriptor update.
An Agent response is not proof that its claims are true; application checks
and the operator's data policy still matter.
