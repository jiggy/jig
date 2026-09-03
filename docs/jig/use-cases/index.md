# Jig use cases

This is a non-normative catalogue of jobs Jig may be particularly good at.
It is evidence for product design and future design probes, not a roadmap or a
claim that every listed capability exists.

The catalogue is deliberately neutral about agent count. A strong agentless
or single-agent result is preferable to an elaborate multi-agent arrangement.
Multiple agents are justified only when independent context, different skills,
separate authority, or independent commitment changes the correctness of the
method.

## What belongs here

A **use case** is a recurring job with an observable result for a recognizable
user. A mechanism such as “call three Agents” or “route to a Flow” is not a use
case.

A **method** is a reusable orchestration pattern found inside one or more use
cases. The [pattern notebook](./patterns.md) records promising methods early so
they can generate probes. A method becomes recommended practice only after at
least two demonstrated use cases need it.

A **tutorial** is one reproducible implementation of a use case. Tutorials may
choose a convenient domain without changing the catalogue definition.

Every entry must answer two uncomfortable questions:

1. Why is Jig better here than the simplest credible script, ordinary LLM,
   local Agent application, CI job, or automation product?
2. What is the least complicated architecture that preserves the value?

If either answer is weak, the entry should be narrowed or removed.

## Vocabulary

The minimum topology records the least complex adequate design:

- `agentless`: no AI call;
- `single-agent`: one logical AI role, even if invoked repeatedly; and
- `multi-agent`: independently scoped roles whose separation affects the
  method. Several calls, personas, or votes alone do not qualify.

Mechanisms use a small descriptive vocabulary:

`deterministic-step`, `sequence`, `parallel`, `branch`, `join`,
`bounded-loop`, `wait`, `authorized-choice`, and `fact-trigger`.

Catalogue maturity has three values:

- `candidate`: the outcome and Jig advantage are credible, but important
  design or evidence remains;
- `specified`: a full brief defines the minimum architecture, authority,
  bounds, failures, baseline, and evaluation; and
- `demonstrated`: a reproducible artifact has passed its stated checks against
  an exact Jig release or commit.

These describe evidence maturity, not product support. A demonstrated entry
is demoted when its evidence no longer works. Disproven or superseded entries
are deleted; Git preserves their history.

## Specified cases

### Evaluate external code without revealing private tests (`confidential-benchmark`)

`specified` · `agentless` · `deterministic-step`

- **Outcome:** A lab or procurement team obtains local benchmark results from
  an externally authored algorithm without trusting it on the host or sending
  private cases to its author.
- **Situation:** The code author and data owner are different parties with a
  real trust boundary.
- **Minimality:** An Agent adds no value; exact contained computation is the
  point.
- **Authority and requirements:** The operator admits one exact package and
  supplies bounded JSON input. The package receives no network or ambient host
  access. Jig retains root input and terminal data locally; output disclosure
  remains an operator decision.
- **Maturity basis / next gate:** Admission and containment exist, but the
  current `--input JSON` command argument is not an acceptable secret-input
  channel. First earn a bounded non-argument input path; then run the hostile
  and legitimate leakage, substitution, resource, and cleanup probe.
- **Detail:** [Confidential benchmark](./confidential-benchmark.md)

### Recover missing wages from messy records (`underpayment-reconstruction`)

`specified` · `single-agent` · `sequence`, `deterministic-step`

- **Outcome:** A worker or clinic receives a source-linked discrepancy ledger
  computed with exact monetary rules.
- **Situation:** Workers or clinics apply independently maintained,
  jurisdictional rule packages to records that mix prose, inconsistent
  layouts, and exact arithmetic.
- **Minimality:** One extraction role plus deterministic calculation is
  sufficient. Additional Agents are unjustified until measured extraction
  errors demonstrate a need.
- **Authority and requirements:** The Agent may extract evidence but cannot
  decide entitlement, submit a claim, or move money. Rich structured results,
  source coordinates, document input, maintained jurisdictional rules, and
  professional review are prerequisites.
- **Maturity basis / next gate:** The complete architecture and evidence gates
  are specified, but the alpha lacks the required document and structured
  extraction surfaces and fixes a third-party Agent provider that may be
  unsuitable for wage records.
- **Detail:** [Underpayment reconstruction](./underpayment-reconstruction.md)

### Choose an event plan that survives uncertain attendance (`futureproof-event-plan`)

`specified` · `single-agent` · `branch`, `join`, `deterministic-step`

- **Outcome:** An organizer sees the choice made under each supplied
  attendance scenario and whether one authorized plan survives all of them.
- **Situation:** Several known futures matter, but probabilities are weak or
  disputed.
