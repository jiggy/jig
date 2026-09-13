# Audience — builders bringing Agents into production software

Jig and FLOW serve the aspiration to [expand human possibility](doctrine/purpose.md).
This document owns the initial ideal customer profile (ICP), audience needs,
domain understanding, and adoption hypotheses. The [product compass](product-compass.md)
owns the authority map; the [communication guide](communication.md) explains
how to address this audience. Audience strategy can change without changing
the shared purpose or the products' core ideas.

## Initial audience

The chosen initial audience is developers and teams already getting substantial
value from Agents during development and interactive work. They want to put
that intelligence inside their products and operational systems. They work
with Skills, prompts, scripts, and ordinary application code; the next step is
software that invokes and composes Agent work as part of its own operation.

The central opportunity is the gap between work a person supervises in a
conversation and work an application must authorize, evaluate, and handle when
it goes wrong. Here, production use means serving real application or
operational needs without a developer supervising every invocation. Review
fatigue and excessive generated code are supporting symptoms. The larger
attraction is being able to build systems that put Agent capabilities to work.

This is a product direction informed by the owner's experience. The pain,
adoption, and benefit claims below are working hypotheses, not findings from
an independent customer study. They guide examples and discovery without
establishing market size, willingness to pay, or product superiority.

## Felt problems and underlying needs

Start from the way a builder experiences the work. Technical explanations
should help them understand a recognizable problem.

| Likely expression of pain | Need to investigate | Useful outcome to demonstrate |
| --- | --- | --- |
| “Agents help me build my product, but I don't trust them inside it.” | Turn intelligent work into bounded application components with explicit authority and outcomes. | An application invokes Agent work, checks its result, and handles failure without a developer directing each call. |
| “What if it goes rogue or follows instructions hidden in its input?” | Keep authority outside model judgment, including under misalignment or prompt injection. | A bounded adversarial example shows attempted unauthorized work refused and the remaining risks understood. |
| “A convincing wrong answer could trigger the wrong action.” | Separate successful execution from semantic correctness and permission to cause a consequence. | Application checks reject an unsuitable result or route uncertainty according to domain policy. |
| “I keep rebuilding the plumbing around every Agent.” | Compose reusable methods while leaving authority and execution lifecycle with the host. | Code and Agent work contribute through explicit invocation boundaries, with visible cancellation and failure handling. |
| “My Agents produce too much AI slop.” | Separate plausible generation from work that satisfies the application's checks. | A result accompanied by relevant evidence and a clear reason when work is unsuccessful. |
| “Reviewing everything has become my job.” | Put repeatable checks and procedural coordination in code, reserving attention for judgment and consequences. | More useful work without a proportional increase in supervision. |

These fears involve different failure modes: wrong answers, unintended actions,
and work that cannot be accounted for or stopped. Prompting alone cannot carry
the authority and lifecycle responsibilities of the surrounding application.
Jig's architectural thesis addresses those boundaries; application checks still
own the meaning and acceptability of results. The [Jig doctrine](doctrine/jig.md)
separates program structure, host guarantees, and the quality of an Agent's
answer.

Production users may also need concurrency, throughput, uptime and recovery.
Investigate those requirements separately. Interest in high-load systems is
a demand signal to explore, not evidence of current capacity or a commitment
to build a hosted service. The opportunity does not depend on claiming that
existing Agent deployments are impossible or that other approaches have no value.

## What the reader already understands

Assume familiarity with using an Agent, writing instructions, running scripts,
calling functions, and assembling an application. `SKILL.md` provides a useful
reference point. Do not assume familiarity with FLOW, process protocols,
admission, capability contracts, or microkernel architecture.

The missing connection is how Agent-assisted work can become a directly
invoked part of a program. An executable Flow can run ordinary code, request
Agent judgment, or combine the two. A caller does not need a model to interpret
the method's prose before invoking its executable implementation.

For Jig, connect that method boundary to who authorizes the work, what happens
when an Agent behaves unexpectedly, and how execution ends. Introduce the
microkernel idea through this division of responsibilities so a reader can
understand why a small execution core supports more capable applications.

## What should make adoption attractive

The desired first understanding of FLOW is: “I can build a system from small,
executable capabilities that compose the same way whether they use code,
Agents, or both, and combine them into something more powerful.” The
desired understanding of Jig is: “I can use Agent flexibility within an
application while keeping its authority, composition, and execution lifecycle
under my system's control.”

A useful entry task has recognizable stakes and a bounded result: an
application classifies a request, drafts a proposal grounded in supplied
evidence, or produces a tested patch. Show the Agent's contribution, the code
that evaluates it, and the application's next decision. Start with one useful
method, then demonstrate what becomes possible when it works with another.
Examples should make delegated software operation visible; the software factory
remains one demanding demonstration rather than the whole audience story.
Do not assume that more Agents or more packages improve the result.

Preserving code for a long time is not the initial attraction. Implementations,
models, and workflows change quickly. The value to demonstrate is the work
that becomes achievable through usable methods and their composition.

## Participants and their intended experience

The initial ICP identifies a starting audience; these roles describe different
relationships to the product. One person may occupy several roles, and a
software consumer can act under delegated authority. Exact responsibilities
remain governed by [design judgment](doctrine/design-judgment.md#1-place-each-responsibility-with-its-proper-owner).

| Role | Intended experience |
| --- | --- |
| **Flow author** | Package a method with readable purpose and the code, Skills, resources, schemas, or contracts it needs. |
| **Application or Starter builder** | Combine specialists, customize meaningful choices, and keep domain checks and consequences explicit. |
| **Operator** | Choose Agents, credentials, infrastructure, powers, and limits; understand the accepted work and the host's guarantees. |
| **Software consumer** | Invoke bounded work, consume its result, and handle failure within established authority. |
| **End user** | Receive a useful outcome with the evidence and decisions relevant to them. |

Teams provide a collaboration context, and Agents consume both methods and
documentation. Neither implies a hosted team service or makes every participant
the primary landing-page reader. Authoring a method does not confer authority
over another participant's data, providers, or consequences.

## Questions to validate

Observe builders doing a real task with their current tools before attributing
the whole difficulty to a missing execution format. In particular, investigate:

- which valuable production tasks builders are withholding from Agents, and why;
- how fears of hallucination, misalignment, prompt injection, and unintended
  actions differ from observed failures and current mitigations;
- whether explicit invocation, authority and lifecycle boundaries make those
  tasks practical, and which domain checks remain the builder's responsibility;
- whether the Skills-to-executable-method connection is understandable;
- whether readers understand a common calling boundary without assuming
  identical behavior, authority, or quality across implementations;
- whether composition adds useful capability beyond one Agent or a script;
- whether setup and review costs are justified by the demonstrated benefit;
- whether users can distinguish an executed procedure from a correct answer;
- what concurrency, cost and latency the intended application actually needs.

Use observed task completion, supervision effort, defects, cost, and latency
where the claim requires them. Keep study records in `.tmp/` and update these
hypotheses when evidence changes them. The selected audience is not a limit
on the broader purpose of either product.
