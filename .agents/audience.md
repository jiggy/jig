# Audience — builders whose capability is outgrowing their attention

Jig and FLOW serve the aspiration to [expand human possibility](doctrine/purpose.md).
This document owns the initial ideal customer profile (ICP), audience needs,
domain understanding, and adoption hypotheses. The [product compass](product-compass.md)
owns the authority map; the [communication guide](communication.md) explains
how to address this audience. Audience strategy can change without changing
the shared purpose or the products' core ideas.

## Initial audience

The chosen initial audience is developers who already use Agents to do useful
work, alone or in small teams, and want to build larger systems from that
capability. They work with Skills, prompts, scripts, and ordinary application
code. Their ability to generate work can outgrow their ability to review and
coordinate it.

This is a product direction informed by the owner's experience. The pain,
adoption, and benefit claims below are working hypotheses, not findings from
an independent customer study. They guide examples and discovery without
establishing market size, willingness to pay, or product superiority.

## Felt problems and underlying needs

Start from the way a builder experiences the work. Technical explanations
should help them understand a recognizable problem.

| Likely expression of pain | Need to investigate | Useful outcome to demonstrate |
| --- | --- | --- |
| “My Agents produce too much AI slop.” | Separate plausible generation from work that satisfies the application's checks. | A result accompanied by relevant evidence and a clear reason when work is unsuccessful. |
| “Reviewing everything has become my job.” | Put repeatable checks and procedural coordination in code, reserving attention for judgment and consequences. | More useful work without a proportional increase in supervision. |
| “I keep repeating the steps, and the Agent still misses things.” | Express important ordering, validation, and stopping conditions as execution. | A method whose procedure is explicit and inspectable. |
| “Adding another Agent gives me more work to coordinate.” | Compose focused methods through defined inputs and results. | Several understandable pieces accomplish a task together. |

“Unreliable execution” may be an accurate diagnosis without being the phrase
that attracts this audience. Here the relevant concern is whether the intended
procedure runs as authored. Uptime and disaster recovery are different concerns.
The [Jig doctrine](doctrine/jig.md) separates program structure, host guarantees,
and the quality of an Agent's answer.

## What the reader already understands

Assume familiarity with using an Agent, writing instructions, running scripts,
calling functions, and assembling an application. `SKILL.md` provides a useful
reference point. Do not assume familiarity with FLOW, process protocols,
admission, capability contracts, or microkernel architecture.

The missing connection is how Agent-assisted work can become a directly
invoked part of a program. An executable Flow can run ordinary code, request
Agent judgment, or combine the two. A caller does not need a model to interpret
the method's prose before invoking its executable implementation.

## What should make adoption attractive

The desired first understanding of FLOW is: “I can build a system from small,
executable capabilities and combine them into something more powerful.” The
desired understanding of Jig is: “I can use Agent flexibility within an
application whose procedure I can understand, run, and direct.”

A useful entry task has recognizable stakes and a bounded result: a tested
patch, a proposal grounded in supplied evidence, or another procedure with
checks the builder understands. Start with one useful method, then demonstrate
what becomes possible when it works with another. Do not assume that more
Agents or more packages improve the result.

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

- whether review and coordination are the limiting work;
- whether the Skills-to-executable-method connection is understandable;
- whether composition adds useful capability beyond one Agent or a script;
- whether setup and review costs are justified by the demonstrated benefit;
- whether users can distinguish an executed procedure from a correct answer.

Use observed task completion, supervision effort, defects, cost, and latency
where the claim requires them. Keep study records in `.tmp/` and update these
hypotheses when evidence changes them. The selected audience is not a limit
on the broader purpose of either product.
