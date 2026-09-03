# Jig use cases

This non-normative catalogue records recurring user jobs that may become
materially better when FLOW packages run under Jig. It guides design probes
and, after evidence exists, tutorials. It is not a product-support matrix or a
roadmap; the [direct-alpha guide](./guide/) is the authority for what the
current release provides.

A use case is a user, a recurring job, and an observable result. Gauntlet,
jury, semantic dispatch, and similar methods belong in
[candidate orchestration patterns](./orchestration-patterns.md), not here.

Every entry has the same shape. There are no privileged “full briefs.”

- **Outcome** identifies the user and useful result.
- **Why Jig** states the hypothesis that distinguishes Jig from an ordinary
  script, Agent application, CI job, workflow engine, or specialist product.
- **Minimum design** uses the least complicated adequate topology.
- **Required boundary** names Jig mechanisms first and external domain or
  application prerequisites second.
- **Strongest alternative** says when Jig should lose.
- **Proof before tutorial** defines the comparison needed before promoting the
  case publicly.

Every entry is an untested `hypothesis` unless an evidence link explicitly
says otherwise. Later results are `supported`, `inconclusive`, or `falsified`;
a working implementation alone is not support. Negative results remain
visible so failed ideas are not rediscovered as new ones.

Topology is `agentless`, `single-agent`, or `multi-agent`. Repeated calls to
one logical role remain single-agent. Multiple Agents are warranted only when
different evidence, skills, authority, or independent commitment changes the
method.

## Demonstration sequence

This is a sequence for choosing probes and tutorials, not an assertion that
every application needs every boundary.

