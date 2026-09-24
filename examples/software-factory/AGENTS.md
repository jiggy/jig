# Small software factory

## Purpose

Show bounded repair composition over a fixed two-issue set: explicit application
choice normally selects a reviewed repair configuration, optional Agent routing
can choose from the same finite set, and every merge decision stays with a person.

## Ownership

- `flows/factory/` owns bounded batch validation, method-to-slot policy,
  source capture, independent evidence and optional routing-result validation, parallel
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
- Each job may select `single-pass`, `checked-correction`, or `auto`; omission
  uses checked correction. Validate every selection before paid work. Explicit
  and default choices dispatch directly. Route `auto` only after all inputs are
  captured; validate complete router results and exact membership before
  dispatch. Abstention, blocked/limit, invalid results and failures never
  silently choose a default. Retain the selection source, chosen method, and
  any routing context and decision with settled job evidence. `cancelAfterMs`
  covers the complete selection-and-repair interval.
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
