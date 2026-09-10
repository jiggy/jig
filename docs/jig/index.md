---
pageType: home
title: Agent flexibility. Software discipline.
description: Build applications from Flows that combine Agent judgment with ordinary code. Jig runs the methods while your application coordinates work and checks results.
hero:
  name: Jig
  eyebrow: Build systems you can direct
  text: "Agent flexibility.\nSoftware discipline."
  tagline: When Agent output outpaces your ability to review it, give the work a procedure you can run and inspect. Jig runs reusable methods called Flows that combine Agent judgment with ordinary code.
  status: Developer alpha · supported Linux hosts
  statusLink: /guide/#supported-host
  actions:
    - theme: brand
      text: Start building
      link: /guide/
    - theme: alt
      text: Explore the docs
      link: /guide/overview
features:
  - title: Write the procedure
    details: Code coordinates the steps and checks.
  - title: Add Agent judgment
    details: Use it where the method needs it.
  - title: Inspect the outcome
    details: Put evidence beside the result.
showcase:
  label: Follow an issue through the work
  title: Give the patch a process you can inspect.
  description: The tested-patch application takes a bug report, asks an Agent to propose changes, and checks the candidate against the original failure and unchanged expectations. You receive the patch with the evidence behind it.
  note: Interactive walkthrough of the authored example. No Agent calls or commands run in this page.
  link: /guide/tested-patch
  linkText: Build this application
  stages:
    - name: Input
      title: Define the job and its acceptance checks.
      description: Supply the issue, permitted source files, and application-owned cases. The repair method works on candidates while your original project stays unchanged.
      file: issue.json
      code: |-
        {
          "issue": "Describe the defect and required behavior.",
          "editPaths": ["src/parse.ts", "src/report.ts"]
        }
      tags: [Selected source, Clear task, Your acceptance cases]
    - name: Procedure
      title: Let the Agent propose and the code check.
      description: Run the reviewed method. Its code bounds attempts and requests approved checks of the candidate. Jig supplies the configured Agent and command powers and accounts for execution.
      file: Run from the configured example
      code: |-
        jig review
        jig run binding:repair \
          --input @issue.json \
          --attach source=fixtures/log-report \
          --out repair-result --timeout 5m
      tags: [Agent proposal, Executed checks, Bounded attempts]
    - name: Evidence
      title: Review a patch with its execution evidence.
      description: A patch is delivered when the example's checks pass. The result records what was tested and why the method finished, so you can evaluate the proposed change before applying it.
      file: Expected delivery
      code: |-
        repair-result/
        ├── result.json
        └── files/
            ├── summary.txt
            └── review.patch  (when checks pass)
      tags: [Reviewable changes, Test evidence, Your next decision]
---

<section className="statement">
<p className="eyebrow">The procedure is ordinary code</p>
<h2>Give the repeatable steps<br />a place outside the prompt.</h2>
<p>In the repair method, an Agent proposes replacement source. Code controls the attempts, requests candidate checks, and handles the result. Your application supplies the acceptance cases and decides which evidence is enough to offer a patch for review.</p>
<p>You can use the same arrangement for your own work: write the procedure as a Flow, call another method when it contributes a useful capability, and bring in Agent judgment at the steps that need it. Jig runs the pieces with their configured powers and limits.</p>
<a className="text-link" href="/guide/understand">See how the responsibilities fit <span aria-hidden="true">↗</span></a>
</section>

<div className="ownership-grid">
<section><span className="tile-index">01 / APPLICATION</span><h3>Define a useful outcome.</h3><p>Your application sets the task, supplies domain checks, and determines what happens with the result.</p></section>
<section><span className="tile-index">02 / FLOW</span><h3>Implement the method.</h3><p>Code, prompts, Skills, validation, and internal control live together in a Flow you can inspect and change.</p></section>
<section><span className="tile-index">03 / JIG</span><h3>Run it within a known boundary.</h3><p>Jig runs the accepted revision with authorized powers and limits, and accounts for completion, failure, and cleanup.</p></section>
</div>

<section className="feature-editorial">
<div><p className="eyebrow">Build on a useful method</p><h2>Use the repair specialist<br />for the next project.</h2></div>
<div><p>The example configures the same repair specialist for a log reporter and a timesheet CLI. Each job supplies its own input and acceptance cases. The method can contribute to another task without requiring a new procedure from scratch.</p><p>As useful methods become available, you can combine them into more capable applications. The independent <a href="https://flow.jig.md/">FLOW standard</a> supplies their shared package and invocation boundary; your code determines how the pieces work together.</p><a className="text-link" href="/guide/tested-patch#two-workers-two-reviewable-patches">Explore the second project <span aria-hidden="true">↗</span></a></div>
</section>

<section className="statement statement--compact">
<p className="eyebrow">A small host for the growing system</p>
<h2>Keep the work understandable<br />as you add capability.</h2>
<p>Because each Flow owns its method, Jig can stay focused on execution. Your source remains ordinary code. You can change a method, review the new revision, choose its Agents, inspect its result, and stop owned work. This is power under control in the everyday process of building.</p>
</section>

<div className="reader-grid">
<a href="/guide/" className="reader-card"><span className="tile-index">FOR DEVELOPERS</span><h3>Run your first Flow.</h3><p>Create a method, run it, and change its result. The first example uses ordinary code and needs no Agent.</p><span className="card-link">Start building ↗</span></a>
<a href="/guide/teams" className="reader-card"><span className="tile-index">FOR TEAMS</span><h3>Build methods with clear ownership.</h3><p>Agree on the outcome, the method's checks, and who chooses its powers and consequences.</p><span className="card-link">Plan your workflow ↗</span></a>
<a href="/guide/for-agents" className="reader-card"><span className="tile-index">FOR AGENTS</span><h3>Start with the right context.</h3><p>Read the documentation as Markdown and find the guide or exact contract for the task.</p><span className="card-link">Get the context ↗</span></a>
</div>

<details className="honest-details"><summary>What to know about this alpha</summary><p>Jig is open-source local software for supported Linux hosts. Host prerequisites are substantive; check the installation guide. Remote Agents receive the data intentionally sent to them. Cancellation cannot retract accepted remote requests or undo completed effects. A passing finite check set supports review, not a claim of general correctness.</p><p><a href="/guide/#supported-host">Supported hosts</a> · <a href="/guide/agents">Agent choices</a> · <a href="/spec/project-policy">Execution guarantees</a></p></details>

<section className="closing-cta"><p className="eyebrow">Begin with a procedure you can understand</p><h2>Run one Flow.<br />Build from there.</h2><a className="action action--brand" href="/guide/">Create your first Flow <span aria-hidden="true">↗</span></a><a className="text-link" href="/guide/overview">Find your path through the docs</a></section>
