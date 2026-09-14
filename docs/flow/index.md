---
pageType: home
title: "Build with Agents as naturally as you build with code."
description: "Start with readable instructions in FLOW.md. Add flow.<ext> to make the method executable. Compose code and Agent work through the same interface."
hero:
  name: FLOW
  eyebrow: "FLOW · An open standard for executable methods"
  text: "Build with Agents\nas naturally as you\nbuild with code."
  tagline: "Start with readable instructions in FLOW.md. Add flow.<ext> to make the method executable. Compose code and Agent work through the same interface."
  status: "Open standard · prerelease specifications"
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
  requiredLabel: Required
  implementationLabel: Optional implementation
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
    - file: flow.ts
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
    - file: flow.py
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
      return run.runChildFlow({
        operationId: "say-hello",
        slot: "greeter",
        input: "Ada",
      });
  stages:
    - name: Describe
      title: Start with one readable file.
      description: FLOW.md holds the method’s description and instructions. Guidance and resources can live beside it. With no implementation, it is an instructions-only Flow.
    - name: Run
      title: Give the method an executable form.
      description: Add one flow.<ext> entrypoint. A compatible host can invoke it directly, without an Agent first interpreting the Markdown. Switch languages to see the same greeting.
    - name: Compose
      title: Call the capability. Choose its implementation.
      description: Another Flow calls the configured greeter slot with an input and receives its result. The same calling boundary works whether the method uses code, Agent work, or both.
  inputLabel: Input
  input: '"Ada"'
  resultLabel: Outcome and output
  result: 'done → { "message": "Hello, Ada!" }'
  runtimeNote: FLOW does not prescribe a language or runtime. The host must support the implementation and its FLOW protocol. TypeScript and Python SDKs exist; their availability does not imply that Jig supports both.
  internalsTitle: Where do Agents fit?
  internals: These greeting implementations use code. An executable method can also request Agent work through capabilities supplied by its host, using Skills and prompts inside the method. The caller still uses the method’s interface; required powers and result quality can differ.
  precisionTitle: Add precision when you need it
  precision:
    - file: input.schema.json
      description: Optionally define which inputs the method accepts.
      link: /spec/package-format#4-conventional-schemas
    - file: result.schema.json
      description: Optionally define the shape of outcomes and outputs.
      link: /spec/package-format#4-conventional-schemas
    - file: Capability contracts
      description: Add an explicit interface for a capability dependency when interoperability needs one. Ordinary child Flow calls need no capability contract.
      link: /spec/capability-contracts
  note: Package walkthrough and SDK excerpts, not a live run. A host supplies the runtime and configures the child slot. Follow the authoring guide for complete setup.
  link: /guide/start
  linkText: Choose an SDK or host
---

<section className="story-section">
<div className="story-copy"><p className="eyebrow">From guidance to execution</p><h2>The familiarity of a Skill.<br />The composition of code.</h2><p><code>SKILL.md</code> captures instructions and resources for an Agent. <code>FLOW.md</code> gives a method readable meaning; an optional <code>flow.&lt;ext&gt;</code> gives it a defined execution boundary.</p><p>Use code for known steps, Agent judgment for interpretation, or combine both. Your application calls the method through the same interface, without taking on its internal orchestration.</p><a className="text-link" href="https://jig.md/guide/request-triage">See one caller use code, an Agent, or both ↗</a></div>
<div className="package-reveal"><p className="visual-caption">Progressive disclosure, built into the package</p><dl><div><dt>Describe the method</dt><dd>Start with the required FLOW.md. Keep its purpose and instructions readable.</dd></div><div><dt>Make it executable</dt><dd>Add one flow.&lt;ext&gt; using a runtime supported by the host.</dd></div><div><dt>Add the precision you need</dt><dd>Schemas and capability contracts stay optional until the work calls for them.</dd></div></dl></div>
</section>

<section className="story-section story-section--reverse">
<div className="story-copy"><p className="eyebrow">A common connection</p><h2>Different internals.<br />Made to fit together.</h2><p>A caller supplies input and handles an outcome. Behind that boundary, a method can use a different language, a library, or an Agent. You can build on the capability without adopting its author’s whole stack.</p><p>This is the modularity FLOW is built for: independently reusable methods that become parts of larger applications. The receiving host supplies supported execution and powers; matching interfaces and suitable behavior make the pieces fit.</p><p><a href="https://jig.md/">Jig</a> puts Flows to work locally. FLOW remains independent of Jig, Agent vendors, and any one runtime.</p><a className="text-link" href="/guide/understand#let-capability-build-on-capability">How capability compounds ↗</a></div>
<div className="composition-reveal"><p className="visual-caption">Build around the method’s interface</p><ol><li><strong>Supply an input</strong><span>Your caller names the configured method slot.</span></li><li><strong>Run the chosen implementation</strong><span>Code, Agent work, or both live inside the method.</span></li><li><strong>Build on the result</strong><span>Your application checks the outcome and chooses what comes next.</span></li></ol><p className="visual-footnote">A shared interface does not guarantee identical judgment, cost, latency, or required powers.</p></div>
</section>

<section className="closing-cta"><h2>Start small.<br />Build something more capable.</h2><p>Choose an SDK or a compatible host and build your first executable Flow.</p><a className="action action--brand" href="/guide/start">Build your first Flow <span aria-hidden="true">↗</span></a><p className="start-note">The standard and SDKs are prerelease.</p></section>
<details className="honest-details"><summary>What to know before building</summary><p>Skills can also bundle executable scripts. FLOW adds its own package and invocation contract; a Markdown rename does not establish universal format compatibility or executable behavior. Hosts support specific implementations and supply their own powers and policy. Progressive disclosure here describes the package’s optional layers, not a guarantee about how an Agent loads context.</p></details>
<nav className="landing-routes" aria-label="More FLOW resources"><a href="/guide/overview">Documentation</a><a href="/guide/">Specifications</a><a href="/guide/for-agents">For Agents</a><a href="https://github.com/jiggy/jig/blob/main/Governance.md">Stewardship</a></nav>
