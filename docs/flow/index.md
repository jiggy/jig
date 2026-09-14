---
pageType: home
title: "From Skills to software you can compose."
description: "Skills give Agents instructions and resources for useful work. FLOW brings that work together with code in executable methods you can call and combine."
hero:
  name: FLOW
  eyebrow: "FLOW · An open standard for executable methods"
  text: "From Skills to software\nyou can compose."
  tagline: "Skills give Agents instructions and resources for useful work. FLOW brings that work together with code in executable methods you can call and combine."
  status: "Open standard · prerelease specifications"
  statusLink: "/guide/"
  actions:
    - theme: brand
      text: "Build your first Flow"
      link: "/guide/start"
    - theme: alt
      text: See it work
      link: "#showcase"
showcase:
  label: Explore a support-request classifier
  title: One call. Code, an Agent, or both.
  description: Your app needs to route a request. Change how the classifier works below. Your application still makes the same call.
  inputLabel: A request arrives
  input: "I was charged twice for my subscription."
  methodLabel: Classify the request
  resultLabel: Suggested queue
  detailsLabel: See the caller and implementation
  note: Illustrative walkthrough, not a live run. Agent suggestions can differ; code checks their shape, not their correctness. Changing a method can change its cost, latency, and required powers.
  link: "https://jig.md/guide/request-triage"
  linkText: Run the complete example
  caller:
    file: The caller stays the same
    code: |-
      return run.runChildFlow({
        operationId: 'classify-request',
        slot: 'classifier',
        input: run.input,
      })
  result: 'done → { queue: billing | technical | manual }'
  stages:
    - name: "Code"
      output: manual
      steps: [Read the request, Look for an explicit label, Use the fallback]
      title: "Run the known procedure directly."
      description: "Recognize an explicit billing or technical label. Send anything else to manual classification. No Agent interprets these steps."
      file: "Implementation excerpt · code"
      code: "queue: explicitQueue(message) ?? 'manual'"
    - name: "Agent"
      output: billing
      steps: [Read the request, Ask an Agent to interpret, Validate the suggestion]
      title: "Give interpretation its own method."
      description: "Ask an Agent to interpret the message, then validate its queue suggestion. Its judgment stays behind the same caller-facing contract."
      file: "Implementation sketch · Agent"
      code: "message → Agent interpretation\n        → validate queue suggestion"
    - name: "Both"
      output: billing
      steps: [Look for an explicit label, Ask an Agent when absent, Validate the suggestion]
      title: "Put code and judgment in one method."
      description: "Use the same label rule first. Ask an Agent only when a message needs interpretation. The caller still makes the same call."
      file: "Implementation sketch · mixed"
      code: "explicit label → code\notherwise      → Agent interpretation\n               → validate queue suggestion"
---

<section className="story-section">
<div className="story-copy"><p className="eyebrow">Open the method</p><h2>Familiar to read.<br />Ready to call.</h2><p>A Skill gives an Agent instructions and resources. A Flow brings that guidance together with an executable entrypoint, so your program can call the method directly.</p><p>Keep useful Skills inside. Use code for known steps and Agent judgment where interpretation helps. The caller works with the method’s input and result.</p><a className="text-link" href="/guide/understand#from-a-skill-to-an-executable-method">How Skills and Flows fit together ↗</a></div>
<div className="package-reveal"><p className="visual-caption">Inside an executable Flow</p><dl><div><dt>FLOW.md</dt><dd>What the method does, its inputs, and its outcomes.</dd></div><div><dt>Guidance &amp; resources</dt><dd>The instructions and materials the work needs.</dd></div><div><dt>Executable entrypoint</dt><dd>The code that carries out the method, with Agent work where useful.</dd></div></dl><p className="visual-footnote">Conceptual package contents. The implementation chooses its files and language.</p></div>
</section>

<section className="story-section story-section--reverse">
<div className="story-copy"><p className="eyebrow">Build on what works</p><h2>One method becomes<br />part of something bigger.</h2><p>Use a classifier’s result to choose what your application does next. Combine useful methods into work you would otherwise have to coordinate yourself.</p><p>That is capability compounding. FLOW defines how methods are packaged and called; you choose their internals and a compatible host. <a href="https://jig.md/">Jig</a> is one host. FLOW remains independent of it.</p><a className="text-link" href="/guide/understand#let-capability-build-on-capability">Explore composition ↗</a></div>
<div className="composition-reveal"><p className="visual-caption">An application can build on the result</p><ol><li><strong>Classify a request</strong><span>Use the method above.</span></li><li><strong>Choose the next step</strong><span>Your code handles the suggested queue.</span></li><li><strong>Prepare a response</strong><span>Call another method when useful.</span></li></ol><p className="visual-footnote">Illustrative application design. Your code owns the sequence and checks.</p></div>
</section>

<section className="closing-cta"><h2>Start with one useful method.</h2><p>Choose an SDK or a compatible host and build your first executable Flow.</p><a className="action action--brand" href="/guide/start">Build your first Flow <span aria-hidden="true">↗</span></a><p className="start-note">The standard and SDKs are prerelease.</p></section>
<details className="honest-details"><summary>What to know before building</summary><p>Hosts support specific implementations and supply their own powers and policy. Instructions-only Flow packages are valid, but need an executable implementation for invocation. Skills can also bundle runnable scripts; a Markdown rename does not establish executable behavior or universal format compatibility.</p></details>
<nav className="landing-routes" aria-label="More FLOW resources"><a href="/guide/overview">Documentation</a><a href="/guide/">Specifications</a><a href="/guide/for-agents">For Agents</a><a href="https://github.com/jiggy/jig/blob/main/Governance.md">Stewardship</a></nav>
