---
title: Why FLOW exists
---

# Why FLOW exists

You've taught an Agent how to do useful work. A Skill might guide it through
drafting a proposal, reviewing evidence, or repairing code. To build an
application from that work, you also need a method your program can call,
check, and combine with other methods.

FLOW brings readable instructions and executable code into one package model.
A **Flow** packages one method; an executable Flow gives callers a defined
input, outcome, and result. It can use ordinary code, Agent judgment, or both.

## From a Skill to a callable method

Every Flow includes `FLOW.md` to describe the method. It can keep instructions,
Skills, and resources alongside an implementation such as `flow.ts` or
`flow.py`. A compatible host invokes that implementation directly: no model
needs to interpret the Markdown first to decide what to run.

This makes the procedure available to ordinary code. Your program can call a
method, validate the returned result, branch on its outcome, and decide what
happens next. The method can request Agent judgment at the steps that need it.

[Skills can also include executable scripts](https://agentskills.io/specification#scripts),
and those scripts can be called directly. FLOW adds a shared package and
invocation contract for the method.
An instructions-only Flow remains useful as guidance; it needs an implementation
before it can execute. Exact package requirements belong in
[Package/1](../spec/package-format.md).

## Build a larger capability from the pieces

The [proposal workshop](https://jig.md/guide/proposal-workshop) is an authored
example hosted by Jig. Its drafting Flow uses a Skill to guide an Agent. A
coordinating Flow calls the drafter, checks requirement coverage and source IDs
in code, and sends the draft to a separate reviewing Flow. Code permits at most
one revision and returns an explicit outcome with the available evidence.

The Agent contributes drafting or review judgment. The program governs the
handoffs, mechanical checks, and stopping conditions. Each specialist is a
callable method that can contribute to another application with suitable
inputs. Their composition gives the proposal workshop its procedure.

This is FLOW's core idea, **capability compounding**: useful methods become
building blocks for work that would be harder to accomplish separately. Its
shared aspiration with Jig is to expand human possibility by making useful
work achievable for more people.

## Keep the boundary small

![A Flow package keeps its method; a compatible host supplies local execution authority through Run/1.](./flow-boundary.svg)

| FLOW defines | The receiving host supplies | The method keeps |
| --- | --- | --- |
| Package meaning and portable values | Supported implementations and launch policy | Domain logic and internal runtime |
| Finite invocation and outcomes | Permissions, credentials, limits, and cleanup | Prompts, Skills, validation, and stopping rules |
| Optional exact interoperability contracts | Local provider and infrastructure choices | Application-specific know-how |

Executable packages use Run/1 for a finite process exchange. The method keeps
its libraries, Skills, and any internal graph. Schemas and exact contracts earn
their place when consumers need validation or independently maintained
interfaces; a complex procedure
does not automatically need every optional mechanism.

The boundary accepts process overhead and less universal visibility into
internal graphs in exchange for runtime and host independence. The
[specification map](./index.md) owns exact requirements.

## Independence is part of the value

FLOW does not require Jig, a mandatory registry, a model provider, or one
programming language. Each host states which implementations it can actually
run. A shared protocol alone cannot guarantee identical results or support on
every host.

Methods carry meaning, not the authority of their authors. A receiving host
supplies local permission to use its powers. [Jig](https://jig.md/) is one host
that makes those decisions explicit through review and accepted execution.

## Compounding has to be earned

An explicit procedure makes its steps inspectable and programmable. It does
not establish that every Agent answer is correct or that adding a reviewer
improves the outcome. The workshop demonstrates composition; evaluating its
benefit requires comparing results, review effort, cost, and latency for the
work you need to accomplish.

Useful checks depend on the application, and methods must be evaluated as
models, data, and conditions change. FLOW supplies the boundary; practitioners
establish which methods and combinations make more work achievable.

[Start building a Flow →](./start.mdx)
