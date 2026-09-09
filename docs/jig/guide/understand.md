---
title: How Jig works
---

# How Jig works

Jig's core idea is **agency**: the ability to pursue a purpose and accomplish
useful work. Its promise is **power under control**. People, applications, and
software subsystems can delegate work while the responsible operator retains
direction over its powers.

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

This is architectural minimalism: keep each responsibility with its owner,
and keep the public concepts proportional to the work. The machinery needed
to enforce authority and settle execution can still be substantial. Small
conceptual scope does not promise trivial installation or negligible overhead.

Use ordinary code for exact operations. Add an Agent where interpretation or
generation helps. Add a graph when its structure helps you inspect, test, or
reuse the procedure. [Choosing a workflow structure](./workflow-design.md)
explains these decisions.

## Review once, run the accepted meaning

![Editable source is reviewed and approved before exact execution; Jig settles owned work before returning.](./review-run.svg)

`jig review` presents proposed changes for approval. `jig run` executes the
accepted revision. Editing visible source proposes a new version; it does not
silently change what has authority to run.

A model can choose within an authorized set or propose further work. Its
output cannot grant new permissions. Applications and their authority owners
decide which consequential actions are delegated.

Jig validates results and accounts for owned execution through completion,
failure, and cancellation. A remote request already accepted cannot be
retracted by stopping its local caller. Read [execution policy](../spec/project-policy.md)
for exact guarantees and [the quickstart](./index.md) for the everyday loop.

## Keep the method, change the application

The [tested-patch example](./tested-patch.md) reuses its repair specialist for
two projects. Application-owned input capture, checks, and delivery surround
the method. The [proposal workshop](./proposal-workshop.md) gives another
example of combining specialists around a useful result.

These are concrete starting points for reuse. The wider ambition is that
builders can inherit increasingly capable methods. Establishing that gain
requires evaluating the methods and applications that use them.

## Where FLOW fits

[FLOW](https://flow.jig.md/) is the independent standard, and a **Flow** is one
method packaged according to it. FLOW defines portable meaning; Jig supplies
host policy. FLOW can serve hosts besides Jig.

The name Jig draws on a physical jig: a tool that guides repeatable work
without becoming the thing being made. The product similarly helps you build
and refine the methods that do your work.

[Create your first Flow →](./index.md)
