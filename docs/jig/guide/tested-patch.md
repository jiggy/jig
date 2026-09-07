---
title: An issue becomes a tested patch
---

# An issue becomes a tested patch

Give Jig a small Bun project and a bug. Get back a multi-file patch, the
commands actually run against it, and independent checks of its behavior.
Your original files stay unchanged; you decide whether to apply the patch.

The [copyable application](https://github.com/jiggy/jig/tree/main/examples/tested-patch)
includes its Flow dependency locks; Jig prepares those dependencies during
review. See the [installation guide](./index.md) for supported hosts.

## Try it

Copy `examples/tested-patch`, [configure an Agent](./agents.md),
and inspect `issue.json`, `bindings/specialist.ts`, and
`flows/project/cases.json`. From your copy:

```sh
jig review
jig run binding:repair --input @issue.json --attach source=fixtures/log-report --out ../repair-result --timeout 5m
```

Open `../repair-result/files/summary.txt`. A `review.patch` appears beside it
only when the repair passed the checks. The destination must be new and
outside the selected source. Review prepares the Flow's locked SDK; candidate
commands do not install dependencies.

The supplied project is an HTTP access-log reporter: a CLI, a parser, a
reporting module, and Bun tests. Its parser admits invalid status codes and
its reporter confuses client errors with server errors. Fixing the issue
requires changes in two source files.

Selected text reaches your configured Agent provider. Choose source and a
provider suitable for your data. Ctrl-C cancels owned work; it cannot retract
a remote request already received, and unsuccessful calls may incur charges.

## What makes a patch review-ready?

The root application captures source and owns delivery. Its reusable repair
specialist receives JSON, asks the Agent for replacement text, and requests
reviewed Bun commands in separate containment. It never needs a writable
host repository or an unrestricted Agent terminal.

The original goes through the same checks first. An independent failure
permits a proposal; an invalid proposal or unsuccessful candidate permits
one correction. There are at most two Agent calls. Tests and acceptance
expectations never change to make the repair pass.

Three different kinds of evidence appear in the result:

| Evidence | What it establishes |
| --- | --- |
| Host-collected output, exit, signal, and candidate identity | What the exact command emitted and how it ended. |
| Ordinary repository tests | Useful project checks, but candidate code can interfere with their runner. |
| Independent application assertions | Whether captured CLI output and exit match unchanged expected behavior, without importing candidate code or trusting its pass flag. |

The root checks the evidence against its captured files and acceptance cases,
then constructs an applicable patch from the validated replacement text.
Passing a finite case set is not proof of general correctness.

## Read the result

| File | Meaning |
| --- | --- |
| `files/review.patch` | A patch backed by reproduced failure and passing candidate checks. Still requires human review. |
| `files/proposal-N.patch` | Each validated proposal, including unsuccessful attempts. |
| `files/summary.txt` | Review-ready or unsuccessful, with the method's reason. |
| `result.json` | Host outcome, input identities, original and candidate evidence, and published file manifest. |

Read the Flow's outcome, not just the CLI exit code: `done` means a passing
patch; `blocked` means no reproduced defect or no acceptable proposal;
`limit` means the Agent stopped at its limit. A valid `blocked` result can
have CLI exit code zero without a review-ready patch.

`output.baseline` records the original. Each `output.attempts` entry retains
a validated proposal and its candidate identity or an invalid-proposal reason.
A completed evaluation includes `commands`, `acceptance`,
`repositoryTestsPassed`, and `accepted`. Treat the Agent's summary as a claim,
not execution evidence.

Cancellation, deadlines, uncertain execution, and unavailable support never
trigger a correction or automatic replay. Each settled job saves an aggregate
of verified patches, unsuccessful outcomes, and pending job IDs. On later
interruption, `result.json.checkpoint` identifies the latest saved aggregate;
only its files are exported, after cleanup. An interrupted Run stays failed
or lost even when it preserves a review-ready sibling patch. Unsaved work is
not salvaged. Retention requires the independent command owner to remain alive;
see [Run Checkpoint](../spec/run-checkpoint.md). File delivery is separate
from execution: inspect an existing destination after a lost acknowledgement
instead of blindly starting another Run. See [working with files](./files.md).

## Use your own small project

Change `issue.json` to name the permitted existing source paths:

```json
{"issue":"Describe the defect and required behavior.","editPaths":["src/parse.ts","src/report.ts"]}
```

Select your source with `--attach source=../my-project`. For a larger tree,
add exact `--select source=src/file.ts` selectors for only the needed files.
The application accepts 16 UTF-8 files totaling 64 KiB and up to eight editable
`src/*.ts` or `src/*.js` files. It does not execute repository configuration
during capture, take an atomic Git snapshot, or filter secrets for you.

In `bindings/specialist.ts`, name your existing Bun test files under
`commands.tests.test` and CLI entrypoint under `commands.cli.run`.
Write independent cases in `flows/project/cases.json`: each has an ID,
arguments, stdin, expected stdout/stderr, and exit code. Review again after
changing either. Candidate dependencies must be source-local or supported
Bun/Node built-ins; network and installation are unavailable.

The repair leaf itself needs no attachment or child Flow. Another root can
reuse it through an exact Binding with its own command policy and JSON cases.
For application development, install development dependencies at the example
root and run `bun test test`. Those deterministic checks establish application
policy, not model quality or a market advantage.

## Two workers, two reviewable patches

The included `batch.json` repairs the log reporter and a timesheet CLI in
parallel. The timesheet has separate defects in time validation and overnight
totals. Both jobs reuse the unchanged JSON repair specialist:

```sh
jig run binding:repair --input @batch.json --attach source=fixtures --out ../batch-result --timeout 5m
```

Each job names its relative project `directory`, an `issue`, permitted
`editPaths`, and one application-owned check set (`logs` or `timesheet`).
Those fixed cases live in the root Flow and require review when changed.
Each project retains the same size and two-proposal limits; a batch can make
up to four Agent calls. All jobs are captured and validated before work starts.

Open `files/summary.txt`, then each job's folder and its entry under
`output.jobs` in the packet's `result.json`. A successful sibling keeps its patch even if another
worker fails. `done` requires every job to be review-ready without conflicting
edits; otherwise the application returns `blocked`. A job failure retains its
captured identity and available failure evidence, not an invented test verdict.

For a per-job time bound, set optional `cancelAfterMs` (1–300,000). Its expiry
requests cancellation of that worker alone; Ctrl-C cancels the complete Run.
If the root itself fails, final Flow files are not exported. This is not yet
checkpoint retention through interruption.

Jig admits at most two sibling calls and reserves each branch's whole resource
ceiling before dispatch. There is no waiting queue. The application reports
overlapping paths but does not combine patches. Their checks establish each
candidate separately; review and test a combined change before applying it.
