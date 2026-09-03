# Use-case catalogue

This catalogue preserves the broader set of credible Jig applications without
confusing ideas with specifications. Each section is a **case family**: its
variants share one Jig-specific thesis and one broad evidence strategy. A
variant receives its own brief only when its user, authority boundary, or
evaluation differs materially.

All entries are `candidate` unless linked to a full brief. The product may not
yet provide their required surfaces.

## 1. Contained foreign computation

**User promise.** An operator runs externally authored deterministic code over
operator-controlled input without granting ambient host or network authority.

**Retained variants.**

- [Confidential benchmark](./confidential-benchmark.md): evaluate an external
  algorithm against private cases.
- `confidential-control-capsule`: run auditor-authored checks against a
  private configuration export.
- `quarantined-format-decoder`: obtain bounded metadata or a preview from a
  suspect legacy file.

**Minimum topology.** `agentless`; one exact admitted Run. AI would add a data
recipient and weaken reproducibility.

**Candidate methods.** None. Containment is a host property, not an
orchestration pattern.

**Why Jig.** The package author and operator are different parties, and the
operator needs exact reviewed bytes, resource bounds, no author-observable
egress, cancellation, and residue-free cleanup under one host policy.

**Jig does not supply.** Algorithm correctness, malware classification,
output declassification, confidential storage, or a parser's semantic safety.

**Strongest alternative and losing condition.** A signed local script,
hardened CI worker, disposable VM, OPA policy, or established content-disarm
tool wins when it already expresses the job and supplies the required trust
boundary. Jig wins only if a portable FLOW package plus independent host
authority removes meaningful bespoke integration.

**Earliest surface and evidence gate.** Exact direct Run. Use legitimate and
hostile packages to test admission, mutation after admission, network and host
reads, aggregate limits, cancellation, output leakage, and residue. Secret
claims additionally require an input path that does not expose bytes through
arguments or retained history unexpectedly.

## 2. Source-linked reconstruction and exact calculation

**User promise.** Messy records become a traceable factual structure; exact
code then computes or joins what language interpretation must not decide.

**Retained variants.**

- [Underpayment reconstruction](./underpayment-reconstruction.md): extract pay
  facts and apply reviewed jurisdictional rules.
- `disaster-claim-binder`: link damage, inventory, receipts, policy clauses,
  and missing evidence without deciding coverage.
- `food-recall-trace`: extract heterogeneous logs and construct a lot graph.
- `protocol-deviation-reconstruction`: retain contradictions while building
  an exact chronology from logs and notes.

**Minimum topology.** `single-agent` extraction followed by deterministic
normalization and calculation. Independent reconstruction becomes
`multi-agent` only after measured correlated-error reduction justifies it.

