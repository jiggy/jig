---
pageType: home
title: "Build with Agents as naturally as you build with code."
description: "FLOW turns Agent instructions into composable methods that software can call, combine, and compound - in Markdown, TypeScript, or Python, behind one shared interface."
hero:
  name: FLOW
  eyebrow: "FLOW · The open standard for executable know-how"
  text: "Executable know-how.\nWhere code and Agents compound."
  tagline: "Skills give Agents instructions. FLOW turns them into composable methods that software can call, combine, and compound. Write in Markdown, TypeScript, Python, or anything else - behind one shared interface."
  status: "Open standard · Runtime-neutral · Apache-2.0"
  statusLink: "/guide/"
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
      description: FLOW.md captures instructions - Any SKILL.md is a compatible Flow if just renamed!
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
<a className="reader-card" href="/spec/package-format"><span className="tile-index">03 · Specifications</span><h3>The Package/1 standard</h3><p>Inspect the normative specification for package structure, metadata, and invocation contracts.</p><span className="card-link">Inspect spec ↗</span></a>
</div>
</section>

<section className="closing-cta"><h2>Start small.<br />Build something more capable.</h2><p>Write a single Flow or bring an existing Skill. Run it with an SDK or compatible host, and connect it to your application.</p><a className="action action--brand" href="/guide/start">Build your first Flow <span aria-hidden="true">↗</span></a><p className="start-note">Open standard · Prerelease specifications · Apache-2.0</p></section>
<details className="honest-details"><summary>What to know about FLOW</summary><p>FLOW is a prerelease specification. Skills can also bundle executable scripts; FLOW adds a standard package and invocation contract. Markdown implementations require a compatible interpreter and admitted powers. A shared interface does not guarantee identical judgment, cost, latency, or safety across different model providers. Hosts provide execution and security boundaries; FLOW does not enforce runtime isolation.</p><p><a href="/spec/package-format">Package specification</a> · <a href="/spec/run-protocol">Run protocol</a> · <a href="/guide/for-agents">For Agents</a></p></details>
<nav className="landing-routes" aria-label="More FLOW resources"><a href="/guide/overview">Documentation</a><a href="/guide/">Specifications</a><a href="/guide/python">Python SDK</a><a href="/guide/for-agents">For Agents</a><a href="https://github.com/jiggy/jig/blob/main/Governance.md">Stewardship</a><a href="https://jig.md/">Jig host</a></nav>
