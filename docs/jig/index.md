---
pageType: home
title: Jig — Accomplish more. Keep the controls.
description: Put reusable expertise to work with Agents you choose. Jig is a small open-source host for capable methods under your direction.
hero:
  name: Jig
  text: Accomplish more. Keep the controls.
  tagline: Put reusable expertise to work with Agents you choose. Combine capable methods, inspect their results, and decide what powers they can use.
  actions:
    - theme: brand
      text: Try a tested patch
      link: /guide/tested-patch
    - theme: alt
      text: See how Jig works
      link: /guide/understand
features:
  - title: Inherit a useful method
    details: Start with a procedure someone has already built. Read it, adapt it, and combine it with other specialists.
    icon: "↗"
  - title: Direct its powers
    details: Choose your Agents and providers. Review the work, constrain its access, and stop owned execution.
    icon: "◇"
  - title: Build on the result
    details: Use the outcome and inspect its evidence. Keep the method as a better starting point for the next task.
    icon: "↔"
---

<p className="story-label">Developer alpha · supported Linux hosts</p>

Jig is for people and applications that need useful work under meaningful
direction. [Check installation requirements](./guide/index.md#supported-host)
before running the examples.

## From a bug report to a patch you can review

The tested-patch example brings the idea down to a concrete task: repair a
small Bun project and return the proposed changes with the checks run against
them. Your original source stays unchanged.

<div className="story-grid">
  <section className="story-card"><span className="step">01 / DIRECT</span><h3>Define the work</h3><p>Supply the issue, permitted source files, and acceptance cases. Review the method and the powers it may use.</p></section>
  <section className="story-card"><span className="step">02 / EXECUTE</span><h3>Repair and check</h3><p>A specialist proposes changes. The application checks the original failure and candidate behavior against unchanged expectations.</p></section>
  <section className="story-card"><span className="step">03 / DECIDE</span><h3>Inspect the delivery</h3><p>Read the summary, patch, and execution evidence. You decide whether to apply the changes.</p></section>
</div>

The example's delivery includes `summary.txt`, `result.json`, and, when checks
pass, `review.patch`. A finite set of passing checks supports review; it does
not establish general correctness.

[Try the tested-patch application →](./guide/tested-patch.md)

## A small host. Room for your methods.

You do not need a dedicated Jig feature for every workflow method. Write the
procedure in ordinary code, use a graph library when it helps, and keep domain
rules in your application. Jig owns the execution boundaries that make those
choices governable.

| Part | Owns | Your freedom |
| --- | --- | --- |
| Your application | Purpose, user experience, and domain rules | Build the product your users need |
| A Flow | A reusable method, its prompts, checks, and internal control | Adapt and combine executable know-how |
| Jig | Accepted execution, authorized powers, limits, and cleanup | Direct and constrain delegated work |
| FLOW | The independent package and invocation standard | Share methods beyond one host |

A Flow can use an Agent where judgment helps and ordinary code where exactness
matters. A sophisticated method does not require a new host abstraction.

[Understand the architecture →](./guide/understand.md)

## Capability that becomes a better starting point

A useful method can outlive its first result. The tested-patch application's
batch example reuses the same repair specialist for two different projects.
The proposal workshop combines drafting and review over supplied evidence.
These examples show how methods can be assembled into applications.

The larger ambition is to let more people inherit, adapt, and improve capable
ways of working—so a small team can attempt work that would otherwise demand
more coordination. Each claimed gain still needs evidence from real use.

[Explore the proposal workshop](./guide/proposal-workshop.md) ·
[Meet FLOW, the independent standard](https://flow.jig.md/)

## Power under your control

Review the exact work that will run. Choose the Agents, credentials, and limits
it receives. Observe its results and request cancellation. Later source edits
need another review before they can execute.

Jig is open-source local software. Your source and policy remain inspectable
and editable. Remote Agents receive the data intentionally sent to them;
operator choice includes choosing providers suitable for that data.
Cancellation settles owned execution but cannot retract a remote request
already accepted or undo a completed external effect.

[Choose your Agent](./guide/agents.md) ·
[Understand review and execution](./guide/index.md#review-run-improve)

## Start with one useful outcome

[Create your first Flow](./guide/index.md), then change it and review the
result. When you are ready for an Agent-powered application, follow the
[tested-patch guide](./guide/tested-patch.md).

These are two starting paths: the greeting checks setup without an Agent; the
tested-patch application requires Agent configuration and its example workspace.
You can start directly with that application after meeting its prerequisites.

For builders: [compose methods](./guide/workflow-design.md),
[work with files](./guide/files.md), or
[look up the exact authoring contract](./spec/project-sdk.md).
