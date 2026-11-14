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

Observed connections receive emphasis, and components and slots show mixed states such as **2 returned · 1 failed**.
Select **Active** to locate active requests or **Needs attention** to locate failed or uncertain requests.
The complete map stays visible and keeps its position as observations change.
Requested cancellation retains its own state without becoming an inferred failure.

An invocation's **Reported views** opens material published by that exact child, when its identity is available.
Read the complete view, then return to the invocation and selected component.
Unavailable identity and stale observations remain explicit rather than selecting a similarly named view.

Counts cover retained observations only.
A component without observed calls may still have executed when observations are incomplete.
Missing ancestry and conflicting identities remain unmatched rather than being assigned by name.
The invocation view retains those calls for inspection.

The map has [fixed display limits](../reference/limits.md#inspect-application-composition).
An oversized composition becomes explicitly unavailable without changing execution.
Saved packets and retained application views do not contain this live composition or its call history.

The Run inspector remains read-only.
Use the map and invocation evidence to identify changes for your codebase.
Use project exploration to choose another workflow or supply new input.

## Explore before starting a Run

Open your approved project without starting its workflow:

```sh
jig explore
# Start with one selected workflow:
jig explore binding:review
```

Open the private browser link printed in your terminal.
Choose a workflow to see its configured calls and declared input schema.
The map shows approved configuration, with no observed calls until a Run starts.
Use this view to inspect dependencies and decide which component or workflow to exercise.

Enter JSON input, then select **Run workflow**.
Jig validates the input and rechecks the approved revision before starting the ordinary Run.
Runs use the workflow's approved powers and can produce its normal effects.
Select **Open run** to inspect live behavior, application views, calls, and delivered evidence in another tab.
The explorer keeps your draft for the next explicit invocation.

This tab retains up to 16 input drafts within 16 MiB.
Larger drafts stay visible but may be cleared when you choose another workflow.

If input is invalid, correct the displayed problem and submit again.
If approval changes, refresh the explorer before choosing the workflow again.
The explorer never repeats a submission automatically after a lost connection.
An uncertain Run requires inspecting its terminal result and effects before further work.

Review an unreviewed project with `jig review` first.
The browser does not approve source or change grants.
Workflows needing unbound local input files or required channels explain their requirements beside the input editor.
Use ordinary `jig run --attach` or channel invocation for those inputs.
Reviewed file bindings and automatic output packets remain available during browser launches.

One Run belongs to an explorer at a time.
Starting the next Run releases the previous settled inspector.
**Close explorer** stops active owned work and waits for ordinary cleanup in the terminal.
Closing a browser tab alone does not stop that work.
The separate Run inspector's **Close inspection** action still closes only its presentation.

The [web display contract](../spec/web-display.md#project-exploration-before-execution) records fixed bounds and the distinction between project control and Run observation.

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

## Inspect configured topology

Use `jig inspect --flow` to see current configured connections without prior approval.
The Markdown graph distinguishes Bindings, direct Flows, caller slots, and resources.
It shows available calls, without establishing execution order, conditions, or caller reactions.

Focus on a target to retain its callers, their other slots, and other configured uses of its package.
The target and its shared uses retain their downstream connections.
Caller paths remain visible up to independent roots, so another entrypoint into a shared method is not lost.
Other caller targets are shown without recursively expanding their entire subgraphs.
Connections crossing the view boundary are counted beside each affected target.

For example, focusing on the factory's checked-correction Binding also shows factory, router, and single-pass.
This reveals the caller and other configured routes to investigate before redirecting work.
The method source establishes which condition selects a route and what the caller does after it returns.
Sharing a package does not establish equal behavior. Bindings retain their individual settings and routes.

The entrypoint selects the default root when no target is supplied.
Without an entrypoint, the graph includes the captured target inventory. Excluded targets and connections are counted.

```sh
jig inspect --flow
jig inspect --flow binding:repair
jig inspect --flow --approved
jig inspect --flow --json
```

`--approved` selects retained authorized configuration instead of current source.
Working-tree inspection evaluates captured declarations through containment. It does not invoke methods, install dependencies, approve work, or write project state.
Declared npm dependencies must already be installed. Their manifest and lock agreement remains unchecked.

This configured map is a structural aid. It does not supply a behavioral overview or establish the consequences of an edit.
