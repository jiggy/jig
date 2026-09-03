# Orchestration pattern handbook

This non-normative handbook records candidate methods for building FLOW
packages. It is not a Jig API, a Sley graph model, or a recommendation to use
multiple Agents. A Flow owns its method. Jig contributes host boundaries such
as exact admission, bounded Agent effects, and exact child calls only when the
method genuinely needs them.

No pattern here is established Jig practice yet. A pattern earns that status
only after at least two independently demonstrated use cases need its
irreducible property.

## The pattern test

Before adopting a pattern, write down:

1. **Failure to prevent:** the concrete error produced by the simpler design.
2. **Partition:** what evidence, skills, authority, or commitment differs
   between participants.
3. **Protocol:** the typed information passed between stages.
4. **Deterministic spine:** eligibility, validation, joins, bounds, and stop
   rules that must not be delegated to prose generation.
5. **Authority owner:** who may accept, invoke, publish, spend, or modify.
6. **Falsifier:** the result that would make one Agent, a script, a solver, or
   an existing product preferable.

If the partition is only a persona prompt, collapse the design. If the join
has to “understand what everyone meant,” its contract is still unspecified.

## Selection map

| Observed risk | Candidate pattern | Prefer the simpler alternative when |
| --- | --- | --- |
| A producer approves its own artifact | Gauntlet or research/review separation | Exact tests already decide acceptance. |
| One ambiguous judgment is unstable | Independent jury | Errors are correlated or no closed rubric exists. |
| One extraction can silently omit facts | Double-entry reconciliation | The second pass has no independent evidence, skill, or model lineage. |
| A plausible plan hides adversarial failure | Red-team challenge | No explicit threat model or remediation owner exists. |
| A large job has separable parts | Orchestrator and bounded workers | The work is coherent or synthesis dominates the task. |
| Coverage along one taxonomy hides blind spots | Orthogonal coverage grid | Both axes are already exact and one script can cross them. |
| New facts should activate only affected reasoning | Blackboard to fixpoint | A bounded sequence or ordinary event handler suffices. |
| Ordered edits must preserve protected facts | Invariant-preserving lens relay | One constrained transform can do the work. |
| Some role must not see protected context | Privacy membrane | All participants are authorized to see the same data. |
| A missing answer should select the next question | Information-gain interview | A stable form or decision tree already exists. |
| A recommendation may flip across assumptions | Controlled assumption reveal or regret matrix | Consequences can be calculated directly. |
| Commitments differ in reversibility or deadline | Option-preserving commitment ladder | One static plan has no meaningful option value. |
| Rival causes imply different safe observations | Causal discrimination cascade | A professional diagnostic procedure already determines the next test. |
| Prose policy must become inspectable control | State-machine policy compiler | Policy is already formal. |
| Stakeholder constraints conflict | Pareto contract or constraint propagation | One authorized optimizer already has all inputs. |
| Components must form a compatible bundle | Typed component assembly | A curated template covers the need. |
| Present feasibility and goal prerequisites distort one another | Meet-in-the-middle planning | Ordinary forward planning finds the same bridge. |
| Free text must choose one admitted action | Bounded semantic dispatch | A menu, form, or deterministic predicate is reliable. |

## Reliability and challenge

### Gauntlet

- **Use when:** a concrete artifact can be checked and repair evidence can be
  fed back under a fixed budget.
- **Protocol:** build artifact; run declared gates; return typed failures to
  the responsible repair stage; stop on acceptance, a blocking failure, or an
  iteration limit.
- **Non-negotiable:** the producer cannot turn an unsupported “looks good” into
  acceptance. Exact gates remain exact; independent review is separate only
  when it contributes evidence the producer lacks.
- **Reject when:** one capable Agent plus existing tests produces the same
  artifact, or the quality bar cannot be made observable.
- **Evidence needed:** compare quality, undetected defects, calls, latency, and
  cost with that one-Agent baseline on frozen tasks. Candidate cases include
  inspectable software, proposals, and policy briefs.

### Independent jury

- **Use when:** several independently committed judgments over one closed
  rubric can reduce a measured, partially independent error.
- **Protocol:** each juror receives the same evidence in isolation and returns
  one allowed decision; a deterministic threshold aggregates committed
  answers and exposes dissent.
- **Non-negotiable:** juror outputs are hidden until commitment. Majority is a
  decision rule, not truth, and cannot repair a bad rubric.
