# Small software factory

## Purpose

Show bounded semantic dispatch over a fixed two-issue set: reusable Agent
judgment chooses a reviewed repair configuration, while application checks retain
patch authority and every merge decision stays with a person.

## Ownership

- `flows/factory/` owns bounded batch validation, candidate-to-slot policy,
  source capture, independent evidence and routing-result validation, parallel
  job dispatch, checkpoint aggregation, conflict detection, and final summaries.
- `flows/router/` owns the portable decision Flow, separately governed below.
- `flows/repair/` owns the factory's independently editable repair specialist.
- `bindings/` composes one-proposal and checked-correction configurations of
  that specialist with one ordinary Agent and fixed Bun test/CLI grants.
- `batch.json` and the named case files own the selected issues and acceptance
  policy. `fixtures/` owns the synthetic comparison projects.
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
- Route only after all inputs are captured. Validate complete router results and
  exact membership before dispatch; abstention, blocked/limit, invalid results and
  failures never silently choose a default. Retain context, candidates and decision
  with settled job evidence. `cancelAfterMs` covers routing and repair together.
- Router and worker execute sequentially within each job, keeping two concurrent
  branches within the existing two-level-plus-effect resource reservations.
- Both configurations use identical acceptance policy; one stops after its first
  checked proposal, the other permits one correction.
- Check each patch separately. Report overlaps and block conflicting output;
  never claim that separately passing patches pass as a combined change.
- Checkpoints retain only settled evidence and patches. Pending or failed work
  never receives an invented verdict or deliverable.
- Original sources remain read-only. The application writes patch packets only;
  a person decides whether to apply, combine, merge, or release them.

## Work Guidance

- Keep the repair, capture, and evidence code inside this project. Its worker
  uses the ordinary Flow and Agent packages; factory issues and acceptance cases
  remain application-owned.
- Bind the factory-owned specialist by its project path `flows/repair`. The
  `npm:` selector is for a declared package dependency, not this local Flow.
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
