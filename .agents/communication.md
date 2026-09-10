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

The reader already sees what Agents can produce. Help them see how to turn
that capability into a system they can understand and direct. Begin with a
recognizable task or difficulty, explain the missing connection, and demonstrate
the benefit before introducing its architectural machinery.

The shared positioning anchor is **the flexibility of AI Agents combined with
the discipline of a traditional codebase**. It connects an existing source of
power with familiar ways to express procedures, compose methods, and check
results. It is not a promise that models become deterministic or error-free.

| Product | Reader's starting point | Connection to establish | Benefit to make tangible |
| --- | --- | --- | --- |
| **FLOW** | Skills and instructions already capture useful know-how. | A method can also expose executable code that a program invokes directly; Agent involvement is chosen inside the method. | Build applications from capabilities and make more work achievable by combining them. |
| **Jig** | Agent output is hard to keep up with, coordinate, and review. | Flows express methods in code and Jig supplies the host boundary for running them. | Run understandable procedures that use Agent judgment and produce evidence for the next decision. |

Portability and a small architecture explain how the promise is sustained.
They should follow the immediate benefit. Long-lived code, protocol elegance,
or restrictions alone are weak opening reasons for this audience to care.

## Build one continuous explanation

Each section must answer a question raised by the preceding section. Use a
small number of connected ideas and carry the same task through them. Headings
orient the reader; adjacent prose explains the causal connection. Avoid a
sequence of interchangeable slogans, unexplained abstractions, or abrupt
switches between examples.

The preferred FLOW progression is:

1. Recognize useful work the reader has already taught an Agent to perform.
2. Show how an executable method can be called directly by code.
3. Show ordinary code and Agent judgment contributing to the same application.
4. Demonstrate what combining methods makes possible: capability compounding.
5. Explain the small package boundary and host independence, then offer a
   concrete first authoring step.

The preferred Jig progression is:

1. Recognize the work of supervising and evaluating Agent output.
2. Follow a useful application through its procedure and checks.
3. Explain what the methods and application own, and what Jig handles.
4. Show how those pieces enable further work while remaining understandable.
5. Offer a supported first run, with meaningful prerequisites easy to find.

These are reasoning sequences, not a requirement for five page sections.
Public introductions should explain a Flow before relying on the name. A
landing page invites and demonstrates; a guide teaches a complete task; a
specification defines exact behavior. Research keeps its evidence status.

## Use Skills as a familiar bridge

“You've taught an Agent how to do useful work” is a useful opening because it
starts with a capability the reader values. Continue toward the greater system
they can build from it. Present FLOW as an evolution in what builders can do
with a method, rather than making the whole page a comparison with Skills.

An executable Flow can be invoked by a compatible host without a model first
interpreting its Markdown to decide which script to run. This permits ordinary
code to govern procedural steps and avoids requiring model calls for that
coordination. Explain this mechanism before making any measured performance
claim. A Skill's bundled script can also be run directly by code; the comparison
concerns the method's defined invocation boundary, not a ban on running files.

Skills can bundle executable scripts and load resources progressively. FLOW
also permits instructions-only packages. Explain the executable entrypoint
when promising invocation or composition; a Markdown rename alone does not
create executable behavior. Claims about exact file compatibility must follow
[Package/1](../docs/flow/spec/package-format.md) and the
[Agent Skills specification](https://agentskills.io/specification).
“Evolution” does not establish universal rename compatibility or deprecation
of Skills. Existing Skills can remain useful within an Agent-assisted method.

## Explain control through the work it enables

Describe execution reliability in terms of a procedure expressed and run as
code: inputs, ordering, calls, checks, branches, and stopping conditions. Agent
judgment remains inside the steps that need it. Ordinary bugs and uncertain
model output remain possible; useful checks require application knowledge.
Uptime, disaster recovery, and semantic correctness need their own evidence.

Introduce Jig's control through understandable execution, inspectable evidence,
and the ability to direct and stop work. Powers and permissions remain essential
and explicit where a user makes those decisions. Do not imply a human must
approve every step already covered by delegated authority.

“Execution envelope” can illustrate a Flow's bounded input, method, and result.
Pair the metaphor with a concrete explanation; it is not a new public type.
A visual may show data moving between these pieces and reveal the code or
Agent work inside them. It must not imply an autonomous routing engine, a
general scheduler, or host control of a Flow's internal graph. Introduce
“microkernel-inspired” only after the small host's responsibility is understood.

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
- FLOW independence and the application/method/host responsibilities are clear.
- Reliability, compatibility, and comparative claims match their evidence.
- The next step is useful, and its requirements are discoverable.
- The narrative remains complete in generated Markdown, including tab content.

Preserve the reasoning behind effective language while allowing exact copy to
improve. Revisit the audience model when reader evidence contradicts its
assumptions; change doctrine only through its owning authority.