- **Minimality:** One logical scenario-analysis role is invoked in isolated
  contexts so incompatible assumptions are not blended. A deterministic join
  compares its closed choices; additional Agent roles add nothing.
- **Authority and requirements:** Agent calls rank only user-supplied choices
  and cannot book or purchase anything.
- **Maturity basis / next gate:** The current closed-enum Agent result is
  sufficient for a bounded first probe. Compare it with one Agent shown all
  scenarios while controlling for ordinary model variance.
- **Detail:** [Futureproof event plan](./futureproof-event-plan.md)

## Candidate backlog

### Summarize sensitive feedback without revealing authors (`private-feedback-analysis`)

`candidate` · `multi-agent` · `sequence`, `join`

- **Outcome:** A group receives themes and actionable concerns while the
  analysis role never receives identities.
- **Situation:** An organization wants useful synthesis from a feedback set
  whose identity-bearing records must remain with a different trusted role.
- **Minimality:** Information separation, not additional opinions, creates the
  value. One all-seeing Agent defeats it.
- **Authority and requirements:** A trusted redaction/reintegration step and
  separately projected contexts are required. Prove that identity-bearing
  fields cannot reach the analysis call.
- **Maturity basis:** Information partitioning is a credible Jig advantage,
  but the required context boundary and reidentification model are not yet
  specified.
- **Next gate:** Specify the redaction contract and realistic reidentification
  attacks before promoting this case.

### Select only an admitted repair procedure (`repair-diagnostic`)

`candidate` · `single-agent` · `authorized-choice`, `branch`

- **Outcome:** A repair technician receives the next test from one admitted,
  model-specific procedure or an explicit abstention.
- **Situation:** Free-text symptoms require interpretation, while safety
  requires a closed and professionally maintained set of procedures.
- **Minimality:** A decision tree wins for structured fault codes. One chooser
  Agent is warranted only when free-text observations are genuinely
  ambiguous; more Agents add nothing.
- **Authority and requirements:** The Agent cannot invent or invoke an
  unlisted procedure. This needs host-owned choice over a compatible admitted
  catalogue and strong abstention behavior.
- **Maturity basis:** The authority boundary is credible, but no demonstrated
  diagnostic corpus yet proves that semantic selection beats a form.
- **Next gate:** Demonstrate a case where semantic interpretation beats a
  form while the closed candidate universe prevents an unsafe invented step.

### Allocate once from a frozen roster (`auditable-allocation`)

`candidate` · `agentless` · `fact-trigger`, `deterministic-step`

- **Outcome:** A cooperative or grant program obtains one reproducible
  allocation record tied to an exact roster, seed, and admitted algorithm.
- **Situation:** Duplicate delivery or coordinator loss must not create a
  second official allocation from the same close event.
- **Minimality:** An Agent would weaken rather than improve the result.
- **Authority and requirements:** A trustworthy close event, immutable inputs,
  durable non-redispatch semantics, and a correction process are required.
- **Maturity basis:** The outcome exercises a real durability boundary, but
  Jig has no admitted Event Source or derivation path today.
- **Next gate:** Specify event identity and failure recovery without claiming
  exactly-once external effects.

### Share protected aggregates under one privacy budget (`privacy-budgeted-analysis`)

`candidate` · `agentless` · `sequence`, `deterministic-step`

- **Outcome:** Independently authored analyses obtain approved aggregates
  while a durable provider denies queries that exceed a cumulative privacy
  budget.
- **Situation:** Several mutually untrusted analyses need useful access to one
  sensitive cohort without receiving rows or resetting shared expenditure.
- **Minimality:** Agents add risk, not value. The essential feature is a typed,
  stateful authority boundary shared across packages.
- **Authority and requirements:** A real privacy mechanism, atomic accounting,
  caller identity, dataset governance, and side-channel review are required.
- **Maturity basis:** This is a strong stateful capability boundary, but no
  provider lifecycle or real privacy implementation exists in the product.
- **Next gate:** Prove the lifecycle with a genuine privacy implementation;
  a process-local counter is not evidence.

### Seal field evidence without exposing signing keys (`field-evidence-sealing`)

`candidate` · `agentless` · `sequence`, `deterministic-step`

- **Outcome:** A journalist or field inspector creates a tamper-evident bundle
  whose originals, derivations, timestamps, and signatures remain linked.
- **Situation:** Independently authored field protocols need to reuse one
  operator-owned vault without receiving its keys or mutable storage access.
- **Minimality:** Authenticity comes from a stateful provider owning keys and
  append-only storage, not from AI.
- **Authority and requirements:** Trusted time and key hardware, canonical
  media handling, secure storage, and evidence policy are external
  prerequisites.
