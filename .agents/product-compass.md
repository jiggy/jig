# Jig and FLOW product compass

This is durable product memory for a future leader who remembers nothing about
Jig or FLOW. It preserves the intent, audience, promises, tradeoffs, design
judgment, and proof standards needed to keep the project coherent.

It is deliberately lossy about mechanics. Public specifications and
conformance evidence own exact behavior; the engineering re-entry guide owns
the stable implementation model; the roadmap owns outcome order. This file
should help a leader reach sound decisions again, not memorize every decision
ever proposed.

The document has three stability layers:

1. **Product thesis** — the purpose, enduring promises, and current audience
   hypothesis. Change these only when product evidence changes the thesis.
2. **Design compass** — the durable boundaries that currently best protect the
   thesis. Change these only when product evidence supports a better boundary.
3. **Proof and leadership memory** — the standards and lessons used to test
   both. Refine these when experience improves the project's judgment.

## Part I — Product thesis

### The one-minute memory

Jig and FLOW let people assemble serious agentic applications from reusable
specialist workflows without surrendering control to a model, framework,
vendor, or package author.

People increasingly design the Agents, methods, tools, checks, and feedback
loops that perform useful work. Those systems should be shareable and
improvable while remaining owned by the people who authorize and depend on
them.

The deepest architectural insight is the separation of **intelligence from
authority**. Models may interpret, propose, create, criticize, and choose among
admitted alternatives. They must not silently decide what software is trusted,
which powers exist, which exact revision runs, or which consequential action is
authorized.

> FLOW makes agentic work portable. Jig lets intelligence remain flexible
> while authority remains exact.

The ownership mnemonic is:

> FLOW carries meaning. Jig carries authority and lifecycle. Flows carry
> method. Runtimes carry internal control. Applications carry purpose.

The aspiration is to make an agentic procedure as easy to share as a Skill, as
natural to compose as a function, with human-readable purpose and inspectable
package content, and as governable as an operating-system process.

A physical jig guides tools toward accurate, repeatable work without becoming
the thing being made. The product should do the same: enable people to build
and refine systems that work, while keeping their powers constrained by the
people who own the consequences.

### The problem, audience, and opportunity

Most agent systems place prompts, workflow meaning, model choice, tools,
credentials, control flow, permissions, state, and domain policy inside one
application. This makes demonstrations easy and trustworthy ecosystems hard.

In such systems, useful methods cannot travel without their frameworks;
changing a provider can change the application; model-selected control can
quietly become execution authority; and operators cannot reliably tell what
was proposed, admitted, executed, left running, or allowed to have
consequences.

Jig and FLOW separate those concerns without replacing them with a universal
application framework. Three distinctions anchor the separation:

- **Portable meaning is not portable authority.** A Flow may travel widely;
  every host decides locally whether, where, and with what powers it may run.
- **Discovery is not admission.** Finding, downloading, parsing, or ranking a
  package never grants execution.
- **Intelligence is not authority.** A model result remains data until policy
  validates it and an authorized component acts on it.

The first serious users are people building repeated AI-assisted processes for
which one chat or embedded model call is no longer enough:

- Flow authors distributing readable specialist procedures without forcing a
  framework;
- application and Starter authors composing those procedures into coherent
  products;
- operators choosing Agents, credentials, infrastructure, data posture,
  limits, and approval boundaries;
- teams in which the procedure author, data owner, Agent provider, reviewer,
  and consequence owner may be different people or organizations; and
- advanced individuals who want to own and improve the systems performing
  their work.

The same person may occupy every role in a small installation. The architecture
must remain sound when they do not.

No single ingredient is the differentiation. A package format does not govern
execution; a workflow engine does not separate model judgment from authority;
an Agent SDK does not make methods portable; a sandbox does not supply meaning
or admission; and a graph runtime does not own credentials or consequences.

