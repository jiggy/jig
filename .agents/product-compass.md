# Jig and FLOW product compass

This is durable product memory for a future leader who remembers nothing about
Jig or FLOW. It owns the *why*: the intent, audience, promises, tradeoffs, end
state, and judgment needed to keep the project coherent.

It is not a specification, roadmap, release record, engineering guide, or
catalogue of possible features. Those documents may change frequently. This
one should change only when the product thesis itself changes.

## The one-minute memory

Jig and FLOW exist to separate **intelligence from authority**.

Models should be free to interpret, propose, create, criticize, and choose
among meaningful alternatives. They must not silently decide what software is
trusted, which powers they receive, what procedures exist, or which
consequential actions may occur.

The enduring product thesis is:

> FLOW makes agentic work portable. Jig lets intelligence remain flexible
> while authority remains exact.

An equally useful shorthand is:

> FLOW carries meaning. Jig carries authority. Flows carry method.
> Applications carry purpose.

The aspiration is to make an agentic procedure as easy to share as a Skill, as
composable as a function, and as governable as an operating-system process.

## The problem worth solving

Most agent systems begin by placing everything in one application: prompts,
workflow meaning, model selection, tools, credentials, control flow,
permissions, state, and domain policy. That makes impressive demonstrations
easy. It makes a trustworthy ecosystem difficult.

In such systems:

- a useful method cannot travel without its framework;
- changing a provider can change the application;
- model-selected control can quietly become execution authority;
- a reusable prompt has no dependable input, result, or lifetime boundary;
- application code accumulates every orchestration technique as proprietary
  infrastructure; and
- operators cannot easily tell what was proposed, what was authorized, what
  actually ran, or what remains alive.

The project exists to separate those concerns without replacing them with a
large universal framework.

Portable meaning is not portable authority. A procedure may be shared widely;
each host must decide locally whether it may run, which exact revision is
accepted, what it may receive, what it may do, and when its authority ends.

Discovery is not admission. Finding a package, installing it, parsing it, or
ranking it never makes it executable.

Intelligence is not authority. A plausible model answer remains data until
ordinary policy validates it and an authorized component acts on it.

## Who this is for

The first serious users are people building repeated AI-assisted processes for
which one chat or one embedded model call is no longer enough:

- workflow authors who want to distribute readable, executable specialist
  procedures;
- application and Starter authors who want to combine those procedures
  without inheriting their internal frameworks;
- operators who need to choose providers, credentials, infrastructure, data
  posture, limits, and approval policy;
- teams in which the procedure author, data owner, Agent provider, reviewer,
  and consequence owner may be different people or organizations; and
- builders for whom “the model probably followed the prompt” is not an
  adequate authority or audit boundary.

The same person may occupy every role in a small project. The architecture
must remain sound when they do not.

Jig is especially valuable where trust is divided or specialist methods are
reused. It should say honestly when a script, one Agent, an existing workflow
engine, or ordinary CI is simpler and sufficient. Ceremony is justified only
when separation, reuse, governance, or lifecycle improves the outcome.

End users should ordinarily meet a coherent application, not a collection of
kernel concepts. Starters and applications turn the small host into software
factories, review systems, research pipelines, operational tools, and personal
campaigns without making any one of those domains part of Jig itself.

## What sets it apart

Most agent products optimize for giving an Agent more power. Jig should
optimize for making power separable, reviewable, and composable.

No single ingredient is the differentiation:

- a sandbox does not provide portable meaning, composition, or admission;
- a workflow engine does not separate model judgment from authority;
- a package format does not govern execution;
- an Agent SDK does not make methods portable; and
- a graph runtime does not own credentials, consent, or consequences.

The product is the join among these boundaries:

- ordinary, independently implementable workflow packages;
- readable purpose with progressively loadable executable detail;
- separation between portable procedure and host policy;
- exact local review and admission;
- deterministic authority around probabilistic judgment;
- bounded composition across independently maintained procedures;
- host-selected Agents and capabilities; and
- human or application ownership of consequential action.

