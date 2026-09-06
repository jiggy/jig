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

The two packages use the published `@jigging/flow@0.1.0-alpha.3` SDK. Their
`package.json` files declare that exact dependency. Before the first review,
copy the example into a new directory and generate each package's ignored
development lock with Bun 1.3.3, if absent:

```sh
cd my-tested-patch
(cd flows/repair && bun install --ignore-scripts --lockfile-only)
(cd flows/evaluate && bun install --ignore-scripts --lockfile-only)
jig review
jig run binding:repair --input "$(cat fixtures/utf8.json)" --timeout 5m
```

Jig prepares the locked dependency during review, not during execution. No
Agent-selected package install, command, or dependency is accepted.

## Inspect the evidence

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

The request contains an `issue`, an `editPath`, and a `snapshot` of ordinary
`{path, content}` text files. Only that existing TypeScript file may change.
The example accepts up to 16 files and 64 KiB of source; paths cannot escape
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

Deterministic application tests use substituted candidates and Agent responses:

```sh
(cd examples/tested-patch/flows/repair && bun install --ignore-scripts)
bun test examples/tested-patch/test
```

Those tests exercise policy and the real acceptance-checker process. They do
not establish model quality, host containment, or independent consumer success.
