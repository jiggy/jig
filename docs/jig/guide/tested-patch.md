---
title: An issue becomes a tested patch
---

# An issue becomes a tested patch

Give Jig a small Bun project and a bug. Get back a multi-file patch, the
commands actually run against it, and independent checks of its behavior.
The example follows one issue through one repair specialist.
Your original files stay unchanged; you decide whether to apply the patch.

Use the [tested-patch source example](https://github.com/jiggy/jig/tree/main/examples/tested-patch).
See the [installation guide](./index.md) for supported hosts.

## Try it

[Configure an Agent](./agents.md) and inspect
`issue.json`, `bindings/specialist.ts`, and `flows/project/cases.json`.
After [workspace setup](dependencies.md#local-workspace-packages), run from the example directory:

```sh
jig review
jig run binding:repair --input @issue.json --attach source=fixtures/log-report --out repair-result --timeout 5m
```

Open `repair-result/files/summary.txt`. A `review.patch` appears beside it
only when the repair passed the checks. The destination must be new and
outside the selected source. Candidate commands do not install dependencies.

The supplied project is an HTTP access-log reporter: a CLI, a parser, a
reporting module, and Bun tests. Its parser admits invalid status codes and
its reporter confuses client errors with server errors. Fixing the issue
requires changes in two source files.

Selected text reaches your configured Agent provider. Choose source and a
provider suitable for your data. Ctrl-C cancels owned work; it cannot retract
a remote request already received, and unsuccessful calls may incur charges.

## From a reproduced failure to a tested patch

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
trigger a correction or automatic replay. This example delivers final results
only; interruption does not retain unfinished patches. File delivery is separate
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
For application development, work in the repository's authoring directory:
use the root workspace installation and run `bun test test` there. Those checks establish application
policy, not model quality or a market advantage.
