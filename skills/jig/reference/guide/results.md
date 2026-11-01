---
title: Results and recovery
---

# Results and recovery

Read the execution status, method outcome, delivered output and cleanup evidence
before deciding what to do next. These facts answer different questions. The
[quickstart](index.md) shows a successful first invocation.

## Read results and diagnose failures

| Fact | Question | Meaning |
| --- | --- | --- |
| Execution status | Did the invocation complete? | The host reports execution, failure or uncertainty. |
| Method outcome and output | Did the method achieve its objective? | A completed method can return `blocked` or `limit`. |
| Delivery, when requested | Did Jig save the result and files? | A result is separate from confirmed packet delivery. |
| Cleanup evidence | Did owned work settle? | Requested cancellation is separate from confirmed cleanup. |

An application field such as `success` is method data. It is not a host verdict.
A successful execution does not prove that the application achieved its
objective.

Human output shows these facts before the application answer. Small answers
appear as YAML. For large answers in a confirmed packet, read `result.json` for
the complete output and checkpoint evidence. If delivery is uncertain, the
terminal keeps result evidence visible. The packet also retains input manifests
and digests when delivery succeeds. Existing result directories are never
replaced.

Writable targets receive a fresh temporary packet when `--out` is omitted. The
operating system may clear that storage. Use `--out DIRECTORY` for a new
retained destination. Result-only targets return stdout by default. See
[file delivery](files.md#receive-one-packet) for destination requirements.

### Choose the next action

| Observed fact | Next step |
| --- | --- |
| The method returns `blocked` or `limit` | Read its output and reason before choosing further work. |
| `REVIEW_REQUIRED` | Review the changed execution environment. Inspect the proposal. Approve the revision before explicitly starting a new Run. |
| An input mismatch | Compare your input with the approved schema using `jig inspect <target>`. |
| Failure with retained diagnostics | Read the reported cause and inspect any effects before starting new work. |
| Missing terminal, uncertain effects or unconfirmed cleanup | Preserve the evidence and settle owned work before another action. |
| A selected Agent prerequisite stops review | Follow [client-check recovery](agents.md#repair-a-client-check). |

These steps do not grant authority to replay work. Cancellation cannot reverse a
completed consequence or retract an accepted remote request.

### Check the approved target and input

Use `jig inspect` to list targets in the last approved revision. Use
`jig inspect <target>` to read its contract, settings, slots, grants and
attachments. The contract includes input, outcomes and channels. The terminal
starts with required input fields, placeholder paths and channel requirements.
`--json` or redirected stdout returns JSON. Replace example placeholders with
data that satisfies the complete schema.

Jig does not guess values or choose a target for you.

Inspection compares approved execution identities with the current local
environment, including selected children. Its `state` is:

| State | Meaning |
| --- | --- |
| `environment-matches` | The compared local identities match. |
| `review-required` | A known mismatch requires review. |
| `unchecked` | Comparison could not complete, including missing Agent configuration. |
| `unreviewed` | No local approval exists, even if a portable lock exists. |

Snapshot reads return exit 0 even when review is required. Scripts must examine
`state`. Inspection performs no provider requests, source evaluation, dependency
preparation, state recovery or approval. Matching identities do not establish
source freshness, launch readiness or remote availability. Run still revalidates
before execution. Inspection retains an approved review-client selection and its
origin.

See [client selection](agents.md#switching) for its review-only scope.

An input mismatch uses the approved schema. If you changed source or schemas,
review and approve those changes first. If the approved schema is correct, fix
the input. For an `enum` error, use one of the declared values. Type errors
report expected and received JSON types without printing rejected values. For
example, `Expected string; received object.` requires a JSON string rather than
an object.

Use `jig <command> --help` for syntax and examples. Errors identify a
project-relative location when available and suggest a safe next step. See
[entrypoint configuration](configuration.md#project-entrypoint) for target
selection.

### Read diagnostics and machine output

Use `--json` for raw records in a terminal. Redirected stdout contains JSON, or
NDJSON with `--receive`. Stderr carries diagnostics and terminal progress. With
`--receive`, live channel text uses labelled headings. Channel completion does
not establish execution or application success.

`runDiagnostics` retains bounded root and child stderr. Each entry's
`operations` path identifies its emitter. Check aggregate `truncated` and
per-entry `stderrTruncated` before treating it as complete. The separate
`diagnostics` field describes root-process stderr only. Neither field is an
Agent answer or proof of task success.

The terminal groups unseen diagnostics by invocation and discloses truncation.
It counts text already printed live rather than printing it again. Collapsed TUI
Activity entries may still contain unread text. Full bounded evidence remains
available in the final result. A null checkpoint means no progress was retained.
The terminal omits it, while the machine record keeps it.

See [workspace controls](channels.md#observe-the-work) for expanded reports and
inspection. See [terminal appearance](configuration.md#terminal-appearance) for
colors and plain output. The
[CLI experience contract](https://jig.md/spec/cli-experience.md) defines exact presentation
requirements.

### Handle interruption

Ctrl-C requests cancellation. Wait for cleanup before starting new work. When an
authoritative terminal is available, Jig preserves its execution status, adds
`command: {status: 'interrupted'}` and exits 2. Completion may have won the race
before cancellation. An interrupted command can exit without JSON when no
terminal or output connection remains. Scripts must handle that absence without
automatic replay.

## Recover from execution failure

A `REVIEW_REQUIRED` diagnostic means the current execution environment differs
from the approved revision. No Flow started for that Run. Run `jig review`,
inspect and approve the proposed revision, then explicitly start a new Run. A
Jig rebuild, runtime change, Agent configuration change, or changed sandbox
support can require review even when your project source is unchanged. In
machine output this is host-only `code: "REVIEW_REQUIRED"` with
`details.reason: "EXECUTION_ENVIRONMENT_CHANGED"` and
`details.flowStarted: false`. Review distinguishes environment-only changes from
source, prepared dependency, and permission changes.

The retained combined fingerprint does not identify which individual historical
component changed. Review states this evidence limit.

An `EXECUTION_FAILED` result with no captured diagnostic text does not establish
whether the Flow started. The public result contains no more specific cause.
Keep the command and diagnostic code for investigation and inspect any effects
before starting new work.

A `DEADLINE_EXCEEDED` result for a contained HTTP request or Project Command may
name the worker phase. It may identify which configured limit capped the
effective deadline: root Run, parent Flow, HTTP grant, or Project Command limit.
This identifies the work and budget involved. It does not prove whether a remote
request was accepted or whether a command had side effects. Inspect retained
evidence before starting a new Run. Increasing `--timeout` helps only when the
root Run was the limiting budget and the work can finish within the other
limits.

The diagnostic instead says the operation was not dispatched when both
conditions apply:

- The effective deadline elapsed before dispatch.
- Jig has no unresolved owner for an earlier attempt with the same operation ID.
  A retry with a retained prior owner is reported as uncertain after Jig settles
  that owner. A deadline after launch also retains the uncertainty warning and
  the host's collected cleanup evidence.

A protocol error means the Flow did not complete Run/0 correctly. Check its SDK
revision and stdout use. Inspect the result and any effects before running
again. After changing source or dependencies, review the changes first.

`INVALID_RESULT` can mean that a Flow's final value failed its declared contract
or that a method rejected a result from one of its operations. Read the reported
cause before changing a schema. For example, an Agent method can reject an HTTP
provider response while the Flow's own result contract is unchanged.

## Reopen a saved result

```sh
jig inspect --result ./result-packet --display tui
jig inspect --result ./result-packet --display web
```

This opens **Recorded result**, **Files** and **Diagnostics** without starting a
Run, reading project authority or contacting providers. Omit `--display` for a
plain report. `--json` or redirected stdout returns the decoded report
unchanged. The directory you select supplies the evidence. A recorded
destination inside `result.json` does not redirect inspection elsewhere.

Saved values are recorded local claims, not newly authenticated execution facts.
File previews use immutable captured bytes checked against the saved manifest.
Matching digests establish consistency with that manifest. Missing or mismatched
files are reported, while already verified previews remain available. Live Flow
tabs and call history are not retained in current packets and are not
reconstructed. The TUI inspector asks before leaving with `q` or keyboard
Ctrl-C, with **Stay** selected.

Escape returns within the TUI. Inspection remains subject to any explicit
enclosing command limit. Input/output failure or external interruption also
closes it and releases its retained evidence. For web, open the private link
printed on terminal stderr and choose **Close inspection** to leave. Browser
disconnection does not cancel or close it. Selecting a captured file shows its
contents.

PNG, JPEG and supported SVG files show an image preview in the browser and
coloured blocks in the TUI. SVG previews use a bundled font and may differ from
the original typography. Images above the preview limits remain available in the
result packet. Empty, non-text, unavailable and clipped files have distinct
explanations. Expanded search covers the retained excerpt, not bytes outside it.
Saved values keep their recorded provenance.

Exit 0 means the saved report and files were read consistently, even if that
report records a failed Run. Exit 1 means invalid or unavailable evidence,
incomplete file verification, or output failure. Exit 2 means external
interruption. Always examine the recorded execution and application outcome
before deciding what to do.

## Reopen application views

An application can explicitly deliver a final display bundle for local retention.
This is separate from a saved Run packet and optional live observation.
The source candidate uses ordinary semantic views with stable definition and instance keys.
See [final bundle authoring](https://jig.md/spec/display-archive.md#select-final-material) before selecting publication.

```sh
jig views context --json
jig run --display-bundle files=display.json
jig views list --definition photos --instance family-2025 --display web
```

Pass the context to your application through its ordinary declared input or read attachment.
Its helper derives revision checks rather than asking authors to assign concurrency tokens.
The operator selects one declared output file, which requires verified final delivery.
Checkpoint-only output and the last live snapshot cannot publish a final edition.

Retained views contain application-selected material and exact captured evidence when available.
They show no invented call history, activity or execution duration.
Completeness and domain revision remain application claims.
Currency is unknown without a current application revision.
Closing inspection releases presentation captures while keeping the retained edition.

When publication is unconfirmed, recover its original receipt before deciding to publish again:

```sh
jig views receipt --request PUBLICATION_ID --generation ARCHIVE_GENERATION --json
```

An accepted duplicate returns its original receipt and provenance without reinstalling removed views.
Generation-checked removal and reset require explicit current conditions.
The [archive contract](https://jig.md/spec/display-archive.md) defines capacity, evidence and recovery limits.

## If retained state cannot be opened

`PROJECT_STATE_INVALID` means `.jig` is incompatible with the current build or
damaged. Reinstalling dependencies does not change that state. Preserve `.jig`
and `jig.lock` for recovery. Once prior work is confirmed stopped and cleaned
up, move them outside the project and run `jig review` for fresh approval. Keep
the source and dependency locks. If cleanup is uncertain, recover the owned work
before replacing its state.