The product is the join among portable workflow meaning, operator-controlled
admission, deterministic authority around probabilistic judgment, bounded
composition, host-selected capabilities, visible user-owned source, explicit
lifetime, and human or application ownership of consequences.

The market story is not “more orchestration machinery.” It is reusable
agentic work that an independent operator can understand, adapt, authorize,
combine, observe, and stop.

### The finished experience

A healthy ecosystem should make this ordinary:

```text
discover useful work
    -> inspect its meaning
    -> admit an exact revision
    -> bind the collaborators and powers it needs
    -> run it under bounded authority
    -> receive evidence and an outcome
    -> edit it as ordinary source
    -> combine it without adopting its internal framework
```

From each role, the system should feel simple:

| Role | Finished experience |
| --- | --- |
| **Flow author** | Describe and package one useful method; add exact execution, schemas, Skills, resources, and contracts only when needed; share it without forcing an application framework or Agent provider. |
| **Application builder** | Compose admitted methods with sane defaults; use Bindings for meaningful configuration and exact composition, and semantic choice only where explicit routing is inadequate. |
| **Operator** | Choose Agents, credentials, infrastructure, data policy, limits, and approval requirements; evaluate the host's documented containment; understand exactly what is accepted and what remains alive. |
| **End user** | Receive the application outcome without confronting kernel concepts unless consent or diagnosis requires them. |

Applications and Starters turn the small host into coherent products. No one
application domain becomes Jig itself, and no registry, runtime, language,
Agent, or vendor owns the ecosystem.

### Non-negotiable promises

These survive changes in mechanism, provider, platform, and product phase.

1. **FLOW remains independent of Jig.** It stays neutral about hosts,
   runtimes, providers, containment, persistence, and application structure.
2. **Models return data, not authority.** They may interpret, propose, rank, or
   choose only within authority established elsewhere.
3. **Discovery never grants execution.** Local policy admits one exact meaning;
   later source changes do not inherit trust silently.
4. **The host owns powers.** Packages cannot choose credentials, provider
   identity, infrastructure, containment, or consequence policy.
5. **Consequential authority remains with its real owner.** Completing a Flow
   does not itself authorize publication, purchase, deployment, deletion,
   communication, legal approval, or another irreversible act.
6. **Runtimes own internal control.** Jig does not become a second scheduler or
   give one recognized runtime privileged product semantics.
7. **Every effect and live resource has an owner.** Completion follows bounded
   revocation, fencing, and cleanup rather than merely receiving a plausible
   result.
8. **Failure and uncertainty remain honest.** Missing support fails visibly;
   possibly dispatched work is not guessed successful or silently repeated.
9. **User-owned meaning remains inspectable.** Avoid hidden overlays,
   competing effective sources, and package magic that prevents understanding
   or adaptation.
10. **The kernel contains no application or workflow ontology.** Tickets, Git,
   Kanban, GUIs, Gauntlets, juries, and domain rules remain in Flows,
   applications, libraries, or Starters.
11. **Public abstractions are earned.** One implementation does not establish
    a framework, and claims never exceed independent evidence.
12. **Simple use remains simple.** Sane defaults handle ordinary cases;
    Bindings, contracts, and configuration appear only when they express real
    customization or interoperability.
13. **Minimalism never excuses weakened safety.** Remove concepts and burden,
    not invariants required to uphold the promise.
14. **The open local product remains whole.** Jig remains useful as
    OSI-approved open-source local software; commercial products must not turn
    it into a deliberately crippled community edition.

## Part II — Design compass

This part records enduring product boundaries, not a snapshot of current
classes, protocols, commands, or subsystems. A named mechanism must still be
earned through specifications and evidence.

### Tradeoffs willingly accepted

The project accepts local review friction for meaningful authority; process
and protocol overhead for language, framework, and failure isolation; visible
failure instead of semantic degradation; controlled semantic nondeterminism
inside deterministic authority; less universal graph introspection for runtime
neutrality; and slower breadth while independent use earns extension points
and formal contracts.

