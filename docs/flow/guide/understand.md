---
title: Why FLOW exists
---

# Code and Agents. One way to compose them.

Skills give Agents instructions and resources for useful work. You can use
that work as part of your software, alongside ordinary code: one method
interprets a request, another checks a record, another prepares a response.
FLOW gives you a way to call and combine these methods through the same
interface, whether their implementation uses intelligence, code, or both.

**FLOW gives code and Agent work one method boundary.** A **Flow** packages a
reusable procedure. When executable, it accepts input and returns a defined
outcome and result. Its implementation can use code, Agent judgment, or both.
The caller works with the method's contract.

## One caller, three implementations

Consider an application that needs a suggested support queue for an incoming
request. Its classifier accepts a message and returns `billing`, `technical`,
or `manual`. The caller does not need a separate orchestration model for an
intelligent implementation.

| Inside the classifier | How it works | What the caller receives |
| --- | --- | --- |
| Code | Recognize explicit labels; otherwise suggest manual classification | An outcome and queue suggestion |
| Agent | Ask an Agent to interpret the message | The same result shape |
| Code and Agent | Recognize labels directly; ask an Agent for other messages | The same result shape |

All three can contribute at the same compositional level. The mixed method
adds interpretation without asking its caller to coordinate a conversation.
The code method runs without an Agent interpreting instructions first.

The [complete example on Jig](https://jig.md/guide/request-triage) contains the
same caller with three configured implementations. That is a concrete host
example; Jig's configuration and Agent capability are not FLOW requirements.
Shared result shape does not guarantee matching answers, costs, latency, or
required powers. Those remain part of choosing and evaluating a method.

## From a Skill to an executable method

A Skill is a useful place to capture how an Agent should work. FLOW brings
that readable guidance together with a defined execution boundary, so the
method can also become a building block in software.

An instructions-only Flow can hold guidance and resources. Add an executable
entrypoint such as `flow.ts` or `flow.py`, and a compatible host can invoke it
directly. The program decides where ordinary procedure is sufficient and where
to request interpretation. It can use existing Skills during Agent work.

Skills can bundle scripts, and code can invoke those scripts directly too.
FLOW's contribution is a common package and invocation contract around the
complete method. A Markdown rename alone does not create an executable Flow;
[Package/1](../spec/package-format.md) defines valid metadata and implementations.

## Let capability build on capability

The classifier can become one part of a larger intake method. Another method
might look up supplied account records or prepare a draft response. Each has
an input, an outcome, and a result the next method can use. The application
owns their ordering, checks, and consequences.

This is **capability compounding**: useful methods become the means to do more
together. A method can gain checks, replace a reasoning step with code, or
combine further specialists while preserving its caller-facing contract.
Consumers can build on that work without adopting its internal framework.
Changing an implementation still requires the receiving host's applicable
review and authorization.

Composition makes improvement possible; evaluation establishes whether it
helped. A faster classifier may make worse decisions. A more capable method
may require broader powers. Reuse carries assumptions as well as capability.

## A small boundary, room for the method

FLOW specifies what a package means and how finite work crosses its boundary.
It leaves the method's internal control to its implementation.

![A Flow package exposes readable meaning, input, and outcomes. Its runtime owns internal execution; the host supplies authorized capabilities.](./flow-boundary.svg)

| Layer | Owns |
| --- | --- |
| Flow method | Procedure, prompts, selected Skills, validation, and internal control |
| FLOW standard | Package meaning, portable values, invocation, outcomes, and optional interoperability contracts |
| Host | Supported execution, local powers, providers, credentials, and policy |
| Application | Purpose, domain checks, and what happens with the result |

This separation is why FLOW is independent of Jig, Agent vendors, and any one
runtime. A method can use a plain program or a graph library without making
that internal model its caller's responsibility. Different hosts may support
different implementations; portability does not imply universal support.

For us, **AI-native composition** means code and Agent judgment can participate
through the same executable method boundary. The work inside can evolve while
the rest of the system keeps a coherent way to build with it.

[Build your first Flow](./start.mdx), or open the
[specification map](./index.md) to implement the boundary itself.
