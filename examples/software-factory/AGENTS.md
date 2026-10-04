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
- `flows/router/` owns the portable decision Flow, separately governed below.
- `flows/repair/` owns the factory's independently editable repair specialist.
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
- The optional `progress` broadcast channel reports routing and the repair
  specialist's observed baseline, proposal, check, and finish phases. A `settled`
  update follows the durable checkpoint. Progress never establishes acceptance;
  the `checkpoint` slot is the separate collaborator for settled evidence.
- Original sources remain read-only. The application writes patch packets only;
  a person decides whether to apply, combine, merge, or release them.

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
- The release gate repeats deterministic application tests against packed SDK
  candidates. Jig's private repair-batch host fixture exercises the same
  contained command and checkpoint boundaries, but does not qualify this
  application's `binding:factory` or a live Agent.

## Child DOX Index

- [flows/repair/AGENTS.md](flows/repair/AGENTS.md) — Factory-owned repair
  proposals and execution checks behind both reviewed configurations.
- [flows/router/AGENTS.md](flows/router/AGENTS.md) — Reusable finite semantic
  choice and public boundary validation, independent of factory policy.
