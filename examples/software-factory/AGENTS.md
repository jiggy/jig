# Small software factory

## Purpose

Show how the tested repair method can process a fixed two-issue set while
retaining separate evidence and leaving every merge decision to a person.

## Ownership

- `flows/factory/` owns bounded batch validation, parallel dispatch, checkpoint
  aggregation, conflict detection, and final summaries.
- `bindings/` composes the existing tested-patch repair Flow with one ordinary
  Agent and fixed Bun test/CLI grants.
- `batch.json` and the named case files own the selected issues and acceptance
  policy. `fixtures/` owns the synthetic comparison projects.
- `test/` owns deterministic batch, failure-isolation, and recovery checks.

## Local Contracts

- Complexity cap: one or two preselected jobs, at most two proposals per job,
  one repair method, and a human merge gate. Do not add ticket intake, Git
  mutation, CI control, general scheduling, or automatic merging.
- Validate and capture every project and case set before paid work. Run workers
  independently; preserve a healthy result when its peer fails or is cancelled.
  Reject incomplete or wholly empty project reads instead of evaluating invented
  empty candidates.
- Check each patch separately. Report overlaps and block conflicting output;
  never claim that separately passing patches pass as a combined change.
- Checkpoints retain only settled evidence and patches. Pending or failed work
  never receives an invented verdict or deliverable.
- Original sources remain read-only. The application writes patch packets only;
  a person decides whether to apply, combine, merge, or release them.

## Work Guidance

- Reuse the tested-patch repair and evidence packages through ordinary Flow
  package dependencies. Keep project-specific issue and check data here.
- A comparison result limits only the measured claim. Preserve tied,
  unfavorable, and failed evidence.

## Verification

- `bun test examples/software-factory/test`
- The release gate repeats deterministic application tests against packed SDK
  candidates. Jig's private repair-batch host fixture exercises the same
  contained command and checkpoint boundaries, but does not qualify this
  application's `binding:factory` or a live Agent.

## Child DOX Index

- None.
