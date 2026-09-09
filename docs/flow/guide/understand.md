---
title: Why FLOW exists
---

# Why FLOW exists

FLOW's core idea is **capability compounding**: useful methods become a
starting point for further capability. Its shared aspiration with Jig is to
expand human possibility by making useful work achievable for more people.

## Inherit the procedure

A method can preserve more than an answer: how evidence is gathered, work is
coordinated, results are checked, and stopping conditions are applied. Others
can use that procedure, adapt it, or combine it with another specialist.

A **Flow** packages one such method. FLOW provides a shared package and
invocation boundary so reuse need not require the author's whole application.
The method may include Skills, libraries, tools, and an internal graph. Its
value comes from useful work those parts enable together.

## Keep the boundary small

![A Flow package keeps its method; a compatible host supplies local execution authority through Run/1.](./flow-boundary.svg)

| FLOW defines | The receiving host supplies | The method keeps |
| --- | --- | --- |
| Package meaning and portable values | Supported implementations and launch policy | Domain logic and internal runtime |
| Finite invocation and outcomes | Permissions, credentials, limits, and cleanup | Prompts, Skills, validation, and stopping rules |
| Optional exact interoperability contracts | Local provider and infrastructure choices | Application-specific know-how |

Every package includes `FLOW.md`. Executable packages use Run/1 for a finite
process exchange. Schemas and exact contracts earn their place when consumers
need validation or independently maintained interfaces; a complex procedure
does not automatically need every optional mechanism.

The boundary accepts process overhead and less universal visibility into
internal graphs in exchange for runtime and host independence. The
[specification map](./index.md) owns exact requirements.

A description-only package can share readable guidance and resources. Without
an implementation, it cannot itself execute a Run/1 invocation.

## Independence is part of the value

FLOW does not require Jig, a mandatory registry, a model provider, or one
programming language. Each host states which implementations it can actually
run. A shared protocol alone cannot guarantee identical results or support on
every host.

Methods carry meaning, not the authority of their authors. A receiving host
supplies local permission to use its powers. [Jig](https://jig.md/) is one host
that makes those decisions explicit through review and accepted execution.

## Compounding has to be earned

Applying a good method in a new setting or combining methods can make more
work achievable. Copying packages does not establish that benefit. Evaluation
must account for changing models, data, assumptions, and operating conditions.

FLOW enables the exchange. Practitioners establish which methods are worth
inheriting and which revisions improve them.

[Start building a Flow →](./start.md)
