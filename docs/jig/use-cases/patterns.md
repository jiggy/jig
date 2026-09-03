# Orchestration pattern notebook

This non-normative notebook records reusable methods that may help generate
Jig use cases and design probes. It is not a Jig API, a FLOW extension, or a
list of recommended architectures.

A pattern earns recommendation only after at least two demonstrated use cases
need it. Until then, its minimum topology and anti-theater test are more
important than its name. Start with a script or one Agent whenever that
preserves the same semantics.

## Reliability and challenge

### Gauntlet

**Minimum topology:** `single-agent` when gates are deterministic;
`multi-agent` only when independent review materially changes the evidence.

Move one artifact through explicit build, test, review, repair, and
verification gates. Failures return to the relevant repair stage and the loop
ends on acceptance, a blocking failure, or a fixed iteration bound.

Repeated “looks good” calls are not a Gauntlet. Each gate needs explicit
criteria and actionable failure evidence. Candidate jobs include grant
proposals, policy briefs, and inspectable software artifacts.

### Independent jury / majority vote

**Minimum topology:** `multi-agent`.

Give an odd number of isolated jurors the same evidence and closed decision
contract. Commit their answers before reveal, then aggregate with a
deterministic majority or threshold rule.

Same-model samples are not independent by default. Majority cannot establish
truth, resolve a value dispute, or repair a bad rubric. Candidate jobs include
ambiguous rubric classification and damaged-text transcription.

### Double-entry reconciliation

**Minimum topology:** `multi-agent` when extractors have genuinely independent
skills, evidence, or model lineage; otherwise `single-agent` multi-pass.

Create two typed reconstructions independently, canonicalize only syntactic
fields, and compare exact agreements and discrepancies. A resolver or human
sees disputed source spans rather than two complete persuasive narratives.

Correlated duplicate calls are not verification, and semantic equivalence is
not a deterministic diff. Candidate jobs include incident chronology and
cross-record obligation reconstruction.

### Red-team challenge

**Minimum topology:** `multi-agent`.

Freeze a proposal, let an adversarial role search for concrete exploits,
counterexamples, or failure paths under an explicit threat model, then harden
accepted findings under a finite remediation rule.

Generic criticism is not red-teaming. Attacks need goals, evidence, severity,
and stopping criteria. Candidate jobs include evacuation-plan attacks and
fraud or exclusion analysis of a public program.

### Research / review separation

**Minimum topology:** `multi-agent`.

A researcher constructs a source-linked evidence packet. A separately scoped
reviewer checks claim support, omissions, and source fitness before any final
composition.

The reviewer must inspect evidence and have authority to reject unsupported
claims; prose polishing does not justify another role. Candidate jobs include
procurement recommendations and travel-risk briefings.

## Decomposition and synthesis

### Orchestrator and bounded workers

**Minimum topology:** `multi-agent` only when subproblems are materially
independent or require different tools, sources, or skills.

An orchestrator creates a bounded work plan, workers receive disjoint tasks and
explicit output contracts, and deterministic code joins the results. Failed
work remains attributable to its task rather than disappearing into synthesis.

Do not split a coherent prompt merely to advertise parallelism. Candidate jobs
include source-partitioned research dossiers and multi-region policy impact
analysis.

### Orthogonal coverage grid

**Minimum topology:** `multi-agent`.

Independently derive two genuinely different decomposition axes, cross them,
and investigate empty or high-risk intersections. The intersections, rather
than two summaries, are the useful artifact.

Correlated axes create false completeness, and a filled grid is not proof that
nothing was missed. Candidate jobs include emergency-drill coverage by phase
and stakeholder, and curriculum coverage by concept and cognitive skill.

### Blackboard to fixpoint

**Minimum topology:** `multi-agent`.

Roles append typed deltas to an ephemeral board. Deterministic activation rules
invoke a role only when its prerequisites become available or a relevant fact
changes. Stop at quiescence or a fixed budget.

A same-model cast polling the same board is inferior to one loop unless roles
have distinct skills, inputs, or activation conditions. Candidate jobs include
incident reconstruction and disaster-response planning from asynchronously
available reports.

### Invariant-preserving lens relay

**Minimum topology:** `single-agent`; multiple roles require distinct skills,
permissions, or context boundaries.

Pass a structured artifact through ordered transformations with protected
invariants and non-overlapping edit scopes. Deterministic structural checks
enforce which fields each stage may change.

Serial personas operating on the same unstructured text are prompt staging,
not orchestration. Candidate jobs include accessible and localized public
notices, and itineraries adapted for several explicit needs.

### Privacy membrane

**Minimum topology:** `multi-agent` or one Agent behind a deterministic trusted
projection, depending on who must see the protected data.

Keep identity or secret-bearing context with one trusted role, project only an
approved representation to an analysis role, then reintegrate only permitted
results. Correctness depends on information not crossing the membrane.

Prompting an all-seeing Agent to “ignore names” supplies no boundary. Candidate
jobs include sensitive-feedback analysis and museum accession writing with
private donor terms.

## Decisions under uncertainty

### Information-gain interview

**Minimum topology:** `single-agent`.

Maintain explicit possible decision states. Generate questions with an
`answer -> surviving states` map, ask the highest-impact question per unit of
user effort, and stop at a fixed question budget with a conditional result.