- **Reject when:** calls share the same dominant failure mode, the question is
  a value dispute, or one calibrated classifier performs as well.
- **Evidence needed:** estimate individual and correlated errors, compare with
  one Agent at equal total cost, and report confident collective mistakes.

### Double-entry reconciliation

- **Use when:** omission or transcription errors in a structured
  reconstruction matter and two genuinely different extraction paths are
  available.
- **Protocol:** construct two typed records independently; canonicalize only
  syntactic fields; compare exact fields; send disputed source spans—not two
  persuasive narratives—to a resolver or human.
- **Non-negotiable:** semantic equivalence is not silently treated as an exact
  match, and agreement does not erase shared-source uncertainty.
- **Reject when:** the second pass uses identical evidence and behavior or a
  deterministic parser already covers the format.
- **Evidence needed:** measure missed facts, false conflicts, correlated
  omissions, and resolution time against one careful extraction pass.

### Red-team challenge

- **Use when:** a frozen proposal has identifiable adversaries, hazards, or
  abuse paths and someone owns remediation decisions.
- **Protocol:** define the threat model; freeze the proposal; produce findings
  with evidence, severity, and reproduction; accept or reject each finding;
  repair accepted findings under a finite loop.
- **Non-negotiable:** the red team cannot rewrite the objective or approve its
  own remediation. Generic negativity is not a finding.
- **Reject when:** no plausible attacker or failure model exists, or standard
  checks already cover it more reliably.
- **Evidence needed:** seed known and misleading faults, measure discovery and
  false-alarm rates, and verify that repairs do not regress protected goals.

### Research/review separation

- **Use when:** claims depend on source quality and the evidence collector has
  incentives or context that should not determine acceptance.
- **Protocol:** research produces a source-linked claim packet; review accepts,
  rejects, or qualifies claims against explicit source criteria; composition
  uses only reviewed claims.
- **Non-negotiable:** the reviewer can inspect evidence and block unsupported
  claims. Copy editing is not review.
- **Reject when:** one researcher with mechanical citation checks is equally
  accurate, or the source corpus itself is not trustworthy.
- **Evidence needed:** compare unsupported claims, material omissions,
  citation fitness, cost, and time with a strong research Agent.

## Decomposition and information boundaries

### Orchestrator and bounded workers

- **Use when:** a job has materially independent subproblems or workers need
  different sources, tools, skills, or authority.
- **Protocol:** create a finite plan; give each worker one explicit task and
  result contract; retain task identity through failure; join results with
  declared completeness rules.
- **Non-negotiable:** workers cannot expand the plan or silently delegate, and
  synthesis reports missing work instead of smoothing it over.
- **Reject when:** the problem is coherent, context duplication dominates, or
  one Agent can use the same tools more effectively.
- **Evidence needed:** measure completeness, cross-part inconsistency,
  recovery, context cost, and latency against a single well-equipped Agent.

### Orthogonal coverage grid

- **Use when:** one taxonomy creates an unjustified sense of completeness and
  two genuinely independent axes expose missing intersections.
- **Protocol:** derive the axes separately; freeze their definitions; cross
  them deterministically; investigate empty or high-risk cells; retain the
  evidence behind each populated cell.
- **Non-negotiable:** a filled grid is not proof of completeness, and correlated
  axes are disclosed rather than marketed as independent coverage.
- **Reject when:** the axes are already known or one analyst can enumerate the
  same matrix exactly.
- **Evidence needed:** seed omissions that only appear at intersections and
  compare recall, false coverage, and effort with a conventional rubric.

### Blackboard to fixpoint

- **Use when:** asynchronously produced facts should activate only reasoning
  whose typed prerequisites changed.
- **Protocol:** roles append immutable typed deltas; deterministic activation
  rules schedule affected roles; provenance is retained; execution stops at
  quiescence or a hard budget.
- **Non-negotiable:** roles do not continuously poll or overwrite shared prose,
  and repeated equivalent deltas cannot create an unbounded loop.
- **Reject when:** a known sequence, database trigger, or event handler solves
  the problem without semantic activation.
- **Evidence needed:** demonstrate incremental recomputation, termination,
  provenance, and useful work avoided relative to a simple sequential loop.

### Invariant-preserving lens relay

- **Use when:** ordered transformations have distinct edit scopes while named
  facts or structural fields must survive every stage.
