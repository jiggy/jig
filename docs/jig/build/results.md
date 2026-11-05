---
title: Results
description: Read execution status, application outcomes, delivery, cleanup evidence, and saved results.
---

# Results

Use the result to decide what your application can do next.
Check execution, the method's answer, output delivery, and cleanup separately.
The [quickstart](../start/index.md) shows a successful first invocation.

## Read an execution result

| Fact | Question | Meaning |
| --- | --- | --- |
| Execution status | Did the invocation complete? | The host reports execution, failure or uncertainty. |
| Method outcome and output | Did the method achieve its objective? | A completed method can return `blocked` or `limit`. |
| Delivery, when requested | Did Jig save the result and files? | A result is separate from confirmed packet delivery. |
| Cleanup evidence | Did owned work settle? | Requested cancellation is separate from confirmed cleanup. |

An application field such as `success` is method data. It is not a host verdict.
A successful execution does not prove that the application achieved its
objective.

Human output shows these facts before the application answer.
Small answers appear as YAML.
For large answers in a confirmed packet, read `result.json` for complete output and checkpoint evidence.
If delivery is uncertain, the terminal keeps result evidence visible.

A delivered packet also retains input manifests and digests.
Jig never replaces an existing result directory.

Writable targets receive a fresh temporary packet when `--out` is omitted. The
operating system may clear that storage. Use `--out DIRECTORY` for a new
retained destination. Result-only targets return stdout by default. See
[file delivery](./files.md#receive-one-packet) for destination requirements.

Use [Troubleshooting](../reference/troubleshooting.md) for diagnostic steps and recovery procedures.

## Check the approved target and input

Use `jig inspect` to list targets in the last approved revision.
Use `jig inspect <target>` to read its contract, settings, slots, grants and attachments.
The contract includes input, outcomes and channels.
The terminal starts with required input fields, placeholder paths and channel requirements.
`--json` or redirected stdout returns JSON.

Replace example placeholders with data that satisfies the complete schema.

Jig does not guess values or choose a target for you.

Inspection compares approved execution identities with the current local
environment, including selected children. Its `state` is:

| State | Meaning |
| --- | --- |
| `environment-matches` | The compared local identities match. |
| `review-required` | A known mismatch requires review. |
| `unchecked` | Comparison could not complete, including missing Agent configuration. |
| `unreviewed` | No local approval exists, even if a portable lock exists. |

Snapshot reads return exit 0 even when review is required.
Scripts must examine `state`.
Inspection performs no provider requests, source evaluation, dependency preparation, state recovery or approval.

Matching identities do not establish source freshness, launch readiness or remote availability.
Run still revalidates before execution.
Inspection retains an approved review-client selection and its origin.

See [client selection](./agents.md#switching) for its review-only scope.

For rejected input, follow [input troubleshooting](../reference/troubleshooting.md#input-does-not-match-the-approved-target).
See [entrypoint configuration](../reference/configuration.md#project-entrypoint) for target selection.

## Read diagnostics and machine output

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
It counts text already printed live rather than printing it again.
Collapsed TUI Activity entries may still contain unread text.
Full bounded evidence remains available in the final result.

A null checkpoint means no progress was retained.
The terminal omits it, while the machine record keeps it.

See [workspace controls](./channels.md#observe-the-work) for expanded reports and
inspection. See [terminal appearance](../reference/configuration.md#terminal-appearance) for
colors and plain output. The
[CLI experience contract](../spec/cli-experience.md) defines exact presentation
requirements.

## Follow available and observed calls

Run your approved target with `--display web`, then open the private link printed on terminal stderr.
Application pages remain first when the application supplies them.
Open **Application map** to inspect the selected root and its admitted components.

Connections show which child calls are available to each component.
They do not define execution order or reveal conditions inside a Flow.
Separate Bindings remain separate components, even when they use the same Flow.
Resources appear at the caller's slot, without exposing their settings or grant policies.

Choose a component to inspect its available calls and matched observations.
Open an observed invocation to read its existing call evidence.
Repeated invocations remain separate, with their literal host states.
A returned call does not establish an acceptable application result or a confirmed external consequence.

Counts cover retained observations only.
A component without observed calls may still have executed when observations are incomplete.
Missing ancestry and conflicting identities remain unmatched rather than being assigned by name.
The invocation view retains those calls for inspection.

The map has [fixed display limits](../reference/limits.md#inspect-application-composition).
An oversized composition becomes explicitly unavailable without changing execution.
Saved packets and retained application views do not contain this live composition or its call history.

The browser remains read-only.
Use the map and invocation evidence to identify changes for your codebase.
New test inputs still use ordinary authorized invocations outside the inspector.

## Read an interrupted result

After interruption, Jig preserves an available authoritative terminal's execution status.
It adds `command: {status: 'interrupted'}` and exits 2.
Completion may have won the race before cancellation.
An interrupted command can exit without JSON when no terminal or output connection remains.
Scripts must handle that absence without automatic replay.
Follow [interruption recovery](../reference/troubleshooting.md#execution-is-interrupted) before deciding on further work.

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
See [final bundle authoring](../spec/display-archive.md#select-final-material) before selecting publication.

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

For an unconfirmed publication, follow [receipt recovery](../reference/troubleshooting.md#view-publication-is-unconfirmed).
Generation-checked removal and reset require explicit current conditions.
The [archive contract](../spec/display-archive.md) defines capacity, evidence and recovery limits.
