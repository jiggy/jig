---
pageType: home
title: Turn Agent skills into applications.
description: Bring Agent instructions and executable code into one package model. Call and combine methods to build more capable applications with FLOW.
hero:
  name: FLOW
  eyebrow: Capability compounding
  text: "Turn Agent skills\ninto applications."
  tagline: You've taught an Agent how to do useful work. FLOW brings instructions and executable code into reusable methods called Flows, so you can build a system from what they can do.
  status: Open standard · prerelease specifications
  statusLink: /guide/
  actions:
    - theme: brand
      text: Build your first Flow
      link: /guide/start
    - theme: alt
      text: Explore the standard
      link: /guide/
features:
  - title: Package a method
    details: Keep its instructions and code together.
  - title: Call it directly
    details: Executable steps need no Agent.
  - title: Build with it
    details: Combine methods into an application.
showcase:
  label: From a drafting Skill to a workshop
  title: Put drafting, checks, and review to work together.
  description: A proposal needs more than a first draft. In the proposal-workshop example, a coordinating Flow calls a drafter, checks its output in code, and calls a separate reviewer. Each specialist uses its own Agent instructions.
  note: Illustrative view of the authored proposal-workshop example, which runs on Jig. This page executes no Flows.
  link: https://jig.md/guide/proposal-workshop
  linkText: Follow the complete example
  stages:
    - name: Package
      title: Give the drafting Skill an executable method.
      description: The drafter keeps its Skill alongside an implementation. FLOW.md explains the method; flow.ts supplies the entrypoint another program can invoke.
      file: Selected files in the drafter package
      code: |-
        drafter/
        ├── FLOW.md
        ├── flow.ts
        └── skills/
            └── grounded-drafting/
                └── SKILL.md
      tags: [Readable purpose, Agent instructions, Executable entrypoint]
    - name: Compose
      title: Let code coordinate the specialists.
      description: The workshop invokes the methods directly. Code checks requirement coverage and source IDs, and permits at most one revision. A model does not have to interpret those procedural steps.
      file: Workshop procedure (summary)
      code: |-
        Supplied objective and evidence
          → call the drafting Flow
          → check coverage and source IDs
          → call the reviewing Flow
          → finish or request one revision
      tags: [Direct invocation, Mechanical checks, Bounded revision]
    - name: Result
      title: Return an outcome the application can use.
      description: A proposal that passes the checks and review is returned with its evidence. Blocked or exhausted work has its own outcome. Agent review remains advisory; the recipient decides whether to act.
      file: Application outcomes (summary)
      code: |-
        done
          proposal + review + history
        blocked
          available work + reason
        limit
          available work + reason
      tags: [Defined outcomes, Retained feedback, Explicit next decision]
---

<section className="statement">
<p className="eyebrow">From instructions to execution</p>
<h2>The workshop calls methods<br />as steps in a program.</h2>
<p>The drafting Skill still guides an Agent. The workshop's code can invoke the drafting Flow directly, then check its result and pass it to the reviewer. Its procedure does not depend on an Agent reading the whole workflow and reconstructing each handoff.</p>
<p>That is the connection FLOW adds: readable guidance and executable behavior fit within one package model. A Flow can run ordinary code throughout or bring in Agent judgment where useful.</p>
<a className="text-link" href="/guide/understand">Understand the method boundary <span aria-hidden="true">↗</span></a>
</section>

<div className="ownership-grid">
<section><span className="tile-index">01 / DESCRIBE</span><h3>Explain the method in FLOW.md.</h3><p>Keep its purpose and instructions readable, with the resources it needs. A package can contain guidance alone.</p></section>
<section><span className="tile-index">02 / IMPLEMENT</span><h3>Add code that can be called.</h3><p>An entrypoint such as flow.ts or flow.py receives input and returns a result through FLOW's invocation protocol. An Agent is optional.</p></section>
<section><span className="tile-index">03 / COMPOSE</span><h3>Use the result in your program.</h3><p>Connect methods with ordinary code. Your application decides how their results contribute to the task and what to do when a method cannot complete it.</p></section>
</div>

<section className="feature-editorial">
<div><p className="eyebrow">Capability compounding</p><h2>Methods form<br />a workshop.</h2></div>
<div><p>Combining the drafter with a reviewer and explicit checks creates a proposal workshop whose procedure you can inspect and adapt. The reviewer is itself a callable method, ready to contribute to another application with suitable inputs.</p><p>This is capability compounding: useful methods become building blocks for work that would be harder to accomplish separately. As you improve a specialist, you can evaluate and use it across the applications that build on its capability.</p><a className="text-link" href="https://jig.md/guide/proposal-workshop">See the methods and their checks</a></div>
</section>

<section className="statement statement--compact">
<p className="eyebrow">A small shared boundary</p>
<h2>Keep your method.<br />Choose a compatible host.</h2>
<p>For these pieces to work together, FLOW defines how a package describes itself and how an invocation exchanges input and results. Your method keeps its language, libraries, and internal control. The host supplies execution support and local powers.</p>
<p>FLOW is an independent standard with no mandatory registry or model provider. <a href="https://jig.md/">Jig</a> is one host; other implementations can use the same public boundary with their own execution policy.</p>
</section>

<div className="reader-grid">
<a href="/guide/start" className="reader-card"><span className="tile-index">BUILD A METHOD</span><h3>Write your first executable Flow.</h3><p>Choose a language and a compatible execution path, then change the method's result.</p><span className="card-link">Start building ↗</span></a>
<a href="/guide/overview" className="reader-card"><span className="tile-index">BUILD AN INTEGRATION</span><h3>Find the boundary you need.</h3><p>Explore package, protocol, SDK, schema, and conformance guidance in one task map.</p><span className="card-link">Explore the documentation ↗</span></a>
<a href="/guide/for-agents" className="reader-card"><span className="tile-index">BUILD WITH AN AGENT</span><h3>Give your Agent the context.</h3><p>Read focused Markdown pages or the complete public documentation bundle.</p><span className="card-link">Get the context ↗</span></a>
</div>

<details className="honest-details"><summary>What to know before you build</summary><p>FLOW is a prerelease standard. An instructions-only package needs an implementation before it can execute a Run/1 invocation, and the chosen host must support that implementation. Code can govern a procedure without guaranteeing that an Agent's answer is correct. The proposal workshop demonstrates composition; it does not prove that multiple Agents outperform one.</p><p><a href="/guide/understand">Understand the design</a> · <a href="/spec/package-format">Read Package/1</a> · <a href="/spec/run-protocol">Read Run/1</a></p></details>

<section className="closing-cta"><p className="eyebrow">Make the next piece of your system</p><h2>Start with one method.<br />Build what comes next.</h2><a className="action action--brand" href="/guide/start">Build your first Flow <span aria-hidden="true">↗</span></a><a className="text-link" href="/guide/">Read the specifications</a></section>
