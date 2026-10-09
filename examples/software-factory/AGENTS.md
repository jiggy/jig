# Small software factory

## Purpose

Produce tested patches for a fixed two-issue set: explicit method IDs choose
reviewed repair budgets, with optional semantic selection when a choice is unknown.
Application checks retain
patch authority and every merge decision stays with a person.

## Ownership

- `flows/factory/` owns bounded batch validation, candidate-to-slot policy,
  source capture, independent evidence and routing-result validation, parallel
  job dispatch, checkpoint aggregation, conflict detection, and final summaries.
  `presentation.ts` translates observed phases, reviewed proposal budgets and
  failure evidence into ordinary language; optional input labels name jobs for people.
  It names observed work and repeats goals with verified outcomes in the final report.
  `dashboard.ts` composes the portable Jobs, Checks and Patches documents using
  public user-updates types. Activity is the initial host surface. All three
  domain views are offered before work and at settlement. Jobs retains goals,
  scope and outcomes, with concise check verdicts and patch references only for
  independently accepted jobs. Its details retain actual-call references,
  verification and the human review step; current phases use one root activity slot per job rather
  than duplicate whole-view publications. Call references name
  actual own operation IDs, and patch references name only accepted files in
  deliverables. Checks distinguish provisional reports from independent final
  verification, including settled jobs with no checked patch. No host-domain
  adapter, terminal callback, invented graph edge or execution control belongs here.
- `flows/router/` owns the portable decision Flow, separately governed below.
- `flows/repair/` owns the factory's independently editable repair specialist.
- The factory declares `factory-repair-flow` as a workspace dependency and
  imports its policy types and progress decoder through manifest exports.
  Cross-Flow helpers require declared package dependencies, never ambient
  imports into sibling directories.
- `bindings/` composes one-proposal and checked-correction configurations of
  that specialist with one ordinary Agent and fixed Bun test/CLI grants.
- `jig.ts` declares the project entrypoint with the factory target, batch/source
  defaults, output destination and deadline. Ordinary `jig run` exercises the
  public host defaults; repeat Runs choose a new output without overwriting.
- `batch.json` and the named case files own the selected issues and acceptance
  policy. `fixtures/` owns the synthetic comparison projects.
  The shipped batch selects `method` explicitly to avoid unnecessary model routing;
  reviewed IDs `p1` and `p2` map to `single-pass` and `checked-correction` for
  selection. Omitting `method` requests semantic selection. Verify shipped data
  against the user-input validator.
- `test/` owns deterministic batch, failure-isolation, and recovery checks.

## Local Contracts

- Complexity cap: one or two preselected jobs, at most two proposals per job,
  two meaningfully bounded repair configurations, and a human merge gate. Do not
  add ticket intake, Git
  mutation, CI control, general scheduling, or automatic merging.
- Validate and capture every project and case set before paid work. Run workers
  independently; preserve a healthy result when its peer fails or is cancelled.
  Reject incomplete or wholly empty project reads instead of evaluating invented
  empty candidates.
- Capture all inputs before Agent work. An optional exact `method` selects one of
  the reviewed factory IDs and bypasses semantic routing; without it, validate the
  complete router result and exact membership before dispatch. Abstention,
  blocked/limit, invalid results and failures never silently choose a default.
  Retain whether selection was explicit or automatic, plus the applicable context
  and decision, with settled job evidence. `cancelAfterMs` covers routing and
  repair together.
- Router and worker execute sequentially within each job, keeping two concurrent
  branches within the existing two-level-plus-effect resource reservations.
- Both configurations use identical acceptance policy; one stops after its first
  checked proposal, the other permits one correction.
- Keep invocation constraints within Jig's supported FLOW Schema/0 vocabulary;
  enforce syntax checks in the owning Flow when the schema cannot express them.
- Compare retained verdict records by their JSON meaning, including exact fields
  and array order, independently of JavaScript object prototypes at the FLOW boundary.
- Check each patch separately. Report overlaps and block conflicting output;
  never claim that separately passing patches pass as a combined change.
- Checkpoints retain only settled evidence and patches. Pending or failed work
  never receives an invented verdict or deliverable.
- Failed jobs retain the observed routing, repair, or validation stage and public
  cause. Final and checkpoint summaries quote and bound reported text, identify
  available evidence, and give a safe next action without replaying work. Only
  independently accepted jobs advertise a review patch.
  Preserve complete short actionable causes in live notices and final summaries.
  The shared quoted prefix permits 512 scalars within 400 double-escaped JSON
  characters; the truncation marker is additional. Two jobs still fit the
  host's 2048-character brief budget.
  Oversized-cause markers refer to retained job evidence without claiming files
  were delivered before checkpoint acknowledgement. Retained causes stay unchanged.