Semantic discovery must not degrade explicit composition or enlarge authority.
A selected remote Agent necessarily receives the bounded data intentionally
sent to it. And when a simpler tool provides the same meaningful outcome and
guarantees with less ceremony, the simpler tool should win.

### The ownership covenant

Each layer stays small by owning one kind of truth.

| Layer | Owns |
| --- | --- |
| **FLOW** | Portable package meaning, values, finite invocation and outcomes, plus optional exact interoperability contracts |
| **Jig** | Discovery, capture, review, admission, binding of operator-provided powers, limits, lifecycle, and accountable execution |
| **Flow package** | Domain method, prompts, selected Skills, validation, and bounded local control |
| **Runtime** | Live advancement of an internal graph or program without acquiring Jig or FLOW policy |
| **Application or Starter** | User experience, domain state, triggers, business rules, repository policy, and human gates |
| **Operator environment** | Agents, endpoints, models, credentials, infrastructure, containment, and data policy |

A concept belongs in Jig only when Jig must enforce it across an authority,
trust, process, cancellation, lifetime, or durability boundary. Otherwise it
belongs in a Flow, library, capability provider, application, or Starter.

“Microkernel-inspired” is a discipline for ownership. It is not permission to
recreate an operating system, service framework, or universal application
model.

### The composition grammar

- **A Flow performs bounded work.** Most reusable procedures compose through
  ordinary Flow calls.
- **A capability exposes a stable interoperable interface or controlled
  power.** An exact contract is justified at a precise exported seam, not
  merely because a procedure is complicated.
- **A Binding customizes and pins a use.** It is not mandatory plumbing for
  every package.
- **An Agent is a host-selected intelligent worker.** A Flow may choose the
  bounded task context and Skills it needs, but not the operator's provider,
  credential, infrastructure, or containment policy.
- **A runtime owns internal control.** Graphs and other execution models remain
  implementation techniques rather than portable FLOW structure.
- **A Starter is one coherent application copied and owned by its user.** It
  is not algebra for merging policy fragments, and it does not choose the
  operator's Agents, credentials, infrastructure, containment, or trust policy.

If reliable outside activation is later earned, keep observed facts separate
from the application policies that react to them. Facts do not become invisible
middleware, and required sequencing remains explicit work rather than an
accidental listener chain. The eventual public mechanism is deliberately
unselected.

Flows perform work. Capabilities expose stable interfaces or controlled
effects. Runtimes own control. Jig owns external authority and lifetimes.
Applications decide why work exists.

### Bounded semantic choice

The original dynamic-routing problem remains central: a growing catalogue
should not require hardcoded keyword gates or one permanent graph edge for
every method. The safe answer is not a globally sovereign router.

There are two distinct decisions:

1. **Determine what is eligible.** Exact admission, compatibility,
   availability, and policy establish a closed authority set.
2. **Choose what best fits now.** Semantic reasoning may rank that set or
   abstain. It cannot enlarge it.

The enduring sequence is:

```text
open-ended intent
    -> deterministic admitted and eligible set
    -> optional bounded semantic choice or abstention
    -> validation against the closed set
    -> exact invocation
    -> evidence and validated outcome
```

Workflow identities and model choices are data. A compelling answer does not
create a package, provider, permission, or route. Exact composition must remain
excellent; semantic choice is introduced only when it provides a material
advantage over an explicit route.

### Ownership across change

Mutable source proposes; exact accepted meaning executes. This lets users edit
ordinary visible source without allowing an unnoticed edit to inherit prior
authority.

Files should express user ownership, not become a metaphysics for every host
record. Internal evidence may use the representation required to preserve its
invariants.

### Deliberately open boundaries

Evidence is still needed about:

- ecosystem discovery, publisher identity, reputation, and provenance;
- comprehensible review and authority as projects and catalogues grow;
- the smallest reliable seam for outside activation or long-lived services;
  and
