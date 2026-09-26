---
pageType: home
title: "Build with Agents as naturally as you build with code."
description: "FLOW turns Agent instructions into composable methods that software can call, combine, and compound - in Markdown, TypeScript, or Python, behind one shared interface."
hero:
  name: FLOW
  eyebrow: "FLOW · The open standard for executable know-how"
  text: "Executable know-how.\nWhere code and Agents compound."
  tagline: "Skills give Agents instructions. FLOW turns them into composable methods that software can call, combine, and compound. Write in Markdown, TypeScript, Python, or anything else - behind one shared interface."
  status: "Public alpha · Specs and APIs may change · Help shape FLOW"
  statusLink: "#what-to-know"
  actions:
    - theme: brand
      text: "Build your first Flow"
      link: "/guide/start"
    - theme: alt
      text: Explore a Flow
      link: "#showcase"
showcase:
  kind: package
  title: A small package. A whole capability.
  description: Familiar if you use SKILL.md. Built to become a callable part of your software.
  packageName: greet
  packageLabel: One Flow package
  requiredLabel: Single entrypoint
  implementationLabel: Code alternative (choose one)
  source:
    file: FLOW.md
    lang: markdown
    code: |-
      ---
      name: greet
      description: Greet someone by name.
      ---

      Greet the supplied name.
      Return a short greeting message.
  implementations:
    - file: FLOW.ts
      lang: typescript
      code: |-
        import { handle } from "@jigging/flow";

        await handle(async (run) => {
          const name = typeof run.input === "string"
            ? run.input : "world";
          return {
            outcome: "done",
            output: { message: `Hello, ${name}!` },
          };
        });
    - file: FLOW.py
      lang: python
      code: |-
        from jiggy.flow import RunContext, RunResult, handle

        async def greet(run: RunContext) -> RunResult:
            name = run.input if isinstance(run.input, str) else "world"
            return {
                "outcome": "done",
                "output": {"message": f"Hello, {name}!"},
            }

        handle(greet)
  caller:
    file: Inside another Flow · TypeScript
    lang: typescript
    code: |-
      return run.call({
        operationId: "say-hello",
        slot: "greeter",
        input: "Ada",
      });
  stages:
    - name: Natural Language
      title: Start with a readable Markdown.
      description: FLOW.md captures a readable procedure. Bring Skill instructions and resources when the receiving runtime supports their requirements.
    - name: Any Runtime
      title: Choose another execution format.
      description: Use FLOW.ts or FLOW.py instead of FLOW.md when code should express the procedure. A package has exactly one FLOW.<ext> entrypoint. Switch languages to see the same greeting.
    - name: Compose
      title: The same method call, regardless of its implementation
      description: Another Flow calls the configured greeter slot with an input and receives its result. The caller's interface stays identical whether the method runs code, Agent judgment, or both.
  inputLabel: Input
  input: '"Ada"'
  resultLabel: Outcome and output
  result: 'done → { "message": "Hello, Ada!" }'
  runtimeNote: FLOW does not prescribe a language or runtime. A package contains exactly one FLOW.<ext> entrypoint. TypeScript, Python, and Markdown interpreters share the same invocation wire protocol.
  internalsTitle: Where do Agents fit?
  internals: In FLOW.md, an interpreter guides the Agent using Markdown instructions. In FLOW.ts or FLOW.py, code executes directly and calls an Agent slot when interpretation is needed. The caller sees the exact same result contract in every case.
  precisionTitle: Add precision when you need it
  precision:
    - file: FLOW.contract.json
      description: Optionally declare input, results, outcomes and channels in one invocation contract.
      link: /spec/invocation-contracts
    - file: FLOW.meta.json
      description: Add optional metadata and declare the method's dependencies without executing its code.
      link: /spec/package-format
  note: Package walkthrough and SDK excerpts. A host supplies execution and configures child slots. Follow the authoring guide for complete setup.
  link: /guide/start
  linkText: Build your first Flow
---

