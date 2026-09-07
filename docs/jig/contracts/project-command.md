---
title: Project Command contract
description: What the Project Command contract ID means, how command authority is supplied, and where to find its descriptor and instructions.
---

# Project Command contract

Project Command lets a Flow run an operator-reviewed Bun entrypoint or tests
against supplied project files in containment. It returns captured output and
termination evidence. The application decides whether that evidence establishes
the result it needs.

## Why did this address bring me here?

`https://jig.md/contracts/project-command` identifies the shared **interface**,
not a command server, a shell, or permission to run arbitrary programs. You may
have found it in a `*.capability.json` file inside a Flow package.

That file is a local copy of the interface the Flow expects. Jig matches its
contract ID, exact version, and canonical descriptor digest against supported
host capabilities. The operator separately supplies permitted commands in a
Binding and approves them through project review. The descriptor alone grants
no command authority.

This page is an explanatory guide. Jig does not fetch it to resolve a
capability, and changing this page does not change the contract. Matching uses
the package-local descriptor offline. The ID names the contract across
versions; the descriptor carries the version and exact interface.

## Where to go next

- **Authorize and call a command:** read the
  [Project Command specification](../spec/project-command.md) for Binding
  settings, supported inputs, resource limits, and collected results.
- **Get the interface file:** download the
  [Project Command JSON descriptor](https://jig.md/contracts/project-command.capability.json).
  Keep an exact copy in the Flow package and reference that local file from
  `FLOW.md`, as the specification shows.
- **See it in an application:** follow
  [an issue becoming a tested patch](../guide/tested-patch.md).
- **Understand contract matching:** read
  [FLOW Capability Contract/1](https://flow.jig.md/spec/capability-contracts).

The interface is a prerelease candidate. Check the specification and your
installed host's supported contract before adopting a descriptor update.
A command's completion is not proof of a correct patch. This capability does
not authorize package installation, arbitrary network access, editing the
original repository, or merging changes.