- Final job evidence retains the full issue and editable paths. Accepted-job
  verification names the independently checked proposal and acceptance cases;
  changed paths compare accepted replacement bytes with captured originals.
  Shorten goal/path context before blocking causes to fit the host brief budget.
  Keep the introduction short and point to the three domain views.
  Budget every complete snapshot using encoded bytes as well as scalar limits;
  valid maximum input must not fail optional publication. Short goals remain
  complete in Jobs; oversized goals explicitly identify their excerpt and exact
  source. Write each original goal to `<job>/goal.txt` before paid work, retain it
  in settled checkpoint files and final evidence, and offer an ordinary artifact
  reference pending verified delivery. Never advertise an unfinished goal as
  checkpoint-saved or read a mutable destination to preview it.
- Live worker check reports remain provisional. Show repository-command status,
  named acceptance mismatches, collected invocations and the next procedural step;
  expected nonzero rejection exits may pass exact application assertions. Do not
  print raw stdin, command logs or model reasoning. Final acceptance belongs to
  factory evidence validation, never progress or Agent judgment.
- The optional `progress` broadcast channel uses the exact canonical user-updates
  profile through its scoped publisher. Root job IDs use a distinct namespace;
  deliberate child phase readers settle before root clears. Notices count jobs
  retained by successful checkpoints, never attempts or acceptance. A complete
  checkpoint notice follows durable storage. Progress never establishes acceptance;
  the `checkpoint` slot is the separate collaborator for settled evidence.
  Final snapshots remain optional observations. Test all three completed views
  through the installed host, including fast blocked and accepted outcomes;
  preserve final result/evidence independently. Publish blocking notices before
  observational snapshots and checkpoint work.
- Original sources remain read-only. The application writes patch packets only;
  a person decides whether to apply, combine, merge, or release them.


Offer each blocking job outcome as an error notice before checkpoint storage;
retain the same cause in the ordinary result. Saved-evidence notices follow
checkpoint acknowledgement. Severity never controls execution or guarantees
optional observation delivery.

- Standalone repair and router views use the same public profile: Repair/Checks
  on `updates`, Selection on `progress`. Root Jobs/Checks/Patches retain their
  independent acceptance and own-publisher reference boundaries.

## Work Guidance

- Keep source capture, acceptance policy, evidence validation and patch export
  application-owned. Repair and routing may use local methods or independently
  maintained public FLOW dependencies; preserve the checked proposal budgets,
  exact method-to-slot map, failure handling and human merge gate.
- Bind a local specialist by its project path, as the supplied `flows/repair`
  Bindings do. Use `npm:` for a declared external package dependency; document
  ordinary installation and reviewed grants without requiring a sibling checkout.
- A comparison result limits only the measured claim. Preserve tied,
  unfavorable, and failed evidence.

## Verification

- `bun test examples/software-factory/test`
- Jig's `package-provider-host.test.ts` also runs this application through the
  installed CLI with a deterministic Flow Agent peer. It verifies reviewed
  repair-dependency imports, live worker reports and checkpoint delivery after
  the editable repair source is removed, complete results and verified delivered
  files for blocked and independently checked repairs. Explicit reception checks
  exact contiguous NDJSON and every observed payload; clean reception requires
  all three final views and checked patch references, while failed/LAGGED retains
  only its actual prefix. Automatic plain display requires either all three
  completed summaries or precisely marked incomplete LAGGED observation, and
  independently verifies its own result and files. A separate small installed
  consumer requires three clean-ended views through both automatic and explicit
  reception, plus truthful producer-loss handling. Deterministic batch tests
  require the actual factory publisher's final Jobs, Checks and Patches offers;
  portable observer tests cover receiver loss and retained-model settlement.
  These checks make no live Agent claim or optional-delivery guarantee.
- The release gate repeats deterministic application tests against packed SDK
  candidates. Jig's private repair-batch host fixture exercises the same
  contained command and checkpoint boundaries, but does not qualify this
  application's `binding:factory` or a live Agent.

## Child DOX Index

- [flows/repair/AGENTS.md](flows/repair/AGENTS.md) — Factory-owned repair
  proposals and execution checks behind both reviewed configurations.
- [flows/router/AGENTS.md](flows/router/AGENTS.md) — Reusable finite semantic
  choice and public boundary validation, independent of factory policy.