<section className="story-section">
<div className="story-copy"><p className="eyebrow">From guidance to execution</p><h2>The familiarity of a Skill.<br />The composition of code.</h2><p><code>SKILL.md</code> and prompts capture instructions for an Agent. But software needs callable methods with explicit inputs, structured outcomes, and clean boundaries. FLOW turns useful know-how into composable packages that programs can call, combine, and improve.</p><p>Start with a single readable <code>FLOW.md</code> file, or choose <code>FLOW.ts</code> or <code>FLOW.py</code> when code should govern the procedure. Use deterministic code for known rules, Agent judgment for interpretation, or combine both.</p><p>Your application calls the method through the same interface, without taking on its internal orchestration.</p><a className="text-link" href="/guide/understand">Why code and Agents share one boundary ↗</a></div>
<div className="package-reveal"><p className="visual-caption">Progressive disclosure, built into the package</p><dl><div><dt>01 · Describe the procedure</dt><dd>Start with one readable FLOW.md entrypoint. Keep instructions, prompts, and resources clear and inspectable.</dd></div><div><dt>02 · Make it precise (optional)</dt><dd>Keep Markdown or switch to TypeScript/Python. Combine deterministic checks with Agent reasoning.</dd></div><div><dt>03 · Add typed precision</dt><dd>Attach optional invocation contracts and metadata for machine-checked integration across teams.</dd></div></dl></div>
</section>

<section className="story-section story-section--reverse">
<div className="story-copy"><p className="eyebrow">One compositional model</p><h2>Different internals.<br />Made to fit together.</h2><p>A caller supplies an input and handles an outcome. Behind that boundary, a method can use a different language, a graph library, a local model, or an Agent. You can build on the capability without adopting its author’s entire stack or runtime framework.</p><p>This is the modularity FLOW is built for: independently reusable methods that become building blocks for larger systems. Upgrade an internal prompt to a trained model or a fast regex check without changing a single line of caller code.</p><a className="text-link" href="/guide/concepts">Explore core concepts ↗</a></div>
<div className="composition-reveal"><p className="visual-caption">How capability compounds</p><ol><li><strong>1. Call the configured slot</strong><span>The caller names the Flow and passes structured input.</span></li><li><strong>2. Execute the chosen method</strong><span>Code, Agent judgment, or composed child Flows do the work.</span></li><li><strong>3. Build on the verified outcome</strong><span>The caller validates the result and triggers the next step in the pipeline.</span></li></ol><p className="visual-footnote">A shared interface does not guarantee identical judgment, cost, or latency. Evaluate each method in context.</p></div>
</section>

<section className="fleet-section">
<div className="section-header">
<p className="eyebrow">The compounding flywheel</p>
<h2>Build once.<br />Compound everywhere.</h2>
<p className="section-description">Capability compounds when a good method becomes the foundation for the next achievement.</p>
</div>
<div className="reader-grid">
<a className="reader-card" href="/guide/start"><span className="tile-index">01 · Quickstart</span><h3>Build your first Flow</h3><p>Create a package in Markdown, TypeScript, or Python and run it through a standard runner.</p><span className="card-link">Start building ↗</span></a>
<a className="reader-card" href="/guide/understand"><span className="tile-index">02 · Architecture</span><h3>Why FLOW exists</h3><p>Understand the single compositional model for code and Agents, and how capability compounds.</p><span className="card-link">Read architecture ↗</span></a>
<a className="reader-card" href="/spec/package-format"><span className="tile-index">03 · Specifications</span><h3>The Package/0 standard</h3><p>Inspect the normative specification for package structure, metadata, and invocation contracts.</p><span className="card-link">Inspect spec ↗</span></a>
</div>
</section>