- **Maturity basis:** The authority separation is credible, but the exact
  portable operations and a recurring adopter remain unidentified.
- **Next gate:** Identify a narrow field workflow where several independent
  protocols genuinely need the same least-authority vault.

### Turn an incoming ticket into reviewed delivered work (`software-factory`)

`candidate` · `multi-agent` · `fact-trigger`, `authorized-choice`,
`branch`, `bounded-loop`, `join`

- **Outcome:** A ticket progresses through triage, planning, implementation,
  validation, and review with visible state and bounded authority.
- **Situation:** A software team wants long-running autonomous work without
  granting one coding Agent unrestricted repository and delivery authority.
- **Minimality:** Different roles, workspaces, and permissions are essential;
  an unrestricted coding Agent is a different product.
- **Authority and requirements:** Durable events, human policy, isolated work
  spaces, bounded selection, and explicit adapters to project systems are
  application prerequisites rather than committed Jig surfaces.
- **Maturity basis:** This remains a north-star application, not an admissible
  next probe; nearly all of its constituent methods still lack independent
  demonstrations.
- **Next gate:** Demonstrate the earlier static methods independently before
  combining them into this application.

## Compact idea bank

The entries below remain `candidate`. They are intentionally shorter than the
developed candidates above. Grouping identifies the earliest distinguishing
surface in the idea, not a promised implementation phase or required release
order. Their common next gate is selection for deeper specification: define
authority, bounds, contracts, the strongest baseline, and a falsifiable
evaluation, then promote the entry above or delete it before implementation.

### Exact contained computation

- **Audit a private system with external checks**
  (`confidential-control-capsule`; `agentless`): run auditor-authored checks
  against a private configuration export without trusting arbitrary code on
  the workstation. Jig matters only when ordinary policy languages are too
  restrictive and the author/operator trust boundary is real; OPA, a signed
  script, or a disposable VM is the baseline.
- **Decode a suspect legacy file** (`quarantined-format-decoder`; `agentless`):
  extract bounded metadata or a preview while treating both parser and input as
  hostile. Standard content-disarm software wins for known formats; a useful
  Jig case needs bounded artifact input rather than command-line JSON.
### One bounded Agent role

- **Find gaps between consent promises and data collection**
  (`consent-promise-gap`; `single-agent`): produce a cited mismatch matrix from
  a consent form, protocol, survey configuration, and export plan. A local LLM
  or governance product wins unless an independently maintained review package
  and per-call policy skill are valuable.
- **Screen an archive collection for release review**
  (`collection-release-screener`; `single-agent`): flag passages, names, and
  dates under only that collection's donor restrictions. The real Jig claim is
  enforced context exclusion across reusable packages, not generic document
  summarization.
- **Code site-specific safety reports**
  (`site-near-miss-coding`; `single-agent`): map narrative reports to one
  site's approved class, severity, and escalation enums for human confirmation.
  A local classifier wins once categories and language are stable.
- **Check an AI response before downstream use**
  (`ai-response-gate`; `single-agent` or `multi-agent`): combine prompt-injection
  screening, citation support checks, and deterministic output-schema
  validation into an accept/hold report. Existing guardrail libraries are the
  baseline; multiple Agents are justified only when checks require independent
  evidence or authority.

### Static orchestration

- **Improve an artifact through bounded quality gates**
  (`gauntlet-artifact`; `single-agent` or `multi-agent`): build, test, review,
  repair, and stop at acceptance or an iteration limit. It is useful for grant
  proposals, policy briefs, and executable artifacts only when the gates are
  concrete and failures return actionable evidence.
- **Adjudicate an ambiguous closed decision independently**
  (`independent-jury`; `multi-agent`): commit several isolated classifications
  before deterministic aggregation. Majority reduces only genuinely
  independent error; it cannot establish truth or repair a bad rubric.
- **Attack and harden a frozen plan** (`red-team-plan`; `multi-agent`): search
  an evacuation, security, or program design for concrete failure paths under
  an explicit threat model, then repair accepted findings under a hard bound.
- **Produce a source-grounded research brief**
  (`research-review-brief`; `multi-agent`): separate evidence gathering from
  claim acceptance and preserve citation support through synthesis. A research
  assistant wins unless roles have real source, skill, or acceptance
  separation.
- **Assemble a disaster-claim evidence binder**
  (`disaster-claim-binder`; `single-agent` or `multi-agent`): link damage,
  inventory, receipts, policy clauses, and missing evidence while leaving
  coverage decisions to a human. The application needs multimodal artifacts,
  provenance, and a credible advantage over claims software.
