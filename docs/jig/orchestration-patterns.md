# Candidate orchestration patterns

Orchestration patterns are reusable ways to organize work that one ordinary
prompt may not handle reliably. Some separate evidence, some protect private
context, and others make iteration or choice easier to inspect.

They are ideas to test, not built-in commands or rules every workflow should
follow. Start with a simple sequence and use a named pattern only when its
extra structure prevents a real failure. Links lead to possible examples in
the [use-case catalogue](./use-cases.md).

## Blackboard to fixpoint

Specialist roles add findings to a shared record. New findings trigger only
the roles that depend on them; work stops when no finding can trigger more
work.

*Candidate pattern · One Agent*

- **Problem it solves:** A fixed schedule repeatedly runs irrelevant roles or
  misses useful work unlocked by newly established facts.
- **How it works:** Roles append typed immutable deltas; deterministic activation
  invokes only affected roles; provenance is retained; execution stops at
  quiescence or a hard budget.
- **Why the structure matters:** Incremental activation from facts rather than
  polling or repeated global reinterpretation.
- **Use something simpler when:** A known sequence, event handler, or one bounded loop
  produces the same result.
- **Possible uses:** [Software factory](./use-cases.md#software-factory) and
  [persistent job-search campaign](./use-cases.md#persistent-job-search-campaign),
  but neither yet establishes the method.
- **What would prove it:** Demonstrate useful work avoided, termination, provenance,
  and better recovery than a simple sequential loop.

## Bounded semantic dispatch

A model chooses only among actions the system owner has already approved.
Ordinary software verifies the choice before anything runs.

*Candidate pattern · One Agent*

- **Problem it solves:** Free-text interpretation becomes authority to invent,
  install, or invoke an unapproved procedure.
- **How it works:** Deterministic code constructs the complete eligible set; one
  Agent returns an ID or abstention; code validates and invokes the exact map.
- **Why the structure matters:** Semantic ranking remains powerless over admission
  and eligibility.
- **Use something simpler when:** A menu, form, classifier, or predicate
  selects reliably.
- **Possible uses:** [Repair diagnostic](./use-cases.md#repair-diagnostic),
  [vetted rule front desk](./use-cases.md#vetted-rule-front-desk),
  [approved waste disposition](./use-cases.md#approved-waste-disposition), and
  [approved release transform](./use-cases.md#approved-release-transform).
- **What would prove it:** Test adversarial out-of-set requests and show better task
  completion than the best deterministic router with zero unauthorized calls.

## Causal discrimination cascade

Competing explanations make testable predictions before more evidence is
gathered. The best safe, affordable check is run, the explanations are updated,
and the cycle repeats within a fixed limit.

*Candidate pattern · One Agent*

- **Problem it solves:** One plausible diagnosis suppresses rival explanations
  before discriminating evidence is acquired.
- **How it works:** Commit rival causal models and predicted observations; choose
  the cheapest authorized discriminator; update; stop at a fixed test budget.
- **Why the structure matters:** Rival models remain separate until evidence, rather
  than being averaged into one narrative.
- **Use something simpler when:** A professional procedure already fixes the
  next safe test
  or one diagnostician preserves alternatives equally well.
- **Possible uses:**
  [Household energy investigation](./use-cases.md#household-energy-investigation)
  and, as a possible later step, [repair diagnostic](./use-cases.md#repair-diagnostic).
- **What would prove it:** On known causes, reduce premature closure without more
  unsafe tests, cost, or delay than the strongest diagnostic baseline.

## Controlled assumption reveal

The same adviser evaluates each possible future separately, without being
shown the other scenarios. It commits to each choice before the choices are
compared.

*Candidate pattern · One Agent*

- **Problem it solves:** A holistic recommendation hides that its action flips
  under one declared assumption.
- **How it works:** Invoke one logical role over sealed assumption bundles; commit
  closed action IDs; compare those IDs and supplied conditions exactly.
- **Why the structure matters:** Cross-scenario blindness until commitment.
- **Use something simpler when:** Consequences can be calculated, an
  all-context call is as
  sensitive, or ordinary model variance exceeds assumption sensitivity.
- **Possible use:** [Futureproof event plan](./use-cases.md#futureproof-event-plan).
- **What would prove it:** At equal calls and budget, reduce false robustness versus
  all-context and identical non-Jig implementations.

## Double-entry reconciliation

Two passes use different evidence, methods, or known failure tendencies to
turn the same source into structured facts. Exact comparison exposes their
disagreements instead of blending them away.

*Candidate pattern · One Agent*

- **Problem it solves:** One reconstruction silently omits or mistranscribes a
  material fact.
- **How it works:** Build two typed records through paths that differ in evidence,
  procedure, or measured failure behavior; canonicalize syntax only; compare
  exact fields; send disputed source spans to a resolver or human.
- **Why the structure matters:** Independent commitment followed by field-level
  disagreement, not narrative consensus.
- **Use something simpler when:** Both passes share their dominant failure mode or a
  deterministic parser covers the format.
- **Possible uses:** Possible extensions to
  [underpayment reconstruction](./use-cases.md#underpayment-reconstruction)
  and
  [protocol deviation reconstruction](./use-cases.md#protocol-deviation-reconstruction).
  Their current minimum designs do not instantiate double entry.
- **What would prove it:** Reduce missed material facts enough to offset false
  conflicts, resolution time, and the second call.

## Gauntlet

A draft must pass a series of explicit checks. Failed checks return precise
problems for limited repair attempts instead of an open-ended rewrite.

*Candidate pattern · One Agent*

- **Problem it solves:** An artifact is declared complete by the same
  unbounded process that produced it.
- **How it works:** Build; run declared gates; return typed failures to the relevant
  repair stage; stop on acceptance, a blocking failure, or an iteration cap.
- **Why the structure matters:** Explicit progressive gates and bounded,
  evidence-driven repair.
- **Use something simpler when:** Existing exact tests plus one Agent produce the same
  quality, or no observable acceptance criterion exists.
- **Possible uses:** [Grant proposal workshop](./use-cases.md#grant-proposal-workshop),
  [truthful job application](./use-cases.md#truthful-job-application), and
  [software factory](./use-cases.md#software-factory).
- **What would prove it:** Improve accepted quality or escaped-defect rate against one
  strong Agent at equal tools and budget, including all added latency and cost.

## Independent jury

Several independent reviewers decide separately using the same closed answer
set. A fixed rule combines their decisions while preserving disagreement.

*Candidate pattern · Multiple Agents*

- **Problem it solves:** One unstable closed judgment becomes the decision
  without exposing disagreement.
- **How it works:** Jurors with different evidence, procedures, skills, model
  lineage, or empirically distinct failure behavior commit allowed values; a
  deterministic threshold aggregates them and preserves dissent.
- **Why the structure matters:** Independent commitment before aggregation.
- **Use something simpler when:** Independence is asserted only from separate
  calls, errors
  are strongly correlated, no closed rubric exists, or one calibrated
  classifier performs as well. Majority is not truth.
- **Possible uses:** Potentially
  [AI response release gate](./use-cases.md#ai-response-release-gate)
  or [near-miss normalization](./use-cases.md#near-miss-normalization), but only
  after single-reviewer errors justify it.
- **What would prove it:** Measure individual and correlated errors, collective
  confident mistakes, cost, and latency against one calibrated reviewer.

## Information-gain interview

Each question is chosen because its answer could change the eventual decision.
The interview stops when further questions cannot help enough or its limit is
reached.

*Candidate pattern · One Agent*

- **Problem it solves:** A conversational system asks low-value questions or
  commits while materially different decision states remain.
- **How it works:** Maintain surviving states; require an `answer -> states` map;
  choose by declared information gain and user effort; stop at a question cap.
- **Why the structure matters:** Question choice is tied to which decisions it can
  change.
- **Use something simpler when:** A stable form or decision tree already
  defines the same
  partitions.
- **Possible uses:** Possible clarification extensions to
  [repair diagnostic](./use-cases.md#repair-diagnostic) and
  [vetted rule front desk](./use-cases.md#vetted-rule-front-desk). Their
  current minimum designs make one choice and do not instantiate an interview.
- **What would prove it:** Reduce user effort or wrong early decisions relative to
  the form and one unconstrained conversational Agent.

## Invariant-preserving lens relay

An item passes through focused editing stages, each allowed to change only
specified parts. Protected facts are checked after every stage.

*Candidate pattern · One Agent*

- **Problem it solves:** Specialized transformations accidentally change facts
  or fields outside their authority.
- **How it works:** Use a structured artifact; declare writable fields per stage;
  validate protected invariants before and after every transform.
- **Why the structure matters:** Mechanically enforced edit scopes between reusable
  transformations.
- **Use something simpler when:** One constrained transformation performs all
  edits or the
  claimed invariants cannot be checked.
- **Possible uses:** [Public notice adaptation](./use-cases.md#public-notice-adaptation)
  and [compartmentalized accession](./use-cases.md#compartmentalized-accession).
- **What would prove it:** Improve specialist quality while producing no more
  invariant violations than one carefully constrained editor.

## Meet-in-the-middle planning

One planning pass works forward from present constraints while another works
backward from the goal. Only feasible meeting points become candidate plans.

*Candidate pattern · One Agent*

- **Problem it solves:** Present constraints distort goal prerequisites, or
  goal knowledge makes a forward plan pretend unavailable steps are feasible.
- **How it works:** Search forward and backward independently; encode bounded
  frontier states; join only exact compatible bridges; expose unmatched states.
- **Why the structure matters:** Search-direction isolation before compatibility.
- **Use something simpler when:** Ordinary forward planning or explicit graph
  search finds
  the same valid bridge more cheaply.
- **Possible use:** [Career transition bridge](./use-cases.md#career-transition-bridge).
- **What would prove it:** Find more actionable valid bridges or fewer missing
  prerequisites than one strong planner on frozen cases.

## Option-preserving commitment ladder

The plan advances through stages as deadlines approach or new facts arrive.
It makes reversible, time-sensitive choices first and postpones commitments
that would benefit from later information.

*Candidate pattern · One Agent*

- **Problem it solves:** A plan closes valuable options early or delays a
  reversible, time-critical step unnecessarily.
- **How it works:** Classify deadline, reversibility, delay cost, dependencies, and
  future facts; commit only authorized safe steps; retain revisit conditions.
- **Why the structure matters:** Explicit option value and authorization at each
  commitment.
- **Use something simpler when:** No meaningful future information exists or a static
  schedule captures every dependency.
- **Possible uses:** Possible later extensions to
  [futureproof event plan](./use-cases.md#futureproof-event-plan) and
  [career transition bridge](./use-cases.md#career-transition-bridge). Their
  current minimum designs recommend; they do not wait and revisit commitments.
- **What would prove it:** Compared with one static schedule, reduce avoidable
  irreversible decisions without increasing missed deadlines or operator
  burden.

## Orthogonal coverage grid

Two different ways of dividing a subject are developed independently and
crossed. Empty or risky intersections reveal gaps that either view might hide.

*Candidate pattern · One Agent*

- **Problem it solves:** One taxonomy creates false confidence while omissions
  exist only at intersections with another framing.
- **How it works:** Derive and freeze two axes separately; cross them exactly;
  investigate empty or high-risk cells with source evidence.
- **Why the structure matters:** Genuinely different decompositions before crossing.
- **Use something simpler when:** Both axes are already known, correlated, or
  easily applied
  by one analyst.
- **Possible use:**
  [Curriculum blind-spot audit](./use-cases.md#curriculum-blind-spot-audit).
- **What would prove it:** Recover seeded intersection-only omissions with acceptable
  false gaps, effort, and cost versus the established rubric.

## Privacy membrane

One trusted step removes information another role should not see. Only the
approved, reduced view crosses the boundary, including in errors and logs.

*Candidate pattern · One Agent*

- **Problem it solves:** A restricted task receives identities or secrets it
  does not need because one context performs every step.
- **How it works:** A trusted stage retains secret-bearing input; project an
  approved representation; accept only a declared restricted-role result.
- **Why the structure matters:** Enforced read separation across inputs, skills,
  errors, diagnostics, results, and retained history.
- **Use something simpler when:** One fully authorized local Agent is
  acceptable or indirect
  identifiers defeat the projection.
- **Possible uses:**
  [Private feedback analysis](./use-cases.md#private-feedback-analysis)
  and [compartmentalized accession](./use-cases.md#compartmentalized-accession).
- **What would prove it:** Against an ordinary trusted projection pipeline, prevent
  more seeded direct and indirect leakage without destroying analytical
  utility or increasing operator error.

## Red-team challenge

A dedicated challenger tests a frozen proposal against a specific threat or
failure model. Someone with authority decides which findings require repair.

*Candidate pattern · One Agent*

- **Problem it solves:** Cooperative drafting suppresses adversarial failure
  paths in a plausible artifact.
- **How it works:** Freeze the proposal and threat model; report reproducible
  findings with severity; an authorized owner accepts findings; repair under a
  finite rule.
- **Why the structure matters:** Committed adversarial search separated from
  remediation acceptance.
- **Use something simpler when:** Exact tests cover the threat or criticism has
  no explicit
  attacker, evidence, severity, or owner.
- **Possible uses:** [Software factory](./use-cases.md#software-factory) and
  [grant proposal workshop](./use-cases.md#grant-proposal-workshop) where a
  concrete exclusion or abuse model exists.
- **What would prove it:** Compared with exact tests and cooperative review of the
  same artifact, find more seeded and realistic failures without overwhelming
  owners with false findings or regressing protected goals during repair.

## Research/review separation

One role gathers sources and states what they support; another independently
decides which claims are trustworthy enough to use.

*Candidate pattern · One Agent*

- **Problem it solves:** Evidence acquisition quietly becomes authority to
  accept its own claims.
- **How it works:** Research emits source-linked claims; a separately scoped role
  accepts, rejects, or qualifies them; composition uses only accepted claims.
- **Why the structure matters:** Evidence collection and claim acceptance have
  distinct authority.
- **Use something simpler when:** Mechanical citation checks or one Agent achieve equal
  support and omission rates.
- **Possible uses:**
  [Procurement evidence brief](./use-cases.md#procurement-evidence-brief)
  and a possible extension to
  [truthful job application](./use-cases.md#truthful-job-application).
- **What would prove it:** Reduce unsupported claims or material omissions enough to
  offset the independent review call and added latency.

## Scenario-action regret matrix

Every allowed action is compared across several plausible scenarios. For each
one, “regret” is how far an action falls short of that scenario's best choice;
the comparison exposes robust choices without guessing at probabilities.

*Candidate pattern · No Agent required*

- **Problem it solves:** A decision pretends disputed scenario probabilities
  are known or hides a dominated action.
- **How it works:** Cross bounded scenarios and authorized actions; populate one
  consequence schema; compute dominance, regret, and thresholds exactly.
- **Why the structure matters:** Explicit comparable consequences across the whole
  matrix.
- **Use something simpler when:** Consequences lack a defensible scale or an existing
  optimizer already represents the problem.
- **Possible use:** An alternative design for
  [futureproof event plan](./use-cases.md#futureproof-event-plan).
- **What would prove it:** Improve realized regret or decision effort against a
  manual table without inventing probabilities or filling unknown cells.

## State-machine policy compiler

A prose policy is turned into explicit situations, permitted actions, and
observable triggers. Ambiguity and dead ends are checked before approval.

*Candidate pattern · One Agent*

- **Problem it solves:** Prose policy is reinterpreted differently on every
  event or contains hidden dead ends and forbidden transitions.
- **How it works:** Elicit states, observable facts, permitted actions, defaults,
  and terminals; compile; check reachability and ambiguity; require approval.
- **Why the structure matters:** Runtime behavior follows an inspected finite policy
  rather than fresh semantic judgment.
- **Use something simpler when:** The policy is already formal or irreducible discretion
  makes compilation misleading.
- **Possible use:**
  [Cold-chain exception packet](./use-cases.md#cold-chain-exception-packet),
  if its SOP cannot already be encoded directly.
- **What would prove it:** Compared with a directly authored finite policy, match
  expert-labelled traces, surface more source-policy omissions and
  contradictions, and introduce no unsafe implicit transitions.
