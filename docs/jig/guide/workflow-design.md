---
title: Choosing a workflow structure
---

# Choosing a workflow structure

Use the smallest structure that makes the important correctness, information,
authority, and lifecycle boundaries visible. More Agents and more steps do not
create assurance by themselves.

This guide helps choose a design; it is not a list of current Jig features.
The [direct-alpha guide](./index.md) defines what Jig supports today.

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

One method can occupy several rows. A test-driven repair loop, for example,
combines deterministic tests, an Agent judgment or edit, and bounded repetition.
The table places each concern where it can actually be implemented or enforced;
it does not force the whole method into one category.

Jig should be able to host these methods without having to own each one. A
prompt can request a limit or permission, but only ordinary code or the host can
enforce it.

## Add structure only for a stated reason

1. If exact code can produce and check the result, use one reviewed Run.
2. If one part needs interpretation or generation, give only that part to one
   Agent. Keep validation, stopping, and effects in code.
3. If the work has distinct steps, start with a fixed sequence, branch,
   fan-out/join, or bounded loop. Add a graph when its topology needs to be
   inspected, tested, or reused.
4. Add Agents only when roles need materially different evidence, skills,
   information access, or authority—not merely different personas.
5. When a model chooses what happens next, construct the complete eligible set
   outside the model. Accept one allowed identifier or abstention, validate it,
   and invoke only the pre-authorized target.
6. Put durable activation, shared resources, credentials, and consequential
   effects behind a real owner. Do not imitate them with conversational memory
   or an indefinitely running Flow.

These are design choices, not maturity levels. A useful application may need
no Agent, no graph, or no host-managed service.

## When a method earns a pattern brief

Add a candidate to the [orchestration-pattern catalogue](../orchestration-patterns.md)
only when it:

- addresses a recurring, named failure;
- has a minimum structure whose removal changes its claim;
- is more than ordinary sequencing, branching, fan-out, joining, or waiting;
- plausibly applies to materially different jobs;
- states its inputs, outputs, stopping rule, failure path, and collapse
  condition; and
- defines a falsifiable comparison with the strongest simpler alternative,
  including cost and latency.

Call it supported only after comparative evidence shows that the structure—not
extra calls, tokens, tools, or authority—caused the improvement and that the
result transfers beyond its first example. Otherwise describe it plainly as a
local recipe or use its established name.

## Related method families

These methods are useful design references and probe baselines. They do not
each need a Jig-owned pattern brief:

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

Probe the distinguishing mechanism of a family with one strong representative
and an equal-resource simpler baseline. Add another branded implementation
only when it introduces a genuinely different structure or failure model.
