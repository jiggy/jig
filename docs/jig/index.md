---
pageType: home
title: "Build with Agents as naturally as you build with code."
description: "Combine Agent reasoning and ordinary code. Jig runs your methods locally with explicit powers, strict containment, and accountable execution."
hero:
  name: Jig
  eyebrow: "Jig · Run code and Agents together"
  text: "Build with Agents\nas naturally as you\nbuild with code."
  tagline: "Invoke Agent reasoning as naturally as ordinary code. Jig runs your methods locally with explicit powers, strict containment, accountable cancellation, and zero license surveillance."
  status: "Developer alpha · Linux hosts · Bread source-available 🍞"
  statusLink: "/guide/#supported-host"
  actions:
    - theme: brand
      text: "Start building"
      link: "/guide/"
    - theme: alt
      text: See it work
      link: "#showcase"
showcase:
  kind: execution
  label: Explore request triage with code and Agents
  title: One method call. Code, an Agent, or both.
  description: >
    Your app needs to route a request. Change the implementation below: your application makes the exact same call regardless of who does the reasoning.
  inputLabel: A support case arrives
  input: "I was charged twice for my subscription."
  methodLabel: "Execute Flow: classify-and-route"
  resultLabel: Suggested queue
  detailsLabel: See the caller and implementation
  note: Illustrative walkthrough. Code enforces invariant contracts; Agent judgment interprets human intent. Changing an implementation changes cost and latency, never the caller's interface.
  link: "/guide/request-triage"
  linkText: Run the complete example in your terminal
  caller:
    file: The caller stays the same
    code: |-
      return run.call({
        operationId: 'classify-request',
        slot: 'classifier',
        input: run.input,
      })
  # result: ''
  stages:
    - name: "Code"
      output: manual-review
      steps: [Match keywords, Check strict pattern, Fall back safely]
      title: "Deterministic code: fast, rigid, predictable."
      description: "Recognize known regex keywords or flags. Anything ambiguous falls back to manual review. No model call; code rules can still misclassify."
      file: "Result"
      code: >
        done → { queue: "billing", priority: "high", requires_human: false }
    - name: "Agent"
      output: billing
      steps: [Read nuance, Reason across intent, Propose classification]
      title: "Agent judgment: flexible, semantic, adaptable."
      description: "Ask an Agent to interpret context, frustration, and implicit intent. Its judgment operates strictly behind the Flow contract without direct system authority."
      file: "Implementation sketch · pure Agent"
      code: "message → Agent reasoning\n        → validate schema output"
    - name: "Both"
      output: billing
      steps: [Run fast code rules, Call Agent when nuanced, Validate against schema]
      title: "The power-under-control sweet spot."
      description: "Known patterns use deterministic code directly. Nuanced requests invoke an Agent. Code validates the result before returning to the caller."
      file: "Implementation sketch · hybrid Flow"
      code: "known pattern → direct code\nambiguous     → Agent interpretation\n              → strict schema validation"
---

<section className="story-section">
<div className="story-copy"><p className="eyebrow">The execution boundary</p><h2>Let Agents interpret.<br />Let your code decide.</h2><p>Prompts are not policy. An Agent can interpret a customer’s nuance, draft an investigation, or propose a code change. But your application code checks records, enforces business rules, and decides the consequences.</p><p>Bring your Skills, prompts, and libraries into bounded methods. Code and Agent work share the same callable boundary, defined by the independent <a href="https://flow.jig.md/">FLOW standard</a>. Your application stays in command.</p><a className="text-link" href="/guide/support-case">See code check an Agent’s proposal ↗</a></div>
<div className="composition-reveal"><p className="visual-caption">How applications stay in control</p><ol><li><strong>1. Delegate the reasoning</strong><span>A Flow invokes an Agent to interpret unstructured data.</span></li><li><strong>2. Enforce domain policy</strong><span>Your code verifies the proposal against strict business invariants.</span></li><li><strong>3. Authorize the consequence</strong><span>Proceed, request human review, or withhold action.</span></li></ol><p className="visual-footnote">Checks need domain knowledge. A well-formed answer can still be wrong.</p></div>
</section>

