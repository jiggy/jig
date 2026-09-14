---
pageType: home
title: "Build with Agents as naturally as you build with code."
description: "Skills give Agents instructions and resources for useful work. FLOW brings that work together with code in executable methods you can call and combine."
hero:
  name: FLOW
  eyebrow: "From Skills to composable software"
  text: "Build with Agents\nas naturally as\nyou build with code."
  tagline: "Skills give Agents instructions and resources for useful work. FLOW brings that work together with code in executable methods you can call and combine."
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
  - title: "Call it from your code"
    details: "Supply input and use the result."
  - title: "Choose how it works"
    details: "Use ordinary code, Agent judgment, or both."
  - title: "Combine useful methods"
    details: "Make one method the starting point for another."
showcase:
  label: One caller · three implementations
  title: One call. Code, an Agent, or both.
  description: Your app needs to route a support request. Start with a rule, ask an Agent to interpret the message, or combine the two. Switch between implementations below—the caller stays the same.
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
<p className="eyebrow">Start with the Skills you know</p>
<h2>Turn useful Agent work<br />into a building block.</h2>
<p>A Skill gives an Agent instructions and resources for a task. A Flow packages a method, with that guidance beside the code that carries out the work. Add an executable entrypoint and your software can call the method directly. Inside, it can use an Agent, ordinary code, or both.</p>
<p>The classifier above shows what that makes possible: your app makes one call, whether a rule or an Agent handles the request. You can build on the result without coordinating the method's internal steps yourself.</p>
<a className="text-link" href="/guide/understand#from-a-skill-to-an-executable-method">See the step from guidance to execution <span aria-hidden="true">↗</span></a>
</section>

<div className="ownership-grid">
<section><span className="tile-index">01 / DESCRIBE</span><h3>Make the method understandable.</h3><p>FLOW.md explains its purpose, inputs, outcomes, and limits. Keep guidance and resources beside the work they support.</p></section>
<section><span className="tile-index">02 / IMPLEMENT</span><h3>Choose how the work happens.</h3><p>An executable entrypoint owns the procedure. Use code, prompts, Skills, libraries, and Agent judgment where each contributes.</p></section>
<section><span className="tile-index">03 / COMPOSE</span><h3>Build with its capability.</h3><p>The next method supplies input and handles the result. It can use the work without adopting its internal orchestration model.</p></section>
</div>

<section className="feature-editorial">
<div><p className="eyebrow">Capability compounding</p><h2>One useful method<br />opens the next possibility.</h2></div>
<div><p>Once you can call a classifier, you can use its result in a larger task. Combine it with a method that checks a record or prepares a response. Each piece does useful work, and you decide how the pieces fit together.</p><p>As you learn, keep known steps in code and use Agent judgment where interpretation helps. A method can change internally while keeping the same input and result contract. Check that the revised method still does the job you need.</p><a className="text-link" href="/guide/understand#let-capability-build-on-capability">Understand capability compounding <span aria-hidden="true">↗</span></a></div>
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