- **Protocol:** represent the artifact structurally; declare each stage's
  writable fields; validate protected invariants before and after every
  transform; reject unauthorized changes.
- **Non-negotiable:** deterministic checks, not downstream prose review, guard
  machine-verifiable invariants.
- **Reject when:** one constrained transform can perform all edits or the
  artifact is unstructured enough that edit scopes cannot be verified.
- **Evidence needed:** inject tempting invariant violations and compare final
  usefulness and preservation with one all-purpose editor.

### Privacy membrane

- **Use when:** one operation needs protected context while another must not
  receive it, even though their outputs contribute to one result.
- **Protocol:** a trusted projection step retains secret-bearing data; the
  restricted role receives only the approved representation; reintegration
  accepts only a declared result shape.
- **Non-negotiable:** inputs, diagnostics, errors, skills, and retained history
  are all part of the information-flow analysis. “Ignore the names” is not a
  boundary.
- **Reject when:** one authorized local Agent can see all data safely or the
  projection preserves indirect identifiers that defeat the claim.
- **Evidence needed:** publish a threat model, seed direct and indirect
  identifiers, inspect every observable channel, and compare with an ordinary
  redaction pipeline or data clean room.

## Decisions under uncertainty

### Information-gain interview

- **Use when:** the answer space is explicit but the cheapest next user
  question depends on answers already given.
- **Protocol:** maintain surviving states; generate questions with an explicit
  `answer -> states` partition; choose by declared information gain and user
  cost; stop at a question budget with a conditional result.
- **Non-negotiable:** the Agent cannot invent decisive facts or hide remaining
  states behind a confident recommendation.
- **Reject when:** a stable form or decision tree already contains the same
  partitions.
- **Evidence needed:** compare questions, completion, user effort, and wrong
  early conclusions with that form and one conversational Agent.

### Controlled assumption reveal

- **Use when:** recommendations may reverse under a small set of explicit
  assumptions and cross-branch influence would hide that instability.
- **Protocol:** give each isolated branch common facts plus one assumption
  bundle; require a closed recommendation before reveal; compare action IDs
  and organizer-supplied condition IDs exactly.
- **Non-negotiable:** free-text explanations remain attached to their branch;
  they are not semantically normalized into false agreement.
- **Reject when:** consequences are deterministic, branches see one another's
  conclusions, or repeated-call variance dominates scenario sensitivity.
- **Evidence needed:** use same-scenario controls and prelabelled cases to
  measure false invariance, scenario sensitivity, variance, latency, and cost.

### Scenario-action regret matrix

- **Use when:** authorized actions and scenarios are bounded, probabilities
  are weak, and comparable consequences can be represented explicitly.
- **Protocol:** populate the declared consequence schema for every
  scenario-action cell; exact code computes dominance, regret, and thresholds;
  the authorized person selects the trade-off.
- **Non-negotiable:** missing cells remain missing and the system does not
  fabricate probabilities.
- **Reject when:** a deterministic domain model can populate the matrix or the
  consequence scale has no defensible meaning.
- **Evidence needed:** compare cell accuracy, missingness, chosen robustness,
  and decision effort with one holistic recommendation and a manual table.

### Option-preserving commitment ladder

- **Use when:** choices differ materially in deadline, reversibility, delay
  cost, dependencies, and facts likely to arrive later.
- **Protocol:** classify commitments; execute only authorized reversible or
  time-critical steps; retain explicit branches and revisit triggers for
  irreversible choices.
- **Non-negotiable:** the planner cannot spend, book, or close an option merely
  because it recommends doing so.
- **Reject when:** no meaningful future information or option value exists, or
  a static schedule already captures every dependency.
- **Evidence needed:** compare avoidable irreversible commitments, missed
  deadlines, retained options, and operator burden with a conventional plan.

### Causal discrimination cascade

- **Use when:** rival causal models imply different observations or safe tests
  and premature convergence is materially costly.
- **Protocol:** commit each model and its predicted observations; select the
  cheapest safe discriminator; acquire the fact through an authorized path;
  update or eliminate models; stop at a fixed test budget.
- **Non-negotiable:** tests cannot exceed safety authority, and model labels do
  not imply independent evidence when all roles share one failure mode.
- **Reject when:** a professional diagnostic procedure already fixes the next
  test or observations cannot safely distinguish the models.
- **Evidence needed:** use known-cause fixtures and measure tests, cost, unsafe
  advice, premature closure, and final discrimination against one diagnostician.

