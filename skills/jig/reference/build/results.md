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
[file delivery](files.md#receive-one-packet) for destination requirements.

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

See [client selection](agents.md#switching) for its review-only scope.

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

See [workspace controls](channels.md#observe-the-work) for expanded reports and
inspection. See [terminal appearance](../reference/configuration.md#terminal-appearance) for
colors and plain output. The
[CLI experience contract](https://jig.md/spec/cli-experience.md) defines exact presentation
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

From an invocation opened through **Application map** or **Execution**, select **Copy investigation brief**.
Paste the plain text into a coding-agent request and add your own question.
The brief includes the Run root, caller, slot, original operation, observed state, and any available application outcome.
It includes the configured target only when Jig matches the invocation to the admitted configuration.
It states when correspondence is unavailable or the Run omitted observations.

The brief gives you a topology command focused on the exact Run root when it can copy that selector safely.
If it cannot, use the supplied `jig inspect --flow --topology --all` command.
Find the caller and slot in the topology, then check the corresponding source in your current project.
The brief does not derive a target selector from a label or opaque identity.
Copy requires a current observation and clipboard access in your browser.

To hand off a configured route, select its caller in **Application map**.
Under **Configured calls**, select **Copy route brief** beside the slot.
The brief gives the configured route from the Run root and the count of matching retained requests, including zero.
It describes gaps in the retained observations. Check the caller source to learn when it makes the call.

Counts cover retained observations only.
A component without observed calls may still have executed when observations are incomplete.
Missing ancestry and conflicting identities remain unmatched rather than being assigned by name.
The invocation view retains those calls for inspection.

The map has [fixed display limits](../reference/limits.md#inspect-application-composition).
An oversized composition becomes explicitly unavailable without changing execution.
Use [saved child calls](#inspect-saved-child-calls) to reopen opted-in call evidence.

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

Enter JSON input or select **Load input JSON file** to reuse a local fixture.
Review or edit the draft, then select **Run workflow**.
Jig validates the input and rechecks the approved revision before starting the ordinary Run.
Runs use the workflow's approved powers and can produce its normal effects.
Select **Open run** to inspect live behavior, application views, calls, and delivered evidence in another tab.
The explorer keeps your draft for the next explicit invocation.

After a local `jig review`, refresh the explorer to see the new approval.
Choose **Reuse previous input** to reload the last accepted JSON and uploads for matching read attachments.
Review the input and file choices, then select **Run workflow** to execute under the new approval.
Open **Compare last two Runs** to see each approval and compare observed call paths, outcomes, and counts.
The input comparison covers your submitted JSON and uploads. Reviewed attachments belong to their respective approvals.

This tab retains up to 16 input drafts within 16 MiB.
Larger drafts stay visible but may be cleared when you choose another workflow.
The file picker accepts one UTF-8 file up to 16 MiB and keeps the current draft if it cannot load the file.

If input is invalid, correct the displayed problem before submitting.
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

The [web display contract](https://jig.md/spec/web-display.md#project-exploration-before-execution) records fixed bounds and the distinction between project control and Run observation.

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
files are reported, while already verified previews remain available.
The TUI inspector asks before leaving with `q` or keyboard
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


### Inspect saved child calls

Use `jig run ... --record-calls --json` to read observed calls in the result's `callEvidence` field.
The field is optional. Check its coverage before using it in a test.
For a result-only target, you can read this evidence without creating a packet directory.

If the combined result exceeds JSON limits, Jig omits the requested evidence and reports `JIG_REPORT_LIMIT` on stderr.
The ordinary result and exit status stay unchanged.
Missing evidence does not prove that no child calls occurred.
Repeating the command starts new work.

To keep evidence for later inspection, select a fresh result packet.

```sh
jig run binding:code --attach source=fixtures/known --record-calls --out ./import-result
jig inspect --result ./import-result --calls
```

This example uses the Contact Import application's code Binding.
The record shows the reader, mapper, converter and exporter calls with their returned outcomes.
Copy the packet to reopen the same evidence after the source changes.

Use either record to assert the caller, slot, target and outcome.
Check that `coverage` is `complete` before asserting that Jig observed no call through a slot.
An earlier branch or a missing observation can both leave a slot absent.
See the [saved call contract](https://jig.md/spec/cli-experience.md#saved-child-calls) for coverage and exit codes.

### Compare two saved Runs

Save each Run with `--record-calls` and its own fresh `--out` directory.
After both Runs exit, pass the two packets in order from any directory, including outside the project.

```sh
jig inspect --result ./before --compare ./after --display web
```

Use **Close inspection** to end the local browser session and print the comparison in the terminal.
Omit `--display web` for the plain comparison. Both displays read the same recorded claims.

The comparison shows each recorded Run and approved revision.
For the same root, caller and slot, it matches the full recorded chain of ancestor slots and targets.
It shows differing observations first, then matching observations, with counts by target, state and outcome.
With incomplete coverage, a missing row says “No retained match.”
The browser gives nonmatching paths priority within its bounded comparison.
A displayed row counts all retained observations on that path.
The browser reports omitted paths separately from incomplete Run recording.

The comparison uses the recorded JSON input identity and submitted attachment manifest.
It reports whether the recorded identity is the same, different, or unknown when either record is missing or malformed.
The match covers submitted data only. Configured Binding files and other Run conditions are outside the comparison.

For a Node integration test, request the same bounded path comparison as JSON.

```sh
jig inspect --result ./before --compare ./after --json
```

Check the command exit status before asserting the changed and preserved paths.
Use the root, ancestor slots and targets, caller and slot to select a row.
Check each side's target, state, outcome and count. `matches` describes retained observations.

`submittedIdentity` and `approvedRevision` report independent relations.
If the output omits paths or the call coverage is incomplete, the command exits 1.
See the [exact comparison contract](https://jig.md/spec/cli-experience.md#saved-child-calls).

Use `jig inspect --result DIR --calls` for the full call record of either Run.
The comparison only reads the two saved packets.

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

For an unconfirmed publication, follow [receipt recovery](../reference/troubleshooting.md#view-publication-is-unconfirmed).
Generation-checked removal and reset require explicit current conditions.
The [archive contract](https://jig.md/spec/display-archive.md) defines capacity, evidence and recovery limits.

## Check working composition

Run `jig check` from the project root before requesting review.
Jig uses installed dependencies to evaluate project declarations in containment and link the complete working configuration.
This check works before the first approval.

Run `jig check --diff` to compare the working configuration with the last local approval.
Look for the changed caller slots and any added or removed targets.
Add `--json` to read exact change records in a script.
Without a retained approval, use `jig check` to confirm that the working configuration links.

The comparison covers configured selectors, slots, settings, and the entrypoint target.
Review still establishes authority for the changed project. Use source inspection and application tests to check behavior.
The [CLI contract](https://jig.md/spec/cli-experience.md#composition-check) defines the JSON fields and exit status.

## Inspect configured topology

Use `jig inspect --flow --topology` to see the current composition graph without prior approval.
The Markdown graph distinguishes Bindings, direct Flows, caller slots, and resources.
It shows available calls, without establishing execution order, conditions, or caller reactions.

Focus on a target to retain its callers, their other slots, and other configured uses of its package.
The target and its shared uses retain their downstream connections.
Caller paths remain visible up to independent roots, so another entrypoint into a shared method is not lost.
Other caller targets are shown without recursively expanding their entire subgraphs.
Connections crossing the view boundary are counted beside each affected target.
In working-tree topology, follow a Binding selector's link to its captured declaration.

For example, focusing on the factory's checked-correction Binding also shows factory, router, and single-pass.
This reveals the caller and other configured routes to investigate before redirecting work.
The method source establishes which condition selects a route and what the caller does after it returns.
Sharing a package does not establish equal behavior. Bindings retain their individual settings and routes.

The entrypoint selects the default root when no target is supplied.
Without an entrypoint, the graph includes the captured target inventory. Excluded targets and connections are counted.

```sh
jig inspect --flow --topology
jig inspect --flow binding:repair
jig inspect --flow --approved
jig inspect --flow --json
```

`--approved` selects retained authorized configuration instead of current source.
Working-tree inspection evaluates captured declarations through containment. It does not invoke methods, install dependencies, approve work, or write project state.
Declared npm dependencies must already be installed. Their manifest and lock agreement remains unchecked.

An Agent resource can remain unselected while inspecting. Choose its native client during review.
Inspection checks the project's declared Jig version before evaluating declarations.

## Inspect source behavior

When you know a step by name or purpose, start with the owner's words.

```sh
jig inspect --flow --find export
```

The lookup matches configured slot names, destination selectors, package paths, and Flow descriptions.
Spaces can stand for hyphens or underscores in configured names. Results show the exact configured names.
If there are no matches, retry with one word from the request.

Find the caller and slot in **Configured handoffs**.
Check the shared destinations for other caller slots and independent Runs that use them.
Open the caller's source links to read its decision, or run the focused inspection command.

Quoted slot references give text locations. Read the caller's code to determine which conditions reach the call.
Use Run results to verify observed behavior.

To look up a phrase in the last locally approved configuration, add `--approved`.

```sh
jig inspect --flow --find export --approved
```

This view shows retained descriptions and configured routes without evaluating current declarations.
It identifies the approved revision and leaves current source and environment unchecked.
Its focused commands also select the last locally approved configuration. Use the working-tree lookup above for current source links and quoted slot references.

Prepare the application map before changing a conditional route.

```sh
jig inspect --flow --all
jig inspect --flow
jig inspect --flow binding:code
jig inspect --flow bindings/code.ts
jig inspect --flow flows/import
jig inspect --flow flows/convert/FLOW.ts
```

The application overview leads with the declared entrypoint and its configured handoffs.
The inventory includes independent direct Flows and configured Bindings.
Follow an overview link to see a Flow chart or a specific configured use.
Each configured use keeps its own conditions, child results, and caller continuations.

In a project without an entrypoint, `jig inspect --flow` lists targets by package with their configured slots.
Run a target's command from that index to inspect its behavior, or add `--all` for the full application map.

When you select a Binding, its declaration, independent Run selector, and configured caller slots are grouped in the opening.
Other configured uses of the same Flow include their own callers and relevant settings differences.
Use these connections to locate the right handoff before changing a shared implementation.

Follow **Captured entry source** to the file Jig starts for the selected Flow or Binding.
Incoming decisions can link the entry files of different configured targets at the same slot.

Caller decisions show where `run.call` gets its request metadata and its child input.
A displayed call label comes from `intent` on the request.

A direct Flow report can show its required input fields and modeled direct returns beside the selector.
Read **Where callers act on this result** to see what each configured caller does with the result.
A modeled path can show the next Flow's result and the caller's own return together.

Read **Caller decisions** to compare supported source locations for the same slot.
The group shows differing literal fields and conditions that help distinguish the calls.
The decision shows where the caller chooses a slot and where its helper sends the request.
Conditional argument fields show how two calls through the same slot can differ.
Other slots that use the same Flow show which callers can share the effect of an implementation change.

In **Incoming caller decisions**, other configured uses of the caller's code show how that same slot is wired elsewhere.
Check those uses before changing the caller's source. A Binding's slot selection applies to every call through that slot in that use.

The opening view can flag a relative runtime import that leaves the Flow package.
Use the source location and any matching configured slots to find the owning package.
For shared code, declare a dependency. Review checks supported imports against the captured Run files.

Pass the package path directly or with `--package` to see every configured use and its direct caller slots.
This works for packages that require a Binding. The report shows settings that differ across uses and adds source locations where available.
Pass a project-relative Flow file path to open its sole configured target or list the uses of its package.
In working-tree inspection, a Binding declaration path opens that exact configured use.

For an unknown path or selector, run `jig inspect --flow --topology --all` to see the available targets and packages.
Add `--approved` to inspect the retained configuration.
Use the command under a configured use to open its focused report.

When analysis stops early, caller source references can point to literal slots and computed slot expressions.
Use computed expressions to find where the caller chooses its slot.
For supported literal lookups, the report shows the configured destinations, the key sources, and related early returns.
Use an exact project-relative package path or an installed `npm:` package selector.
Select a listed target for its behavior, or add `--json` to get the exact configuration records.

The consequences list calls, requested progress, and attempted file writes.

The diagram labels the conditions that select each route.
Direct validation guards can show which route passes or rejects the check.
**Source checks** shows the predicate and whether its result is known on the displayed routes.
**Coverage gaps** identifies unsupported code and analysis limits.

Follow a call link to see the inputs, supported child path, and continuation for that call.
Select another target to inspect it independently.
The configured inventory lists declared outcomes, attachments, and artifact results.

When you need to compare behavior before and after a specific edit, capture a baseline first.

```sh
jig inspect --flow --snapshot > before.json
jig inspect --flow --compare before.json
```

The comparison highlights affected targets, changes to calls and effects, and coverage gaps.
Follow the source reference to investigate a change, such as a request for 4/4 progress on an early-return path.
Calls and effects can appear on only one side when changed conditions prevent a path match.
The summary can show a newly captured call order even when the complete paths cannot be paired.

Add `--all` to compare the full paths.
Inspect an affected target for child-path detail.
Use representative Runs to verify actual outputs, progress, and delivered files.

The result contract checks point out known undeclared outcomes and concrete results that fail the schema.
Other analyzed results can remain readable when the diagram reaches its display limit.

For example, a converted preview can return `needs_mapping` with outcome `done`.
The caller's checks determine whether that preview reaches export.
The view can also describe a supported progress calculation and its requested publication.

An opaque component remains visible in the configured inventory.
The map may show how its caller would respond to a contract outcome or failure.
An effect before an opaque continuation remains visible on the route that reaches it.
Follow reported gaps into source before relying on a continuation.
Use ordinary Runs to verify results, effects, and displayed progress.

The chart can show repeated calls in a supported finite loop.
Follow separate paths to see early stops and shared continuations.