- extension boundaries and operator-held authority across genuinely different
  Agents, runtimes, containment mechanisms, and remote or multi-user hosts.

Do not answer these questions with speculative frameworks. Let complete
applications, independent consumers, and conformance failures reveal the
necessary seam.

## Part III — Proof and leadership memory

### The north-star proof

The software factory is the strongest complete demonstration:

```text
authorized issue
    -> bounded planning and implementation
    -> disposable workspace authority
    -> exact tests and independent evidence
    -> inspectable patch
    -> human merge and release
```

Its importance is not that Jig is a software-development framework. It makes
the complete thesis visible: reusable specialists, role-specific context,
exact checks, bounded choice, least authority, recovery, and human consequence
ownership.

The baseline is deliberately strong:

```text
one capable coding Agent + repository access + CI + human review
```

Jig earns its presence only if it materially justifies its additional ceremony
through better accepted-result quality, fewer escaped defects or unauthorized
actions, lower operator burden, more reusable methods, clearer evidence, or
safer adaptation. It need not outperform the baseline on every dimension; it
must substantiate the advantage it actually claims.

Other domains reuse the same spine without inheriting issue, Git, or Kanban
concepts. Controlled AI release, evidence reconstruction, privacy-separated
work, scientific procedures, procurement review, incident triage, and
long-running personal campaigns are examples rather than roadmap commitments.

### Product proof standards

The thesis is progressively earned when evidence shows that:

1. **Portability and reuse are real.** Independently maintained procedures can
   collaborate through public boundaries, and a claimed host, application, or
   provider substitution works without private integration knowledge.
2. **Authority survives failure.** Model and package behavior remains within
   stated host-granted authority under the claimed threat model, and lifecycle
   promises remain true when work fails, cancels, or becomes uncertain.
3. **Public usability is real.** An unfamiliar user can obtain the claimed
   outcome from public artifacts and understand the meaning and authority being
   approved.
4. **The ceremony is justified.** A complete vertical demonstrates a material
   benefit over its strongest credible simpler baseline on the dimensions it
   claims.
5. **Claims remain proportional.** A release claims only what its evidence
   proves; no phase pretends the completed ecosystem already exists.

These are product standards, not a feature checklist. Specifications own
protocol conformance, security owners prove containment, the roadmap orders
outcomes, and individual applications choose their domain metrics. Every
delivery phase must culminate in a compelling user-facing example; an internal
protocol milestone is not a promotable outcome.

### Lessons bought through failed designs

#### Sequence is architecture

Many discarded ideas were reasonable in isolation and wrong in sequence. A
service model, semantic catalogue, event system, graph compiler, provider
framework, or update engine built before its first indispensable outcome
becomes a tax on everything that follows.

Complete user-facing verticals earn new concepts. Let independent use expose
the smallest missing seam; implementing one seam does not authorize the next
subsystem.

#### Safety serves the outcome

Admission, containment, cancellation, and cleanup are foundations. Users adopt
Jig for trustworthy composition of reusable work. Protect the boundary, but
sell and evaluate the outcome.

Minimalism applies to concepts and user burden. Deep private machinery is
justified when it preserves a demonstrated authority, failure, or lifecycle
invariant; line count is not the product boundary.

#### Probes consume; they do not co-design

A real probe freezes the public surface, gives only that surface to an
independent builder, forbids platform changes during consumption, and treats
failure as valuable evidence. A probe changed until it passes is co-design,
not independent evidence.

#### Methods belong to the ecosystem

Gauntlets, juries, debates, tree search, prompt optimization, research/review
separation, and future techniques should become excellent Flows, libraries, or
Starters—not Jig primitives.

More Agents are not automatically better. Add a role only when it changes the
evidence, context, authority, expertise, or failure independence. Prefer tests,
retrieval, execution, simulation, independent evidence, and human review over
verbal self-critique.

