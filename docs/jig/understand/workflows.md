---
title: Choose a workflow structure
description: Decide where code, Agent judgment, checks, and additional coordination help your application.
---

# Choose a workflow structure

Start with the result your application needs and the checks that establish it.
Use the smallest structure that preserves correctness, information boundaries, authority, and accountable execution.
More Agents and steps do not create assurance by themselves.

This guide helps you choose a design.
The [quickstart](../start/index.md) defines the supported first-run path.
The linked specifications define exact host behavior.

Code and Agent work share a Flow boundary.
Choose their arrangement inside a method before adding coordination around it.
The [contact-import example](../examples/contact-import.md) uses one caller with code, an Agent, or both.

## Put each concern where it belongs

| Concern | Put it here |
| --- | --- |
| Parsing, arithmetic, validation, allow-lists, candidate construction, and stopping rules | Ordinary deterministic code |
| Interpretation, extraction, drafting, or judgment that exact code cannot express | One bounded Agent call |
| Task-specific guidance or reference material | An explicitly selected skill; a skill supplies context, not authority |
| Ordering, branching, joining, or bounded repetition | Package code; use a graph when inspecting, testing, or reusing the topology is valuable |
| Tests, retrieval, compilers, fuzzers, simulations, benchmarks, or human review | Evidence supplied to a check, gate, or loop |
| Best-of-N, tree search, evolutionary search, prompt optimization, or another specialized algorithm | A reusable Flow or library, not a Jig primitive |
| Admission, exact identity, isolation, credentials, deadlines, and resource limits | The Jig host |
| Publication, payment, device control, legal approval, or another consequential action | The owning application, person, or narrowly authorized capability |

One method can occupy several rows.
A test-driven repair loop combines deterministic tests, Agent judgment or edits, and bounded repetition.
Place each concern where it can be implemented or enforced.
The whole method need not fit one category.

Implement the method in its Flow.
Rely on Jig for the boundaries the host must enforce.
A prompt can request a limit or permission.
Ordinary code or the host must enforce it.

## Add structure only for a stated reason

1. If exact code can produce and check the result, use one reviewed Run.
2. If part of the work needs interpretation or generation, give that part to one Agent.
   Keep validation, stopping, and effects in code.
3. For distinct steps, start with a sequence, branch, fan-out/join, or bounded loop.
   Add a graph when you need to inspect, test, or reuse its topology.
4. Add Agents when roles need materially different evidence, Skills, information access, or authority.
   Different personas alone do not justify additional Agents.
5. Before model selection, construct the complete eligible set outside the model.
   Accept one allowed identifier or abstention.
   Validate the selection before invoking its pre-authorized target.
6. Give durable activation, shared resources, credentials, and consequential effects a real owner.
   Conversational memory and an indefinitely running Flow cannot replace that ownership.

These are design choices, not maturity levels. A useful application may need
no Agent, no graph, or no host-managed service.

## Explore additional methods

When a simple sequence is insufficient, existing methods can offer a starting point.
Choose one for a concrete need and evaluate its contribution.
The [research catalogue](../research/orchestration-patterns.md) distinguishes possibilities from demonstrated support.

<details>
<summary>Established method families</summary>

- **Refinement and verification:** [Self-Refine](https://arxiv.org/abs/2303.17651),
  [Reflexion](https://arxiv.org/abs/2303.11366),
  [CRITIC](https://arxiv.org/abs/2305.11738), and
  [Chain-of-Verification](https://arxiv.org/abs/2309.11495).
- **Decomposition and orchestration:**
  [prompt chaining, routing, parallelization, and orchestrator–workers](https://www.anthropic.com/engineering/building-effective-agents),
  plus [least-to-most prompting](https://arxiv.org/abs/2205.10625).
- **Opposition and ensembles:** [multi-Agent debate](https://arxiv.org/abs/2305.14325),
  [Mixture-of-Agents](https://arxiv.org/abs/2406.04692), and
  [LLM-Blender](https://arxiv.org/abs/2306.02561).
- **Candidate search:** [Tree of Thoughts](https://arxiv.org/abs/2305.10601),
  beam or evolutionary search, tournaments, and Best-of-N selection.
- **Tool and environment feedback:** [ReAct](https://arxiv.org/abs/2210.03629),
  retrieval, tests, compilers, fuzzers, simulations, and benchmarks.
- **Prompt and pipeline optimization:** [OPRO](https://arxiv.org/abs/2309.03409),
  [DSPy](https://arxiv.org/abs/2310.03714), and
  [TextGrad](https://arxiv.org/abs/2406.07496).
- **Human governance:** checkpoints, exception-based escalation, risk-tiered
  approval, and [trustworthy Agent controls](https://www.anthropic.com/research/trustworthy-agents).

</details>

Use [project design](../build/design.md) to express the selected structure in an understandable Jig application.
