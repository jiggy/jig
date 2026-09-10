---
title: How Jig works
---

# How Jig works

Agents can produce work faster than you can review and coordinate it. A useful
application gives that work a procedure: what to attempt, which checks to run,
when to ask for another attempt, and when to return a result for a decision.

Jig runs reusable methods called **Flows**. A Flow can combine Agent judgment
with ordinary code, keeping its procedure explicit and callable. Jig supplies
the execution boundary around the method, so your application can build on it.

## Let code govern the procedure

In the [tested-patch application](./tested-patch.md), an Agent proposes source
changes. The repair method's code bounds attempts and requests execution of
the candidate against application-owned checks. A patch is offered when those
checks pass, with evidence the recipient can inspect before applying it.

This combines the flexibility of AI Agents with the discipline of a traditional
codebase. Code governs procedural choices, including ordering, validation, and
stopping conditions. Agent judgment contributes where generation or
interpretation helps. [Choosing a workflow structure](./workflow-design.md)
explains when a function, an Agent call, or an internal graph fits the work.

Running an explicit procedure does not guarantee a correct answer. Code can
have bugs, models can be wrong, and application checks can miss a defect. The
benefit is a procedure you can inspect, test, and direct, with evidence about
what happened. Uptime and disaster recovery are separate concerns.

## Four parts, distinct jobs

| Part | Responsibility |
| --- | --- |
| Application | Why the work exists, its user experience, and domain rules |
| Flow | How one reusable method performs its work |
| Jig | Which accepted work may run, with what powers, limits, and lifecycle |
| FLOW | The independent standard for packaging and invoking methods |

A runtime or graph library inside a Flow advances its own program. Jig does
not reconstruct that graph or make its nodes into host concepts. The operator
chooses Agents, providers, credentials, and execution policy.

## Why a small host can enable substantial work

A repair method can propose a change, execute checks through an authorized
capability, and bound its correction attempts. A proposal method can separate
drafting and review. Those procedures belong to their Flows and applications;
Jig need not add a repair engine or a proposal primitive.

This follows a microkernel-inspired idea: a small host owns essential execution
responsibilities while methods supply the behavior. You can change how a
method works without teaching Jig a new kind of application. The machinery
needed to enforce authority and settle execution can still be substantial;
small conceptual scope does not promise negligible overhead.

## Review once, run the accepted meaning

![Editable source is reviewed and approved before exact execution; Jig settles owned work before returning.](./review-run.svg)

`jig review` presents proposed changes for approval. `jig run` executes the
accepted revision. Editing visible source proposes a new version; it does not
silently change what has authority to run.

A model can choose within an authorized set or propose further work. Its
output cannot grant new permissions. Applications and their authority owners
decide which consequential actions are delegated.

Jig validates protocol results and declared schemas, and accounts for owned
execution through completion, failure, and cancellation. Your application
checks whether the result satisfies its domain requirements. A remote request
already accepted cannot be retracted by stopping its local caller. Read
[execution policy](../spec/project-policy.md)
for exact guarantees and [the quickstart](./index.md) for the everyday loop.

## Keep the method, change the application

The [tested-patch example](./tested-patch.md) reuses its repair specialist for
two projects. Application-owned input capture, checks, and delivery surround
the method. The [proposal workshop](./proposal-workshop.md) gives another
example of combining specialists around a useful result.

These examples show how a method can contribute to further work. The intended
gain is more achievable capability without a proportional increase in
supervision; establishing that gain requires evaluating the application.

Jig's core idea is **agency**: the ability to pursue a purpose and accomplish
useful work. Its promise, **power under control**, applies to this everyday
process of building: understand the methods, choose their powers, run an
accepted revision, inspect the outcome, and change or stop the work. People,
applications, and software subsystems can act within delegated authority.

## Where FLOW fits

[FLOW](https://flow.jig.md/) is the independent standard, and a **Flow** is one
method packaged according to it. FLOW defines portable meaning; Jig supplies
host policy. FLOW can serve hosts besides Jig.

The name Jig draws on a physical jig: a tool that guides repeatable work
without becoming the thing being made. The product similarly helps you build
and refine the methods that do your work.

[Create your first Flow →](./index.md)
