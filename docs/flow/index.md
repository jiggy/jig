---
pageType: home
title: "Build with Agents as naturally as you build with code."
description: "Start with executable instructions in FLOW.md, or choose FLOW.ts to express the method in code. Compose code and Agent work through the same interface."
hero:
  name: FLOW
  eyebrow: "FLOW · An open standard for executable methods"
  text: "Build with Agents\nas naturally as you\nbuild with code."
  tagline: "Start with executable instructions in FLOW.md, or choose FLOW.ts to express the method in code. Compose code and Agent work through the same interface."
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
    - name: Describe
      title: Start with one readable file.
      description: FLOW.md is the Markdown implementation. A compatible interpreter carries out the procedure under host-authorized powers. Guidance and resources can live beside it.
    - name: Run
      title: Choose another execution format.
      description: Use FLOW.ts or FLOW.py instead of FLOW.md when code should express the procedure. A package has exactly one FLOW.<ext> entrypoint. Switch languages to see the same greeting.
    - name: Compose
      title: Call the capability. Choose its implementation.
      description: Another Flow calls the configured greeter slot with an input and receives its result. The same calling boundary works whether the method uses code, Agent work, or both.
  inputLabel: Input
  input: '"Ada"'
  resultLabel: Outcome and output
  result: 'done → { "message": "Hello, Ada!" }'
  runtimeNote: FLOW does not prescribe a language or runtime. The host must support the implementation and its FLOW protocol. TypeScript and Python SDKs exist; their availability does not imply that Jig supports both.
  internalsTitle: Where do Agents fit?
  internals: These greeting implementations use code. An executable method can also call an ordinary Agent Flow through an authorized slot, using Skills and prompts inside the method. The caller still uses the method’s interface; required powers and result quality can differ.
  precisionTitle: Add precision when you need it
  precision:
    - file: FLOW.contract.json
      description: Optionally declare input, results, outcomes and channels in one invocation contract.
      link: /spec/invocation-contracts
    - file: FLOW.meta.json
      description: Add optional metadata and declare the method's dependencies without executing its code.
      link: /spec/package-format
  note: Package walkthrough and SDK excerpts, not a live run. A host supplies the runtime and configures the child slot. Follow the authoring guide for complete setup.
  link: /guide/start
  linkText: Choose an SDK or host
---

<section className="story-section">
<div className="story-copy"><p className="eyebrow">From guidance to execution</p><h2>The familiarity of a Skill.<br />The composition of code.</h2><p><code>SKILL.md</code> captures instructions and resources for an Agent. <code>FLOW.md</code> is a Markdown implementation with a defined execution boundary. Choose <code>FLOW.ts</code> or another supported format instead when code should express the procedure.</p><p>Use code for known steps, Agent judgment for interpretation, or combine both. Your application calls the method through the same interface, without taking on its internal orchestration.</p><a className="text-link" href="https://jig.md/guide/request-triage">See one caller use code, an Agent, or both ↗</a></div>
<div className="package-reveal"><p className="visual-caption">Progressive disclosure, built into the package</p><dl><div><dt>Describe the method</dt><dd>Start with one FLOW.&lt;ext&gt; entrypoint. Markdown keeps the procedure readable.</dd></div><div><dt>Make it executable</dt><dd>Choose Markdown or code using a runtime supported by the host; do not combine entrypoints.</dd></div><div><dt>Add the precision you need</dt><dd>Optional metadata and one invocation contract add precise declarations when needed.</dd></div></dl></div>
</section>

<section className="story-section story-section--reverse">
<div className="story-copy"><p className="eyebrow">A common connection</p><h2>Different internals.<br />Made to fit together.</h2><p>A caller supplies input and handles an outcome. Behind that boundary, a method can use a different language, a library, or an Agent. You can build on the capability without adopting its author’s whole stack.</p><p>This is the modularity FLOW is built for: independently reusable methods that become parts of larger applications. The receiving host supplies supported execution and powers; matching interfaces and suitable behavior make the pieces fit.</p><p><a href="https://jig.md/">Jig</a> puts Flows to work locally. FLOW remains independent of Jig, Agent vendors, and any one runtime.</p><a className="text-link" href="/guide/understand#let-capability-build-on-capability">How capability compounds ↗</a></div>
<div className="composition-reveal"><p className="visual-caption">Build around the method’s interface</p><ol><li><strong>Supply an input</strong><span>Your caller names the configured method slot.</span></li><li><strong>Run the chosen implementation</strong><span>Code, Agent work, or both live inside the method.</span></li><li><strong>Build on the result</strong><span>Your application checks the outcome and chooses what comes next.</span></li></ol><p className="visual-footnote">A shared interface does not guarantee identical judgment, cost, latency, or required powers.</p></div>
</section>

<section className="closing-cta"><h2>Start small.<br />Build something more capable.</h2><p>Choose an SDK or a compatible host and build your first executable Flow.</p><a className="action action--brand" href="/guide/start">Build your first Flow <span aria-hidden="true">↗</span></a><p className="start-note">The standard and SDKs are prerelease.</p></section>
<details className="honest-details"><summary>What to know before building</summary><p>Skills can also bundle executable scripts. FLOW adds its own package and invocation contract. Markdown needs a compatible interpreter and admitted resources; Skill-compatible authoring does not promise identical behavior across runtimes. Hosts support specific implementations and supply their own powers and policy. Progressive disclosure here describes the package’s optional layers, not a guarantee about how an Agent loads context.</p></details>
<nav className="landing-routes" aria-label="More FLOW resources"><a href="/guide/overview">Documentation</a><a href="/guide/">Specifications</a><a href="/guide/for-agents">For Agents</a><a href="https://github.com/jiggy/jig/blob/main/Governance.md">Stewardship</a></nav>
