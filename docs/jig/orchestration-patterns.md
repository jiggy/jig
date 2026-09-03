# Candidate orchestration patterns

These non-normative methods may appear inside the
[Jig use cases](./use-cases.md). They are not Jig APIs, Sley primitives, or
recommended architecture. Ordinary sequencing, fan-out, branching, and joins
need no branded pattern.

Every method below is a `candidate`. It becomes established only after two
independently supported use cases show that removing its irreducible property
worsens the outcome against a simpler baseline.

The minimum topology is the least arrangement that preserves that property,
not the largest arrangement imaginable. A second persona with the same
context, tools, authority, and failure modes is not an independent Agent.

Mechanism tags are descriptive only: `deterministic-step`, `sequence`,
`parallel`, `branch`, `join`, `bounded-loop`, `wait`, `authorized-choice`, and
`fact-trigger`.

## Blackboard to fixpoint

`minimum single-agent` · `fact-trigger`, `join`, `bounded-loop`

- **Failure prevented:** A fixed schedule repeatedly runs irrelevant roles or
  misses useful work unlocked by newly established facts.
- **Protocol:** Roles append typed immutable deltas; deterministic activation
  invokes only affected roles; provenance is retained; execution stops at
  quiescence or a hard budget.
- **Irreducible property:** Incremental activation from facts rather than
  polling or repeated global reinterpretation.
- **Collapse when:** A known sequence, event handler, or one bounded loop
  produces the same result.