The market story is not “more orchestration machinery.” It is reusable
agentic work that an independent operator can understand, authorize, combine,
and stop.

## The core design idea

The original dynamic-routing question remains central: a growing catalogue
should not require hardcoded keyword gates or a new graph edge every time a
method appears. The safe answer is not a globally sovereign router.

There are two different choices:

1. **Resolve what is eligible.** Deterministic policy finds compatible,
   available, admitted candidates and establishes the complete authority
   boundary.
2. **Choose what best fits now.** Semantic reasoning may rank those candidates
   or abstain, but it cannot enlarge the set.

The enduring sequence is:

```text
open-ended intent
    -> deterministic compatibility and eligibility
    -> bounded semantic choice or abstention
    -> validation against the closed set
    -> exact admitted invocation
    -> validated result and evidence
```

Workflow identities are data. A model's choice is data. Neither becomes new
authority merely because it appears in a convincing answer.

Static composition must remain excellent. Semantic selection is valuable only
where explicit routing is genuinely inadequate. Dynamic discovery may prepare
a bounded choice set later; runtime choice must never become installation,
admission, credential, or permission authority.

## The finished world

A mature ecosystem should feel simple from each role.

### For a workflow author

The author creates an ordinary FLOW package with a clear human purpose. Exact
execution, schemas, skills, resources, and capability contracts are added only
as needed. The implementation may use plain code, a graph runtime, or a future
execution model without imposing that choice on FLOW.

The package can travel through ordinary decentralized sources. Its meaning
does not depend on one registry, one host, one programming language, one Agent,
or one vendor.

### For an application builder

The builder assembles packages and domain policy into a coherent application
or Starter. Sensible defaults make simple components work without a Binding or
configuration file for every relationship. Bindings customize, restrict, and
pin; they do not exist merely to announce that a component exists.

The builder starts with fixed composition. Separate roles are added only when
they need meaningfully different evidence, skills, context, failure
independence, or authority. Semantic choice is introduced only when it beats an
explicit route.

Domain models, user experience, Git policy, Kanban, professional rules,
watchers, and human approvals remain application concerns.

### For an operator

The operator chooses the host environment: Agents, models, credentials,
infrastructure, containment, and data posture. The operator sees a
comprehensible proposed change, accepts one exact meaning, and can later tell
which packages, policies, and powers were used.

The system may run an explicit target or eventually react to an approved
outside fact. Either way, authority is bounded, failure is honest, uncertain
work is not guessed successful, and completion includes the end of owned
activity.

### For an end user

The user receives the application outcome: a reviewed patch, an evidence
packet, a decision held for approval, a repaired artifact, or another useful
result. Internal identities, scopes, bindings, records, and provider mechanics
should stay out of the way unless understanding them is necessary for consent
or diagnosis.

## The ownership covenant

Each layer remains small because it owns one kind of truth.

| Layer | Owns |
| --- | --- |
| **FLOW** | Portable package meaning, values, finite invocation, outcomes, and optional exact capability contracts |
| **Jig** | Discovery, capture, review, admission, binding, host authority, provider choice, limits, lifecycle, and accountable execution |
| **Flow package** | Domain procedure, prompts, selected skills, validation, and bounded local control logic |
| **Component runtime** | Live advancement of an internal graph or program, without acquiring Jig or FLOW policy |
| **Application or Starter** | User experience, domain state, triggers, business rules, repository policy, and human gates |
| **Operator environment** | Agents, endpoints, models, credentials, infrastructure, containment preference, and data policy |

A concept belongs in Jig only when Jig must enforce it across an authority,
trust, process, cancellation, or durability boundary. Otherwise it belongs in
a Flow, library, capability provider, application, or Starter.

“Microkernel-inspired” is a discipline for ownership. It is not permission to
recreate an operating system or service framework.

## The composition grammar

Several mechanisms that once blurred together have different jobs:

- **A Flow performs bounded work.** Most reusable procedures compose through
  ordinary Flow calls.
- **A capability provides a stable interface or controlled power.** Formal
  contracts are justified at precise exported seams, not because a procedure
  is complicated.
