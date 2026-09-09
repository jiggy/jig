---
pageType: home
title: Good methods should travel.
description: An independent standard for sharing executable know-how. Package useful methods so others can run, adapt, and combine them.
hero:
  name: FLOW
  eyebrow: Capability compounding
  text: "Good methods\nshould travel."
  tagline: Give the next builder a better starting point. Share executable know-how that others can run, adapt, and combine.
  status: Open standard · prerelease specifications
  statusLink: /guide/
  actions:
    - theme: brand
      text: Build your first Flow
      link: /guide/start
    - theme: alt
      text: Explore the standard
      link: /guide/
features:
  - title: Ordinary files
    details: Readable purpose. Inspectable methods.
  - title: A small boundary
    details: Finite invocation. Explicit outcomes.
  - title: Independent by design
    details: Your language. Your runtime. Your host.
showcase:
  label: Explore the boundary
  title: One method. A better starting point.
  description: Keep the procedure together and the exchange small. A Flow preserves how work gets done without making every consumer adopt the author's application.
  note: Illustrative package and handler. Execution requires a compatible host; this page runs no Flow.
  link: /guide/start
  linkText: Follow the authoring path
  stages:
    - name: Package
      title: Keep the method in ordinary files.
      description: FLOW.md describes the method. An executable package adds its implementation and the resources it needs. Schemas and exact contracts are optional.
      file: A minimal executable package
      code: |-
        echo/
        ├── FLOW.md
        ├── package.json
        └── flow.ts
      tags: [Readable purpose, Inspectable source, Colocated resources]
    - name: Invoke
      title: Small at the boundary. Flexible inside.
      description: The TypeScript SDK handles one Run/1 exchange. Your program owns its method; a compatible host supplies the invocation and local powers.
      file: flow.ts
      code: |-
        import { handle } from "@jigging/flow";

        await handle(async (run) => ({
          outcome: "done",
          output: { received: run.input },
        }));
      tags: [Ordinary code, Finite work, Your internal runtime]
    - name: Build further
      title: Give another consumer something useful.
      description: A defined outcome lets another application use the result. Evaluate the method in its new setting, adapt it, and preserve what proves useful.
      file: Result for input {"name":"Ada"}
      code: |-
        {
          "outcome": "done",
          "output": {
            "received": { "name": "Ada" }
          }
        }
      tags: [Defined outcomes, Reusable method, Evidence-led improvement]
---

<section className="statement">
<p className="eyebrow">Share how the work gets done</p>
<h2>An answer helps once.<br />A method is a starting point.</h2>
<p>A research procedure can preserve how sources are gathered, claims checked, and uncertainty reported. Others can adapt it or combine it with another specialist. FLOW provides the shared boundary for that executable know-how.</p>
<a className="text-link" href="/guide/understand">Why FLOW exists <span aria-hidden="true">↗</span></a>
</section>

<div className="ownership-grid">
<section><span className="tile-index">01 / CAPTURE</span><h3>Package the craft.</h3><p>Keep the method's code, instructions, checks, and resources together. Explain what a consumer can expect.</p></section>
<section><span className="tile-index">02 / APPLY</span><h3>Carry it forward.</h3><p>A compatible host invokes the method with its own local powers. The method keeps its implementation.</p></section>
<section><span className="tile-index">03 / EVALUATE</span><h3>Preserve what works.</h3><p>Test the result in its setting. Share useful improvements and give the next consumer a stronger starting point.</p></section>
</div>

<section className="feature-editorial">
<div><p className="eyebrow">Independent by design</p><h2>Methods travel.<br />Authority stays local.</h2></div>
<div><p>FLOW defines portable package and invocation meaning. Each host supplies permissions, providers, credentials, execution limits, and lifecycle policy.</p><p>No mandatory registry, model provider, programming language, or internal runtime owns that exchange. <a href="https://jig.md/">Jig</a> is one host; FLOW can serve others without adopting Jig's policy model.</p><a className="text-link" href="/guide/">Explore the exact contracts <span aria-hidden="true">↗</span></a></div>
</section>

<section className="statement statement--compact"><p className="eyebrow">Built to be built on</p><h2>A standard with room for your ideas.</h2><p>Start with one method. Use a plain program or a graph library. Add precision where independent consumers need it. Let the useful outcome determine the structure.</p></section>

<div className="reader-grid">
<a href="/guide/start" className="reader-card"><span className="tile-index">FOR AUTHORS</span><h3>Share a useful method.</h3><p>Choose a language and a compatible execution path. Learn the package and invocation boundary.</p><span className="card-link">Start building ↗</span></a>
<a href="/guide/overview" className="reader-card"><span className="tile-index">FOR IMPLEMENTERS</span><h3>Build on exact meaning.</h3><p>Find the package, protocol, SDK, schema, and conformance material in one task map.</p><span className="card-link">Explore the documentation ↗</span></a>
<a href="/guide/for-agents" className="reader-card"><span className="tile-index">FOR AGENTS</span><h3>Read the source of truth.</h3><p>Fetch focused Markdown pages or the complete public documentation bundle.</p><span className="card-link">Get the context ↗</span></a>
</div>

<details className="honest-details"><summary>What portability does—and does not—promise</summary><p>FLOW is a prerelease standard. Hosts must state which implementations they support; a protocol does not make every package run everywhere. Description-only packages cannot execute a Run/1 invocation. Reuse creates an opportunity for capability compounding; evaluation establishes the benefit. No package format guarantees accuracy or automatic improvement.</p><p><a href="/guide/understand">Understand the design</a> · <a href="/spec/run-protocol">Read Run/1</a></p></details>

<section className="closing-cta"><p className="eyebrow">Give the next builder a better starting point</p><h2>Make your know-how<br />something others can use.</h2><a className="action action--brand" href="/guide/start">Build your first Flow <span aria-hidden="true">↗</span></a><a className="text-link" href="/guide/">Read the specifications</a></section>
