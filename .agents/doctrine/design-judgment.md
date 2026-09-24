# Design in service of capability and agency

Design decisions serve [FLOW's capability compounding](flow.md) and
[Jig's agency through power under control](jig.md), under the shared purpose
to [expand human possibility](purpose.md). This is the wider layer of the
pyramid: it turns the product principles into responsibilities, constraints,
tradeoffs, and decision criteria.

## Design principles

Three principles govern how the wider layer can develop.

1. **Place each responsibility with its proper owner.** The standard, host,
   methods, runtimes, applications, and operators have different jobs.
2. **Preserve the promise with the least burden.** Reduce unnecessary
   machinery while keeping authority, ownership, and failure guarantees intact.
3. **Let evidence bound the next decision.** Demonstrate useful outcomes and
   stop at the smallest sufficient change.

## 1. Place each responsibility with its proper owner

A small host depends on other components owning substantial work. The split
is about which truth each layer is responsible for, not merely which package
contains its code.

| Layer | Responsibility |
| --- | --- |
| **FLOW** | Portable package meaning, values, finite invocation and outcomes, and optional exact interoperability contracts |
| **Jig** | Discovery, capture, review, admission, exact binding of operator-provided powers, limits, lifecycle, and accountable execution |
| **Flow package** | Domain method, prompts, selected Skills, validation, and bounded local control |
| **Runtime** | Live advancement of its internal graph or program without acquiring Jig or FLOW policy |
| **Application or Starter** | User experience, domain state, triggers, business rules, repository policy, and human gates |
| **Operator environment** | Agents, endpoints, models, credentials, infrastructure, containment, and data policy |

A concept belongs in Jig only when Jig must enforce it across an authority,
trust, process, cancellation, lifetime, or durability boundary. Otherwise a
Flow, library, provider, application, or Starter should own it. Crossing such a
boundary is a reason to examine a host responsibility, not automatic
justification for a new public abstraction.

### The microkernel architectural thesis

Jig draws on microkernel architecture: keep the common execution core focused
on responsibilities that must hold across component boundaries, and let
substantial capability live in independently composed methods. Methods own
their work; applications own their purpose; operators own their powers. Jig
owns the boundaries through which authorized work begins, interacts, and ends.

We believe this separation is a strong foundation for agent-native software.
Methods can combine authored procedures with flexible Agent judgment while
authority and execution lifecycle remain outside the model's judgment.
Capability can grow through composition without requiring the host to absorb
each new workflow or Agent technique. Runtime independence lets authors choose
how their methods advance; explicit boundaries let other software use the work.

"Microkernel-inspired" is primarily a communication analogy for a powerful
host with clear responsibilities, not a development objective. Prioritize useful
power, easier adoption and composition, and less configuration and lifecycle
knowledge for consumers. Neither shrinking the core nor extracting another
module into a Flow earns priority by itself. Judge extraction by the reuse,
replaceability, or reduced burden it enables while preserving the boundaries.

This does not require an operating system, general service framework, or
universal application model. Flows perform bounded work; optional invocation
contracts name interfaces, including services backed by host-held powers.
Uniform calls do not make that native authority package authority. FLOW's
independent method boundary does not adopt Jig's host policy. The product
reasoning lives in [FLOW](flow.md) and [Jig](jig.md); the
[communication guide](../communication.md) owns the architectural analogy's use.

## 2. Preserve the promise with the least burden

Simpler design must preserve the principles above it. The costs accepted here
protect those principles; the warning signs identify burden that often does
not serve them.

### Tradeoffs we accept

The boundaries have costs. Recognizing them prevents later teams from
accidentally removing the promise while trying to remove its friction.

| Accepted cost | What it protects |
| --- | --- |
| Local review and admission friction | Meaningful authority over exact accepted work |
| Process and protocol overhead | Language, framework, and failure isolation |
| Less universal graph introspection | Runtime independence and ownership of internal control |
| Semantic nondeterminism inside exact eligibility and limits | Useful flexible choice without model-created authority |
| Visible failure when required support is absent | Honest meaning instead of silent semantic degradation |
| Slower breadth while independent use earns extension points | A small understandable product rather than speculative machinery |

These choices are deliberate, not claims that every overhead is necessary.
An alternative deserves consideration when it preserves the same meaningful
boundary with less burden. An easier path that weakens authority, hides
uncertainty, or silently changes meaning is not equivalent.

Minimalism concerns concepts and user burden. Private machinery can be
substantial when it upholds a demonstrated safety, failure, or lifecycle
invariant. Neither a smaller file nor a smaller table count is sufficient
evidence of a better design. Equally, invoking safety does not excuse machinery
whose actual responsibility has disappeared.

### Progressive disclosure is a design obligation

Some distinctions are essential; making every caller manually coordinate them
is not. Preserve the difference between observations and results, requested
cancellation and settled work, or a valid answer and retained state. Put their
repetitive coordination in reusable SDK or library helpers, methods, or host
machinery at the layer that owns the responsibility. Keep application decisions
and operator authority explicit.

An ordinary author should concentrate on the method, and an operator on its
powers. Introduce advanced controls when the task needs them, without requiring
simple callers to learn unused protocols or lifecycle states. Defaults and
helpers must preserve inspectable choices, honest failures and cleanup; they
must not silently grant powers, retry uncertain work, or equate partial results
with success.

Judge simplicity across the complete consumer task, not by API method count.
Count required concepts, configuration files, duplicated declarations, manual
wiring and recovery code. Prefer making existing power easier to use over
adding another abstraction. A reusable public correction must work in ordinary
consumer projects; example-only wrappers or extra instructions that conceal
product friction do not satisfy this obligation.

### Warning signs

A proposal deserves particular scrutiny when it adds a domain or named
workflow primitive, configuration for nearly every component, host policy
inside FLOW, hidden listener sequencing, a contract for ordinary work, or a
public framework inferred from one implementation. These are recurring signs
that another layer's responsibility is becoming user-facing platform burden.

Jig is not intended as a universal graph language, Agent-provider SDK,
GUI/Git/Kanban framework, general package manager, universal service bus, or
mandatory registry. Finite work does not by itself require a durable engine;
one containment mechanism does not earn a public sandbox framework; remote
execution does not itself require a cloud control plane. Nor do unpromoted
drafts justify a museum of compatibility formats. Removing these temptations
keeps room for the work the product actually promises.

## 3. Let evidence bound the next decision

A vision guides judgment without proving that a chosen mechanism works.
Decision criteria, experiments, and useful applications supply that evidence;
none authorizes a contradiction of a higher-level commitment.

### Beliefs, commitments, and demonstrated properties

Architectural conviction explains why we build. We can state that conviction
and its causal reasoning directly, without first establishing a competitive
ranking. Three kinds of statement have different roles:

| Kind | Role | Example |
| --- | --- | --- |
| **Belief** | Explains why a direction is worth pursuing. | Explicit execution boundaries are a strong foundation for composing Agent intelligence into software. |
| **Commitment** | Constrains acceptable designs. | Model output cannot grant itself authority, and owned execution must be settled. |
| **Demonstrated property** | Reports what evidence establishes under stated conditions. | A particular implementation fences descendants after coordinator failure under its tested threat model. |

Beliefs deserve clear arguments; commitments guide implementation; demonstrated
properties require evidence. Conviction is not a substitute for proof of a
security guarantee, performance claim, or comparative advantage. Equally,
evidence standards should not make an explanation of our design depend on a
benchmark or reduce its ambition to what one current test exercises. None of
these categories changes the product authority pyramid or silently selects a
new API, implementation, or release claim.

### The decision test

For every project decision, first identify the core idea, guiding principles,
and existing commitments it must satisfy. A lower-level choice cannot
contradict them; a broad appeal to agency, compounding, or simplicity cannot
waive a specific safeguard. A conflict needs explicit resolution at its owning
level before dependent work proceeds.

For a material change, apply that hierarchy through these questions:

1. Which higher-level principles does the change serve? What valuable outcome
   becomes possible, and what is its strongest credible simpler baseline?
2. Could a Flow, library, provider, application, or Starter own it instead?
3. What authority, information, or lifetime crosses a boundary? Who grants,
   observes, and revokes it, and can the operator understand the change?
4. Can existing finite calls, exact choices, schemas, ordinary data, and sane
   defaults express the outcome? Which configuration or lifecycle coordination
   must the consumer still manage, and which can its responsible layer remove?
5. Has an independent consumer required this abstraction, or is one
   implementation being mistaken for a portable interface?
6. What happens when a model lies, abstains, returns malformed data, or names
   something outside the admitted set?
7. How does work fail, cancel, remain uncertain, and end without overstating
   success?
8. What would falsify its value, and what are the stopping and deletion rules?

Vague answers favor waiting or a smaller experiment. Owner suggestions,
specialist reviews, and external reports are proposals to examine, not evidence
by themselves. A reviewed owner decision establishes direction; agreement by
several critics does not establish that its mechanism works.

### What would count as proof

The product thesis is progressively earned through distinct kinds of evidence.
A passing interface test, a useful method, and an adopted ecosystem establish
different things.

1. **Portability and reuse are real.** Independent consumers collaborate
   through public boundaries. A claimed host, application, or provider
   substitution works without private integration knowledge. Calling this
   compounding additionally requires evidence of added usable capability
   through that reuse or combination.
2. **Authority survives failure.** Package and model behavior stays within
   host-granted authority under the claimed threat model. Lifecycle promises
   remain true through failure, cancellation, and uncertainty.
3. **Public usability is real.** An unfamiliar user obtains the claimed
   outcome from public artifacts and understands the meaning and authority
   being accepted.
4. **The ceremony is justified.** A complete application shows a material
   advantage over its strongest credible simpler baseline on the dimensions
   it claims.
5. **Claims remain proportional.** Evidence about one bounded outcome does
   not establish all future applications, mechanisms, or the whole ecosystem.

Specifications define exact contracts within these commitments; conformance
checks those contracts; security owners prove containment;
applications choose their domain metrics; the roadmap orders outcomes. These
product standards are not an additional feature checklist or a demand to run
a market comparison at every engineering checkpoint. When a simpler tool
provides the same meaningful outcome and guarantees with less ceremony, it
should win.

Every delivery phase needs a compelling user-facing example. Internal protocol
milestones alone are not a promotable benefit. Safety serves useful outcomes;
the product story must show what people or systems can accomplish with it.

### Sequence and independent use

A mechanism developed before its consumer demonstrates a need can burden
every earlier outcome. A service model, event system, graph compiler,
catalogue, or update engine may be reasonable in isolation while still being
premature for the product.
Completing one useful vertical earns only its demonstrated requirements, not
automatic authorization for the next subsystem.

A design probe is an experiment in which someone builds an application using
the proposed public interface. A platform author can repair or explain an
interface while using it, hiding the gaps such an experiment should reveal. Independent consumers must receive a frozen public surface and
cannot change the platform while consuming it. Failure is evidence to examine,
not a result to prompt-tune away. Co-design remains useful when identified as
such; it cannot substitute for independent usability evidence. The operational
procedure is described in the [maintainer guide](../maintainer-guide.md).

Small inward and outward iterations are compatible with this discipline:
consume a boundary, review the evidence, deliberately revise it, then test the
next candidate independently. The outcome determines when to stop. Elaborating
a platform until every imagined use fits is not completion.

### The software factory makes the thesis visible

The software factory remains a demanding north-star application. It illustrates
the broader ambition of applications incorporating Agent work into their own
operation, with explicit authority, composition, checks, and completion. Its
development domain does not limit that ambition to coding assistance.

The application combines the promises into an outcome people can inspect:

```text
authorized issue
    -> bounded planning and implementation
    -> disposable workspace authority
    -> exact tests and independent evidence
    -> inspectable patch
    -> human merge and release
```

Its baseline is deliberately strong: one capable coding Agent with repository
access, CI, and human review. Jig must materially justify its additional
ceremony through the advantage it claims: accepted-result quality, fewer
escaped defects or unauthorized actions, lower operator burden, reusable
methods, clearer evidence, or safer adaptation. It need not win every dimension.

Role-specific context, least authority, and recovery are part of this proof,
alongside reusable specialists and exact checks. The human merge gate belongs
to this application's consequence policy. It does not impose a universal
manual gate on every Jig application. Similarly,
Tasks, Git, Kanban, and worktrees remain application concepts. The factory is
a demanding proof of reusable work, not a license to make its domain the
kernel or a guarantee that it will beat the simpler baseline.

### Questions still open

The vision does not settle ecosystem discovery, publisher identity,
reputation, provenance, or comprehensible review at large scale. Nor does it
settle the smallest seam for outside activation or long-lived services, or
operator-held authority across different Agents, runtimes, containment
mechanisms, remote hosts, and multi-user environments.

If outside activation is earned, observed facts must stay distinct from
application policy reacting to them. Required sequencing remains explicit
work; an accidental listener chain must not become invisible middleware. The
public activation mechanism remains unselected.

Likewise, comparisons with other systems are sources of questions rather than
compatibility or roadmap commitments. Complete applications, independent
implementers, and conformance failures should reveal the needed boundaries.
The [roadmap](../coordination/ROADMAP.md) owns their order; these questions
authorize no new subsystem on their own.