- **A Binding customizes and pins a use.** It is not mandatory plumbing for
  every package.
- **An event is a fact.** It may cause an application to react, but it is not
  invisible middleware and does not secretly own control flow.
- **A graph is an implementation technique.** Runners own internal control;
  Jig does not mirror or schedule their nodes.
- **A Starter is one coherent application copied and owned by its user.** It is
  not algebra for merging policy fragments.

Flows sequence work. Applications decide why that work exists. Capability
owners control effects. Observers record facts. Keeping these roles separate
prevents a convenient callback from quietly becoming a scheduler or authority
system.

## Non-negotiable promises

These survive changes in implementation, provider, platform, and product
phase.

1. **FLOW remains independent of Jig.** It stays neutral about hosts, graph
   runtimes, providers, sandboxes, persistence, and application structure.
2. **Models return bounded data, not authority.** They may propose, rank, or
   choose only within an authority set created elsewhere.
3. **Discovery never grants execution.** New meaning becomes usable only
   through an explicit admission policy.
4. **Accepted meaning is exact.** Mutable source proposes; an accepted
   revision executes. Changes do not inherit trust silently.
5. **Missing support fails honestly.** No weaker isolation or semantically
   different interpretation is selected behind a successful interface.
6. **The host owns credentials and powers.** A package cannot choose secrets,
   provider identity, containment, or infrastructure policy.
7. **Runners own internal control flow.** Jig never becomes a second scheduler
   for a graph it does not own.
8. **Every resource and consequential effect has an owner.** Authority can be
   bounded and revoked; success does not leave hidden work behind.
9. **Uncertainty remains uncertainty.** Possibly dispatched work is not
   silently repeated or described as successful.
10. **User-owned meaning stays inspectable.** Avoid hidden overlays and
    competing effective sources.
11. **The kernel contains no application ontology.** Tickets, tasks, Kanban,
    Git branches, GUIs, and domain rules do not become Jig primitives.
12. **One implementation does not create a public framework.** Independent
    consumers or implementations must expose the same boundary first.
13. **Consequential authority stays with its real owner.** A model does not
    merge, release, purchase, publish, delete, communicate, or approve merely
    because it completed a workflow.
14. **Claims stay smaller than evidence.** Structured shape is not truth;
    several Agents are not independence; one successful probe is not a market.
15. **Minimalism applies to concepts and burden, not to deleting proved safety
    invariants.** Necessary private machinery may be deeper than the public
    experience.

## Tradeoffs willingly accepted

The project consciously accepts costs that protect the thesis:

- review and approval friction in exchange for meaningful local authority;
- process and protocol overhead in exchange for language, framework, and
  failure isolation;
- one strong supported host before broad but weaker fallbacks;
- exact closed composition before open semantic discovery;
- reduced universal graph introspection in exchange for supporting graphs,
  imperative programs, and plugin-style components equally;
- failure when exact execution is unavailable instead of silently changing
  semantics;
- host-selected rather than package-selected providers and infrastructure;
- finite work before arbitrary durable continuation;
- delayed public extension points until more than one real implementation or
  consumer reveals their shape;
- formal contracts only where stable service interoperability earns their
  cost;
- slower breadth in exchange for complete, useful vertical outcomes;
- breaking draft designs in place until an interface is explicitly promoted;
  and
- the fact that a selected remote Agent necessarily receives the bounded data
  intentionally sent to it.

Semantic selection is accepted controlled nondeterminism. Eligibility,
authority, validation, budgets, and the eventual invocation remain
deterministic.

The project also accepts that Jig may not be useful everywhere. A simple tool
should win when it offers the same outcome and boundary with less ceremony.

## The north-star proof

The software factory is the strongest complete demonstration:

```text
authorized issue
    -> bounded planning and implementation
    -> disposable workspace
    -> exact tests and independent evidence
    -> inspectable patch
    -> human merge and release
```

Its importance is not that Jig is a software-development ontology. It visibly
combines specialist procedures, role-specific context, exact checks, bounded
choice, external activation, least authority, recovery, and human control.