**Candidate methods.** [Double-entry reconciliation](./patterns.md#double-entry-reconciliation)
for independently justified extraction paths; [research/review separation](./patterns.md#researchreview-separation)
when a second authority must accept source claims.

**Why Jig.** Independently distributed extraction procedures, selected skills,
and rule packages can run with bounded inputs and explicit authority while
the deterministic result remains attributable to exact sources and code.

**Jig does not supply.** OCR, source-coordinate conventions, professional
rules, legal or regulatory judgment, domain data, or an acceptable data
processor.

**Strongest alternative and losing condition.** Payroll, claims, ERP, QMS,
LIMS, or a local purpose-built application wins when the organization already
owns an integrated and trusted stack. A FLOW-based solution must demonstrate
cross-party reuse or materially lower integration cost without reducing
accuracy.

**Earliest surface and evidence gate.** One bounded Agent plus exact package
code; realistic cases usually also need richer document and structured-result
transport. Evaluate source attribution, extraction precision and recall,
arithmetic correctness, unresolved-item behavior, and professional review
time against the strongest domain product.

## 3. Bounded semantic review

**User promise.** A reusable reviewer maps unstructured material into a closed
finding or hold decision without receiving downstream authority.

**Retained variants.**

- `consent-promise-gap`: compare consent promises with collection and export
  plans in a cited mismatch matrix.
- `collection-release-screener`: flag passages under collection-specific donor
  restrictions for human release review.
- `site-near-miss-coding`: map narrative safety reports to approved classes,
  severities, and escalation states.
- `ai-response-gate`: combine prompt-injection, citation-support, and
  structured-output checks into an accept-or-hold report.

**Minimum topology.** `single-agent` with selected policy skills and a closed
result. Multiple reviewers are warranted only when they use distinct evidence
or authority and the deterministic join has an explicit conflict rule.

**Candidate methods.** [Invariant-preserving lens relay](./patterns.md#invariant-preserving-lens-relay)
for ordered checks with disjoint edit authority; [research/review separation](./patterns.md#researchreview-separation)
when evidence collection and acceptance must differ.

**Why Jig.** The review procedure can be admitted independently of the calling
application, receive a deliberately narrow context, and fail closed while the
host—not the Agent—controls which effect follows.

**Jig does not supply.** A correct policy corpus, content provenance, an
authoritative citation index, or domain approval. Agent containment does not
make model output trustworthy.

**Strongest alternative and losing condition.** A schema validator, rules
engine, local classifier, guardrail library, DLP tool, or ordinary Agent
application wins whenever it provides the same policy and authority boundary
more directly. Packaging a prompt alone is not differentiation.

**Earliest surface and evidence gate.** One bounded Agent call. Freeze labelled
fixtures and false-accept costs before evaluation; measure closed-result
validity, unsupported findings, abstention, leakage of excluded context, and
operator review time against the best specialized alternative.

## 4. Artifact challenge and assurance

**User promise.** An artifact is not merely generated; it passes declared,
bounded challenges whose failures remain inspectable.

**Retained variants.**

- `gauntlet-artifact`: build, test, review, repair, and stop at acceptance or a
  fixed bound.
- `independent-jury`: commit isolated classifications before deterministic
  aggregation.
- `red-team-plan`: attack a frozen plan under an explicit threat model and
  repair accepted findings.
- `research-review-brief`: separate evidence collection from claim acceptance.
- `job-application-workshop`: research an employer, map resume evidence,
  draft, and reject unsupported claims.

**Minimum topology.** Static composition. A Gauntlet may remain
`single-agent` when gates are exact; jury, red-team, and independent review
require `multi-agent` only when role separation changes information,
commitment, or authority.

**Candidate methods.** [Gauntlet](./patterns.md#gauntlet),
[independent jury](./patterns.md#independent-jury),
[red-team challenge](./patterns.md#red-team-challenge), and
[research/review separation](./patterns.md#researchreview-separation). These
are alternatives with different failure models, not interchangeable names for
“ask another Agent.”

**Why Jig.** Each role can be an exact admitted component with its own skills,
inputs, bounds, and child slots. The parent exposes failures and owns the stop
rule instead of allowing one autonomous context to generate and approve its
own work invisibly.

**Jig does not supply.** A quality rubric, independent model lineage, factual
ground truth, a threat model, or proof that more calls improve quality.

**Strongest alternative and losing condition.** One strong Agent with good
tools, CI quality gates, an evaluation framework, or ordinary human review
wins unless separation produces a measured error reduction or a required
authority boundary. Same-model personas are not independent evidence.

**Earliest surface and evidence gate.** Exact child composition plus bounded
Agent calls where needed. Compare the full protocol with the strongest
single-Agent or conventional pipeline at equal model, tools, budget, and
fixtures; include the cost of extra calls and false confidence after agreement.

## 5. Information-bounded transformation

**User promise.** Each transformation receives only its declared context and
may change only its declared part of an artifact; protected facts, identities,
or structural invariants remain outside that authority.

**Retained variants.**

- `private-feedback-analysis`: separate identity-bearing redaction and
  reintegration from theme analysis.
- `compartmentalized-accession`: produce a public museum label without giving
  the writer private donor terms.
- `public-notice-relay`: apply clarity, accessibility, and localization lenses
  while protecting factual invariants.

**Minimum topology.** `single-agent` for ordered, mechanically checked edit
scopes; `multi-agent` only when different roles must see different
information. Ordered prose personas with the same context are not an
authority boundary.

**Candidate methods.** [Privacy membrane](./patterns.md#privacy-membrane) for
context exclusion; [invariant-preserving lens relay](./patterns.md#invariant-preserving-lens-relay)
for bounded edits to one shared artifact.

**Why Jig.** Package-local skills, explicit child inputs, independently
admitted components, and deterministic invariant checks could make allowed
information and edit flow inspectable across reusable transformations.

**Jig does not supply.** Reliable de-identification, reidentification-risk
analysis, translation correctness, rights clearance, or output disclosure
policy. The trusted projection step remains part of the application threat
model.

**Strongest alternative and losing condition.** A local redaction pipeline,
data clean room, template system, or one trusted editor wins unless separate
packages and host-enforced context boundaries reduce real organizational or
technical risk.

**Earliest surface and evidence gate.** Static child composition. Specify an
information-flow matrix before implementation, seed realistic indirect
identifiers and invariant violations, and prove that excluded fields do not
reach the restricted role or its diagnostics.

## 6. Decisions under explicit uncertainty

**User promise.** A decision exposes how it changes across assumptions,
missing facts, or rival causal accounts instead of hiding uncertainty inside
one plausible narrative.

**Retained variants.**

- [Futureproof event plan](./futureproof-event-plan.md): compare closed choices
  across declared attendance futures.
- `career-transition-bridge`: connect forward feasibility with backward
  prerequisites without letting either erase the other.
- `curriculum-coverage-grid`: cross independently derived concept and
  cognitive-skill axes to find blind spots.
- `energy-discrimination`: preserve rival causes and request the cheapest safe
  distinguishing observation.

**Minimum topology.** `single-agent` isolated calls when only context isolation
matters; `multi-agent` only for genuine independent commitment, knowledge, or
skills. Deterministic scenario models and decision trees should remain
agentless.

**Candidate methods.** [Controlled assumption reveal](./patterns.md#controlled-assumption-reveal),
[scenario-action regret](./patterns.md#scenario-action-regret-matrix),
[causal discrimination](./patterns.md#causal-discrimination-cascade),
[orthogonal coverage](./patterns.md#orthogonal-coverage-grid), or
[meet-in-the-middle planning](./patterns.md#meet-in-the-middle-planning),
depending on the specific uncertainty. Combining them by default is unjustified.

**Why Jig.** Bounded roles can receive different declared assumptions or
evidence and return closed states that deterministic code compares without
semantically smoothing over disagreement.

**Jig does not supply.** Correct scenarios, calibrated probabilities, causal
truth, professional safety advice, or a license to act. The user owns the
choice and any real-world observation.

**Strongest alternative and losing condition.** A comparison table, solver,
decision tree, or one Agent shown the complete problem wins unless isolation
materially reduces false invariance, goal leakage, or premature convergence.

**Earliest surface and evidence gate.** Static calls and deterministic joins.
Use prelabelled scenarios and same-scenario controls; measure structural
validity, sensitivity to the intended assumption, ordinary model variance,
false stability, and added cost.

## 7. Authorized semantic dispatch

**User promise.** Free-text intent selects one already authorized exact
procedure—or abstains—without giving the model power to invent or admit code.

**Retained variants.**

- `repair-diagnostic`: select the next model-specific diagnostic procedure.
- `vetted-law-front-desk`: select a compatible benefits or deadline
  calculator.
- `authorized-waste-disposition`: select one EHS-approved calculation and
  checklist.
- `approved-release-transform`: select an admitted redaction or
  de-identification transform while a human retains release authority.

**Minimum topology.** `single-agent` choice over a deterministic finite
candidate set, followed by an exact branch. No Agent is needed when reliable
machine-readable facts or a form select the procedure.

**Candidate method.** [Bounded semantic dispatch](./patterns.md#bounded-semantic-dispatch).

**Why Jig.** Deterministic admission, compatibility, and authority filtering
can precede semantic ranking; the chosen ID can then resolve to exact bytes
without letting model confidence widen the eligible universe.

**Jig does not supply.** Candidate correctness, legal or safety expertise,
compatibility adapters, or an adequate abstention policy.

**Strongest alternative and losing condition.** A menu, form, decision tree,
classifier, or application router wins unless users supply genuinely
ambiguous language and semantic choice improves completion without unsafe
selection.

**Earliest surface and evidence gate.** A host-owned authorized choice
surface, if concrete use cases earn one. Evaluate
only against a frozen candidate universe and include adversarial requests for
nonexistent, incompatible, and unauthorized targets. Any invented or
out-of-set dispatch is a hard failure.

## 8. Durable fact-to-work derivation

**User promise.** One authenticated external fact derives one exact bounded
piece of work without duplicate official effects after replay or coordinator
uncertainty.

**Retained variants.**

- `auditable-allocation`: derive one reproducible allocation from a frozen
  roster, seed, and admitted algorithm.
- `cold-chain-excursion`: bind one excursion to the exact SOP revision,
  calculate exposure, and optionally prepare a human exception brief.

**Minimum topology.** `agentless` derivation; a downstream `single-agent`
brief is optional and cannot become the authoritative calculation.

**Candidate methods.** None by default. One durable fact followed by one exact
calculation is ordinary derivation, not a reason to invent an orchestration
abstraction.

**Why Jig.** Durable admission, event identity, derivation records, fencing,
and conservative uncertainty could connect outside facts to exact FLOW Runs
without pretending external effects are exactly once.

**Jig does not supply.** A trustworthy sensor, roster, event source, external
transaction, correction policy, or business authority.

**Strongest alternative and losing condition.** A database transaction,
queue consumer, workflow engine, IoT platform, or small idempotent service wins
when it already owns both event and effect. Jig must demonstrate value from
portable admitted procedures, not merely reproduce a job queue.

**Earliest surface and evidence gate.** One admitted source of external facts
and a narrow durable derivation path. Test duplicate delivery, crash before and after
dispatch, uncertain completion, correction events, and residue without making
an exactly-once claim.

## 9. Stateful least-authority capabilities

**User promise.** Independently authored packages repeatedly use one protected
resource through a small stable interface without receiving its raw authority.

**Retained variants.**

- `privacy-budgeted-analysis`: expose approved aggregates while atomically
  consuming a shared privacy budget.
- `field-evidence-sealing`: let a vault own signing keys and append-only
  evidence while field protocols submit canonical derivations.
- `instrument-protocol-commons`: keep calibration, units, sessions, and safety
  interlocks behind a typed instrument provider.
- `consent-gated-archive`: let transcription and publication packages ask
  narrow questions without receiving the rights database.
- `safe-repair-bus`: expose typed, interlocked diagnostics instead of raw
  serial or vehicle-bus access.

**Minimum topology.** Usually `agentless`. The defining feature is a
long-lived, multi-operation authority, not orchestration or AI.

**Candidate methods.** None. A capability contract describes a stable service
boundary; it is not a workflow pattern.

**Why Jig.** A portable capability contract, provider lifecycle, scoped
binding, and host-owned revocation could let multiple FLOW packages reuse the
same authority without importing the provider implementation or gaining its
credentials.

**Jig does not supply.** Differential privacy, secure hardware, calibrated
instruments, consent policy, device safety, trusted time, or governance. A toy
counter or mock service proves plumbing only.

**Strongest alternative and losing condition.** A monolithic domain product,
vendor SDK, operating-system broker, or ordinary local service wins unless
independently distributed FLOW packages genuinely need the shared boundary.
No capability surface should be standardized before that recurring consumer
exists.

**Earliest surface and evidence gate.** No current Jig surface. A long-lived
capability execution profile should be considered only after a concrete
provider and at least two independent consumers exist.
Conformance must cover compatibility, lifecycle, concurrent calls, revocation,
provider loss, and authority escape; domain safety needs separate evidence.

## 10. Persistent agentic applications

**User promise.** Long-running work advances through visible states while
separate procedures and Agents receive only the authority needed for their
current step.

**Retained variants.**

- `software-factory`: move tickets through triage, planning, implementation,
  validation, review, and delivery.
- `job-search-campaign`: discover opportunities, verify fit, prepare truthful
  applications, retain status, and react to deadlines under user approval.

The static `job-application-workshop` belongs to artifact assurance; it is a
prerequisite component, not evidence that the persistent campaign works.

**Minimum topology.** `multi-agent` only because roles require different
workspaces, skills, information, and permissions. A single unrestricted Agent
is a competing product with a different safety model.

**Candidate methods.** [Orchestrator and bounded workers](./patterns.md#orchestrator-and-bounded-workers)
for independent tasks, [Gauntlet](./patterns.md#gauntlet) for artifact repair,
and [bounded semantic dispatch](./patterns.md#bounded-semantic-dispatch) only
where explicit slots no longer suffice. Durable application state is not
itself an orchestration pattern.

**Why Jig.** Exact admitted procedures, Agent calls, semantic choice, durable
facts, bounded effects, and scoped state could be composed under one host
authority without one integration owning the entire application.

**Jig does not supply.** Git or job-board integrations, Kanban semantics,
human approval policy, business goals, notifications, or a GUI. Those remain
application components even if reusable FLOW packages implement them.

**Strongest alternative and losing condition.** A coding Agent, applicant
tracker, automation platform, durable workflow engine, or purpose-built SaaS
wins if the user does not need independently admitted components and
least-authority role boundaries. Operational sophistication alone is not a
Jig advantage.

**Earliest surface and evidence gate.** Complete applications come last. Each
static method, external-state boundary, and failure transition must first work
alone. An end-to-end probe must survive restarts, duplicate facts, Agent
failure, human delay, stale state, and cancellation while showing a user
benefit beyond a strong integrated application.

## Inventory

The inventory makes omissions visible. Slugs are descriptive research IDs,
not package names or promised interfaces.

| Family | Retained entries |
| --- | --- |
| Contained foreign computation | `confidential-benchmark`, `confidential-control-capsule`, `quarantined-format-decoder` |
| Source-linked reconstruction | `underpayment-reconstruction`, `disaster-claim-binder`, `food-recall-trace`, `protocol-deviation-reconstruction` |
| Bounded semantic review | `consent-promise-gap`, `collection-release-screener`, `site-near-miss-coding`, `ai-response-gate` |
| Artifact challenge and assurance | `gauntlet-artifact`, `independent-jury`, `red-team-plan`, `research-review-brief`, `job-application-workshop` |
| Information-bounded transformation | `private-feedback-analysis`, `compartmentalized-accession`, `public-notice-relay` |
| Decisions under uncertainty | `futureproof-event-plan`, `career-transition-bridge`, `curriculum-coverage-grid`, `energy-discrimination` |
| Authorized semantic dispatch | `repair-diagnostic`, `vetted-law-front-desk`, `authorized-waste-disposition`, `approved-release-transform` |
| Durable fact-to-work derivation | `auditable-allocation`, `cold-chain-excursion` |
| Stateful least-authority capabilities | `privacy-budgeted-analysis`, `field-evidence-sealing`, `instrument-protocol-commons`, `consent-gated-archive`, `safe-repair-bus` |
| Persistent agentic applications | `software-factory`, `job-search-campaign` |
