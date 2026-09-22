---
pageType: home
title: "Build with Agents as naturally as you build with code."
description: "Call Agent work from your application through a Flow: a method that can use code, an Agent, or both. Jig runs it with the powers and limits you choose."
hero:
  name: Jig
  eyebrow: "Jig · Run code and Agents together"
  text: "Build with Agents\nas naturally as you\nbuild with code."
  tagline: "Call Agent work from your application through a Flow: a method that can use code, an Agent, or both. Jig runs it with the powers and limits you choose."
  status: "Developer alpha · supported Linux hosts"
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
  label: Explore a support-request classifier
  title: One call. Code, an Agent, or both.
  description: Your app needs to route a request. Change how the classifier works below. Your application still makes the same call.
  inputLabel: A request arrives
  input: "I was charged twice for my subscription."
  methodLabel: Classify the request
  resultLabel: Suggested queue
  detailsLabel: See the caller and implementation
  note: Illustrative walkthrough, not a live run. Agent suggestions can differ; code checks their shape, not their correctness. Changing a method can change its cost, latency, and required powers.
  link: "/guide/request-triage"
  linkText: Run the complete example
  caller:
    file: The caller stays the same
    code: |-
      return run.call({
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
<div className="story-copy"><p className="eyebrow">Build around the result</p><h2>Let Agents interpret.<br />Let your code decide.</h2><p>A suggested queue is a starting point. Your application can check records, ask for more information, or call another method. An Agent’s answer becomes an action through rules you write.</p><p>Bring your Skills, prompts, and libraries into the methods that need them. Code and Agent work share the same callable boundary, defined by the independent <a href="https://flow.jig.md/">FLOW standard</a>.</p><a className="text-link" href="/guide/support-case">See code check an Agent’s proposal ↗</a></div>
<div className="composition-reveal"><p className="visual-caption">Your application directs the work</p><ol><li><strong>Get a suggestion</strong><span>A Flow returns an Agent’s interpretation.</span></li><li><strong>Check what matters</strong><span>Your code applies the relevant rules.</span></li><li><strong>Decide what follows</strong><span>Continue, ask for help, or handle a failure.</span></li></ol><p className="visual-footnote">Checks need domain knowledge. A well-formed answer can still be wrong.</p></div>
</section>

<section className="story-section story-section--reverse">
<div className="story-copy"><p className="eyebrow">A microkernel for agent-native systems</p><h2>A small core.<br />Room for capable methods.</h2><p>Methods own the work. Jig handles the execution around them: running reviewed methods, supplying authorized powers, and stopping owned processes when you cancel.</p><p>This separation lets you build new capabilities without adding each workflow to the host. Agents have room to reason inside their methods; their judgment does not grant them more authority.</p><a className="text-link" href="/guide/understand#why-a-microkernel-inspired-host">Understand the architecture ↗</a></div>
<div className="boundary-reveal"><p className="visual-caption">Jig’s execution boundary</p><div className="boundary-method"><strong>Your Flow</strong><p>Code · Agents · Skills · Libraries</p><span>The method owns how the work happens.</span></div><ul><li>Run the reviewed method</li><li>Supply chosen powers and limits</li><li>Account for completion and cleanup</li></ul><p className="visual-footnote">Jig governs execution. Your application checks meaning and consequences.</p></div>
</section>

<section className="closing-cta"><h2>Run one Flow.<br />Build from there.</h2><p>Create a small project, run a method, and change its result. The first run uses ordinary code and needs no Agent.</p><a className="action action--brand" href="/guide/">Start building <span aria-hidden="true">↗</span></a><p className="start-note">Developer alpha · <a href="/guide/#supported-host">Check supported Linux hosts and prerequisites</a></p></section>
<details className="honest-details"><summary>What to know about this alpha</summary><p>Jig runs locally. Its <a href="https://bread.jig.md/">Bread license</a> (🍞) defines source access and commercial permissions. Agents can hallucinate or follow injected instructions; Jig does not guarantee correct judgment. Harmful decisions within granted authority remain possible. Remote Agents receive the data intentionally sent to them. Cancellation cannot retract accepted remote requests or undo completed effects. Production-scale performance is not established.</p><p><a href="/guide/agents">Agent choices</a> · <a href="/spec/project-policy">Execution guarantees</a></p></details>
<nav className="landing-routes" aria-label="More Jig resources"><a href="/guide/overview">Documentation</a><a href="/guide/teams">With your team</a><a href="/guide/for-agents">For Agents</a><a href="/spec/project-policy">Execution specification</a></nav>
