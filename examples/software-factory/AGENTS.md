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
- `jig.ts` declares the project entrypoint with the factory target, batch/source
  defaults, output destination and deadline. Ordinary `jig run` exercises the
  public host defaults; repeat Runs choose a new output without overwriting.
- `batch.json` and the named case files own the selected issues and acceptance
  policy. `fixtures/` owns the synthetic comparison projects.
  The shipped batch omits `method` to exercise semantic selection; optional
  reviewed IDs `p1` and `p2` map to `single-pass` and `checked-correction` for
  explicit selection. Verify shipped data against the user-input validator.
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
- Check each patch separately. Report overlaps and block conflicting output;
  never claim that separately passing patches pass as a combined change.
- Checkpoints retain only settled evidence and patches. Pending or failed work
  never receives an invented verdict or deliverable.
- The optional `progress` broadcast channel reports routing and the repair
  specialist's observed baseline, proposal, check, and finish phases. A `settled`
  update follows the durable checkpoint. Progress never establishes acceptance;
  the `checkpoint` slot is the separate collaborator for settled evidence.
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
