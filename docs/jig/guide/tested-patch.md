---
title: An issue becomes a tested patch
---

# An issue becomes a tested patch

Ask an Agent to repair a small bug, then inspect a patch backed by executed
checks—not the Agent's claim that its code works. Your original files remain
unchanged, and nothing is merged or published automatically.

The [example](https://github.com/jiggy/jig/tree/main/examples/tested-patch)
contains two Flows and one Binding. Use the Jig source candidate from the
same checkout on a [supported host](https://github.com/jiggy/jig/blob/main/SECURITY.md).
This example requires the candidate's file-Run support; it does not claim
availability in an older registry release.

## Try it

Copy `examples/tested-patch` into your own application directory and
[configure an Agent](../spec/agent-run.md#alpha-host-implementations).
Inspect `issue.json` and `flows/repair/checks.json`, then run:

```sh
jig review
jig run binding:repair --input @issue.json --attach source=fixtures/utf8 --out ../utf8-repair --timeout 5m
```

Jig reads the issue, captures the selected source, runs the admitted method,
and saves one result packet. The destination must be new and outside the
source directory. Review prepares the locked SDK; execution does not install
dependencies. No application launcher or separate Bun command is needed.

Selected text is sent to your operator-selected provider. Choose files and a
provider appropriate to your data. Ctrl-C requests cancellation and waits for
owned work to settle; it cannot retract a remote request already received.
Unsuccessful and interrupted calls may still incur provider charges.

## What the method does

The supplied utility truncates UTF-8 incorrectly: a four-byte budget retains
all of `café`, which occupies five bytes. The repair Flow reproduces the bug,
asks for one file replacement, and tests it against the same acceptance cases.
A failed check or invalid candidate observation permits one correction with
the observed failure. There are at most two Agent calls; checks never change
to make a patch pass.

Candidate code runs in a separate, capability-free evaluator Flow. The repair
Flow's fixed checker receives only JSON observations and compares them with
its own expected answers. The candidate cannot edit those checks or borrow
the parent's Agent. Before writing a review-ready patch, the repair method
also checks snapshot, patch, checker, and case identities against the evidence.

The supported task is one existing synchronous TypeScript function with JSON
arguments/results and one editable file. Passing the finite cases is useful
evidence, not a proof of general correctness.

## Read the result

Start with `../utf8-repair/files/summary.txt`.

| File | Meaning |
| --- | --- |
| `files/review.patch` | A replacement that passed the unchanged checks after reproducing the defect. Still needs your review. |
| `files/proposal-N.patch` | Each validated proposal, including unsuccessful attempts. |
| `files/summary.txt` | Check counts, final classification, and reason. |
| `result.json` | Jig's execution outcome, admitted method and input identities, and published file manifest. |

Read the Flow's `outcome`, not just the command exit code:

- `done`: the original failed an assertion and the replacement passed.
- `blocked`: no reproducible defect, no proposed patch, or unsuccessful checks.
- `limit`: the Agent stopped at its limit.

These are valid method outcomes. Jig can exit `0` after delivering a `blocked`
result; that does not mean a patch passed. `review.patch` is written only for
validated review-ready evidence.

Operational failures—such as invalid protocol, a failed process, cancellation,
or an invalid result—export no Flow files. When Jig can deliver a settled
failure record, it writes only the host packet. Earlier validated proposals
may remain in `details.attempts`; they are not passing patches. Coordinator
loss can prevent even that record from arriving.

Execution and file delivery are separate. A settled Run can have a failed
delivery, and a complete packet can exist even if its acknowledgement was
lost. Check an existing destination before deciding to start new work:
repeating `jig run` is a new invocation, not an export retry. See
[working with files](./files.md) for the general rules.

### Inspecting detailed evidence

`output.baseline` and the ordered `output.attempts` retain original and proposed
check results. Each proposal includes the permitted path, original identity,
replacement, unified diff, and Agent-written summary. Treat that summary as a
claim. A completed `tested` record contains actual checker exit, signal, and
bounded logs; an invalid candidate observation is not a completed checker run.
The child interface does not expose the candidate process's raw exit or stderr.

## Use your own utility

Change `issue.json` to contain just your issue and one existing edit path:

```json
{"issue":"Describe the defect and required behavior.","editPath":"src/utility.ts"}
```

Choose another source directory with `--attach source=../my-project`.
For a larger repository, select only the needed files:

```sh
jig run binding:repair --input @issue.json \
  --attach source=../my-project --select source=src/utility.ts \
  --select source=README.md --out ../utility-review --timeout 5m
```

Selectors are exact paths, not globs. The method accepts up to 16 regular
UTF-8 files totaling 64 KiB. Jig captures their bytes without executing
repository configuration. This is not an atomic Git snapshot or an automatic
secret filter.

Edit `flows/repair/checks.json` to name the exported function and independently
authored cases, then review the application again. Cases use
`{returned: value}` or `{threw: errorName}` and must follow
[FLOW JSON/1](https://flow.jig.md/spec/json-values), including its safe-integer
range. Include negative cases so removing required validation cannot pass.
Neither the evaluator package nor Jig needs a new API for this adaptation.

For application development, install the repair Flow's declared dependency
and run its deterministic checks:

```sh
(cd examples/tested-patch/flows/repair && bun install --ignore-scripts)
bun test examples/tested-patch/test
```

Those tests verify application policy and checker evidence. They do not prove
model reliability or superiority over a capable coding Agent with ordinary tests.