| Boundary under study | Flagship story | Current alpha | Question the probe must answer |
| --- | --- | --- | --- |
| Exact admitted Run | [Confidential counterparty evaluation](#confidential-counterparty-evaluation) | Public-fixture containment is available; private input is blocked on a non-argument secret channel and retention policy. | Does independent hosting make third-party code safer and simpler to review than the strongest sandboxed alternative? |
| One bounded Agent effect | [AI response release gate](#ai-response-release-gate) | Experimental for root Flows, bounded JSON, selected skills, and the fixed remote provider. | Does a distributable, skill-bounded reviewer improve a real application's release decision? |
| Static orchestration | [Grant proposal workshop](#grant-proposal-workshop) | Repeated effects can run in one root Flow. Bound child calls are agentless; Agent-capable Flows cannot be child slots. | Do explicit maker, evidence, and quality gates outperform one strong Agent at acceptable cost? |
| Authorized semantic dispatch | [Repair diagnostic](#repair-diagnostic) | Unavailable. | Can semantic interpretation improve free-text routing without expanding the admitted action set? |
| Durable fact activation | [Cold-chain exception packet](#cold-chain-exception-packet) | Unavailable. | Can one outside fact derive one exact assessment without unsafe redispatch? |
| Stateful least-authority capability | [Privacy-budgeted analysis](#privacy-budgeted-analysis) | Capability descriptors exist; provider binding and lifecycle are unavailable. | Can independent packages share protected state without receiving its underlying authority? |

The software factory is deliberately absent from the boundary column: it is
an application that may combine several boundaries, not another platform
primitive.

## North star

### Software factory

`hypothesis` · `single-agent` · integrated application

- **Outcome:** A maintainer turns an authorized issue into a tested,
  reviewable patch bundle while seeing its state and retaining merge and
  release authority.
- **Why Jig:** Independently admitted procedures, bounded workspaces, exact
  gates, and separated implementation and review authority remain inspectable
  across a long-running lifecycle.
- **Minimum design:** Start with one coding Agent and exact tests. Add planning,
  review, or security roles only when they receive different skills,
  workspaces, evidence, or approval authority. Semantic choice is optional;
  explicit routes should work first.
- **Required boundary:** The earliest bounded slice is one root coding Agent
  plus exact in-package gates. The complete case is blocked on workspace
  authority, Agent-bearing component composition, durable issue facts, and
  explicit Git/CI adapters. Kanban, branch policy, repository credentials,
  and the interface are application responsibilities.
- **Strongest alternative:** A strong coding Agent plus CI wins for a small
  trusted team unless independent procedures and least-authority roles reduce
  escaped defects, unauthorized changes, or operator work.
- **Proof before tutorial:** Compare equal-model, equal-tool, and equal-budget
  runs on frozen issues. Measure accepted-patch rate, escaped defects,
  unauthorized edits, operator time, latency, and cost; exercise duplicate
  issues, restart, Agent failure, cancellation, and stale work. Publish only
  the slice actually demonstrated—not a mock ticket classifier called a
  software factory.

## Exact admitted Run

### Confidential counterparty evaluation

`hypothesis` · `agentless` · exact Run

- **Outcome:** A buyer, laboratory, or compliance team evaluates
  counterparty-authored algorithms, formulas, or checks against operator-owned
  cases without sending those cases to the author.
- **Why Jig:** Exact reviewed bytes meet local data inside an independently
  enforced offline envelope. Edited source requires a new admission; the
  retained old admitted bytes remain runnable.
- **Minimum design:** One deterministic FLOW package and one Run. An Agent only
  adds another data recipient.
- **Required boundary:** Exact admission, bounded input and result, no network
  or ambient host access, whole-tree limits, cancellation, and cleanup. The
  operator must treat output and diagnostics as possible disclosures; private
  input also needs a non-argument channel and an explicit retention policy,
  because the current host retains canonical root input in project history.
- **Strongest alternative:** A signed script, hardened CI worker, or disposable
  VM wins when the parties already share trust or an expert team operates the
  sandbox without meaningful integration cost.
- **Proof before tutorial:** Test legitimate and hostile packages, mutation
  after admission, resource abuse, host reads, network access, deliberate
  output leakage, and residue. Compare setup time, review burden, repeat-run
  effort, and operator error with a competently configured VM or CI worker.

### Quarantined format decoder

`hypothesis` · `agentless` · exact Run

- **Outcome:** An archive or investigator extracts bounded metadata or a
  preview from a malformed legacy file while treating both file and parser as
  potentially hostile.
- **Why Jig:** A reusable parser package receives only the artifact and fixed
  resources; failures and descendants remain inside one reviewed Run.
- **Minimum design:** One decoder package per artifact, with an exact result
  schema and no Agent.
- **Required boundary:** Read-only artifact projection or bounded streaming,
  file-type and output limits, containment, timeout, and cleanup. Jig does not
  prove that decoded content is semantically safe.
- **Strongest alternative:** Established content-disarm software or a
  disposable VM wins for standard formats and centralized operations.
- **Proof before tutorial:** Use valid, malformed, decompression-bomb,
  parser-crash, fork, and exfiltration fixtures; compare supported-format
  coverage, operator effort, escape resistance, and cleanup with the best
  existing decoder path.

## One bounded Agent effect

### AI response release gate

`hypothesis` · `single-agent` · bounded Agent effect

- **Outcome:** A product safety or content-operations team receives an accept,
  hold, or human-review record before its AI application's response is
  published or passed to another system.
- **Why Jig:** The application can invoke an independently admitted reviewer
  with an explicit policy skill and closed result while retaining all release
  authority outside the model.
- **Minimum design:** Run deterministic schema and allow-list checks first;
  call one semantic reviewer only for injection, citation support, or policy
  questions that exact code cannot decide.
- **Required boundary:** Per-call skill projection, bounded instructions,
  structured results, fail-closed validation, and an acceptable provider data
  posture. Citation checks also require an authoritative evidence packet.
- **Strongest alternative:** A guardrail library, schema validator, local
  classifier, or application-native review call wins whenever it supplies the
  same policy and authority boundary more directly.
- **Proof before tutorial:** Evaluate false accepts, false holds, abstentions,
  latency, cost, and excluded-context leakage on adversarial and ordinary
  traffic. Compare with the best deterministic checks and the identical model
  call embedded directly in the application.

### Consent promise audit

`hypothesis` · `single-agent` · bounded Agent effect

- **Outcome:** A research team receives a source-linked matrix of mismatches
  among consent language, study protocol, collected fields, and export plans.
- **Why Jig:** A reusable review procedure can receive only the selected
  institutional policy skill and return findings without access to research
  systems or authority to approve the study.
- **Minimum design:** One privacy-review role followed by deterministic source
  and result validation.
- **Required boundary:** Document input, source coordinates, collection-shaped
  results, and an acceptable provider. Policy correctness and ethics review
  remain external.
- **Strongest alternative:** A GRC product or local LLM review application wins
  unless independently maintained review packages and per-call context
  boundaries materially reduce integration or governance work.
- **Proof before tutorial:** Domain reviewers label a blinded corpus; compare
  material-mismatch recall, unsupported findings, review time, and policy
  leakage with the incumbent process.

### Archive release screening

`hypothesis` · `single-agent` · bounded Agent effect

- **Outcome:** An archivist receives passages, names, and dates needing human
  review under one collection's donor and release restrictions.
- **Why Jig:** The same admitted screener can be reused while each call receives
  only the selected collection policy rather than a broad rights database.
- **Minimum design:** One screening role with source-linked findings and no
  publication authority.
- **Required boundary:** Bounded document input, collection results, source
  spans, skill isolation, and a provider acceptable for the records.
- **Strongest alternative:** Archive-management software plus a local model
  wins when one institution owns the complete stack and policy set.
- **Proof before tutorial:** Measure missed restrictions, unnecessary holds,
  source accuracy, review time, and leakage of sibling-collection policy on
  professionally labelled records.

### Near-miss normalization

`hypothesis` · `single-agent` · bounded Agent effect

- **Outcome:** A safety lead receives approved incident class, severity, and
  escalation fields from narrative near-miss reports for human confirmation.
- **Why Jig:** Sites can share an admitted extraction procedure while each
  projects only its own taxonomy and guidance.
- **Minimum design:** One Agent returns closed enums plus cited evidence;
  deterministic code rejects unknown values.
- **Required boundary:** Per-call skills, closed structured output, explicit
  privacy posture, and site-owned categories. Jig supplies no safety judgment.
- **Strongest alternative:** A local classifier or incident-management product
  wins for high-volume, stable categories or one centrally managed site.
- **Proof before tutorial:** Compare class and escalation errors, abstention,
  inter-reviewer disagreement, operator time, and cross-site taxonomy leakage
  with the strongest local classifier.

## Static orchestration

These cases use fixed stages and targets. A stage may be in-package code, an
Agent effect, or an exact bound child Flow; none requires semantic target
selection. The current alpha restrictions in the demonstration table still
apply.

### Grant proposal workshop

`hypothesis` · `single-agent` · static orchestration

- **Outcome:** A nonprofit receives a submission-ready proposal whose claims,
  budget, eligibility, and required sections survive explicit review gates.
- **Why Jig:** Evidence gathering, drafting, financial checking, and final
  acceptance can be exact admitted components with distinct skills and
  bounded repair loops rather than one context grading its own prose.
- **Minimum design:** One drafting Agent plus exact completeness and budget
  checks. Add a separate evidence or eligibility reviewer only when it has
  distinct sources or rejection authority.
- **Required boundary:** Exact child calls, per-call skills, bounded repair,
  deterministic gates, and a human submission decision. Funding data and
  organizational evidence are application inputs.
- **Strongest alternative:** One strong writing Agent plus a checklist and
  spreadsheet wins unless separated gates reduce unsupported claims or review
  effort enough to justify added calls.
- **Proof before tutorial:** On frozen grant briefs, compare eligibility
  failures, unsupported claims, budget inconsistencies, reviewer scores,
  operator time, cost, and latency with the one-Agent baseline.

### Procurement evidence brief

`hypothesis` · `single-agent` · static orchestration

- **Outcome:** A procurement team receives a source-grounded comparison whose
  claims and recommendation can be traced to current vendor evidence.
- **Why Jig:** A research component gathers evidence while a separately scoped
  reviewer can reject unsupported or unsuitable claims before composition.
- **Minimum design:** Research, evidence review, then deterministic assembly;
  omit the second Agent if mechanical citation checks perform as well.
- **Required boundary:** Source access supplied by the application, exact child
  inputs, citation-bearing results, distinct review authority, and a human
  purchasing decision.
- **Strongest alternative:** A research assistant, procurement platform, or
  one web-capable Agent wins unless separation improves source fitness and
  reduces unsupported conclusions.
- **Proof before tutorial:** Compare factual support, omitted material risks,
  source freshness, decision-maker effort, calls, and cost on completed
  procurement decisions with known evidence.

### Underpayment reconstruction

`hypothesis` · `single-agent` · static orchestration

- **Outcome:** A worker, union, or clinic receives a source-linked ledger of
  possible missing wages computed under exact reviewed rules.
- **Why Jig:** Independently maintained extraction and jurisdictional rule
  packages can be distributed without allowing the Agent to decide
  entitlement or perform monetary arithmetic.
- **Minimum design:** One logical extraction role over bounded records,
  deterministic normalization, exact decimal calculation, and professional
  review.
- **Required boundary:** Document input, source coordinates, collection
  results, selected skills, and exact rule code. OCR, legal rules, acceptable
  data processing, and professional judgment are external prerequisites.
- **Strongest alternative:** Payroll-audit software or a local extraction
  application feeding the same calculator wins unless cross-party package
  maintenance is measurably easier or more trustworthy with FLOW.
- **Proof before tutorial:** Measure final-ledger precision and recall, usable
  case coverage, unresolved rate, arithmetic errors, review time, and false
  negatives on stratified professional fixtures; separately test rule updates
  across more than one clinic or jurisdiction maintainer.

### Disaster claim binder

`hypothesis` · `single-agent` · static orchestration

- **Outcome:** A household receives a room-by-room evidence matrix linking
  damage, inventory, receipts, policy clauses, and missing evidence without an
  automatic coverage decision.
- **Why Jig:** An independent aid organization can distribute an inspectable
  local method whose extraction roles cannot submit claims or alter originals.
- **Minimum design:** Bounded artifact extraction followed by deterministic
  hashing, deduplication, ordering, and joining.
- **Required boundary:** Multimodal artifacts, source coordinates, typed
  collections, and controlled local storage. Coverage interpretation and
  claimant approval remain outside Jig.
- **Strongest alternative:** Claims-management software or a local multimodal
  application wins when neutrality, inspectability, and independent package
  maintenance do not matter.
- **Proof before tutorial:** Compare evidence recall, false associations,
  missing-item usefulness, preparation time, and user comprehension on
  professionally reviewed claim sets.

### Food recall trace

`hypothesis` · `single-agent` · static orchestration

- **Outcome:** A small producer traces suspect supplier lots to finished
  batches from inconsistent invoices, certificates, and production logs.
- **Why Jig:** Semantic extraction cannot alter the exact lot-graph algorithm,
  and an independently maintained procedure can run without receiving the
  producer's operational credentials.
- **Minimum design:** Bounded extraction by record type followed by an exact
  graph with source-linked uncertain edges.
- **Required boundary:** Document projection, typed collections, provenance,
  exact graph code, and human recall authority. Jig is not a traceability
  database.
- **Strongest alternative:** An integrated ERP or traceability product wins
  whenever the producer already has clean operational data.
- **Proof before tutorial:** On known lot histories, measure missed and false
  edges, unresolved records, time to isolate affected batches, and operator
  effort against the existing process.

### Protocol deviation reconstruction

`hypothesis` · `single-agent` · static orchestration

- **Outcome:** A research or manufacturing team receives an evidence-linked
  timeline of departures from an approved protocol without erasing
  contradictions.
- **Why Jig:** Agents extract bounded claims; exact code normalizes chronology
  and preserves competing source statements for review.
- **Minimum design:** Extract obligations and observations separately, then
  join by exact time and identifier rules.
- **Required boundary:** Document input, source spans, typed collections, exact
  time handling, and domain review. Jig does not determine regulatory impact.
- **Strongest alternative:** QMS or LIMS software wins for already integrated
  operations with reliable structured records.
- **Proof before tutorial:** Compare event and deviation recall, false joins,
  contradiction retention, investigation time, and reviewer agreement on
  known incidents.

### Compartmentalized accession

`hypothesis` · `multi-agent` · static orchestration

- **Outcome:** A museum receives private rights flags, handling notes, and a
  public label while the public-writing role never receives donor terms.
- **Why Jig:** Information separation can be an exact reviewed dataflow with
  different skills and inputs rather than an instruction to one all-seeing
  model.
- **Minimum design:** A private rights role, deterministic cleared-fact
  projection, and a separately scoped public-writing role.
- **Required boundary:** Narrow child inputs, rich intermediate contracts,
  source documents, diagnostics review, and per-call skills. Rights clearance
  and reidentification analysis remain institutional responsibilities.
- **Strongest alternative:** A bespoke local model pipeline or one trusted
  collections editor wins unless independently maintained components and
  inspectable context exclusion reduce real risk.
- **Proof before tutorial:** Seed direct and indirect private facts and factual
  invariants; inspect every output channel, label usefulness, rights-review
  time, and leakage against the strongest local pipeline.

### Private feedback analysis

`hypothesis` · `single-agent` · static orchestration

- **Outcome:** An organization receives themes and actionable concerns while
  the analysis role never receives respondent identities.
- **Why Jig:** A trusted projection role and restricted analysis package can
  have different visible inputs and authority under one inspectable run tree.
- **Minimum design:** Deterministic or trusted de-identification, restricted
  analysis, then permitted reintegration; no voting or extra personas.
- **Required boundary:** Explicit information-flow contracts, narrow child
  input, bounded results, diagnostic controls, and a realistic
  reidentification threat model.
- **Strongest alternative:** A data clean room, local redaction pipeline, or
  one authorized analyst wins when package reuse and host-enforced separation
  provide no additional assurance.
- **Proof before tutorial:** Seed direct and quasi-identifiers; measure leakage,
  theme utility, false grouping, and operator effort across all observable
  channels.

### Public notice adaptation

`hypothesis` · `single-agent` · static orchestration

- **Outcome:** A public body receives clear, accessible, and localized notice
  variants without changes to protected dates, obligations, contacts, or
  legal facts.
- **Why Jig:** Independently maintained transformations can receive disjoint
  edit scopes while deterministic checks protect exact fields between stages.
- **Minimum design:** One logical editing role may run several lenses; multiple
  Agents are justified only by different skills or language authority.
- **Required boundary:** Structured source content, exact invariant checks,
  bounded child transformations, and qualified accessibility and translation
  review.
- **Strongest alternative:** A template system or one constrained editor wins
  when the transformations and languages are centrally managed.
- **Proof before tutorial:** Inject tempting factual changes and compare
  invariant violations, readability, accessibility, translation quality,
  review time, and cost with one all-purpose editor.

### Futureproof event plan

`hypothesis` · `single-agent` · static orchestration

- **Outcome:** An organizer sees how a choice among authorized plans changes
  across explicit attendance scenarios instead of receiving one blended
  recommendation.
- **Why Jig:** Scenario-isolated Agent calls can be bounded and joined by exact
  code that cannot invent choices or smooth disagreement into a false robust
  answer.
- **Minimum design:** One logical role invoked separately per scenario; a
  deterministic join compares closed choice IDs. This does not require child
  Flows.
- **Required boundary:** Closed Agent results, isolated instructions, fixed
  scenarios, bounded explanations, and a human decision. Jig supplies neither
  scenarios nor probabilities.
- **Strongest alternative:** A comparison table, deterministic regret model,
  or the identical multi-call protocol in a small Agent script wins unless
  FLOW admission and reuse create an additional measured benefit.
- **Proof before tutorial:** Compare isolated and all-context treatments at
  equal calls and token budgets, plus the identical non-Jig protocol. Use
  blinded invariant, reversal, and defer cases; measure false robustness,
  decision quality, user effort, variance, latency, and cost.

### Career transition bridge

`hypothesis` · `single-agent` · static orchestration

- **Outcome:** A career changer receives feasible bridge states connecting
  current evidence and constraints to the prerequisites of a target role.
- **Why Jig:** Forward feasibility and backward prerequisite search can commit
  independently before exact compatibility checks expose the smallest missing
  bridge.
- **Minimum design:** Two bounded searches plus a typed join; use one planner
  if separation does not alter results.
- **Required boundary:** Explicit current evidence, target criteria, bounded
  search, no fabricated qualifications, and human ownership of commitments.
- **Strongest alternative:** A career adviser or one planning Agent wins unless
  independent frontiers reveal materially more valid and actionable bridges.
- **Proof before tutorial:** On longitudinal cases, compare valid bridge
  discovery, missing prerequisites, unsupported claims, user follow-through,
  cost, and time with one strong planner.

### Curriculum blind-spot audit

`hypothesis` · `single-agent` · static orchestration

- **Outcome:** An educator receives evidence-backed gaps at the intersections
  of subject concepts and cognitive skills.
- **Why Jig:** Separate bounded analyses can derive genuinely different axes
  before exact crossing, reducing the chance that one framing hides omissions.
- **Minimum design:** Derive or supply two axes, cross them deterministically,
  and investigate high-risk empty cells.
- **Required boundary:** Curriculum artifacts, stable coverage evidence,
  explicit axis definitions, and educator review. A filled grid is not proof
  of completeness.
- **Strongest alternative:** A conventional curriculum rubric wins when both
  axes are already known or one analyst can apply them reliably.
- **Proof before tutorial:** Seed intersection-only omissions; compare recall,
  false gaps, axis correlation, teacher usefulness, effort, and cost with the
  best existing rubric.

### Household energy investigation

`hypothesis` · `single-agent` · static orchestration

- **Outcome:** A household receives safe, low-cost observations that
  distinguish plausible causes of an unexplained energy-cost spike.
- **Why Jig:** Rival causal models can remain separate until evidence arrives,
  while exact policy prevents either role from authorizing unsafe tests.
- **Minimum design:** Commit predicted observations for bounded hypotheses,
  choose one safe discriminator, update, and stop at a fixed budget.
- **Required boundary:** User-supplied bills and observations, a safe-test
  allow-list, explicit uncertainty, and referral to qualified professionals.
- **Strongest alternative:** Utility diagnostics, an electrician, or a
  professional troubleshooting guide wins whenever it already determines the
  safe next test.
- **Proof before tutorial:** Use known-cause fixtures and supervised field
  cases; compare unsafe advice, premature closure, tests requested, diagnostic
  accuracy, cost, and time with one diagnostic Agent.

### Truthful job application

`hypothesis` · `single-agent` · static orchestration

- **Outcome:** A job seeker receives a tailored application whose claims are
  traceable to supplied experience and whose gaps remain explicit.
- **Why Jig:** Employer research, evidence mapping, drafting, and unsupported-
  claim review can have separate inputs and stop rules while the user retains
  submission authority.
- **Minimum design:** One drafting Agent plus deterministic evidence links;
  add research or review roles only when their separation changes errors.
- **Required boundary:** Selected skills, exact child calls where roles are
  separate, bounded personal data, source-linked claims, and human submission.
- **Strongest alternative:** A strong career assistant wins unless separated
  evidence review reduces fabricated or weakly supported claims enough to
  justify added work.
- **Proof before tutorial:** Compare unsupported claims, interview relevance,
  user editing time, response rate where observable, privacy exposure, cost,
  and latency with one strong assistant.

## Authorized semantic dispatch

### Repair diagnostic

`hypothesis` · `single-agent` · authorized semantic dispatch

- **Outcome:** A technician receives the next test from one admitted,
  model-compatible procedure—or an explicit abstention—from free-text
  symptoms.
- **Why Jig:** The model selects an authorized identity; deterministic code
  owns eligibility and exact invocation, so a nonexistent reset or unsafe
  command cannot enter the candidate universe.
- **Minimum design:** Filter a finite catalogue, request one closed ID or
  abstention, validate it, then call the exact procedure.
- **Required boundary:** Host-owned candidate construction, compatibility
  metadata, complete candidate disclosure, abstention, and choice evidence.
  Device authority is a separate capability, not part of selection.
- **Strongest alternative:** OEM diagnostics, a decision tree, or a structured
  form wins for known fault codes and machine-readable observations.
- **Proof before tutorial:** Freeze the candidate set and test ambiguous,
  unauthorized, incompatible, and nonexistent requests. Measure selection,
  abstention, unsafe routing, task completion, and operator effort against the
  best deterministic router; any out-of-set invocation is a hard failure.

### Vetted rule front desk

`hypothesis` · `single-agent` · authorized semantic dispatch

- **Outcome:** A legal-aid or benefits worker receives a result from one
  admitted jurisdiction-specific calculator, or an abstention, after entering
  an unstructured account.
- **Why Jig:** Semantic interpretation may identify the applicable exact rule
  package without allowing the model to invent law, arithmetic, or executable
  procedure.
- **Minimum design:** Deterministic jurisdiction and version filtering, one
  closed semantic choice, exact calculation, and professional review.
- **Required boundary:** Maintained rule packages, compatibility, clarification
  and abstention, source-linked facts, and human legal authority.
- **Strongest alternative:** A structured expert system wins when a form can
  collect the legally relevant facts reliably.
- **Proof before tutorial:** Domain experts label cases and exclusions; compare
  applicable-package selection, unsafe false positives, abstention, completion
  time, and review effort with the form and expert-system baseline.

### Approved waste disposition

`hypothesis` · `single-agent` · authorized semantic dispatch

- **Outcome:** A laboratory coordinator receives an EHS-approved calculation
  and handling checklist—or abstention—from an ambiguous waste description.
- **Why Jig:** The model chooses among admitted methods rather than composing
  plausible but unauthorized safety advice.
- **Minimum design:** Deterministic compatibility filtering, one closed choice,
  exact method execution, and mandatory human confirmation.
- **Required boundary:** EHS-owned package inventory, material attributes,
  jurisdiction and facility compatibility, abstention, and no device or
  disposal authority.
- **Strongest alternative:** An EHS form or specialist product wins when waste
  attributes can be captured structurally.
- **Proof before tutorial:** Use expert-labelled edge cases and adversarial
  unknowns; compare unsafe selection, unnecessary abstention, operator effort,
  and task completion with the incumbent form.

### Approved release transform

`hypothesis` · `single-agent` · authorized semantic dispatch

- **Outcome:** A records steward applies one admitted redaction or
  de-identification procedure appropriate to the dataset and release purpose,
  while retaining release authority.
- **Why Jig:** Semantic interpretation may select policy implementation but
  cannot synthesize, weaken, or execute an unapproved transform.
- **Minimum design:** Deterministic purpose and jurisdiction filtering, closed
  choice or abstention, exact transform, and human review.
- **Required boundary:** Artifact projection, maintained transform packages,
  compatibility metadata, result inspection, and disclosure policy.
- **Strongest alternative:** DLP or records-management software wins for
  stable document classes and centrally administered policy.
- **Proof before tutorial:** Test known classes, mixed-purpose records, unknown
  requests, and adversarial attempts to select weaker transforms; measure
  unsafe releases, over-redaction, abstention, and review time.

## Durable fact activation

### Auditable allocation

`hypothesis` · `agentless` · durable fact activation

- **Outcome:** A cooperative or grant program obtains one reproducible
  allocation tied to a frozen roster, committed seed, and exact algorithm.
- **Why Jig:** One authenticated close fact can be durably associated with the
  exact admitted computation without speculative redispatch after uncertainty.
- **Minimum design:** One fact derives one deterministic Run and immutable
  result; no Agent.
- **Required boundary:** Trustworthy fact identity, frozen input, durable
  derivation, correction procedure, and public or participant review. Jig does
  not authenticate the roster's social legitimacy.
- **Strongest alternative:** Specialist lottery software or a transactional
  job service wins unless local inspectability and independently distributed
  algorithms matter.
- **Proof before tutorial:** Exercise duplicate facts and crashes before,
  during, and after dispatch; verify one durable Jig derivation,
  reproducibility, uncertainty reporting, corrections, and participant
  comprehension. Publishing an official allocation is a separate idempotent
  external effect and must be tested as such.

### Cold-chain exception packet

`hypothesis` · `agentless` · durable fact activation

- **Outcome:** A biobank or distributor receives one exposure calculation and
  operator packet for each real temperature excursion.
- **Why Jig:** The fact can bind to the exact SOP and package revision active
  at derivation, while duplicate sensor delivery cannot silently create a
  competing assessment.
- **Minimum design:** Deterministic excursion grouping and exposure calculation;
  an optional Agent drafts only the human-readable brief.
- **Required boundary:** Authenticated sensor facts, excursion identity,
  durable derivation, SOP revision, correction policy, and human disposition
  authority. Holds and notifications need separately idempotent integrations.
- **Strongest alternative:** IoT monitoring or cold-chain SaaS wins for
  connector-rich ordinary alerting.
- **Proof before tutorial:** Replay realistic telemetry with duplicates,
  reorderings, gaps, coordinator loss, and corrections; compare missed and
  duplicate excursions, SOP binding, operator time, and recovery with the
  incumbent platform.

## Stateful least-authority capability

### Privacy-budgeted analysis

`hypothesis` · `agentless` · stateful capability

- **Outcome:** A data steward lets independently authored analyses return
  approved aggregates while one provider atomically enforces cumulative
  privacy expenditure.
- **Why Jig:** Packages cannot obtain raw rows, database credentials, or a new
  budget simply by starting another Run.
- **Minimum design:** Exact analysis packages call a typed long-lived provider
  that owns dataset access, caller identity, accounting, and results.
- **Required boundary:** A real privacy mechanism, transactions, recovery,
  revocation, governance, and side-channel review. A toy counter proves only
  plumbing.
- **Strongest alternative:** A data clean room or centralized analytics service
  wins unless independently distributed local packages genuinely need the
  shared authority.
- **Proof before tutorial:** Use at least two independent consumers; test
  concurrent calls, budget exhaustion, restart, caller substitution, provider
  loss, raw-data escape, and analytical utility against an established privacy
  platform.

### Field evidence sealing

`hypothesis` · `agentless` · stateful capability

- **Outcome:** A journalist or field inspector creates a tamper-evident bundle
  linking originals, derivations, trusted time, and signatures.
- **Why Jig:** Independently authored collection procedures can use one local
  vault without receiving signing keys or mutable evidence storage.
- **Minimum design:** Exact collection packages call a narrow append-and-seal
  provider; the provider owns key and ledger lifetime.
- **Required boundary:** Secure key storage, trusted time, canonical media
  handling, append-only persistence, recovery, and evidence policy.
- **Strongest alternative:** A forensic evidence application wins when one
  organization and workflow own the entire lifecycle.
- **Proof before tutorial:** Use independent producer packages and test
  tampering, rollback, concurrent append, key access, crash recovery,
  verification portability, and operator error against the incumbent tool.

### Instrument protocol commons

`hypothesis` · `agentless` · stateful capability

- **Outcome:** A community laboratory runs independently reviewed methods
  against vendor-neutral instruments while calibration and interlocks remain
  under local control.
- **Why Jig:** Protocol packages can remain replaceable while a typed provider
  owns units, sessions, exclusive access, device credentials, and safety.
- **Minimum design:** One long-lived instrument provider and exact protocol
  packages; Agents are unnecessary for physical control.
- **Required boundary:** Device-specific implementation, calibration, units,
  cancellation, exclusive sessions, recovery, and physical safety review.
- **Strongest alternative:** Vendor instrument software wins in a single-vendor
  laboratory or whenever certified integrations already cover the methods.
- **Proof before tutorial:** With safe simulated hardware first, test units,
  concurrency, cancellation, provider loss, interlocks, and cross-package
  portability; physical deployment requires independent safety evidence.

### Consent-gated archive

`hypothesis` · `agentless` · stateful capability

- **Outcome:** Transcription, analysis, and publication packages can ask
  whether an item may be used without receiving the raw rights database.
- **Why Jig:** Independently maintained tools share one least-authority local
  consent boundary whose state and revocation outlive one Flow call.
- **Minimum design:** A typed provider owns consent history and exposes narrow
  query and update operations to authenticated consumers.
- **Required boundary:** Caller identity, concurrency rules, authenticated
  changes, durable history, recovery, revocation, and institutional policy.
- **Strongest alternative:** A monolithic archive-management system wins when
  one application owns all workflows and integrations.
- **Proof before tutorial:** Use at least two independent consumer packages;
  test concurrent updates, withdrawal, stale decisions, unauthorized queries,
  restart, and audit comprehension against the existing archive system.

### Safe repair bus

`hypothesis` · `agentless` · stateful capability

- **Outcome:** Independent repair procedures query a vehicle or appliance
  through typed diagnostics without obtaining arbitrary serial or bus access.
- **Why Jig:** A provider can enforce model compatibility, sessions, and safe
  operations while procedures remain separately admitted and replaceable.
- **Minimum design:** Exact repair package calling a narrow device provider;
  semantic dispatch may choose the package but never the raw operation.
- **Required boundary:** Device-specific interlocks, exclusive sessions,
  cancellation, operator confirmation, version compatibility, and physical
  safety assurance.
- **Strongest alternative:** OEM service tools or a specialist diagnostic
  application wins unless independent cross-vendor procedures are the central
  requirement.
- **Proof before tutorial:** Start with a simulator; test unauthorized commands,
  session collision, cancellation, model mismatch, provider loss, and useful
  diagnosis before any supervised physical trial.

## Integrated applications

### Persistent job-search campaign

`hypothesis` · `single-agent` · integrated application

- **Outcome:** A job seeker discovers suitable openings, verifies fit, prepares
  truthful applications, retains status, and responds to deadlines while
  approving every submission.
- **Why Jig:** Independently admitted research, evidence, drafting, and review
  procedures can evolve while personal data, external accounts, and submission
  authority remain separately scoped.
- **Minimum design:** Begin with the truthful application Flow and explicit
  user-selected openings. Add durable facts, discovery, and specialized roles
  only after each improves outcomes independently.
- **Required boundary:** Personal-data policy, source integrations, durable
  application state, deadlines, human approvals, and idempotent external
  actions. Job boards and messaging are application integrations.
- **Strongest alternative:** An applicant tracker plus a strong career Agent
  wins unless procedure reuse and least-authority account boundaries improve
  response quality or substantially reduce user work.
- **Proof before tutorial:** Run a consented longitudinal study; measure
  suitable opportunities, unsupported claims, completed applications,
  interviews, user time, privacy incidents, notification errors, cost, and
  abandonment against the participant's incumbent process.