- **Candidate cases:** [Software factory](./use-cases.md#software-factory) and
  [persistent job-search campaign](./use-cases.md#persistent-job-search-campaign),
  but neither yet establishes the method.
- **Evidence gate:** Demonstrate useful work avoided, termination, provenance,
  and better recovery than a simple sequential loop.

## Bounded semantic dispatch

`minimum single-agent` · `authorized-choice`, `branch`

- **Failure prevented:** Free-text interpretation becomes authority to invent,
  install, or invoke an unapproved procedure.
- **Protocol:** Deterministic code constructs the complete eligible set; one
  Agent returns an ID or abstention; code validates and invokes the exact map.
- **Irreducible property:** Semantic ranking remains powerless over admission
  and eligibility.
- **Collapse when:** A menu, form, classifier, or predicate selects reliably.
- **Candidate cases:** [Repair diagnostic](./use-cases.md#repair-diagnostic),
  [vetted rule front desk](./use-cases.md#vetted-rule-front-desk),
  [approved waste disposition](./use-cases.md#approved-waste-disposition), and
  [approved release transform](./use-cases.md#approved-release-transform).
- **Evidence gate:** Test adversarial out-of-set requests and show better task
  completion than the best deterministic router with zero unauthorized calls.

## Causal discrimination cascade

`minimum single-agent` · `sequence`, `branch`, `bounded-loop`

- **Failure prevented:** One plausible diagnosis suppresses rival explanations
  before discriminating evidence is acquired.
- **Protocol:** Commit rival causal models and predicted observations; choose
  the cheapest authorized discriminator; update; stop at a fixed test budget.
- **Irreducible property:** Rival models remain separate until evidence, rather
  than being averaged into one narrative.
- **Collapse when:** A professional procedure already fixes the next safe test
  or one diagnostician preserves alternatives equally well.
- **Candidate cases:** [Household energy investigation](./use-cases.md#household-energy-investigation)
  and, as a possible later step, [repair diagnostic](./use-cases.md#repair-diagnostic).
- **Evidence gate:** On known causes, reduce premature closure without more
  unsafe tests, cost, or delay than the strongest diagnostic baseline.

## Controlled assumption reveal

`minimum single-agent` · `branch`, `join`, `deterministic-step`

- **Failure prevented:** A holistic recommendation hides that its action flips
  under one declared assumption.
- **Protocol:** Invoke one logical role over sealed assumption bundles; commit
  closed action IDs; compare those IDs and supplied conditions exactly.
- **Irreducible property:** Cross-scenario blindness until commitment.
- **Collapse when:** Consequences can be calculated, an all-context call is as
  sensitive, or ordinary model variance exceeds assumption sensitivity.
- **Candidate case:** [Futureproof event plan](./use-cases.md#futureproof-event-plan).
- **Evidence gate:** At equal calls and budget, reduce false robustness versus
  all-context and identical non-Jig implementations.

## Double-entry reconciliation

`minimum single-agent` · `parallel`, `join`, `deterministic-step`

- **Failure prevented:** One reconstruction silently omits or mistranscribes a
  material fact.
- **Protocol:** Build two typed records through paths that differ in evidence,
  procedure, or measured failure behavior; canonicalize syntax only; compare
  exact fields; send disputed source spans to a resolver or human.
- **Irreducible property:** Independent commitment followed by field-level
  disagreement, not narrative consensus.
- **Collapse when:** Both passes share their dominant failure mode or a
  deterministic parser covers the format.
- **Candidate cases:** Possible extensions to
  [underpayment reconstruction](./use-cases.md#underpayment-reconstruction)
  and [protocol deviation reconstruction](./use-cases.md#protocol-deviation-reconstruction).
  Their current minimum designs do not instantiate double entry.
- **Evidence gate:** Reduce missed material facts enough to offset false
  conflicts, resolution time, and the second call.

## Gauntlet

`minimum single-agent` · `sequence`, `bounded-loop`, `deterministic-step`

- **Failure prevented:** An artifact is declared complete by the same
  unbounded process that produced it.
- **Protocol:** Build; run declared gates; return typed failures to the relevant
  repair stage; stop on acceptance, a blocking failure, or an iteration cap.
- **Irreducible property:** Explicit progressive gates and bounded,
  evidence-driven repair.
- **Collapse when:** Existing exact tests plus one Agent produce the same
  quality, or no observable acceptance criterion exists.
- **Candidate cases:** [Grant proposal workshop](./use-cases.md#grant-proposal-workshop),
  [truthful job application](./use-cases.md#truthful-job-application), and
  [software factory](./use-cases.md#software-factory).
- **Evidence gate:** Improve accepted quality or escaped-defect rate against one
  strong Agent at equal tools and budget, including all added latency and cost.

## Independent jury

`minimum multi-agent` · `parallel`, `join`, `deterministic-step`

- **Failure prevented:** One unstable closed judgment becomes the decision
  without exposing disagreement.
- **Protocol:** Jurors with different evidence, procedures, skills, model
  lineage, or empirically distinct failure behavior commit allowed values; a
  deterministic threshold aggregates them and preserves dissent.
- **Irreducible property:** Independent commitment before aggregation.
- **Collapse when:** Independence is asserted only from separate calls, errors
  are strongly correlated, no closed rubric exists, or one calibrated
  classifier performs as well. Majority is not truth.
- **Candidate cases:** Potentially [AI response release gate](./use-cases.md#ai-response-release-gate)
  or [near-miss normalization](./use-cases.md#near-miss-normalization), but only
  after single-reviewer errors justify it.
- **Evidence gate:** Measure individual and correlated errors, collective
  confident mistakes, cost, and latency against one calibrated reviewer.

## Information-gain interview

`minimum single-agent` · `sequence`, `branch`, `bounded-loop`

- **Failure prevented:** A conversational system asks low-value questions or
  commits while materially different decision states remain.
- **Protocol:** Maintain surviving states; require an `answer -> states` map;
  choose by declared information gain and user effort; stop at a question cap.
- **Irreducible property:** Question choice is tied to which decisions it can
  change.
- **Collapse when:** A stable form or decision tree already defines the same
  partitions.
- **Candidate cases:** Possible clarification extensions to
  [repair diagnostic](./use-cases.md#repair-diagnostic) and
  [vetted rule front desk](./use-cases.md#vetted-rule-front-desk). Their
  current minimum designs make one choice and do not instantiate an interview.
- **Evidence gate:** Reduce user effort or wrong early decisions relative to
  the form and one unconstrained conversational Agent.

## Invariant-preserving lens relay

`minimum single-agent` · `sequence`, `deterministic-step`

- **Failure prevented:** Specialized transformations accidentally change facts
  or fields outside their authority.
- **Protocol:** Use a structured artifact; declare writable fields per stage;
  validate protected invariants before and after every transform.
- **Irreducible property:** Mechanically enforced edit scopes between reusable
  transformations.
- **Collapse when:** One constrained transformation performs all edits or the
  claimed invariants cannot be checked.
- **Candidate cases:** [Public notice adaptation](./use-cases.md#public-notice-adaptation)
  and [compartmentalized accession](./use-cases.md#compartmentalized-accession).
- **Evidence gate:** Improve specialist quality while producing no more
  invariant violations than one carefully constrained editor.

## Meet-in-the-middle planning

`minimum single-agent` · `parallel`, `join`

- **Failure prevented:** Present constraints distort goal prerequisites, or
  goal knowledge makes a forward plan pretend unavailable steps are feasible.
- **Protocol:** Search forward and backward independently; encode bounded
  frontier states; join only exact compatible bridges; expose unmatched states.
- **Irreducible property:** Search-direction isolation before compatibility.
- **Collapse when:** Ordinary forward planning or explicit graph search finds
  the same valid bridge more cheaply.
- **Candidate case:** [Career transition bridge](./use-cases.md#career-transition-bridge).
- **Evidence gate:** Find more actionable valid bridges or fewer missing
  prerequisites than one strong planner on frozen cases.

## Option-preserving commitment ladder

`minimum single-agent` · `sequence`, `wait`, `deterministic-step`

- **Failure prevented:** A plan closes valuable options early or delays a
  reversible, time-critical step unnecessarily.
- **Protocol:** Classify deadline, reversibility, delay cost, dependencies, and
  future facts; commit only authorized safe steps; retain revisit conditions.
- **Irreducible property:** Explicit option value and authorization at each
  commitment.
- **Collapse when:** No meaningful future information exists or a static
  schedule captures every dependency.
- **Candidate cases:** Possible later extensions to
  [futureproof event plan](./use-cases.md#futureproof-event-plan) and
  [career transition bridge](./use-cases.md#career-transition-bridge). Their
  current minimum designs recommend; they do not wait and revisit commitments.
- **Evidence gate:** Compared with one static schedule, reduce avoidable
  irreversible decisions without increasing missed deadlines or operator
  burden.

## Orthogonal coverage grid

`minimum single-agent` · `parallel`, `join`

- **Failure prevented:** One taxonomy creates false confidence while omissions
  exist only at intersections with another framing.
- **Protocol:** Derive and freeze two axes separately; cross them exactly;
  investigate empty or high-risk cells with source evidence.
- **Irreducible property:** Genuinely different decompositions before crossing.
- **Collapse when:** Both axes are already known, correlated, or easily applied
  by one analyst.
- **Candidate case:** [Curriculum blind-spot audit](./use-cases.md#curriculum-blind-spot-audit).
- **Evidence gate:** Recover seeded intersection-only omissions with acceptable
  false gaps, effort, and cost versus the established rubric.

## Privacy membrane

`minimum single-agent` · `sequence`, `join`

- **Failure prevented:** A restricted task receives identities or secrets it
  does not need because one context performs every step.
- **Protocol:** A trusted stage retains secret-bearing input; project an
  approved representation; accept only a declared restricted-role result.
- **Irreducible property:** Enforced read separation across inputs, skills,
  errors, diagnostics, results, and retained history.
- **Collapse when:** One fully authorized local Agent is acceptable or indirect
  identifiers defeat the projection.
- **Candidate cases:** [Private feedback analysis](./use-cases.md#private-feedback-analysis)
  and [compartmentalized accession](./use-cases.md#compartmentalized-accession).
- **Evidence gate:** Against an ordinary trusted projection pipeline, prevent
  more seeded direct and indirect leakage without destroying analytical
  utility or increasing operator error.

## Red-team challenge

`minimum single-agent` · `sequence`, `bounded-loop`

- **Failure prevented:** Cooperative drafting suppresses adversarial failure
  paths in a plausible artifact.
- **Protocol:** Freeze the proposal and threat model; report reproducible
  findings with severity; an authorized owner accepts findings; repair under a
  finite rule.
- **Irreducible property:** Committed adversarial search separated from
  remediation acceptance.
- **Collapse when:** Exact tests cover the threat or criticism has no explicit
  attacker, evidence, severity, or owner.
- **Candidate cases:** [Software factory](./use-cases.md#software-factory) and
  [grant proposal workshop](./use-cases.md#grant-proposal-workshop) where a
  concrete exclusion or abuse model exists.
- **Evidence gate:** Compared with exact tests and cooperative review of the
  same artifact, find more seeded and realistic failures without overwhelming
  owners with false findings or regressing protected goals during repair.

## Research/review separation

`minimum single-agent` · `sequence`, `join`

- **Failure prevented:** Evidence acquisition quietly becomes authority to
  accept its own claims.
- **Protocol:** Research emits source-linked claims; a separately scoped role
  accepts, rejects, or qualifies them; composition uses only accepted claims.
- **Irreducible property:** Evidence collection and claim acceptance have
  distinct authority.
- **Collapse when:** Mechanical citation checks or one Agent achieve equal
  support and omission rates.
- **Candidate cases:** [Procurement evidence brief](./use-cases.md#procurement-evidence-brief)
  and a possible extension to
  [truthful job application](./use-cases.md#truthful-job-application).
- **Evidence gate:** Reduce unsupported claims or material omissions enough to
  offset the independent review call and added latency.

## Scenario-action regret matrix

`minimum agentless` · `branch`, `join`,
`deterministic-step`

- **Failure prevented:** A decision pretends disputed scenario probabilities
  are known or hides a dominated action.
- **Protocol:** Cross bounded scenarios and authorized actions; populate one
  consequence schema; compute dominance, regret, and thresholds exactly.
- **Irreducible property:** Explicit comparable consequences across the whole
  matrix.
- **Collapse when:** Consequences lack a defensible scale or an existing
  optimizer already represents the problem.
- **Candidate case:** An alternative design for
  [futureproof event plan](./use-cases.md#futureproof-event-plan).
- **Evidence gate:** Improve realized regret or decision effort against a
  manual table without inventing probabilities or filling unknown cells.

## State-machine policy compiler

`minimum single-agent` · `sequence`, `deterministic-step`

- **Failure prevented:** Prose policy is reinterpreted differently on every
  event or contains hidden dead ends and forbidden transitions.
- **Protocol:** Elicit states, observable facts, permitted actions, defaults,
  and terminals; compile; check reachability and ambiguity; require approval.
- **Irreducible property:** Runtime behavior follows an inspected finite policy
  rather than fresh semantic judgment.
- **Collapse when:** The policy is already formal or irreducible discretion
  makes compilation misleading.
- **Candidate case:** [Cold-chain exception packet](./use-cases.md#cold-chain-exception-packet),
  if its SOP cannot already be encoded directly.
- **Evidence gate:** Compared with a directly authored finite policy, match
  expert-labelled traces, surface more source-policy omissions and
  contradictions, and introduce no unsafe implicit transitions.
