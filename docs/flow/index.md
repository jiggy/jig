---
pageType: home
title: FLOW — Give the next builder a better starting point.
description: FLOW is an open, independent standard for sharing executable know-how. Package useful methods so others can run, adapt, and combine them.
hero:
  name: FLOW
  text: Give the next builder a better starting point.
  tagline: Turn a useful way of working into a method others can run, adapt, and combine. FLOW is an open, independent standard for sharing executable know-how.
  actions:
    - theme: brand
      text: Start building
      link: /guide/start
    - theme: alt
      text: Explore the standard
      link: /guide/
features:
  - title: Capture the method
    details: Share the procedure behind an outcome—its code, instructions, checks, and resources—in a readable package.
    icon: "◫"
  - title: Keep your implementation
    details: Use ordinary code or your chosen runtime. FLOW defines the exchange at the boundary, leaving internal control with the method.
    icon: "↔"
  - title: Let others build further
    details: Consumers can inspect, adapt, and combine the method without adopting its author's entire application or provider arrangements.
    icon: "↗"
---

<p className="story-label">Open standard · prerelease specifications</p>

## Share how the work gets done

A report gives someone an answer. A reusable research method can also preserve
how sources are gathered, claims checked, and uncertainty reported. Another
builder can adapt that procedure or combine it with a different method.

That is FLOW's core idea: **capability compounding**. Useful know-how becomes
a starting point for further capability. Reuse creates the opportunity;
evaluation establishes whether the result is better.

<div className="story-grid">
  <section className="story-card"><span className="step">01 / CAPTURE</span><h3>Package one method</h3><p>Describe its purpose and keep the implementation, instructions, and resources together in ordinary files.</p></section>
  <section className="story-card"><span className="step">02 / APPLY</span><h3>Use it elsewhere</h3><p>A compatible host supplies the invocation and local powers. The method keeps its own implementation.</p></section>
  <section className="story-card"><span className="step">03 / BUILD FURTHER</span><h3>Evaluate and share</h3><p>Check the outcome, adapt what needs changing, and give the next consumer a useful starting point.</p></section>
</div>

Research illustrates the ambition; it is not a claim that a packaged method
inherits expert accuracy or improves automatically.

## Small at the boundary. Flexible inside.

A **Flow** is a package containing one reusable method. Every package has a
`FLOW.md` describing it; executable methods add their implementation and any
schemas or resources they need.

For executable Flows, **Run/1** defines one finite exchange: receive input,
perform bounded work, and return an outcome with data. The implementation may
use a plain program or a runtime of its author's choosing.

```ts
import { handle } from "@jigging/flow";

await handle(async (run) => {
  return { outcome: "done", output: { received: run.input } };
});
```

This is the TypeScript handler boundary. A compatible host launches it and
supplies the protocol invocation; [the authoring path](./guide/start.md)
explains the surrounding package and SDK setup.

[Understand the boundary →](./guide/understand.md)

## Methods travel. Authority stays local.

FLOW defines portable package and invocation meaning. The receiving host
chooses which implementations it supports and supplies local authority,
credentials, execution limits, and lifecycle policy.

That separation lets a method travel without carrying its author's permissions
with it. It also keeps FLOW independent of Jig, a mandatory registry, any
particular model provider, and the method's internal framework. Portability
requires compatible implementations; it does not mean every package runs on
every host.

[Jig](https://jig.md/) is one host. You can implement another against the public
specifications and conformance material without adopting Jig's policy model.

## Choose your next step

| Your task | Start here |
| --- | --- |
| Package a reusable method | [Start building](./guide/start.md) |
| Implement a Python method | [Python SDK guide](./guide/python.md) |
| Understand the design | [Why this boundary exists](./guide/understand.md) |
| Implement a host or SDK | [Specification map](./guide/index.md) |
| Run methods with Jig | [Jig's getting-started guide](https://jig.md/guide/) |

FLOW's ambition is to make useful capability easier to inherit. Its standard
provides the exchange; builders and consumers establish what is worth sharing.