- **Trace a food-recall lot through messy records**
  (`food-recall-trace`; `single-agent`): extract heterogeneous logs and build
  the lot graph deterministically. An integrated ERP wins whenever the
  producer already has clean operational data.
- **Write a public museum label without revealing donor terms**
  (`compartmentalized-accession`; `multi-agent`): a private rights role emits
  only cleared facts to a separately scoped writing role. Jig matters when the
  information boundary must be inspectable, not merely requested in a prompt.
- **Reconstruct a protocol deviation**
  (`protocol-deviation-reconstruction`; `single-agent` or `multi-agent`): join
  source-linked claims from logs and notes into an exact timeline without
  erasing contradictions. QMS or LIMS software wins for integrated operations.
- **Prepare a truthful job application**
  (`job-application-workshop`; `multi-agent`): separate employer research,
  résumé-evidence mapping, drafting, and unsupported-claim review. It must
  outperform a strong career assistant without fabricating qualifications.
- **Adapt one public notice without changing its facts**
  (`public-notice-relay`; `single-agent`): apply clarity, accessibility, and
  localization lenses under protected factual invariants. Several personas
  with identical context are unnecessary.
- **Find the bridge into a new career**
  (`career-transition-bridge`; `multi-agent`): isolate forward feasibility from
  backward prerequisite search and join compatible states. It is justified
  only when that separation exposes missing steps a conventional planner
  overlooks.
- **Find curriculum blind spots across two independent axes**
  (`curriculum-coverage-grid`; `multi-agent`): cross concept coverage with
  cognitive skills and investigate empty intersections. A conventional rubric
  wins if the axes are already known.
- **Diagnose an unexplained household energy spike**
  (`energy-discrimination`; `multi-agent`): preserve rival causal models and
  request the cheapest safe observation that distinguishes them. This needs a
  bounded interaction path and must not masquerade as professional electrical
  advice.

### Authorized semantic choice

- **Apply only a vetted jurisdictional calculator**
  (`vetted-law-front-desk`; `single-agent`): interpret a messy benefits or
  deadline narrative, select one compatible admitted rule package, or abstain.
  A structured legal expert system wins when a form can collect the facts.
- **Choose one approved waste-disposal method**
  (`authorized-waste-disposition`; `single-agent`): map free text to an
  EHS-approved calculation and checklist without allowing improvised safety
  advice. The semantic step must beat a form to justify itself.
- **Apply the approved release transform**
  (`approved-release-transform`; `single-agent`): choose an admitted redaction
  or de-identification package for the declared data and purpose while a human
  retains release authority. Existing DLP software is the primary baseline.

### Durable fact activation

- **Create one cold-chain exception packet per excursion**
  (`cold-chain-excursion`; `agentless` or `single-agent`): bind one authenticated
  excursion to the exact SOP revision, calculate exposure, and optionally
  draft a human brief without speculative redispatch. IoT monitoring products
  win when ordinary connector idempotency is enough.

### Stateful least-authority services

- **Run portable protocols against a protected instrument**
  (`instrument-protocol-commons`; `agentless`): let a typed provider own
  calibration, units, sessions, and safety interlocks while independently
  authored methods remain replaceable. Vendor software wins in single-vendor
  laboratories.
- **Enforce changing consent across archive tools**
  (`consent-gated-archive`; `agentless`): give transcription and publication
  packages narrow consent operations without exposing the rights database.
  A monolithic archive system wins unless independent tools genuinely share
  the boundary.
- **Expose safe diagnostics without raw device access**
  (`safe-repair-bus`; `agentless`): permit admitted procedures to use typed,
  interlocked operations rather than arbitrary serial or vehicle-bus commands.
  OEM tools remain the strongest alternative.

### Complete applications

- **Run a persistent job-search campaign**
  (`job-search-campaign`; `multi-agent`): discover opportunities, verify fit,
  prepare truthful applications, retain status, and react to deadlines under
  user approval. This is valuable only after its static application workshop,
  source integrations, and durable state each prove themselves independently.

## Full-page rule

A candidate earns a full page only when it represents a recurring job, names a
specific Jig advantage, survives the simpler-baseline test, states its inputs
and authority precisely, has bounded failure behavior, and defines observable
success. Domain reskins remain variants of an existing page.

A full brief uses this outline:

1. Outcome
2. Fits / does not fit
3. Minimum architecture
4. Inputs and authority
5. Orchestration
6. Contracts
7. Bounds and failure behavior
8. Success and baseline
9. Current requirements
10. Evidence
11. Variants

Design probes consume these briefs through public documentation and released
artifacts. A probe may expose a missing platform surface, but it must stop and
report that gap rather than inventing an SDK or changing a specification while
trying to consume it.
