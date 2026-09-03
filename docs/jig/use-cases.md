# Jig use cases

These examples show where Jig could help: running unfamiliar code more safely,
giving AI agents narrower jobs, coordinating specialist workflows, and
keeping people in control.

These are ideas we plan to test, not a promise that all of them work in Jig
today. The [getting-started guide](./guide/) shows what people can use now.

## Find an example

The examples grow with Jig, but no application has to use every capability.

| What Jig adds | A good first example |
| --- | --- |
| Run reviewed code safely | [Confidential counterparty evaluation](#confidential-counterparty-evaluation) |
| Give one Agent a narrow job | [AI response release gate](#ai-response-release-gate) |
| Connect known steps | [Grant proposal workshop](#grant-proposal-workshop) |
| Choose among approved routes | [Repair diagnostic](#repair-diagnostic) |
| React reliably to outside events | [Cold-chain exception packet](#cold-chain-exception-packet) |
| Share a protected service | [Privacy-budgeted analysis](#privacy-budgeted-analysis) |

The [software factory](#software-factory) is the north star: a complete
application that may eventually combine several of these abilities.

## How to read the catalogue

Each entry starts with a plain-language description, followed by the smallest
version worth trying, what Jig would add, and what would count as convincing
evidence. Before an idea becomes a tutorial, it must beat the best simpler
alternative; unsuccessful experiments will remain documented too.

Named methods such as Gauntlet and Independent Jury are explained in
[orchestration patterns](./orchestration-patterns.md).

## North star

### Software factory

A software factory turns an authorized issue into a tested patch through
bounded planning, coding, checking, and human approval.

*Research idea · Starts with one Agent · Complete application*

- **What the user gets:** A maintainer turns an authorized issue into a tested,
  reviewable patch bundle while seeing its state and retaining merge and
  release authority.
- **Why Jig:** Independently admitted procedures, bounded workspaces, exact
  gates, and separated implementation and review authority remain inspectable
  across a long-running lifecycle.
- **Simplest version:** Start with one coding Agent and exact tests. Add planning,
  review, or security roles only when they receive different skills,
  workspaces, evidence, or approval authority. Semantic choice is optional;
  explicit routes should work first.
- **What it needs:** The earliest bounded slice is one root coding Agent
  plus exact in-package gates. The complete case is blocked on workspace
  authority, Agent-bearing component composition, durable issue facts, and
  explicit Git/CI adapters. Kanban, branch policy, repository credentials,
  and the interface are application responsibilities.
- **Use something else when:** A strong coding Agent plus CI wins for a small
  trusted team unless independent procedures and least-authority roles reduce
  escaped defects, unauthorized changes, or operator work.
- **What would prove it:** Compare equal-model, equal-tool, and equal-budget
  runs on frozen issues. Measure accepted-patch rate, escaped defects,
  unauthorized edits, operator time, latency, and cost; exercise duplicate
  issues, restart, Agent failure, cancellation, and stale work. Publish only
  the slice actually demonstrated—not a mock ticket classifier called a
  software factory.

## Run reviewed code safely

### Confidential counterparty evaluation

A team runs someone else's algorithm against its own private cases without
sending the data back to the author.

*Research idea · No Agent · Reviewed local run*

- **What the user gets:** A buyer, laboratory, or compliance team evaluates
  counterparty-authored algorithms, formulas, or checks against operator-owned
  cases without sending those cases to the author.
- **Why Jig:** Exact reviewed bytes meet local data inside an independently
  enforced offline envelope. Edited source requires a new admission; the
  retained old admitted bytes remain runnable.
- **Simplest version:** One deterministic FLOW package and one Run. An Agent only
  adds another data recipient.
- **What it needs:** Exact admission, bounded input and result, no network
  or ambient host access, whole-tree limits, cancellation, and cleanup. The
  operator must treat output and diagnostics as possible disclosures; private
  input also needs a non-argument channel and an explicit retention policy,
  because the current host retains canonical root input in project history.
- **Use something else when:** A signed script, hardened CI worker, or disposable
  VM wins when the parties already share trust or an expert team operates the
  sandbox without meaningful integration cost.
- **What would prove it:** Test legitimate and hostile packages, mutation
  after admission, resource abuse, host reads, network access, deliberate
  output leakage, and residue. Compare setup time, review burden, repeat-run
  effort, and operator error with a competently configured VM or CI worker.

### Quarantined format decoder

A suspicious or obsolete file is opened by a disposable decoder instead of
directly on the operator's machine.

*Research idea · No Agent · Reviewed local run*

- **What the user gets:** An archive or investigator extracts bounded metadata or a
  preview from a malformed legacy file while treating both file and parser as
  potentially hostile.
- **Why Jig:** A reusable parser package receives only the artifact and fixed
  resources; failures and descendants remain inside one reviewed Run.
- **Simplest version:** One decoder package per artifact, with an exact result
  schema and no Agent.
- **What it needs:** Read-only artifact projection or bounded streaming,
  file-type and output limits, containment, timeout, and cleanup. Jig does not
  prove that decoded content is semantically safe.
- **Use something else when:** Established content-disarm software or a
  disposable VM wins for standard formats and centralized operations.
- **What would prove it:** Use valid, malformed, decompression-bomb,
  parser-crash, fork, and exfiltration fixtures; compare supported-format
  coverage, operator effort, escape resistance, and cleanup with the best
  existing decoder path.

## Give one Agent a narrow job

### AI response release gate

A final checkpoint holds unsafe or unsupported AI responses before another
system or person relies on them.

*Research idea · One Agent · One bounded Agent call*

- **What the user gets:** A product safety or content-operations team receives an accept,
  hold, or human-review record before its AI application's response is
  published or passed to another system.
- **Why Jig:** The application can invoke an independently admitted reviewer
  with an explicit policy skill and closed result while retaining all release
  authority outside the model.
- **Simplest version:** Run deterministic schema and allow-list checks first;
  call one semantic reviewer only for injection, citation support, or policy
  questions that exact code cannot decide.
- **What it needs:** Per-call skill projection, bounded instructions,
  structured results, fail-closed validation, and an acceptable provider data
  posture. Citation checks also require an authoritative evidence packet.
- **Use something else when:** A guardrail library, schema validator, local
  classifier, or application-native review call wins whenever it supplies the
  same policy and authority boundary more directly.
- **What would prove it:** Evaluate false accepts, false holds, abstentions,
  latency, cost, and excluded-context leakage on adversarial and ordinary
  traffic. Compare with the best deterministic checks and the identical model
  call embedded directly in the application.

### Consent promise audit

A research team compares what participants were promised with what the study
actually collects and exports.

*Research idea · One Agent · One bounded Agent call*

- **What the user gets:** A research team receives a source-linked matrix of mismatches
  among consent language, study protocol, collected fields, and export plans.
- **Why Jig:** A reusable review procedure can receive only the selected
  institutional policy skill and return findings without access to research
  systems or authority to approve the study.
- **Simplest version:** One privacy-review role followed by deterministic source
  and result validation.
- **What it needs:** Document input, source coordinates, collection-shaped
  results, and an acceptable provider. Policy correctness and ethics review
  remain external.
- **Use something else when:** A GRC product or local LLM review application wins
  unless independently maintained review packages and per-call context
  boundaries materially reduce integration or governance work.
- **What would prove it:** Domain reviewers label a blinded corpus; compare
  material-mismatch recall, unsupported findings, review time, and policy
  leakage with the incumbent process.

### Archive release screening

An archivist gets a focused list of passages that may conflict with the
collection's release restrictions.

*Research idea · One Agent · One bounded Agent call*

- **What the user gets:** An archivist receives passages, names, and dates needing human
  review under one collection's donor and release restrictions.
- **Why Jig:** The same admitted screener can be reused while each call receives
  only the selected collection policy rather than a broad rights database.
- **Simplest version:** One screening role with source-linked findings and no
  publication authority.
- **What it needs:** Bounded document input, collection results, source
  spans, skill isolation, and a provider acceptable for the records.
- **Use something else when:** Archive-management software plus a local model
  wins when one institution owns the complete stack and policy set.
- **What would prove it:** Measure missed restrictions, unnecessary holds,
  source accuracy, review time, and leakage of sibling-collection policy on
  professionally labelled records.

### Near-miss normalization

Free-form safety reports are converted into the site's approved categories
for a human to confirm.

*Research idea · One Agent · One bounded Agent call*

- **What the user gets:** A safety lead receives approved incident class, severity, and
  escalation fields from narrative near-miss reports for human confirmation.
- **Why Jig:** Sites can share an admitted extraction procedure while each
  projects only its own taxonomy and guidance.
- **Simplest version:** One Agent returns closed enums plus cited evidence;
  deterministic code rejects unknown values.
- **What it needs:** Per-call skills, closed structured output, explicit
  privacy posture, and site-owned categories. Jig supplies no safety judgment.
- **Use something else when:** A local classifier or incident-management product
  wins for high-volume, stable categories or one centrally managed site.
- **What would prove it:** Compare class and escalation errors, abstention,
  inter-reviewer disagreement, operator time, and cross-site taxonomy leakage
  with the strongest local classifier.

## Connect known steps

These examples follow a known route from start to finish. A step may use
ordinary code, call an Agent, or run another reviewed Flow, but a model does
not decide which procedure comes next.

### Grant proposal workshop

A proposal is drafted, checked against the evidence and budget, repaired, and
handed back for human submission.

*Research idea · One Agent · Fixed workflow*

- **What the user gets:** A nonprofit receives a submission-ready proposal whose claims,
  budget, eligibility, and required sections survive explicit review gates.
- **Why Jig:** Evidence gathering, drafting, financial checking, and final
  acceptance can be exact admitted components with distinct skills and
  bounded repair loops rather than one context grading its own prose.
- **Simplest version:** One drafting Agent plus exact completeness and budget
  checks. Add a separate evidence or eligibility reviewer only when it has
  distinct sources or rejection authority.
- **What it needs:** Exact child calls, per-call skills, bounded repair,
  deterministic gates, and a human submission decision. Funding data and
  organizational evidence are application inputs.
- **Use something else when:** One strong writing Agent plus a checklist and
  spreadsheet wins unless separated gates reduce unsupported claims or review
  effort enough to justify added calls.
- **What would prove it:** On frozen grant briefs, compare eligibility
  failures, unsupported claims, budget inconsistencies, reviewer scores,
  operator time, cost, and latency with the one-Agent baseline.

### Procurement evidence brief

Vendor claims are gathered and challenged before they become a recommendation.

*Research idea · One Agent · Fixed workflow*

- **What the user gets:** A procurement team receives a source-grounded comparison whose
  claims and recommendation can be traced to current vendor evidence.
- **Why Jig:** A research component gathers evidence while a separately scoped
  reviewer can reject unsupported or unsuitable claims before composition.
- **Simplest version:** Research, evidence review, then deterministic assembly;
  omit the second Agent if mechanical citation checks perform as well.
- **What it needs:** Source access supplied by the application, exact child
  inputs, citation-bearing results, distinct review authority, and a human
  purchasing decision.
- **Use something else when:** A research assistant, procurement platform, or
  one web-capable Agent wins unless separation improves source fitness and
  reduces unsupported conclusions.
- **What would prove it:** Compare factual support, omitted material risks,
  source freshness, decision-maker effort, calls, and cost on completed
  procurement decisions with known evidence.

### Underpayment reconstruction

Messy work records become an auditable calculation of wages that may be
missing.

*Research idea · One Agent · Fixed workflow*

- **What the user gets:** A worker, union, or clinic receives a source-linked ledger of
  possible missing wages computed under exact reviewed rules.
- **Why Jig:** Independently maintained extraction and jurisdictional rule
  packages can be distributed without allowing the Agent to decide
  entitlement or perform monetary arithmetic.
- **Simplest version:** One logical extraction role over bounded records,
  deterministic normalization, exact decimal calculation, and professional
  review.
- **What it needs:** Document input, source coordinates, collection
  results, selected skills, and exact rule code. OCR, legal rules, acceptable
  data processing, and professional judgment are external prerequisites.
- **Use something else when:** Payroll-audit software or a local extraction
  application feeding the same calculator wins unless cross-party package
  maintenance is measurably easier or more trustworthy with FLOW.
- **What would prove it:** Measure final-ledger precision and recall, usable
  case coverage, unresolved rate, arithmetic errors, review time, and false
  negatives on stratified professional fixtures; separately test rule updates
  across more than one clinic or jurisdiction maintainer.

### Disaster claim binder

Photos, receipts, policies, and inventories are assembled into a reviewable
claim package without deciding coverage.

*Research idea · One Agent · Fixed workflow*

- **What the user gets:** A household receives a room-by-room evidence matrix linking
  damage, inventory, receipts, policy clauses, and missing evidence without an
  automatic coverage decision.
- **Why Jig:** An independent aid organization can distribute an inspectable
  local method whose extraction roles cannot submit claims or alter originals.
- **Simplest version:** Bounded artifact extraction followed by deterministic
  hashing, deduplication, ordering, and joining.
- **What it needs:** Multimodal artifacts, source coordinates, typed
  collections, and controlled local storage. Coverage interpretation and
  claimant approval remain outside Jig.
- **Use something else when:** Claims-management software or a local multimodal
  application wins when neutrality, inspectability, and independent package
  maintenance do not matter.
- **What would prove it:** Compare evidence recall, false associations,
  missing-item usefulness, preparation time, and user comprehension on
  professionally reviewed claim sets.

### Food recall trace

Inconsistent supplier and production records become a traceable map from
suspect lots to finished goods.

*Research idea · One Agent · Fixed workflow*

- **What the user gets:** A small producer traces suspect supplier lots to finished
  batches from inconsistent invoices, certificates, and production logs.
- **Why Jig:** Semantic extraction cannot alter the exact lot-graph algorithm,
  and an independently maintained procedure can run without receiving the
  producer's operational credentials.
- **Simplest version:** Bounded extraction by record type followed by an exact
  graph with source-linked uncertain edges.
- **What it needs:** Document projection, typed collections, provenance,
  exact graph code, and human recall authority. Jig is not a traceability
  database.
- **Use something else when:** An integrated ERP or traceability product wins
  whenever the producer already has clean operational data.
- **What would prove it:** On known lot histories, measure missed and false
  edges, unresolved records, time to isolate affected batches, and operator
  effort against the existing process.

### Protocol deviation reconstruction

Logs, notes, and the approved procedure are combined into a timeline that
keeps contradictions visible.

*Research idea · One Agent · Fixed workflow*

- **What the user gets:** A research or manufacturing team receives an evidence-linked
  timeline of departures from an approved protocol without erasing
  contradictions.
- **Why Jig:** Agents extract bounded claims; exact code normalizes chronology
  and preserves competing source statements for review.
- **Simplest version:** Extract obligations and observations separately, then
  join by exact time and identifier rules.
- **What it needs:** Document input, source spans, typed collections, exact
  time handling, and domain review. Jig does not determine regulatory impact.
- **Use something else when:** QMS or LIMS software wins for already integrated
  operations with reliable structured records.
- **What would prove it:** Compare event and deviation recall, false joins,
  contradiction retention, investigation time, and reviewer agreement on
  known incidents.

### Compartmentalized accession

A museum produces internal rights notes and a public label without showing
private donor terms to the writing step.

*Research idea · Multiple Agents · Fixed workflow*

- **What the user gets:** A museum receives private rights flags, handling notes, and a
  public label while the public-writing role never receives donor terms.
- **Why Jig:** Information separation can be an exact reviewed dataflow with
  different skills and inputs rather than an instruction to one all-seeing
  model.
- **Simplest version:** A private rights role, deterministic cleared-fact
  projection, and a separately scoped public-writing role.
- **What it needs:** Narrow child inputs, rich intermediate contracts,
  source documents, diagnostics review, and per-call skills. Rights clearance
  and reidentification analysis remain institutional responsibilities.
- **Use something else when:** A bespoke local model pipeline or one trusted
  collections editor wins unless independently maintained components and
  inspectable context exclusion reduce real risk.
- **What would prove it:** Seed direct and indirect private facts and factual
  invariants; inspect every output channel, label usefulness, rights-review
  time, and leakage against the strongest local pipeline.

### Private feedback analysis

Sensitive feedback is summarized without giving the analysis step the
identities behind it.

*Research idea · One Agent · Fixed workflow*

- **What the user gets:** An organization receives themes and actionable concerns while
  the analysis role never receives respondent identities.
- **Why Jig:** A trusted projection role and restricted analysis package can
  have different visible inputs and authority under one inspectable run tree.
- **Simplest version:** Deterministic or trusted de-identification, restricted
  analysis, then permitted reintegration; no voting or extra personas.
- **What it needs:** Explicit information-flow contracts, narrow child
  input, bounded results, diagnostic controls, and a realistic
  reidentification threat model.
- **Use something else when:** A data clean room, local redaction pipeline, or
  one authorized analyst wins when package reuse and host-enforced separation
  provide no additional assurance.
- **What would prove it:** Seed direct and quasi-identifiers; measure leakage,
  theme utility, false grouping, and operator effort across all observable
  channels.

### Public notice adaptation

A public notice is made clearer, more accessible, and easier to translate
without changing its protected facts.

*Research idea · One Agent · Fixed workflow*

- **What the user gets:** A public body receives clear, accessible, and localized notice
  variants without changes to protected dates, obligations, contacts, or
  legal facts.
- **Why Jig:** Independently maintained transformations can receive disjoint
  edit scopes while deterministic checks protect exact fields between stages.
- **Simplest version:** One logical editing role may run several lenses; multiple
  Agents are justified only by different skills or language authority.
- **What it needs:** Structured source content, exact invariant checks,
  bounded child transformations, and qualified accessibility and translation
  review.
- **Use something else when:** A template system or one constrained editor wins
  when the transformations and languages are centrally managed.
- **What would prove it:** Inject tempting factual changes and compare
  invariant violations, readability, accessibility, translation quality,
  review time, and cost with one all-purpose editor.

### Futureproof event plan

An organizer sees whether the same plan still makes sense under low, expected,
and high attendance.

*Research idea · One Agent · Fixed workflow*

- **What the user gets:** An organizer sees how a choice among authorized plans changes
  across explicit attendance scenarios instead of receiving one blended
  recommendation.
- **Why Jig:** Scenario-isolated Agent calls can be bounded and joined by exact
  code that cannot invent choices or smooth disagreement into a false robust
  answer.
- **Simplest version:** One logical role invoked separately per scenario; a
  deterministic join compares closed choice IDs. This does not require child
  Flows.
- **What it needs:** Closed Agent results, isolated instructions, fixed
  scenarios, bounded explanations, and a human decision. Jig supplies neither
  scenarios nor probabilities.
- **Use something else when:** A comparison table, deterministic regret model,
  or the identical multi-call protocol in a small Agent script wins unless
  FLOW admission and reuse create an additional measured benefit.
- **What would prove it:** Compare isolated and all-context treatments at
  equal calls and token budgets, plus the identical non-Jig protocol. Use
  blinded invariant, reversal, and defer cases; measure false robustness,
  decision quality, user effort, variance, latency, and cost.

### Career transition bridge

A career changer searches forward from current skills and backward from a
target role to find a realistic bridge.

*Research idea · One Agent · Fixed workflow*

- **What the user gets:** A career changer receives feasible bridge states connecting
  current evidence and constraints to the prerequisites of a target role.
- **Why Jig:** Forward feasibility and backward prerequisite search can commit
  independently before exact compatibility checks expose the smallest missing
  bridge.
- **Simplest version:** Two bounded searches plus a typed join; use one planner
  if separation does not alter results.
- **What it needs:** Explicit current evidence, target criteria, bounded
  search, no fabricated qualifications, and human ownership of commitments.
- **Use something else when:** A career adviser or one planning Agent wins unless
  independent frontiers reveal materially more valid and actionable bridges.
- **What would prove it:** On longitudinal cases, compare valid bridge
  discovery, missing prerequisites, unsupported claims, user follow-through,
  cost, and time with one strong planner.

### Curriculum blind-spot audit

A curriculum is examined across two different dimensions to reveal important
combinations it never teaches.

*Research idea · One Agent · Fixed workflow*

- **What the user gets:** An educator receives evidence-backed gaps at the intersections
  of subject concepts and cognitive skills.
- **Why Jig:** Separate bounded analyses can derive genuinely different axes
  before exact crossing, reducing the chance that one framing hides omissions.
- **Simplest version:** Derive or supply two axes, cross them deterministically,
  and investigate high-risk empty cells.
- **What it needs:** Curriculum artifacts, stable coverage evidence,
  explicit axis definitions, and educator review. A filled grid is not proof
  of completeness.
- **Use something else when:** A conventional curriculum rubric wins when both
  axes are already known or one analyst can apply them reliably.
- **What would prove it:** Seed intersection-only omissions; compare recall,
  false gaps, axis correlation, teacher usefulness, effort, and cost with the
  best existing rubric.

### Household energy investigation

Competing explanations for a surprising energy bill are narrowed through
safe, inexpensive observations.

*Research idea · One Agent · Fixed workflow*

- **What the user gets:** A household receives safe, low-cost observations that
  distinguish plausible causes of an unexplained energy-cost spike.
- **Why Jig:** Rival causal models can remain separate until evidence arrives,
  while exact policy prevents either role from authorizing unsafe tests.
- **Simplest version:** Commit predicted observations for bounded hypotheses,
  choose one safe discriminator, update, and stop at a fixed budget.
- **What it needs:** User-supplied bills and observations, a safe-test
  allow-list, explicit uncertainty, and referral to qualified professionals.
- **Use something else when:** Utility diagnostics, an electrician, or a
  professional troubleshooting guide wins whenever it already determines the
  safe next test.
- **What would prove it:** Use known-cause fixtures and supervised field
  cases; compare unsafe advice, premature closure, tests requested, diagnostic
  accuracy, cost, and time with one diagnostic Agent.

### Truthful job application

A job application is tailored to an employer while every claim stays tied to
the applicant's real experience.

*Research idea · One Agent · Fixed workflow*

- **What the user gets:** A job seeker receives a tailored application whose claims are
  traceable to supplied experience and whose gaps remain explicit.
- **Why Jig:** Employer research, evidence mapping, drafting, and unsupported-
  claim review can have separate inputs and stop rules while the user retains
  submission authority.
- **Simplest version:** One drafting Agent plus deterministic evidence links;
  add research or review roles only when their separation changes errors.
- **What it needs:** Selected skills, exact child calls where roles are
  separate, bounded personal data, source-linked claims, and human submission.
- **Use something else when:** A strong career assistant wins unless separated
  evidence review reduces fabricated or weakly supported claims enough to
  justify added work.
- **What would prove it:** Compare unsupported claims, interview relevance,
  user editing time, response rate where observable, privacy exposure, cost,
  and latency with one strong assistant.

## Choose among approved routes

### Repair diagnostic

A technician describes a problem in ordinary language and receives one
approved next diagnostic step—or an abstention.

*Research idea · One Agent · Approved route selection*

- **What the user gets:** A technician receives the next test from one admitted,
  model-compatible procedure—or an explicit abstention—from free-text
  symptoms.
- **Why Jig:** The model selects an authorized identity; deterministic code
  owns eligibility and exact invocation, so a nonexistent reset or unsafe
  command cannot enter the candidate universe.
- **Simplest version:** Filter a finite catalogue, request one closed ID or
  abstention, validate it, then call the exact procedure.
- **What it needs:** Host-owned candidate construction, compatibility
  metadata, complete candidate disclosure, abstention, and choice evidence.
  Device authority is a separate capability, not part of selection.
- **Use something else when:** OEM diagnostics, a decision tree, or a structured
  form wins for known fault codes and machine-readable observations.
- **What would prove it:** Freeze the candidate set and test ambiguous,
  unauthorized, incompatible, and nonexistent requests. Measure selection,
  abstention, unsafe routing, task completion, and operator effort against the
  best deterministic router; any out-of-set invocation is a hard failure.

### Vetted rule front desk

A messy benefits or legal account is directed to the correct maintained rule
calculator instead of answered from model memory.

*Research idea · One Agent · Approved route selection*

- **What the user gets:** A legal-aid or benefits worker receives a result from one
  admitted jurisdiction-specific calculator, or an abstention, after entering
  an unstructured account.
- **Why Jig:** Semantic interpretation may identify the applicable exact rule
  package without allowing the model to invent law, arithmetic, or executable
  procedure.
- **Simplest version:** Deterministic jurisdiction and version filtering, one
  closed semantic choice, exact calculation, and professional review.
- **What it needs:** Maintained rule packages, compatibility, clarification
  and abstention, source-linked facts, and human legal authority.
- **Use something else when:** A structured expert system wins when a form can
  collect the legally relevant facts reliably.
- **What would prove it:** Domain experts label cases and exclusions; compare
  applicable-package selection, unsafe false positives, abstention, completion
  time, and review effort with the form and expert-system baseline.

### Approved waste disposition

An ambiguous waste description is matched to an approved handling procedure
rather than improvised safety advice.

*Research idea · One Agent · Approved route selection*

- **What the user gets:** A laboratory coordinator receives an EHS-approved calculation
  and handling checklist—or abstention—from an ambiguous waste description.
- **Why Jig:** The model chooses among admitted methods rather than composing
  plausible but unauthorized safety advice.
- **Simplest version:** Deterministic compatibility filtering, one closed choice,
  exact method execution, and mandatory human confirmation.
- **What it needs:** EHS-owned package inventory, material attributes,
  jurisdiction and facility compatibility, abstention, and no device or
  disposal authority.
- **Use something else when:** An EHS form or specialist product wins when waste
  attributes can be captured structurally.
- **What would prove it:** Use expert-labelled edge cases and adversarial
  unknowns; compare unsafe selection, unnecessary abstention, operator effort,
  and task completion with the incumbent form.

### Approved release transform

A records steward selects the approved transformation for a specific release
without allowing the model to weaken policy.

*Research idea · One Agent · Approved route selection*

- **What the user gets:** A records steward applies one admitted redaction or
  de-identification procedure appropriate to the dataset and release purpose,
  while retaining release authority.
- **Why Jig:** Semantic interpretation may select policy implementation but
  cannot synthesize, weaken, or execute an unapproved transform.
- **Simplest version:** Deterministic purpose and jurisdiction filtering, closed
  choice or abstention, exact transform, and human review.
- **What it needs:** Artifact projection, maintained transform packages,
  compatibility metadata, result inspection, and disclosure policy.
- **Use something else when:** DLP or records-management software wins for
  stable document classes and centrally administered policy.
- **What would prove it:** Test known classes, mixed-purpose records, unknown
  requests, and adversarial attempts to select weaker transforms; measure
  unsafe releases, over-redaction, abstention, and review time.

## React reliably to outside events

### Auditable allocation

A cooperative or grant program uses a frozen participant list and a seed
chosen in advance to produce one reproducible allocation of places or funds.

*Research idea · No Agent · Event-triggered work*

- **What the user gets:** A cooperative or grant program obtains one reproducible
  allocation tied to a frozen roster, committed seed, and exact algorithm.
- **Why Jig:** One authenticated close fact can be durably associated with the
  exact admitted computation without speculative redispatch after uncertainty.
- **Simplest version:** One fact derives one deterministic Run and immutable
  result; no Agent.
- **What it needs:** Trustworthy fact identity, frozen input, durable
  derivation, correction procedure, and public or participant review. Jig does
  not authenticate the roster's social legitimacy.
- **Use something else when:** Specialist lottery software or a transactional
  job service wins unless local inspectability and independently distributed
  algorithms matter.
- **What would prove it:** Exercise duplicate facts and crashes before,
  during, and after dispatch; verify one durable Jig derivation,
  reproducibility, uncertainty reporting, corrections, and participant
  comprehension. Publishing an official allocation is a separate idempotent
  external effect and must be tested as such.

### Cold-chain exception packet

A real temperature excursion produces one calculation and review packet tied
to the right procedure revision.

*Research idea · No Agent · Event-triggered work*

- **What the user gets:** A biobank or distributor receives one exposure calculation and
  operator packet for each real temperature excursion.
- **Why Jig:** The fact can bind to the exact SOP and package revision active
  at derivation, while duplicate sensor delivery cannot silently create a
  competing assessment.
- **Simplest version:** Deterministic excursion grouping and exposure calculation;
  an optional Agent drafts only the human-readable brief.
- **What it needs:** Authenticated sensor facts, excursion identity,
  durable derivation, SOP revision, correction policy, and human disposition
  authority. Holds and notifications need separately idempotent integrations.
- **Use something else when:** IoT monitoring or cold-chain SaaS wins for
  connector-rich ordinary alerting.
- **What would prove it:** Replay realistic telemetry with duplicates,
  reorderings, gaps, coordinator loss, and corrections; compare missed and
  duplicate excursions, SOP binding, operator time, and recovery with the
  incumbent platform.

## Share protected services

### Privacy-budgeted analysis

Repeated statistical answers can gradually expose individuals. One shared
service answers useful aggregate questions while tracking and limiting that
total disclosure.

*Research idea · No Agent · Shared protected service*

- **What the user gets:** A data steward lets independently authored analyses return
  approved aggregates while one provider atomically enforces cumulative
  privacy expenditure.
- **Why Jig:** Packages cannot obtain raw rows, database credentials, or a new
  budget simply by starting another Run.
- **Simplest version:** Exact analysis packages call a typed long-lived provider
  that owns dataset access, caller identity, accounting, and results.
- **What it needs:** A real privacy mechanism, transactions, recovery,
  revocation, governance, and side-channel review. A toy counter proves only
  plumbing.
- **Use something else when:** A data clean room or centralized analytics service
  wins unless independently distributed local packages genuinely need the
  shared authority.
- **What would prove it:** Use at least two independent consumers; test
  concurrent calls, budget exhaustion, restart, caller substitution, provider
  loss, raw-data escape, and analytical utility against an established privacy
  platform.

### Field evidence sealing

Field evidence is stored, linked, timestamped, and signed without giving
collection workflows the signing keys.

*Research idea · No Agent · Shared protected service*

- **What the user gets:** A journalist or field inspector creates a tamper-evident bundle
  linking originals, derivations, trusted time, and signatures.
- **Why Jig:** Independently authored collection procedures can use one local
  vault without receiving signing keys or mutable evidence storage.
- **Simplest version:** Exact collection packages call a narrow append-and-seal
  provider; the provider owns key and ledger lifetime.
- **What it needs:** Secure key storage, trusted time, canonical media
  handling, append-only persistence, recovery, and evidence policy.
- **Use something else when:** A forensic evidence application wins when one
  organization and workflow own the entire lifecycle.
- **What would prove it:** Use independent producer packages and test
  tampering, rollback, concurrent append, key access, crash recovery,
  verification portability, and operator error against the incumbent tool.

### Instrument protocol commons

Independently authored laboratory procedures use equipment through a safe
local service, without receiving direct device control. The service enforces
calibration and safety checks.

*Research idea · No Agent · Shared protected service*

- **What the user gets:** A community laboratory runs independently reviewed methods
  against vendor-neutral instruments while calibration and interlocks remain
  under local control.
- **Why Jig:** Protocol packages can remain replaceable while a typed provider
  owns units, sessions, exclusive access, device credentials, and safety.
- **Simplest version:** One long-lived instrument provider and exact protocol
  packages; Agents are unnecessary for physical control.
- **What it needs:** Device-specific implementation, calibration, units,
  cancellation, exclusive sessions, recovery, and physical safety review.
- **Use something else when:** Vendor instrument software wins in a single-vendor
  laboratory or whenever certified integrations already cover the methods.
- **What would prove it:** With safe simulated hardware first, test units,
  concurrency, cancellation, provider loss, interlocks, and cross-package
  portability; physical deployment requires independent safety evidence.

### Consent-gated archive

Archive tools can ask whether an item may be used without receiving the
underlying rights database.

*Research idea · No Agent · Shared protected service*

- **What the user gets:** Transcription, analysis, and publication packages can ask
  whether an item may be used without receiving the raw rights database.
- **Why Jig:** Independently maintained tools share one least-authority local
  consent boundary whose state and revocation outlive one Flow call.
- **Simplest version:** A typed provider owns consent history and exposes narrow
  query and update operations to authenticated consumers.
- **What it needs:** Caller identity, concurrency rules, authenticated
  changes, durable history, recovery, revocation, and institutional policy.
- **Use something else when:** A monolithic archive-management system wins when
  one application owns all workflows and integrations.
- **What would prove it:** Use at least two independent consumer packages;
  test concurrent updates, withdrawal, stale decisions, unauthorized queries,
  restart, and audit comprehension against the existing archive system.

### Safe repair bus

Repair packages receive only a short list of safe diagnostic operations
instead of unrestricted low-level control of a vehicle or appliance.

*Research idea · No Agent · Shared protected service*

- **What the user gets:** Independent repair procedures query a vehicle or appliance
  through typed diagnostics without obtaining arbitrary serial or bus access.
- **Why Jig:** A provider can enforce model compatibility, sessions, and safe
  operations while procedures remain separately admitted and replaceable.
- **Simplest version:** Exact repair package calling a narrow device provider;
  semantic dispatch may choose the package but never the raw operation.
- **What it needs:** Device-specific interlocks, exclusive sessions,
  cancellation, operator confirmation, version compatibility, and physical
  safety assurance.
- **Use something else when:** OEM service tools or a specialist diagnostic
  application wins unless independent cross-vendor procedures are the central
  requirement.
- **What would prove it:** Start with a simulator; test unauthorized commands,
  session collision, cancellation, model mismatch, provider loss, and useful
  diagnosis before any supervised physical trial.

## Build complete applications

### Persistent job-search campaign

A job search continues across openings, deadlines, applications, and
follow-ups while the user approves every external action.

*Research idea · One Agent · Complete application*

- **What the user gets:** A job seeker discovers suitable openings, verifies fit, prepares
  truthful applications, retains status, and responds to deadlines while
  approving every submission.
- **Why Jig:** Independently admitted research, evidence, drafting, and review
  procedures can evolve while personal data, external accounts, and submission
  authority remain separately scoped.
- **Simplest version:** Begin with the truthful application Flow and explicit
  user-selected openings. Add durable facts, discovery, and specialized roles
  only after each improves outcomes independently.
- **What it needs:** Personal-data policy, source integrations, durable
  application state, deadlines, human approvals, and idempotent external
  actions. Job boards and messaging are application integrations.
- **Use something else when:** An applicant tracker plus a strong career Agent
  wins unless procedure reuse and least-authority account boundaries improve
  response quality or substantially reduce user work.
- **What would prove it:** Run a consented longitudinal study; measure
  suitable opportunities, unsupported claims, completed applications,
  interviews, user time, privacy incidents, notification errors, cost, and
  abandonment against the participant's incumbent process.