Use a form or decision tree when questions and partitions are already known;
several question Agents add nothing. Candidate jobs include education choices
under funding uncertainty and benefits triage from incomplete facts.

### Controlled assumption reveal

**Minimum topology:** `multi-agent` only when independent commitment matters;
otherwise `single-agent` isolated calls.

Give each isolated branch the same base facts plus one alternate assumption
bundle. Commit closed recommendations before reveal, then compare action IDs
and organizer-supplied condition IDs. This exposes recommendations that remain
stable and assumptions associated with a reversal.

Free-form reasons cannot be reconciled deterministically. The pattern is
theater if branches see one another's conclusions or deterministic scenario
calculation suffices. Candidate jobs include relocation and event planning.

### Scenario-action regret matrix

**Minimum topology:** `agentless` when consequences are supplied;
`single-agent` when semantic estimation is unavoidable.

Cross a bounded scenario set with authorized actions, populate one consequence
schema, then compute dominance, regret, and thresholds exactly. It seeks robust
action without pretending disputed probabilities are known.

Several Agents filling cells are decorative unless they bring distinct
evidence or expertise. Candidate jobs include crop choices under uncertain
rainfall and venue contracts under uncertain turnout.

### Option-preserving commitment ladder

**Minimum topology:** `single-agent` plus deterministic scheduling.

Classify decisions by deadline, reversibility, delay cost, dependencies, and
facts that could change them. Commit reversible or time-critical actions while
retaining explicit branches for irreversible choices.

Multiple planning roles add nothing unless they control distinct commitments
or private facts. Candidate jobs include wedding commitments and education
plans while funding outcomes remain open.

### Causal discrimination cascade

**Minimum topology:** `multi-agent`.

Commit rival causal models with predicted observations and safe tests. Choose
the lowest-cost observation that most separates their interventions, update
the models, and stop under a fixed test budget.

Renamed copies that converge before evidence are an ensemble costume. The
method also needs a safe fact-acquisition path. Candidate jobs include
household energy-cost investigation and changes in student performance.

### State-machine policy compiler

**Minimum topology:** `single-agent` plus deterministic compilation.

Elicit states, observable facts, permitted actions, forbidden transitions,
defaults, and terminal conditions. Compile them into a finite policy and check
reachability, ambiguity, and dead ends before runtime facts select transitions.

Multiple policy roles are unnecessary unless different authorities own
different transitions. Candidate jobs include weather contingency and travel
disruption procedures.

## Constraints and assembly

### Pareto contract

**Minimum topology:** `agentless`; isolated Agents are justified only for
separate, private, or unstructured stakeholder inputs.

Encode hard constraints, preferences, and permitted concessions. Compute the
feasible Pareto frontier and minimal conflicting constraint sets, leaving the
final trade-off to the authorized person.

Persona Agents are not stakeholders and cannot invent preferences. Candidate
jobs include a family caregiving rota and community-budget allocation.

### Distributed constraint propagation

**Minimum topology:** `agentless` for formal constraints; `multi-agent` only
when knowledge or disclosure is actually distributed.

Give each domain a variable set and local constraints, propagate domain
reductions to a fixpoint, then branch on the smallest unresolved domain or
surface explicit relaxations on conflict.

If one solver already has every constraint, simulated owners add latency rather
than correctness. Candidate jobs include clinic rosters and accessible wedding
seating.

### Typed component assembly

**Minimum topology:** `agentless` with an existing inventory; `single-agent`
when components must be authored from unstructured needs.

Represent components with typed prerequisites, effects, resources, and
incompatibilities. Use exact cover or bounded search to assemble coherent
bundles.

Facet Agents are unnecessary when one generator can create the same inventory.
Candidate jobs include workshop programs and capsule wardrobes under explicit
constraints.

### Meet-in-the-middle planning

**Minimum topology:** `multi-agent` for semantic state search; `agentless` for
an explicit graph.

Isolate forward search from the present and backward prerequisite search from
the goal. Normalize bounded frontier states and connect compatible bridge
states.

Isolation matters only when goal leakage would distort feasibility or present
assumptions would distort prerequisites. Candidate jobs include career
transitions and exhibition preparation.

## Authorized control

### Bounded semantic dispatch

**Minimum topology:** `single-agent`.

Deterministic code first produces a finite authorized candidate set. One Agent
returns a candidate ID or abstention under a closed schema; code validates the
ID and invokes the exact mapped action.

Use ordinary predicates when labels are reliably machine-readable. The chooser
must never invent candidates, admit packages, widen authority, or silently
truncate the declared set. Candidate jobs include model-specific repair
diagnosis and jurisdiction-specific inquiry routing.

## How to use this notebook

When proposing a design probe:

1. Start from a [catalogued user outcome](./), not a pattern name.
2. Select the least complex pattern that could produce it.
3. Write the simpler credible baseline first.
4. State what information or authority each role receives.
5. Make joins, bounds, failures, and human decisions explicit.
6. Remove any role whose absence does not change the semantics.

The probe may show that a pattern is unnecessary or that Jig lacks an
important surface. It must report that result rather than changing Jig while
trying to consume it.
