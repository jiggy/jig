# FLOW — capability compounding

FLOW's core idea is **capability compounding**. Its substance is executable
know-how: a useful way of doing work that others can apply, evaluate, adapt,
and share. Portability and composability support this purpose; a portable file
or a successful invocation alone does not demonstrate it.

## How a method becomes accumulated capability

A method becomes more valuable when later practitioners can build on its
working procedure instead of starting again. A research method, for example,
might preserve how sources are separated, claims checked, disagreements
resolved, and uncertainty reported. Its reusable value extends beyond the
report it produced on one occasion.

Capability can grow when an unchanged good method reaches a new consumer, or
when combining methods makes a previously impractical outcome achievable.
Revising the procedure is one route to improvement, not the only one. The
intended loop is:

```text
capture a useful method
    -> apply or combine it in another setting
    -> evaluate the result and its limits
    -> preserve and share what proved useful, adapting where needed
    -> give the next practitioner a better starting point
```

Compounding describes gains in usable capability building on earlier ones.
It does not promise automatic learning, exponential growth, or improvement
with every revision. Repeated copying accumulates packages; it does not
establish accumulated capability. A method can also carry bad assumptions into
its next application.

Evaluation closes the loop. A claimed gain needs evidence appropriate to its
purpose, and the method or combination must remain usable by others. Models,
data, tools, and operating conditions can change its effectiveness. Portable
meaning cannot guarantee identical results or transfer an expert's full competence.
FLOW enables this exchange; applications and practitioners establish whether
what they exchange is worth inheriting.

## Why a procedure deserves its own boundary

Some methods derive their value from execution structure: independent
contexts, ordering, repeated attempts, external checks, integration, and
stopping conditions. Asking one Agent to follow a description may be entirely
sufficient. When the structure itself matters, a reusable procedure should
make it dependable rather than leave every consumer to reconstruct it.

Skills, tools, libraries, and graph runtimes remain valuable. A Skill can
include scripts and a tool can expose a complex workflow; these are not rigid
categories separating knowledge from executable work. FLOW's proposal is a
shared package and invocation boundary for the complete method, independent
of how its author implements that method.

A Flow performs bounded work. It owns its domain logic, prompts, selected
Skills, validation, and internal method. FLOW owns portable package meaning,
values, finite invocation, outcomes, and optional exact interoperability
contracts. Exact public mechanics remain in the
[FLOW specifications](../../docs/flow/spec/).

## Independence is a practical requirement

A method that travels only by adopting Jig's authority model or one runtime's
internal graph is still coupled to that host or framework. FLOW therefore
remains independent of Jig and neutral about provider selection, credentials,
containment, persistence, and application structure. Portable meaning does not
carry local permission to execute it; each host supplies that authority.

The intended interchange leaves internal control with the implementing
runtime. A graph, plain program, or another suitable execution model can own
its live advancement. Jig must not mirror its nodes, reconstruct its control,
or give a preferred runtime privileged product semantics. This costs some
universal introspection and accepts a process/protocol boundary; those are
deliberate [tradeoffs](design-judgment.md#tradeoffs-we-accept).

Jig should be an excellent FLOW host, not a prerequisite for FLOW packages to
exist. A particular host may support only a subset of implementations and must
state that honestly. Neutrality does not mean every package runs everywhere,
and missing execution support cannot silently substitute a different method.

## Precision should earn its cost

Readable purpose and inspectable package content make a method understandable
before anyone accepts it. Simple bounded work should not require a formal
capability contract merely because it contains a sophisticated procedure.
Ordinary invocation and appropriate input/result validation should remain
the simple path.

An exact contract earns its place where independently maintained consumers
need a stable, machine-verifiable interface. Complexity, size, or number of
Agents is not itself that requirement. Host configuration, dependency locks,
runtime choices, and internal snapshot evidence retain their own homes;
unnecessary precision in the method's human-facing description creates burden
without establishing compatibility or trust.

The point is to make methods easy to exchange while remaining exact where
ambiguity changes interoperability. Semantic resemblance between descriptions
is not proof that two components can substitute for one another.

## Methods belong to their authors and users

Gauntlets, independent juries, debate, research/review separation, tree search,
and prompt optimization should be expressible as excellent Flows, libraries,
or Starters. These methods should travel through FLOW and run on Jig or other
hosts without becoming features owned by the standard or host. A growing
collection of named techniques is not a reason to add matching kernel
primitives or invent a universal graph language.

The same restraint applies inside a method. More Agents are useful when they
add different evidence, context, expertise, authority, or failure independence.
Multiple instances are not automatically independent judges. Tests, retrieval,
execution, simulation, and human review can provide stronger feedback than
another round of verbal agreement. A genuinely strong single-Agent or
deterministic method belongs in this ecosystem too.

The product claim is earned when a useful method can be consumed, adapted, or
combined through public boundaries without private knowledge of its author's
stack. Where a simpler existing format already does that job, wrapping it in
FLOW must justify the extra burden. Method quality and interface conformance
are separate evidence, both needed for a credible story of compounding.
