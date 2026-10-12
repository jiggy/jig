---
title: FLOW documentation
description: A complete task map for authors, host implementers, SDK builders, and agents using FLOW.
---

# Build on reusable know-how

FLOW is the independent standard for packaging and invoking reusable methods.
A **Flow** puts code, Agent judgment, or both behind one method boundary.
A compatible host supplies local powers.

<div className="reader-grid">
<a className="reader-card" href="/guide/start"><span className="tile-index">AUTHOR A METHOD</span><h3>Build your first Flow.</h3><p>Choose a language and a compatible host. Understand the package and handler boundary.</p><span className="card-link">Start building ↗</span></a>
<a className="reader-card" href="/guide/"><span className="tile-index">IMPLEMENT THE STANDARD</span><h3>Find the exact contract.</h3><p>Work from the public package, values, protocol, SDK, and interoperability specifications.</p><span className="card-link">Open the specification map ↗</span></a>
<a className="reader-card" href="/guide/understand"><span className="tile-index">UNDERSTAND THE DESIGN</span><h3>Keep the boundary small.</h3><p>See why implementation freedom and locally supplied authority matter to reuse.</p><span className="card-link">Why FLOW exists ↗</span></a>
<a className="reader-card" href="/guide/for-agents"><span className="tile-index">FOR AGENTS</span><h3>Read the source of truth.</h3><p>Fetch focused Markdown or the full public bundle, without adopting host-specific assumptions.</p><span className="card-link">Get the context ↗</span></a>
</div>

## Find your task

| I want to… | Read |
| --- | --- |
| See code and Agent work compose through one boundary | [Understand FLOW](./understand.md), then [the Jig example](https://jig.md/guide/request-triage) |
| Package a reusable procedure | [Start building](./start.mdx), then [Package/0](../spec/package-format.md) |
| Write a Markdown method with inputs, child calls and outcomes | [Markdown authoring](./markdown.md) |
| Bring an existing Skill and understand execution differences | [Skill compatibility](./skills.md) |
| Write TypeScript or JavaScript and exercise the protocol | [TypeScript / JavaScript SDK guide](./typescript.md) |
| Write a Python method and exercise the protocol | [Python SDK guide](./python.md) |
| Check runtime support matrix or implement a new SDK | [Runtimes and SDKs](./runtimes.md) |
| Implement a FLOW host or integrate with coding agents & ACP | [Host and platform integration](./platforms.md) |
| Write TypeScript under a qualified Jig build | [Jig's first Flow](https://jig.md/guide/) |
| Understand portable input and output values | [JSON/0](../spec/json-values.md) |
| Validate inputs, settings, or results | [Schema/0](../spec/schema-files.md) |
| Launch a method or implement a host | [Run/0](../spec/run-protocol.md) |
| Implement or use an SDK | [Run SDK/0](../spec/run-sdk.md) |
| Define an independently maintained invocation interface | [Invocation Contract/0](../spec/invocation-contracts.md) |
| Define exact live-message meaning | [Channel Contract/0](../spec/channel-contracts.md) |
| Resolve terminology or a common question | [Concepts and questions](./concepts.md) |

## What belongs to a host?

Providers, credentials, permission, containment, and local execution support
are host decisions. FLOW does not make those choices for the consumer.
[Jig](https://jig.md/) documents one host; a host's supported languages are
separate from the languages with FLOW SDKs.

## How to read this documentation

The sidebar keeps authoring, explanation, and exact reference visible from every
page. Use search for a field or concept, and the outline to jump within a long
specification. Copy Markdown when you need the page in an Agent's context.

The standard is prerelease. An SDK candidate in source is not necessarily a
published package. Authoring guides identify their execution prerequisites;
implementers should qualify a concrete revision against the public
[conformance material](https://github.com/jiggy/jig/tree/main/conformance/run-0).