<section className="adopters-section">
<div className="section-header">
<p className="eyebrow">Built with FLOW</p>
<h2>Real implementations.<br />Independent hosts.</h2>
<p className="section-description">FLOW is an open, host-neutral standard. Explore runtimes, platforms, and hosts that run and compose Flows in practice.</p>
</div>
<div className="adopters-grid" role="region" aria-label="FLOW hosts and integrations">
<article className="adopter-card">
<span className="adopter-badge">Direct-run Host</span>
<h3>Jig</h3>
<p>A local Linux host for running reviewed Markdown and TypeScript Flows with your configured Agents. Combine methods through dependency slots, stream progress, and control the powers each method receives.</p>
<ul className="adopter-caps">
<li>Package/0 and Run/0 wire host</li>
<li>Markdown/0 and TypeScript runtimes</li>
<li>Explicit source review and operator-granted powers</li>
<li>Streaming progress channels and child slot composition</li>
</ul>
<div className="adopter-actions">
<a href="https://jig.md/" target="_blank" rel="noopener noreferrer">Explore Jig host ↗</a>
<a href="/guide/markdown#run-the-composition-on-jig">Inspect Markdown composition demo ↗</a>
</div>
</article>
<article className="adopter-card adopter-card--invitation">
<span className="adopter-badge">Community &amp; Partners</span>
<h3>Add your host or platform</h3>
<p>Building an agent platform, coding assistant, or execution runtime that implements FLOW? Share your implementation with the ecosystem. We evaluate every host by the same capability, support, and evidence criteria.</p>
<ul className="adopter-caps">
<li>Host-neutral protocol conformance</li>
<li>Autonomous ACP agent or client integration</li>
<li>Open, unencumbered Community Specification</li>
</ul>
<div className="adopter-actions">
<a href="https://github.com/jiggy/jig/discussions" target="_blank" rel="noopener noreferrer">Submit an integration ↗</a>
</div>
</article>
</div>
</section>

<section className="closing-cta"><h2>Start small.<br />Build something more capable.</h2><p>Write a single Flow or bring an existing Skill. Run it with an SDK or compatible host, and connect it to your application.</p><a className="action action--brand" href="/guide/start">Build your first Flow <span aria-hidden="true">↗</span></a><p className="start-note">Public alpha · Community Specification, Apache-2.0 &amp; CC-BY-4.0 · Open to feedback</p></section>
<details className="honest-details" id="what-to-know"><summary>What to know about FLOW (public alpha &amp; licensing)</summary><p><strong>Public alpha:</strong> FLOW specifications, SDKs, and wire protocols are provisional. APIs and draft semantics may evolve based on real-world adoption. Help shape FLOW by reporting implementation experience or proposing changes in <a href="https://github.com/jiggy/jig/discussions">GitHub Discussions</a> or <a href="https://github.com/jiggy/jig/issues">Issues</a>.</p><p><strong>Licensing:</strong> Normative specifications and working-group materials use the <a href="https://github.com/jiggy/jig/blob/main/LICENSES/Community-Spec-1.0.md">Community Specification License 1.0</a>; SDKs, machine schemas, examples, and conformance tooling use <a href="https://github.com/jiggy/jig/blob/main/LICENSES/Apache-2.0.txt">Apache License 2.0</a>; explanatory documentation and site guides use <a href="https://github.com/jiggy/jig/blob/main/LICENSES/CC-BY-4.0.txt">Creative Commons Attribution 4.0 (CC-BY-4.0)</a>. See <a href="https://github.com/jiggy/jig/blob/main/LICENSES.md">LICENSES.md</a>.</p><p><strong>Execution &amp; Boundaries:</strong> Skills can bundle executable scripts; FLOW adds a standard package format and invocation contract. Markdown implementations require a compatible interpreter and host-granted capabilities (see the <a href="/guide/skills">Skill compatibility guide</a>). A shared interface does not guarantee identical judgment, cost, latency, or safety across different model providers. Hosts provide execution and security boundaries; FLOW does not enforce runtime isolation.</p><p><a href="/spec/package-format">Package specification</a> · <a href="/spec/run-protocol">Run protocol</a> · <a href="/guide/for-agents">For Agents</a> · <a href="https://github.com/jiggy/jig/blob/main/Governance.md">Governance &amp; Stewardship</a></p></details>
<nav className="landing-routes" aria-label="More FLOW resources"><a href="/guide/overview">Documentation</a><a href="/guide/">Specifications</a><a href="/guide/typescript">TypeScript SDK</a><a href="/guide/python">Python SDK</a><a href="/guide/for-agents">For Agents</a><a href="https://github.com/jiggy/jig/discussions">Discussions</a><a href="https://github.com/jiggy/jig/blob/main/Governance.md">Governance</a><a href="https://github.com/jiggy/jig/blob/main/LICENSES.md">Licenses</a><a href="https://jig.md/">Jig host</a></nav>
