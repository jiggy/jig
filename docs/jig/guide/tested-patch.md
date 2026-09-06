---
title: An issue becomes a tested patch
---

# An issue becomes a tested patch

Ask an Agent to repair a small bug, then inspect a patch backed by executed
checks—not the Agent's claim that its code works. The original repository is
never writable by the Agent or the candidate code.

The [example source](https://github.com/jiggy/jig/tree/main/examples/tested-patch)
contains two Flows and one Binding. It is an authored application for the
current source candidate, not a promoted Starter or independent usability
proof. Use a Jig build from the same checkout on a
[supported host](https://github.com/jiggy/jig/blob/main/SECURITY.md).

## What happens

The supplied repository has a UTF-8 truncation bug: a four-byte budget wrongly
retains all of `café`, which occupies five bytes. The repair method first
reproduces that defect, asks its Agent for one file replacement, and tests the
replacement against the same acceptance cases. If the candidate returns an
invalid result or fails those checks, the Agent gets one correction attempt
with the previous patch and observed failure. Two Agent calls is the hard limit;
the checks never change to make a patch pass.

Candidate code runs in the separate, capability-free evaluator Flow. A fixed
acceptance program in the repair Flow receives only the observed JSON values.
It owns the expected answers and records real process exit codes and bounded
logs. Candidate code cannot edit those checks, access the parent's Agent, or
turn a self-reported pass into acceptance.

This first example supports a synchronous exported TypeScript function with
JSON arguments and results. It is not an unrestricted coding terminal, a
general repository test runner, or proof of correctness beyond the cases run.

## Try it

Configure one Agent using the [operator instructions](../spec/agent-run.md#alpha-host-implementations).
Keep that configuration available during review and execution. The application
does not choose a provider, model, or credential.

Copy `examples/tested-patch` from that candidate checkout into a new application
directory. Keep its two included `bun.lock` files: they identify the published
`@jigging/flow@0.1.0-alpha.3` SDK. No local dependency installation is needed
to run the application. Bun 1.3.3 runs its small repository-facing command;
Jig runs the reviewed methods inside containment.

```sh
cd my-tested-patch
jig review
bun --no-env-file --no-install --config=/dev/null repair.ts \
  --repo fixtures/utf8 --edit src/truncate-utf8.ts --file README.md \
  --issue 'Fix UTF-8 byte truncation without splitting a code point. Preserve invalid-budget rejection.' \
  --out ../utf8-repair
```

Jig prepares the locked dependency during review, not during execution. No
Agent-selected package install, command, or dependency is accepted.

The command reads the editable file and only the additional `--file` paths
you name. It does not scan the repository, load its configuration, or send
unselected files to the Agent. Selected text **is sent to your operator-selected
provider**; choose files and a provider appropriate to your data. Source and
candidate execution remain inside the existing Flow boundary.

`--out` must name a new directory outside the original repository, under an
existing parent. Nothing is applied automatically. Use `--jig /absolute/path/to/jig`
if the candidate is not your default executable. Ctrl-C requests cancellation
and waits for Jig; work is never automatically retried. The Run deadline is
five minutes, with at most two Agent calls. Provider charges can still apply
to unsuccessful or interrupted calls.

## Inspect the evidence

Open `../utf8-repair/summary.txt`. You do not need to extract a diff from JSON.

| File | What it tells you |
| --- | --- |
| `review.patch` | A patch backed by a reproduced defect and passing checks; absent otherwise. Still requires your review. |
| `proposal-N.patch` | Each validated proposal, including unsuccessful ones. Its name does not imply passing checks. |
| `summary.txt`, `summary.json` | Original and proposal check counts, final classification, and reason. |
| `input.json`, `acceptance.json` | The captured original text and identities/expectations used to check the returned evidence. |
| `terminal.json` | The untouched CLI terminal, when complete JSON arrived. |
| `stdout.txt`, `stderr.txt`, `execution.json` | Captured CLI output and actual command exit/interruption records. Each stream is capped at 1 MiB; excess output requests cancellation. |

The command exits `0` only for a review-ready patch, `1` for an unsuccessful
method outcome, `2` for input, execution, or evidence errors, and `130` for
interruption. If startup or terminal delivery fails, the packet can be partial.
Missing evidence does not prove that no work was dispatched. Keep partial
packets for diagnosis and use a new output path for any deliberately new Run.

The exporter verifies patch bytes and snapshot/check identities before marking
anything review-ready. If the checked identities differ from the visible
application, inspect and review the current application before running again.

### Reading the raw terminal

Read the Flow outcome as well as the command's execution status.

- `done`: the original showed an assertion failure and the replacement passed
  the same checks. Inspect `output.baseline` and the ordered `output.attempts`
  before using the final attempt's patch.
- `blocked`: the baseline did not reproduce the defect, the Agent could not
  supply a patch, or the proposed patch failed its checks. An evaluated failing
  patch remains in the output.
- `limit`: the Agent stopped at its limit. No repair retry is implied.

Invalid patches and candidate execution, cancellation, or uncertain-dispatch
errors stay failures; they are not rewritten into passing test reports.
When patched execution fails, `details.attempts` retains the validated proposals,
alongside snapshot identities and baseline evidence, without inventing a candidate exit
code. Cancellation or coordinator loss can prevent that report from arriving.

`baseSha256` identifies the original; each attempt's `patchedSha256` identifies
its submitted snapshot. Each patch
contains the sole permitted path, original-file identity, full replacement,
unified diff, and Agent-written summary. Treat that summary as a claim.
An attempt has a `tested` record when its checker completed, or a `failure`
record when candidate output was invalid. No completed check is implied by
that failure. The checker and case-set identities accompany actual acceptance-process
`exitCode`, `signal`, stdout, stderr, byte counts, and truncation flags.
These are **checker** records: the child-call interface does not expose the
candidate process's raw exit code or stderr.

The output authorizes no original-repository write, merge, push, or release.
Apply the patch only after reviewing it. Cancellation stops locally owned
work; it cannot retract a request already received by a remote model. A failed
coordinator may prevent an application report from being delivered.

## Adapt the method

Select a different utility with `--repo` and `--edit`; add only the context
files it needs with repeated `--file`. Paths are relative to that repository,
and symlinks beneath its root are rejected. Selected files must be regular
UTF-8 text. A detected edit during capture fails; the captured set is not an
atomic Git revision. It is the exact bounded text supplied to this Run.

The command builds the existing request: an `issue`, an `editPath`, and a `snapshot` of ordinary
`{path, content}` text files. Only that existing TypeScript file may change.
The example accepts up to 16 files and 64 KiB of source; unusually escape-heavy
input must also fit the command's 120,000-byte JSON limit. Paths cannot escape
the disposable tree. Snapshot identity is SHA-256 of compact JSON for the
files sorted by path, with each object containing `path` then `content`.
The fixture JSON matches the original files in `fixtures/utf8/`.

Change `flows/repair/checks.json` to specify the exported function and the
independent argument/expected-observation cases for another small utility.
Arguments and expected values must follow [FLOW JSON/1](https://flow.jig.md/spec/json-values),
including its safe-integer range; not every JavaScript value can cross a Flow boundary.
Expect `{returned: value}` or `{threw: errorName}`; the fixture includes invalid
budgets so dropping validation cannot pass. Review
those changes before running: acceptance policy is admitted application
source, not something the Agent can replace in its answer. The evaluator
package and its public child-call interface need no change.

This is ordinary application code calling `jig run binding:repair`, not a new
`jig repair` command. Existing software callers may still supply snapshot JSON
directly through `jig run`. To change a Flow dependency, regenerate its lock
with `bun install --ignore-scripts --lockfile-only` and review the change.

Deterministic application tests use substituted candidates and Agent responses:

```sh
(cd examples/tested-patch/flows/repair && bun install --ignore-scripts)
bun test examples/tested-patch/test
```

Those tests exercise policy and the real acceptance-checker process. They do
not establish model quality, host containment, or independent consumer success.