#### Defaults and visible ownership are product features

A Binding or configuration file for nearly every component is a design smell.
Ordinary use should work through sane discovery and host defaults; explicit
declarations are for meaningful customization.

User-owned source and policy remain ordinary, visible, and editable. This does
not require every internal runtime concern to become a file. If updates are
introduced, reconcile accepted base, local intent, and upstream source; never
create a permanent patch overlay beside the effective source.

#### Precision belongs at authority boundaries

Use exact identities, contracts, and records where equivocation changes
authority or interoperability. Keep human-facing declarations loose and
obvious where precision adds only ceremony.

Comparisons are not roadmap commitments. Owner suggestions, architecture
reports, and specialist reviews remain hypotheses; evidence-backed
disagreement is part of leadership.

### Warning signs and anti-goals

Stop and reconsider when a proposal introduces:

- a Jig primitive named after a workflow technique or application domain;
- one Binding or configuration file for nearly every component;
- provider, credential, runtime, or containment policy inside FLOW;
- a model-selected target outside an admitted eligible set;
- silent fallback that changes semantics, or execution merely because a
  package appeared;
- contracts for ordinary bounded work or listeners that hide required
  sequencing;
- a mandatory central registry before its need is proven;
- a public framework inferred from one implementation, or compatibility
  machinery for an unpromoted design; or
- architecture marketed as value without a compelling application outcome.

Jig is not trying to become a universal graph language, catalogue of every
workflow method, all-purpose AI application framework, provider SDK, GUI,
Kanban or Git framework, general package manager, universal service bus,
durable engine merely to support finite work, public sandbox framework inferred
from one mechanism, mandatory registry, or cloud control plane merely because
remote execution is possible.

FLOW is not Jig's configuration format. Jig should be an excellent FLOW host,
not the reason FLOW packages can exist.

### The decision gate

Before adding a public product concept, answer:

1. What valuable user outcome becomes possible, and what is its strongest
   credible simpler baseline?
2. Could a Flow, library, capability provider, application, or Starter own this
   instead?
3. What authority, information, or lifetime crosses a boundary; who grants,
   observes, and revokes it; and can the operator understand the change?
4. Can existing finite calls, exact choices, schemas, ordinary data, and sane
   defaults already express the outcome?
5. Has an independent consumer required this exact abstraction, or are we
   mistaking one implementation for a portable public interface?
6. What happens when a model lies, abstains, returns malformed data, or names
   something outside the admitted set?
7. How does execution fail, cancel, remain uncertain, and end without
   overstating success?
8. What evidence would falsify its value, and what is the stopping and deletion
   rule?

When these answers are vague, waiting is usually the correct design.

### Returning as leader

On returning with no memory:

1. Read Part I for why the product exists.
2. Read Part II for the boundaries that currently protect that purpose.
3. Read Part III for how to test new claims and avoid repeating old mistakes.
4. Read the [engineering re-entry guide](maintainer-reentry.md) for stable
   mechanics and the [roadmap](ROADMAP.md) for outcome order.
5. Read current public specifications only for the product question at hand.
6. Inspect live evidence before trusting reports or remembered status.

Then protect this hierarchy:

1. useful, reusable agentic work;
2. user ownership of the systems performing that work;
3. semantic flexibility inside deterministic authority;
4. FLOW as the portable boundary;
5. Jig as the smallest sufficient authority and lifecycle host;
6. Flows and applications as owners of method and purpose;
7. runtimes as owners of internal control; and
8. enforcement machinery as infrastructure serving those outcomes.

Reversing that hierarchy produces an impressive platform with no compelling
reason to exist.

The final reminder is:

> Protect the boundary, but sell the outcome. Let methods remain creative,
> models remain replaceable, source remain owned, applications remain
> opinionated, and Jig remain the smallest authority that makes portable
> agentic work trustworthy.
