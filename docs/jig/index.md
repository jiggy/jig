---
pageType: home
title: "Agent intelligence. Inside your software."
description: "Build with code and Agents through the same callable methods. Jig runs them with explicit powers and limits, so your system directs the work and handles what comes back."
hero:
  name: Jig
  eyebrow: "The flexibility of Agents. The discipline of software."
  text: "Agent intelligence.\nInside your software."
  tagline: "Build with code and Agents through the same callable methods. Jig runs them with explicit powers and limits, so your system directs the work and handles what comes back."
  status: "Developer alpha · supported Linux hosts"
  statusLink: "/guide/#supported-host"
  actions:
    - theme: brand
      text: "Start building"
      link: "/guide/"
    - theme: alt
      text: See the architecture
      link: /guide/understand
features:
  - title: "Compose the capability"
    details: "Call code and Agent work through the same boundary."
  - title: "Keep authority explicit"
    details: "Choose the methods, Agents, and powers."
  - title: "Account for execution"
    details: "Handle outcomes, stop work, and settle owned resources."
showcase:
  label: One caller · three implementations
  title: Change how it works. Keep how it fits.
  description: An application needs a suggested queue for a support request. Keep its caller in view as you explore three implementations of the same classifier. Code and Agent work compose at the same level.
  note: Illustrative excerpts from the request-triage example on Jig. This page runs no Flows. A shared result shape does not promise identical judgment, cost, latency, or powers.
  link: "/guide/request-triage"
  linkText: Run the complete example
  caller:
    file: intake · the caller stays the same
    code: |-
      return run.call({
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
<p className="eyebrow">From building software to working inside it</p>
<h2>Give intelligence a role<br />your application can direct.</h2>
<p>Agents help you develop software. Putting them inside it means deciding what they can do and what happens when they get it wrong. Jig gives their work an execution boundary that ordinary software can compose, inspect, and stop.</p>
<p>In the classifier, an Agent interprets a request and returns a suggestion. The application decides how to use it. Changing the method behind that call needs review, even when the interface stays the same. A plausible answer never grants itself new powers.</p>
<a className="text-link" href="/guide/understand">See how Jig works <span aria-hidden="true">↗</span></a>
</section>

<div className="ownership-grid">
<section><span className="tile-index">01 / APPLICATION</span><h3>Set the purpose and consequences.</h3><p>Your application owns domain rules, checks, and what happens with a result. A suggestion becomes an action only through its policy.</p></section>
<section><span className="tile-index">02 / FLOW</span><h3>Give the method room to work.</h3><p>Code, Agent judgment, Skills, and internal control live together behind an input, outcome, and result.</p></section>
<section><span className="tile-index">03 / JIG</span><h3>Keep execution accountable.</h3><p>The operator chooses Agents and powers. Jig runs the accepted methods with limits and accounts for completion, failure, cancellation, and cleanup.</p></section>
</div>

<section className="feature-editorial">
<div><p className="eyebrow">A microkernel for agent-native systems</p><h2>A small core.<br />Room for capable methods.</h2></div>
<div><p>We believe Agent intelligence belongs inside methods that software can compose. Jig's microkernel-inspired architecture keeps the common core focused on authority and execution, while methods own the work and its internal control.</p><p>A classifier can gain a reasoning step without changing its caller. A workshop can combine drafting and review without becoming a host feature. The independent <a href="https://flow.jig.md/">FLOW standard</a> supplies the common method boundary, leaving Jig focused on putting those methods to work.</p><a className="text-link" href="/guide/understand#why-a-microkernel-inspired-host">Understand the architecture <span aria-hidden="true">↗</span></a></div>
</section>

<section className="statement statement--compact">
<p className="eyebrow">Build around judgment, including when it is wrong</p>
<h2>Intelligence can be uncertain.<br />Its authority must be explicit.</h2>
<p>An Agent can hallucinate, misunderstand, or follow injected instructions. Jig makes its work governable and composable; it does not make its judgment correct. Your application checks meaning and consequences. Jig enforces its execution boundaries without asking the model to authorize itself.</p>
<p>See code check an Agent’s proposal in <a href="/guide/support-case">support-case handling</a>, or see how a repair method puts <a href="/guide/tested-patch">executed checks beside a proposed patch</a>.</p>
</section>

<div className="reader-grid">
<a href="/guide/" className="reader-card"><span className="tile-index">FOR DEVELOPERS</span><h3>Run your first Flow.</h3><p>Create a method, run it, and change its result. The first example uses ordinary code and needs no Agent.</p><span className="card-link">Start building ↗</span></a>
<a href="/guide/teams" className="reader-card"><span className="tile-index">FOR TEAMS</span><h3>Build with clear ownership.</h3><p>Agree on the methods, application checks, and who supplies powers and authorizes consequences.</p><span className="card-link">Plan your workflow ↗</span></a>
<a href="/guide/for-agents" className="reader-card"><span className="tile-index">FOR AGENTS</span><h3>Bring the right context.</h3><p>Read the same documentation as Markdown. Find focused guides and exact contracts for the task.</p><span className="card-link">Get the context ↗</span></a>
</div>

<details className="honest-details"><summary>What to know about this alpha</summary><p>Jig is open-source local software for supported Linux hosts. Check the installation prerequisites. Remote Agents receive the data intentionally sent to them. Cancellation cannot retract accepted remote requests or undo completed effects. A harmful decision within granted authority remains possible; this architecture is not a guarantee of correct judgment or production-scale performance.</p><p><a href="/guide/#supported-host">Supported hosts</a> · <a href="/guide/agents">Agent choices</a> · <a href="/spec/project-policy">Execution guarantees</a></p></details>

<section className="closing-cta"><p className="eyebrow">Power under control</p><h2>Run one Flow.<br />Build a system from there.</h2><a className="action action--brand" href="/guide/">Create your first Flow <span aria-hidden="true">↗</span></a><a className="text-link" href="/guide/overview">Find your path through the docs</a></section>
