---
pageType: home
title: Accomplish more. Keep the controls.
description: Build with reusable expertise and Agents you choose. Jig is a small open-source host for capable methods under your direction.
hero:
  name: Jig
  eyebrow: Expand human possibility
  text: "Accomplish more.\nKeep the controls."
  tagline: Bring capable methods together. Choose your Agents. Turn intent into work you can inspect, adapt, and control.
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
  - title: Your methods
    details: Ordinary code. Reusable expertise.
  - title: Your Agents
    details: Providers and models you choose.
  - title: Your authority
    details: Powers you grant. Limits you set.
showcase:
  label: Explore a working example
  title: A bug report becomes a patch you can review.
  description: See where the method ends and your authority begins. The tested-patch application repairs a small Bun project and returns proposed changes with execution evidence.
  note: Interactive walkthrough of the example. No Agent calls or commands run in this page.
  link: /guide/tested-patch
  linkText: Build this application
  stages:
    - name: Intent
      title: Define the work. Keep the original.
      description: Supply the issue, permitted source files, and acceptance cases. Your original project stays unchanged.
      file: issue.json
      code: |-
        {
          "issue": "Describe the defect and required behavior.",
          "editPaths": ["src/parse.ts", "src/report.ts"]
        }
      tags: [Selected source, Explicit scope, Your acceptance cases]
    - name: Method
      title: Put a specialist to work.
      description: A reusable repair method proposes changes. The application checks the original failure and the candidate against unchanged expectations.
      file: Reviewed execution
      code: |-
        jig review
        jig run binding:repair \
          --input @issue.json \
          --attach source=fixtures/log-report \
          --out repair-result --timeout 5m
      tags: [Your Agent, Reviewed commands, Bounded attempts]
    - name: Evidence
      title: Inspect the result. Decide what happens next.
      description: A patch is delivered when the example's checks pass. Read the execution evidence and review the changes before applying them.
      file: Expected delivery
      code: |-
        repair-result/
        ├── result.json
        └── files/
            ├── summary.txt
            └── review.patch  (when checks pass)
      tags: [Reviewable changes, Executed checks, Your decision]
---

<section className="statement">
<p className="eyebrow">A small host. A larger starting point.</p>
<h2>The method is yours.<br />So is what comes next.</h2>
<p>Write a procedure in ordinary code. Use an Agent where judgment helps. Add a graph library when the structure earns its place. Jig takes care of the execution boundaries, so your application can stay about its purpose.</p>
<a className="text-link" href="/guide/understand">Understand the architecture <span aria-hidden="true">↗</span></a>
</section>

<div className="ownership-grid">
<section><span className="tile-index">01 / APPLICATION</span><h3>You define the purpose.</h3><p>The experience, domain rules, and consequential decisions belong to your application and its authority owners.</p></section>
<section><span className="tile-index">02 / FLOW</span><h3>The method owns its craft.</h3><p>Prompts, Skills, validation, and internal control live together in a reusable Flow. You can inspect and change them.</p></section>
<section><span className="tile-index">03 / JIG</span><h3>The host holds the boundary.</h3><p>Jig runs the accepted revision with authorized powers and limits, and accounts for completion, failure, and cleanup.</p></section>
</div>

<section className="feature-editorial">
<div><p className="eyebrow">Capability that compounds</p><h2>Keep the know-how.<br />Build something further.</h2></div>
<div><p>A useful method can outlive its first result. The tested-patch example reuses one repair specialist across two projects. The proposal workshop combines drafting and review over supplied evidence.</p><p>The ambition is a better starting point for every builder: capable procedures you can inherit, evaluate, adapt, and share. The independent <a href="https://flow.jig.md/">FLOW standard</a> makes that exchange possible beyond one host.</p><a className="text-link" href="/guide/proposal-workshop">Explore the proposal workshop <span aria-hidden="true">↗</span></a></div>
</section>

<section className="statement statement--compact">
<p className="eyebrow">Power under control</p>
<h2>More agency, at every step.</h2>
<p>Review what will run. Choose its Agents and powers. Inspect the outcome. Stop owned work. Your source and policy stay ordinary, visible, and editable.</p>
</section>

<div className="reader-grid">
<a href="/guide/" className="reader-card"><span className="tile-index">FOR DEVELOPERS</span><h3>Build your first Flow.</h3><p>Create a method, run it, and make it yours. No Agent is needed for the first example.</p><span className="card-link">Start building ↗</span></a>
<a href="/guide/teams" className="reader-card"><span className="tile-index">FOR TEAMS</span><h3>Share methods. Keep clear ownership.</h3><p>Separate application policy, method expertise, and operator authority.</p><span className="card-link">Plan your workflow ↗</span></a>
<a href="/guide/for-agents" className="reader-card"><span className="tile-index">FOR AGENTS</span><h3>Start with the right context.</h3><p>Read the documentation as Markdown. Find the exact guide or contract for the task.</p><span className="card-link">Get the context ↗</span></a>
</div>

<details className="honest-details"><summary>What to know about this alpha</summary><p>Jig is open-source local software for supported Linux hosts. Host prerequisites are substantive; check the installation guide. Remote Agents receive the data intentionally sent to them. Cancellation cannot retract accepted remote requests or undo completed effects. A passing finite check set supports review, not a claim of general correctness.</p><p><a href="/guide/#supported-host">Supported hosts</a> · <a href="/guide/agents">Agent choices</a> · <a href="/spec/project-policy">Execution guarantees</a></p></details>

<section className="closing-cta"><p className="eyebrow">Your next useful outcome</p><h2>Start small.<br />Build further.</h2><a className="action action--brand" href="/guide/">Create your first Flow <span aria-hidden="true">↗</span></a><a className="text-link" href="/guide/overview">Find your path through the docs</a></section>