The comparison is not a weak agent demo. It is the strongest simple baseline:

```text
one capable coding Agent + repository access + CI + human review
```

Jig earns its ceremony only if it improves accepted-patch quality, escaped
defects, unauthorized actions, operator effort, reuse, or comprehensibility.

Other domains reuse the same spine without inheriting issue, Git, or Kanban
concepts. Examples include controlled AI release, evidence reconstruction,
privacy-separated work, scientific procedures, procurement review, incident
triage, and long-running personal campaigns.

Every product phase needs a useful example that a person would choose for its
outcome, not an internal engineering milestone dressed as a tutorial:

- before Agents, run reviewed unfamiliar work against operator-owned inputs;
- with one Agent, add bounded semantic extraction or review without granting
  consequential authority;
- with exact composition, build useful fixed workshops, Gauntlets, juries,
  research/review pipelines, and repair loops;
- with bounded semantic choice, triage among already approved specialists;
- with durable external activation and services, support complete applications
  whose lifetimes extend beyond one invocation.

A genuinely strong no-Agent or one-Agent use case is better than artificial
multi-Agent theater. Add Agents only when separation changes evidence,
context, authority, or failure independence. Prefer tests, retrieval,
execution, simulation, independent evidence, and human review over verbal
self-critique.

## Lessons bought through failed designs

These lessons are part of the product judgment, not merely project history.

### Sequence is architecture

Many discarded ideas were reasonable in isolation and wrong in sequence. A
Service model, semantic catalogue, event system, graph compiler, provider SPI,
or update engine built before its first indispensable outcome becomes a tax on
everything that follows.

Finish one useful vertical. Let its pressure expose the smallest missing seam.
Stop when the outcome works. Completing a phase does not authorize choosing the
next one.

### The safety substrate is not the product story

Admission, containment, cancellation, and cleanup are foundations. Users adopt
Jig for trustworthy composition of reusable agentic work. Protect the
boundary, but sell and evaluate the outcome.

### Probes must not invent the platform they consume

The first design-probe cycle failed because the platform authors supplied
imaginary interfaces and changed the platform until the probes passed. A real
probe freezes the public surface, gives only that surface to an independent
builder, forbids platform changes during consumption, and treats failure as
valuable evidence.

### Workflow techniques belong to the ecosystem

Gauntlet, jury, debate, tree search, prompt optimization, research/review
separation, and future methods should be excellent Flows, libraries, or
Starters—not Jig primitives. Jig should host methods without owning each one.

The source of feedback matters more than the number or persona of Agents.

### Defaults preserve simplicity

A Binding or configuration file for nearly every component is a design smell.
Simple direct use should work through sane discovery and host defaults. Expose
exact declarations for environments that need tighter control.

### Files express ownership, not metaphysics

User-owned source and policy should remain ordinary, visible, and editable.
That does not require every internal record or runtime concern to become a
file. If updates are added, reconcile base, local intent, and upstream at
update time rather than maintaining permanent patch overlays beside the
effective source.

### Precision belongs at authority boundaries

Use exact identities, digests, contracts, and records where equivocation would
change authority or interoperability. Keep human-facing declarations loose
and obvious where precision adds only ceremony.

### Comparison projects are not roadmap commitments

Other harnesses, plugin systems, and protocols can reveal useful concepts.
They do not create a requirement to port their ecosystems or reproduce their
feature sets.

### Criticism is part of leadership

Owner suggestions, architecture reports, and specialist reviews are
hypotheses. Test them against the product intent and evidence. The project
improved when opposing arguments were made seriously; agreement is not proof.

## Warning signs

Stop and reconsider when a proposal introduces:

