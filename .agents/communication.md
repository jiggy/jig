# Communication — make capability and agency understandable

Jig and FLOW pursue [expanded human possibility](doctrine/purpose.md) through
capability compounding and agency. This guide owns positioning, narrative,
vocabulary, and editorial judgment for their public entrypoints. Read the
[audience model](audience.md) for the initial ICP and its hypotheses, and the
[product compass](product-compass.md) for the governing principles.

Purpose, audience strategy, and communication have separate owners. This guide
applies the product doctrine to a reader's understanding; it does not redefine
the products, establish market evidence, or change exact public contracts.
Published wording belongs in `docs/` and the relevant README. Page drafts,
screenshots, comparisons, and review notes belong in `.tmp/`.

## Lead from recognizable work to greater capability

Speak to the developer who already works with Agents, Skills, and code. They
want to build something useful while keeping up with tools and coordinating
what they already have. Landing pages address that person directly, in fluid,
simple language. Enterprise adoption, governance programs, and organizational
operating models belong in relevant documentation, not the landing-page pitch.

Lead with a concrete compositional promise: **Build with Agents as naturally
as you build with code.** Explain that a Flow can use code, Agent judgment,
or both behind the same callable interface. Name Skills explicitly when they
provide the familiar starting point. Then show how Jig runs the chosen work
with explicit boundaries. Production is a use context, not a substitute for
the developer's own task, frustration, or ambition.

The shared positioning anchor is **the flexibility of AI Agents combined with
the discipline of a traditional codebase**. It connects an existing source of
power with familiar ways to express procedures, compose methods, and check
results. It is not a promise that models become deterministic or error-free.

| Product | Reader's starting point | Connection to establish | Benefit to make tangible |
| --- | --- | --- | --- |
| **FLOW** | Skills and instructions already capture useful know-how. | Executable methods give code and Agent work the same caller-facing boundary; the implementation chooses how to do the work. | Build applications from capabilities that compose consistently whether their methods use code, Agents, or both. |
| **Jig** | Already uses Agents and wants to call their work from an application. | Code and Agent work compose through Flows; Jig keeps authority and execution lifecycle outside model judgment. | Build applications that put Agent intelligence to work within explicit boundaries and handle its outcomes. |