<section className="story-section story-section--reverse">
<div className="story-copy"><p className="eyebrow">A microkernel for agent-native systems</p><h2>A small core.<br />Uncompromising containment.</h2><p>Methods own the work. Jig handles the execution around them: running reviewed code, granting operator-authorized resource access, and fencing owned work when you cancel. Completion requires confirmed settlement; cancellation is not instantaneous.</p><p>This separation lets you build new capabilities without giving models ambient system access. Agents have room to reason inside their methods; their judgment does not grant them more authority, access to raw credentials, or the ability to spawn untracked processes.</p><a className="text-link" href="/guide/understand#why-a-microkernel-inspired-host">Understand the architecture ↗</a></div>
<div className="boundary-reveal"><p className="visual-caption">Jig’s host containment boundary</p><div className="boundary-method"><strong>Your Flow</strong><p>Code · Agents · Skills · Libraries</p><span>The method owns how the work happens.</span></div><ul><li>Grants only operator-authorized resources; credentials stay host-owned</li><li>Enforces strict process, memory, and timeout limits</li><li>Refuses success when owned cleanup is unconfirmed</li></ul><p className="visual-footnote">Jig governs execution. Your application directs meaning and authority.</p></div>
</section>

<section className="fleet-section">
<div className="section-header">
<p className="eyebrow">Capability compounding</p>
<h2>Build the builders.<br />From one method to a fleet.</h2>
<p className="section-description">A single method solves one task. When methods compose, capability compounds. Each specialist has explicit inputs, outputs, and bounded powers—enabling coordinated multi-agent systems with power under control.</p>
</div>
<div className="reader-grid">
<a className="reader-card" href="/guide/request-triage"><span className="tile-index">01 · Method Boundary</span><h3>One caller, three implementations</h3><p>See how code, an Agent, and a hybrid Flow satisfy the exact same result contract.</p><span className="card-link">Explore walkthrough ↗</span></a>
<a className="reader-card" href="/guide/support-case"><span className="tile-index">02 · Consequence Policy</span><h3>Handle a disputed charge</h3><p>An Agent interprets the claim, code checks records, and the caller receives eligibility.</p><span className="card-link">Explore walkthrough ↗</span></a>
<a className="reader-card" href="/guide/tested-patch"><span className="tile-index">03 · Autonomous Patching</span><h3>An issue becomes a tested patch</h3><p>Specialists reproduce failure, draft changes, and deliver verified patch evidence.</p><span className="card-link">Explore walkthrough ↗</span></a>
</div>
</section>

<section className="closing-cta"><h2>Run one Flow.<br />Build with confidence.</h2><p>Create a small project, run a method, and inspect its result in your terminal. The first run uses ordinary code and needs no Agent.</p><a className="action action--brand" href="/guide/">Start building <span aria-hidden="true">↗</span></a><p className="start-note">Developer alpha · <a href="/guide/#supported-host">Check supported Linux hosts and prerequisites</a></p></section>
<details className="honest-details"><summary>What to know about this alpha</summary><p>Jig is Bread source-available, not open source. Personal non-business use and genuine evaluation are free; qualifying business groups below $1M annual revenue also have a free grant. See <a href="/pricing">pricing</a> and the <a href="https://github.com/jiggy/jig/blob/main/LICENSE.md">license</a> for terms. FLOW is independently licensed. Agents can hallucinate or follow injected instructions; Jig does not guarantee correct judgment. Harmful decisions within granted authority remain possible. Remote Agents receive the data intentionally sent to them. Cancellation cannot retract accepted remote requests or undo completed effects. Production-scale performance is not established.</p><p><a href="/guide/agents">Agent choices</a> · <a href="/spec/project-policy">Execution guarantees</a></p></details>
<nav className="landing-routes" aria-label="More Jig resources"><a href="/guide/overview">Documentation</a><a href="/guide/teams">With your team</a><a href="/guide/for-agents">For Agents</a><a href="/spec/project-policy">Execution specification</a><a href="/pricing">Pricing</a></nav>