- a Jig primitive named after a workflow technique;
- one Binding or configuration file for nearly every component;
- a provider, model, credential, runtime command, or sandbox policy in FLOW;
- a model-selected target outside an admitted eligible set;
- host control over a Flow's internal graph;
- a public provider or containment framework inferred from one mechanism;
- a daemon or durable engine merely to support finite work;
- a Task, Kanban, Git, GUI, or other domain ontology in the kernel;
- a silent fallback that changes semantics;
- automatic execution merely because a file or package appeared;
- hooks as invisible middleware or events whose listeners can rewrite facts;
- capability contracts for ordinary bounded work;
- persistent patch overlays beside directly edited source;
- a central registry before package reuse and trust signals are proven;
- a probe that expands the platform merely so the probe can pass;
- architecture marketed as value without a compelling application outcome;
  or
- compatibility machinery for an unpromoted design.

## The decision test

Before adding a product concept, answer these questions concretely:

1. What visible user outcome becomes possible?
2. What is the strongest credible simpler alternative?
3. Does the proposed feature enforce something only the host can enforce?
4. Could it live in a Flow, library, capability provider, Starter, or
   application instead?
5. Can existing finite calls, exact choices, schemas, and ordinary data already
   express it?
6. What new authority, information, or lifetime enters? Who grants, observes,
   and revokes it?
7. What happens when a model lies, abstains, returns malformed data, or names an
   unavailable route?
8. What happens when work fails or becomes uncertain around an external
   effect?
9. Can a new user understand what they are approving?
10. Is one implementation being mistaken for a portable interface?
11. Has an independent consumer needed this exact abstraction?
12. What equal-model, equal-tool, equal-budget comparison would falsify its
    value?
13. Does removing the abstraction materially invalidate the product claim?
14. What is the experiment's stopping rule, and can the failed path be deleted?
15. After proving this outcome, are we willing to stop rather than
    automatically begin another subsystem?

When these questions lack concrete answers, waiting is usually the correct
design.

## Questions deliberately left open

The product compass protects boundaries; it does not pre-decide every future
surface.

The ecosystem still needs evidence about:

- how package discovery, publisher identity, reputation, and update provenance
  should work without making one registry mandatory;
- how review remains comprehensible when projects and catalogues grow;
- when durable outside facts and long-lived providers truly require host
  concepts beyond finite Runs;
- when a second containment or Agent integration reveals a useful public
  extension boundary;
- how local authority principles generalize to multi-user or remote hosts;
- how directly edited packages reconcile upstream changes while preserving
  user intent; and
- which applications prove that independently distributed FLOW packages are
  better than Skills, libraries, containers, templates, or embedded model
  calls.

Do not answer these with speculative frameworks. Let applications and
independent implementers produce the evidence.

## What not to become

Jig is not trying to become:

- a universal graph language;
- a catalogue of every orchestration pattern;
- an all-purpose AI application framework;
- a model or provider SDK;
- a package manager or mandatory central registry;
- a GUI, Kanban, Git, or software-factory framework;
- a universal service bus;
- a cloud control plane merely because remote operation is possible;
- a public sandbox framework inferred from one host; or
- a museum of superseded prerelease formats.

FLOW is not “Jig's configuration format.” Jig should aim to be an excellent
FLOW host, not the reason FLOW packages can exist.

## Returning as leader

On returning with no memory, recover judgment in this order:

1. Read this compass for *why* the project exists.
2. Read the engineering re-entry guide for stable mental models and boundaries.
3. Read the roadmap for the order in which outcomes may earn new concepts.
4. Read current public guides and specifications only for the product question
   at hand.
5. Inspect live evidence before trusting status reports or remembered claims.

Then protect this hierarchy:

1. reusable, trustworthy agentic work;
2. semantic flexibility inside deterministic authority;
3. FLOW as the portable boundary;
4. Jig as the smallest sufficient authority host;
5. Flows and applications as the owners of method and purpose;
6. the software factory as a north-star proof, not a kernel ontology; and
7. enforcement machinery as infrastructure serving those outcomes.

Reversing that hierarchy is how the project becomes overbuilt while remaining
technically impressive.

The final reminder is:

> Protect the boundary, but sell the outcome. Let workflows remain creative,
> models remain replaceable, applications remain opinionated, and Jig remain
> the smallest authority that makes their composition trustworthy.