### State-machine policy compiler

- **Use when:** prose policy needs to become a finite, inspectable procedure
  driven only by observable facts.
- **Protocol:** elicit states, facts, permitted actions, forbidden transitions,
  defaults, and terminals; compile; check reachability, ambiguity, and dead
  ends; require human acceptance before use.
- **Non-negotiable:** the generated machine cannot silently fill an undefined
  transition or turn advice into external authority.
- **Reject when:** the policy is already formal or its discretion cannot be
  represented without misleading simplification.
- **Evidence needed:** compare the compiled machine with source policy and
  expert-labelled traces, including omissions and contradictory clauses.

## Constraints and assembly

### Pareto contract

- **Use when:** several real stakeholders own hard constraints and preferences
  but no single scalar objective is legitimate.
- **Protocol:** collect authenticated constraints and permitted concessions;
  compute the feasible Pareto frontier and minimal conflict sets; leave the
  final trade-off to the authorized participants.
- **Non-negotiable:** Agent personas are not stakeholders and cannot invent
  preferences or weights.
- **Reject when:** one authorized optimizer owns the objective or ordinary
  scheduling software models the problem completely.
- **Evidence needed:** test feasibility, missing constraints, minimal conflict
  explanations, and decision effort against a standard solver interface.

### Distributed constraint propagation

- **Use when:** constraints are genuinely distributed across private domains
  or independent owners and only bounded reductions should cross boundaries.
- **Protocol:** each domain maintains local variables and constraints;
  exchange typed domain reductions; iterate to a fixpoint; expose conflicts or
  explicit relaxations; branch only under a declared bound.
- **Non-negotiable:** reductions cannot leak more private information than the
  contract permits, and no role silently weakens another's hard constraint.
- **Reject when:** one solver can legitimately receive every constraint.
- **Evidence needed:** compare solution quality, disclosure, rounds, and
  conflict diagnosis with centralized constraint solving.

### Typed component assembly

- **Use when:** a bundle must be assembled from components with exact
  prerequisites, effects, resources, and incompatibilities.
- **Protocol:** validate a finite inventory; use exact-cover or bounded search;
  return the selected bundle plus unmet requirements and conflicts.
- **Non-negotiable:** semantic generation may propose inventory entries but
  cannot bypass type and compatibility checks.
- **Reject when:** a curated template or package manager already expresses the
  complete compatibility model.
- **Evidence needed:** evaluate valid-bundle rate, unmet constraints, search
  bounds, and authoring effort against templates and one unconstrained Agent.

### Meet-in-the-middle planning

- **Use when:** forward feasibility from the present and backward prerequisites
  from the goal systematically distort one another.
- **Protocol:** isolate both searches; represent bounded frontier states in a
  shared exact schema; join only compatible bridges; expose unmatched states
  and assumptions.
- **Non-negotiable:** a semantic join cannot quietly declare two incompatible
  states equivalent.
- **Reject when:** ordinary forward planning or an explicit graph search finds
  the same path with less work.
- **Evidence needed:** seed goals with hidden prerequisites and present states
  with misleading affordances; measure valid bridges, missed prerequisites,
  and cost.

## Authorized control

### Bounded semantic dispatch

- **Use when:** free-text context must choose among a finite set of already
  eligible exact actions and deterministic predicates are inadequate.
- **Protocol:** deterministic code constructs the complete candidate set; one
  Agent returns a candidate ID or abstention under a closed schema; code
  validates the ID and invokes its exact mapping.
- **Non-negotiable:** the chooser cannot discover, admit, install, synthesize,
  or authorize a target, and candidate truncation cannot be hidden.
- **Reject when:** a menu, form, classifier, or rule reliably produces the same
  selection.
- **Evidence needed:** test ambiguous valid inputs, abstentions, unauthorized
  and nonexistent requests, set-size limits, and selection quality against the
  best deterministic router. Any out-of-set invocation is a hard failure.

## From handbook to probe

A probe starts from a [catalogued user outcome](./catalogue.md), not from the
desire to implement a pattern. It fixes the simpler baseline, authority map,
protocol, budget, and falsifier before code is written. It removes any role
whose absence does not change the semantics.

If the probe needs a new platform feature, it stops with an evidence-backed
gap. A consumer experiment cannot amend Jig or FLOW merely to make its chosen
pattern pass.
