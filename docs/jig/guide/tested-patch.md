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

The example declares the ordinary ACP Agent dependency and includes
`bindings/agent.ts`. [Choose your client](./agents.md) there; Pi is an example
choice, not a Jig preference. The `defaultProviders` map selects that Binding
for the Agent Run contract. Inspect `issue.json`, `bindings/specialist.ts`, and
`flows/project/logs-cases.json`.
Download the example directory, then install its pinned public dependencies
without lifecycle scripts:

```sh
bun install --ignore-scripts
```

Keep the resulting lock so later reviews use the same resolution. Run from the
example directory:

```sh
jig review --allow-resolution-network
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
{"issue":"Describe the defect and required behavior.","editPaths":["src/parse.ts","src/report.ts"],"checks":"my-project"}
```

Select your source with `--attach source=../my-project`. For a larger tree,
add exact `--select source=src/file.ts` selectors for only the needed files.
The application accepts 16 UTF-8 files totaling 64 KiB and up to eight editable
`src/*.ts` or `src/*.js` files. It does not execute repository configuration
during capture, take an atomic Git snapshot, or filter secrets for you.

In `bindings/specialist.ts`, name your existing Bun test files under
`slots.tests.test` and CLI entrypoint under `slots.cli.run`.
Write independent cases in `flows/project/my-project-cases.json`: each has an ID,
arguments, stdin, expected stdout/stderr, and exit code. For example:

```json
[{"id":"empty","args":[],"stdin":"","stdout":"0\n","stderr":"","exitCode":0}]
```

Use the actual behavior your CLI should produce. Supply 1–8 cases; the JSON file
is limited to 256 KiB. Select it with `checks: "my-project"`; omitted `checks`
uses the included `logs` set. Names are 1–32 lowercase letters, digits or hyphens,
starting with a letter. The same selection works in batch jobs without editing
the root or specialist code. Files live in the reviewed application, outside
the candidate's permitted edits. Every selected set is validated before worker
dispatch. Review again after changing commands or cases.
Candidate dependencies must be source-local or supported
Bun/Node built-ins; network and installation are unavailable.

The repair specialist needs no attachment. Another root can reuse it through
an exact Binding with its own Agent selection, command grants, and JSON cases.
For application development, work in the repository's authoring directory:
use the root workspace installation and run `bun test test` there. Those checks establish application
policy, not model quality or a market advantage.

## Keep conversation context for a correction

Ordinary repair sends each proposal request independently. For a qualified
native Agent, you can instead restore the first conversation after executing
its proposed changes. This can preserve context without keeping an Agent active
while the separately contained commands run.

Add this to the repair specialist Binding in `bindings/specialist.ts`:

```ts
settings: { restoreCorrections: true },
```

In the selected Agent Binding, explicitly grant native retention:

```ts
slots: { native: { kind: 'acp', client: 'codex', retainSessions: true } },
```

Review these changes before running. [Native restoration](conversations.md#restore-after-a-clean-close)
requires qualified matching artifacts; the HTTP Agent does not support it.
The default repair configuration remains unchanged.

The specialist keeps sessions optional because its ordinary one-shot path
does not need them. Static dependency requirements therefore do not qualify
this settings-dependent choice. Check the selected Agent's declared `sessions`
support and its separate native grant; actual retention still requires a final
receipt. Do not add an unconditional session requirement to the default example.

The first call requests Run-scoped retention and supplies its final receipt before any candidate
command starts. If the proposal is invalid or fails the fixed checks, one
restored call receives that feedback. It must still propose replacements against
the original files, within the same two-proposal budget and root deadline.
The original source is not resent in the correction prompt; native retained
history supplies that context. This is restoration, not an overlapping live
conversation or automatic summary handoff.

Unavailable retention still allows a passing first patch. If correction is
needed, the application returns `blocked` with the reason. Missing or malformed
receipts and failed restoration remain errors; neither triggers a fresh-call
fallback or replay. `attempts[].session` records final receipts, including a
first reference already consumed by correction. These references are temporary:
root settlement removes their stored state, so the packet is evidence, not a
source of cross-Run continuation. Retained transcripts contain the supplied
source and feedback; the host's retention limits and expiry still apply.