Move from something familiar to a new ability, then to what the reader can
build with it. For example: Skills give Agents instructions and resources;
FLOW brings that work together with code in executable methods a program can
call and combine. Explain the entrypoint when promising execution; the
[Skills bridge](#use-skills-as-a-familiar-bridge) sets the comparison and its limits.

Show the ability to call, compose, check, and replace a method before asking
the reader to appreciate execution architecture. “Reliable” and “unprecedented”
are weak substitutes for those concrete abilities. Reliability needs a named
property and evidence; it must not imply that model judgment becomes correct.
Portability and the small execution core support the story once its value is clear.

## Build one continuous explanation

Each section must answer a question raised by the preceding section. Use a
small number of connected ideas and carry the same task through them. Headings
orient the reader; adjacent prose explains the causal connection. Avoid a
sequence of interchangeable slogans, unexplained abstractions, or abrupt
switches between examples.

The preferred FLOW progression is:

1. Recognize useful work the reader performs with Agents or Skills; name the
   familiar reference explicitly.
2. Show how an executable method can be called directly by code.
3. Show code and Agent judgment behind the same method boundary, with the
   caller composing through the method's contract.
4. Demonstrate what combining methods makes possible: capability compounding.
5. Explain the small package boundary and host independence, then offer a
   concrete first authoring step.

The preferred Jig progression is:

1. Recognize the developer's existing work with Agents, Skills, and code.
2. Show how to call and combine that work through one method interface.
3. Follow a useful task through its result and checks, then explain how explicit
   execution boundaries help when Agent judgment is wrong or work must stop.
4. Explain the microkernel design through what methods, applications, operators
   and Jig each own, and show why composition can grow from that small core.
5. Offer a supported first run, with meaningful prerequisites easy to find.

These are reasoning sequences, not a requirement for five page sections.
Public introductions should explain a Flow before relying on the name. A
landing page invites and demonstrates; a guide teaches a complete task; a
specification defines exact behavior. Research keeps its evidence status.

## Use Skills as a familiar bridge

Name `SKILL.md` or Skills explicitly when using them as the familiar bridge.
“Teaching an Agent” does not by itself establish that association. Begin with
a recognizable task and show the greater system the reader can build from it.
Present FLOW as an evolution in what builders can do with a method, rather
than making the whole page a comparison with Skills.

An executable Flow can be invoked by a compatible host without a model first
interpreting its Markdown to decide which script to run. This permits ordinary
code to govern procedural steps and avoids requiring model calls for that
coordination. Explain this mechanism before making any measured performance
claim. A Skill's bundled script can also be run directly by code; the comparison
concerns the method's defined invocation boundary, not a ban on running files.

Skills can bundle executable scripts and load resources progressively. FLOW
also supports Markdown implementations through a compatible interpreter.
Explain the entrypoint and required host support when promising invocation or
composition; a Markdown rename alone does not establish that support or grant
execution authority. Claims about exact file compatibility must follow
[Package/0](../docs/flow/spec/package-format.md) and the
[Agent Skills specification](https://agentskills.io/specification).
“Evolution” does not establish universal rename compatibility or deprecation
of Skills. Existing Skills can remain useful within an Agent-assisted method.

## Explain control through the work it enables

Describe execution reliability in terms of a procedure expressed and run as
code: inputs, ordering, calls, checks, branches, and stopping conditions. Agent
judgment remains inside the steps that need it. Ordinary bugs and uncertain
model output remain possible; useful checks require application knowledge.
Uptime, disaster recovery, and semantic correctness need their own evidence.

Name the fear of an Agent hallucinating, following injected instructions, or
taking unintended actions without turning it into a claim of universal
protection. Jig makes work governable and composable; it does not make judgment
correct. Explain how host authority and application checks address different
parts of the problem. A harmful decision within granted authority can still
occur. Give the reader the relevant limit alongside the mechanism it qualifies.

Introduce Jig's control through understandable execution, inspectable evidence,
and the ability to direct and stop work. Powers and permissions remain essential
and explicit where a user makes those decisions. Do not imply a human must
approve every step already covered by delegated authority.

“Execution envelope” can illustrate a Flow's bounded input, method, and result.
Pair the metaphor with a concrete explanation; it is not a new public type.
A visual may show data moving between these pieces and reveal the code or
Agent work inside them. It must not imply an autonomous routing engine, a
general scheduler, or host control of a Flow's internal graph.

## Explain why we believe in the architecture

**One compositional model for code and Agents** is central to the story.
For Jig and FLOW, AI-native means that a caller can compose executable methods
through the same boundary whether their implementation uses code, Agent
judgment, or both. FLOW owns that common method boundary; Jig owns local
authority and execution lifecycle. Explain their complementary contributions.

“Build with code and Agents as parts of the same system” expresses the benefit.
Make it concrete by showing a caller invoking a method and then revealing
different implementations behind its contract. The calling model stays
consistent; the required powers, side effects, quality and performance remain
visible where they matter. A shared interface does not prove that two methods
are behaviorally interchangeable.

“A microkernel for agent-native systems” is an architectural analogy worth
explaining. Pair it immediately with the concrete division: methods own work,
applications own purpose, operators supply powers, and Jig owns the common
execution boundaries. This is how the small core supports richer methods
without absorbing every Agent technique or becoming a workflow language.
Use the analogy primarily in positioning and architectural explanation: it
signals a powerful host, not a requirement for users to understand kernel
internals. It does not set development priorities or make extracting more
modules a product achievement. Show what the boundaries let a builder accomplish
with less configuration and coordination.

Lead with the positive design conviction: Agents have room to reason within
their role, code can express known procedures, and software can compose both
while authority and execution lifecycle stay explicit. Explain what makes
this arrangement distinctive through its responsibilities and consequences.
Our reason for building does not depend on a competitive ranking.

Follow the doctrine's distinction between
[beliefs, commitments, and demonstrated properties](doctrine/design-judgment.md#beliefs-commitments-and-demonstrated-properties).
State beliefs confidently as beliefs and explain their reasoning. Do not make
every architectural explanation wait for a comparative benchmark. Measured
speed, proven threat resistance, production scale, exclusivity and superiority
are factual claims and need their own evidence. Avoid “the only solution,”
“agents cannot run in production,” and “eliminates prompt injection.” Those
claims are unnecessary to explain why this architecture deserves to exist.

## Make examples earn the promise

Use an ordinary public example and trace its input, method, checks, and result.
Identify where an Agent reasons, where code executes directly, and what the
recipient must still decide. Distinguish an illustrative walkthrough from
actual execution. A conceptual composition is not evidence of a working app.

Claim a gain in capability, supervision effort, correctness, cost, or latency
only to the extent demonstrated. A successful invocation, another Agent's
agreement, and a useful domain result are different evidence. The
[product proof standards](doctrine/design-judgment.md#what-would-count-as-proof)
govern the claim; technical details and limitations should appear where they
help a reader make a decision.

## Editorial review

Before delivering an entrypoint, check that a new reader can explain the
product and its value in their own words. Review these concrete properties:

- The opening connects a familiar task to something more achievable.
- Each section supplies the reason for the next; remove repeated slogans.
- The example makes direct execution, Agent involvement, and checks visible.
- The Jig story connects development assistance to delegated application work
  and explains the positive reason for its architecture.
- FLOW independence and the application/method/host responsibilities are clear.
- Design convictions are expressed clearly and distinguished from demonstrated
  guarantees; model correctness is not implied by execution control.
- Reliability, compatibility, and comparative claims match their evidence.
- The next step is useful, and its requirements are discoverable.
- The narrative remains complete in generated Markdown, including tab content.

Preserve the reasoning behind effective language while allowing exact copy to
improve. Revisit the audience model when reader evidence contradicts its
assumptions; change doctrine only through its owning authority.
