---
title: Agent Run contract
description: What the Agent Run contract ID means, how Flows use it, and where to find its descriptor and instructions.
---

# Agent Run contract

Agent Run lets a Flow ask an operator-selected Agent for a bounded response.
The Flow supplies instructions, any selected package-local Skills, and an
optional structured-result schema. The operator chooses the Agent, model,
credentials, and endpoint.

## Why did this address bring me here?

`https://jig.md/contracts/agent-run` identifies the shared **interface**, not
an Agent server or an API endpoint. You may have found it in a
`*.capability.json` file inside a Flow package.

That file is a local copy of the interface the Flow expects, not a new Agent
implementation. Jig matches its contract ID, exact version, and canonical
descriptor digest against supported host capabilities. Copying the file does
not provide an Agent or grant permission to use one.

This page is an explanatory guide. Jig does not fetch it to resolve a
capability, and changing this page does not change the contract. Matching uses
the package-local descriptor offline. The ID names the contract across
versions; the descriptor carries the version and exact interface.

## Where to go next

- **Use the capability:** read the [Agent Run specification](../spec/agent-run.md)
  for request and result fields, Skills, limits, and failure behavior.
- **Configure an Agent:** follow the
  [host configuration instructions](../spec/agent-run.md#alpha-host-implementations).
  Do not use this contract ID as your provider's base URL.
- **Get the interface file:** download the
  [Agent Run JSON descriptor](https://jig.md/contracts/agent-run.capability.json).
  Keep an exact copy in the Flow package and reference that local file from
  `FLOW.md`, as the specification shows.
- **See it in an application:** try the
  [proposal workshop](../guide/proposal-workshop.md).
- **Understand contract matching:** read
  [FLOW Capability Contract/1](https://flow.jig.md/spec/capability-contracts).

The interface is a prerelease candidate. Check the specification and your
installed host's supported contract before adopting a descriptor update.
An Agent response is not proof that its claims are true; application checks
and the operator's data policy still matter.
