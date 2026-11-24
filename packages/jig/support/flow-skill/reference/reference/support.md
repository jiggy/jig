---
title: Hosts, runtimes, and SDKs
description: Choose an execution path by separating language support, SDK availability, and a host's qualified implementations.
---

# Hosts, runtimes, and SDKs

FLOW supports any `FLOW.<ext>` implementation that meets its package and invocation requirements.
Your host determines which runtimes it can launch and which powers it supplies.

Choose the host before relying on a language example.
Then use the SDK or interpreter revision that host qualifies.

## Supporting hosts

| Host | Current alpha implementations | Setup and requirements |
| --- | --- | --- |
| [Jig](https://jig.md/) | `FLOW.ts` through Bun, and `FLOW.md` through its Markdown interpreter. | [Jig's supported host and first run](https://jig.md/guide/#supported-host) |

Jig's current alpha accepts `FLOW.ts` and `FLOW.md`.
Python SDK availability does not establish Jig support for `FLOW.py`.
Check the host's selected release for runtime, platform, dependency, and authority requirements.

Building another host? Follow [Implement FLOW](https://flow.jig.md/implement/) and state the implementations your host actually qualifies.

## SDKs and interpreters

| Implementation | Component runtime | SDK or interpreter | Execution requirement |
| --- | --- | --- | --- |
| Markdown | A host's Markdown interpreter and Agent | Markdown/0, implemented by Jig | Support for the profile, reasoning dependency, and required grants. |
| TypeScript | Bun, or Node with suitable TypeScript support | npm `@jigging/flow@alpha` | A host that supports the selected runtime and package dependencies. |
| JavaScript | Node or Bun | npm `@jigging/flow@alpha` | A host that accepts the implementation and prepares its dependencies. |
| Python | Python 3.11 or newer | PyPI `jiggy-flow`, installed with `--pre` | A host that supports Python and the package's dependencies. |
| Another language | Its executable runtime | Implement Run/0 directly or provide an SDK | Qualify the protocol and the host's launch path. |

The TypeScript SDK also serves JavaScript.
Node's direct TypeScript execution depends on its version and supported syntax.
Consult [Node's TypeScript documentation](https://nodejs.org/api/typescript.html) when choosing that runtime.

An SDK serves the component side of the exchange.
Running an implementation alone still requires a host invocation on its protocol input.
An SDK smoke test qualifies neither a production host nor its containment guarantees.

## Choose how the method works

Code can perform known steps, request Agent judgment, or combine both.
The current Markdown/0 profile always uses bounded Agent interpretation and advances sequentially.
These choices preserve the calling boundary while allowing different behavior, costs, latency, and required powers.

Start with the [authoring guides](https://flow.jig.md/build/), or read [Skill compatibility](skill-compatibility.md) before adapting existing instructions.
To add language support, follow [Implement an SDK](https://flow.jig.md/implement/sdk).

The source interface may be newer than a published package.
Use a qualified revision and report missing support directly.
