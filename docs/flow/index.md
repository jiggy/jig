---
pageType: home
title: "Code. Agents. One way to compose them."
description: "You've taught an Agent how to do useful work. FLOW turns methods like that into building blocks for software: callable procedures that use code, Agent judgment, or both."
hero:
  name: FLOW
  eyebrow: "Executable know-how. Greater possibility."
  text: "Code. Agents.\nOne way to compose them."
  tagline: "You've taught an Agent how to do useful work. FLOW turns methods like that into building blocks for software: callable procedures that use code, Agent judgment, or both."
  status: "Open standard · prerelease specifications"
  statusLink: "/guide/"
  actions:
    - theme: brand
      text: "Build your first Flow"
      link: "/guide/start"
    - theme: alt
      text: See the architecture
      link: /guide/understand
features:
  - title: "One method boundary"
    details: "Input, outcome, and result. Whatever does the work."
  - title: "Freedom inside"
    details: "Use ordinary code, Agent judgment, or both."
  - title: "Capability compounds"
    details: "Build more capable methods from useful ones."
showcase:
  label: One caller · three implementations
  title: Change how it works. Keep how it fits.
  description: An application needs a suggested queue for a support request. Keep its caller in view as you explore three implementations of the same classifier. Code and Agent work compose at the same level.
  note: Illustrative excerpts from the request-triage example on Jig. This page runs no Flows. A shared result shape does not promise identical judgment, cost, latency, or powers.
  link: "https://jig.md/guide/request-triage"
  linkText: Run the complete example
  caller:
    file: intake · the caller stays the same
    code: |-
      return run.runChildFlow({
        operationId: 'classify-request',
        slot: 'classifier',
        input: run.input,
      })
  result: 'done → { queue: billing | technical | manual }'
  stages:
    - name: "Code"
      title: "Run the known procedure directly."
      description: "Recognize an explicit billing or technical label. Send anything else to manual classification. No Agent interprets these steps."
      file: "Implementation excerpt · code"
      code: "queue: explicitQueue(message) ?? 'manual'"
      tags: ["Direct execution", "No Agent call"]
    - name: "Agent"
      title: "Give interpretation its own method."
      description: "Ask an Agent to interpret the message, then validate its queue suggestion. Its judgment stays behind the same caller-facing contract."
      file: "Implementation sketch · Agent"
      code: "message → Agent interpretation\n        → validate queue suggestion"
      tags: ["One Agent call", "Structured suggestion"]
    - name: "Both"
      title: "Put code and judgment in one method."
      description: "Use the same label rule first. Ask an Agent only when a message needs interpretation. The caller still makes the same call."
      file: "Implementation sketch · mixed"
      code: "explicit label → code\notherwise      → Agent interpretation\n               → validate queue suggestion"
      tags: ["Zero or one Agent call", "Same method contract"]
---

<section className="statement">
<p className="eyebrow">From a useful Skill to a system of methods</p>
<h2>Give what your Agent knows<br />a form your software can call.</h2>
<p>A Skill captures how to do useful work. An executable Flow gives that method an input, an entrypoint, and a result. A host can invoke it directly, without asking a model to interpret the instructions first. The method itself decides where intelligence helps.</p>
<p>In the classifier, that means the same call can reach a rule, an Agent, or a combination. FLOW brings readable instructions and executable code into one package model, so each can contribute to a larger application.</p>
<a className="text-link" href="/guide/understand#from-a-skill-to-an-executable-method">See the step from guidance to execution <span aria-hidden="true">↗</span></a>
</section>

<div className="ownership-grid">
<section><span className="tile-index">01 / DESCRIBE</span><h3>Make the method understandable.</h3><p>FLOW.md explains its purpose, inputs, outcomes, and limits. Keep guidance and resources beside the work they support.</p></section>
<section><span className="tile-index">02 / IMPLEMENT</span><h3>Choose how the work happens.</h3><p>An executable entrypoint owns the procedure. Use code, prompts, Skills, libraries, and Agent judgment where each contributes.</p></section>
<section><span className="tile-index">03 / COMPOSE</span><h3>Build with its capability.</h3><p>The next method supplies input and handles the result. It can use the work without adopting its internal orchestration model.</p></section>
</div>

<section className="feature-editorial">
<div><p className="eyebrow">Capability compounding</p><h2>One useful method<br />opens the next possibility.</h2></div>
<div><p>The classifier can become part of an intake method. Add a method that checks supplied records and another that prepares a response, and the pieces can support a larger task. Each contribution has a boundary the rest of the system can understand.</p><p>A method can gain intelligence, replace reasoning with code, or add checks while preserving its caller-facing contract. Evaluate the results as you build: composition creates room for capability to grow; it does not guarantee improvement.</p><a className="text-link" href="/guide/understand#let-capability-build-on-capability">Understand capability compounding <span aria-hidden="true">↗</span></a></div>
</section>

<section className="statement statement--compact">
<p className="eyebrow">A shared boundary, an open field</p>
<h2>Your method has room to evolve.<br />Your host stays your choice.</h2>
<p>FLOW defines portable package meaning and invocation. It leaves internal execution to the method and local authority to the receiving host. Jig is one host; FLOW is independent of it, Agent vendors, and any one runtime.</p>
<a className="text-link" href="/guide/">Explore the standard <span aria-hidden="true">↗</span></a>
</section>

<div className="reader-grid">
<a href="/guide/start" className="reader-card"><span className="tile-index">FOR AUTHORS</span><h3>Build your first Flow.</h3><p>Start with a small method and a useful result. Choose your language and a compatible host.</p><span className="card-link">Start building ↗</span></a>
<a href="/guide/" className="reader-card"><span className="tile-index">FOR IMPLEMENTERS</span><h3>Build on the boundary.</h3><p>Find the package, protocol, SDK, and interoperability contracts in one specification map.</p><span className="card-link">Read the contracts ↗</span></a>
<a href="/guide/for-agents" className="reader-card"><span className="tile-index">FOR AGENTS</span><h3>Work from the source of truth.</h3><p>Read focused Markdown pages or the complete public bundle, generated from these docs.</p><span className="card-link">Get the context ↗</span></a>
</div>

<details className="honest-details"><summary>What to know before building</summary><p>The standard and SDKs are prerelease. Hosts support specific implementations and supply their own powers and policy. Instructions-only packages are valid, but need an executable implementation for invocation. Skills can also bundle runnable scripts; a Markdown rename does not establish executable behavior or universal format compatibility.</p><p><a href="/guide/start">Authoring paths</a> · <a href="/guide/">Specifications</a> · <a href="https://github.com/jiggy/jig/blob/main/Governance.md">Stewardship</a></p></details>

<section className="closing-cta"><p className="eyebrow">Begin with something useful</p><h2>Make a method.<br />Build what comes next.</h2><a className="action action--brand" href="/guide/start">Build your first Flow <span aria-hidden="true">↗</span></a><a className="text-link" href="/guide/overview">Find your path through the docs</a></section>
