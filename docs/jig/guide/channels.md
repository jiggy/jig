# Add progress to a Flow

A method can tell its caller what it is doing before its result arrives. Use
complete notices for messages, replaceable activities for current work, and
read-only views for a domain workspace. The
application still checks its result; a count or closed update stream never
establishes success.

## Import one agreement

Declare `@jigging/reporting` alongside `@jigging/flow` in the Flow package's
dependencies. From that package, create a `contracts` directory and import:

```sh
mkdir -p contracts
jig import-contract jig:reporting contracts/reporting
```

The importer copies exact local descriptor bytes and its license, refuses an
existing destination, and runs no package code or network request. Other hosts
can copy the same agreement from the library or its
[download](https://jig.md/contracts/reporting.json), with the accompanying
[MPL-2.0 license](https://jig.md/contracts/reporting/LICENSE).

Add this optional port to `FLOW.contract.json`. If the Flow has no invocation
descriptor yet, create one with the following contents:

```json
{"$schema":"https://flow.jig.md/schemas/invocation-contract-0.schema.json","channels":{"updates":{"direction":"send","required":false,"contract":"./contracts/reporting/reporting.json"}}}
```

The name `updates` is local. No named invocation contract for the whole Flow is
required. Direct delivery is the default; broadcast remains an ordinary choice.
Managed TypeSpec source borrows this exact descriptor; generation preserves its
bytes instead of rebuilding a similar model.

## Publish within the handler

Keep the method's work and checks inside one scope:

```ts
import { withReporting } from '@jigging/reporting'

return withReporting(run, 'updates', async reporter => {
  reporter.activity('check', 'Checking the proposed result')
  const result = await checkProposal()
  reporter.notice('The proposal checks have ended.')
  reporter.clear('check')
  return result
})
```

Here `checkProposal()` is the application's existing procedure returning its
Run result. The scope validates offers, bounds queues, paces publication, and
settles its operations before returning. It owns that writer exclusively; do
not independently send, close, transfer, or wrap it again. Running without an
observer is allowed.
Invalid offers still throw when unwired, and offers after scope exit are errors.

Python uses its independently packaged `jiggy-reporting` helper with the
same descriptor and meanings:

```python
from jiggy.reporting import reporting

async with reporting(run, "updates") as reporter:
    reporter.activity("check", "Checking the proposed result")
    result = await check_proposal()
    reporter.notice("The proposal checks have ended.")
    reporter.clear("check")
    return result
```

`notice(text, severity?)` is one complete message; multiline content is allowed.
Use `info` (default), `warning` or `error` to report importance. For example,
`reporter.notice("Could not start the AI session.", "error")` in TypeScript or
`reporter.notice("Could not start the AI session.", severity="error")` in Python.
Jig prominently labels attributed Flow-reported errors. Severity does not change
ordering, quotas, optional delivery or execution authority. Offer blocking failures
promptly and retain their reasons in final results independently of observation.
`activity(id, label, progress?, {detail?, operationId?})` replaces the complete slot.
The optional detail explains the current procedure; an own-call operation ID
links to host-observed execution without inventing a call or changing its status.
That association stays fixed until `clear(id)`. When moving a shared activity slot
to another call, clear it first or give the new activity its own ID.
Progress has required
`completed`, optional `total`, and optional `unit`, for example
`{completed: 3, total: 8, unit: 'files'}` in TypeScript. Counts may decrease or
change units; omitted progress removes the old count. `clear(id)` is idempotent.
Every source ending removes all its transient activities without decorating them
as successful. Keep essential warnings and outcome evidence in results/artifacts.

Local publication limits, 500 ms send wait or 4000 ms final drain expiry stop
optional observation;
original send and close operations still settle, so cleanup can take longer.
Known observer loss may degrade. Unexpected publisher errors and root cancellation
remain failures. A body error stays primary with a bounded secondary diagnostic.
See [exact bounds and lifecycle](../spec/reporting.md).

## Observe the work

After reviewing the changed source, ordinary `jig run` automatically displays
exactly one optional canonical output on stderr. Suitable terminals default to the
TUI workspace with the actual invocation tree and application views; other terminals
use plain output. Complete notices retain Flow attribution. Plain or redirected
stderr shows meaningful label, title and summary changes without repeating counts.
Stdout remains the ordinary final result. `--updates off` disables automatic
observation; `--json` also disables it, while host diagnostics remain available.

Explicit `--receive updates` exposes the existing selected-channel stdout
presentation or JSON/NDJSON. It takes precedence even when supplied by the approved
project entrypoint; `--updates off` does not cancel that explicit choice. Multiple
canonical ports get one hint instead of a guess. Unsupported contracts remain
ordinary optional channels. NO_COLOR and TERM=dumb alter style, not selection.

Use `jig run --display tui` for a terminal workspace. **Activity** collects
current work and the newest notices first. Setup stages expand from one entry.
**Execution** shows actual calls, opening active or problematic branches and
collapsing returned branches.

You can expand them to see their calls. Your application page composes its
summary and authored sections, retaining records and evidence. Routine
activity history stays collapsed, while attributed causes remain visible
across tabs. `!` opens their full explanation, `d` opens attributed diagnostic
text, and `?` shows contextual help.

Diagnostic text with no structured severity stays unclassified.

Give each child call a short, descriptive `intent` in `run.call(...)`; Execution
uses that supplied label. Without it, the graph shows the reviewed slot name.
Enter on a call shows its original operation ID and host lifecycle.

The terminal renderer is included with Jig. Flows supply semantic reports,
facts, counts and collections. They do not import a UI library or choose
terminal widgets. Your root landing view is the application's main page.

Execution, Activity, Delivered files and child views sit together under
Inspector. Publish the same root view as your application advances or stops,
using a separate presentation module to turn domain state into sections. Keep
each child Flow's own view useful when that Flow is invoked directly. Large
terminals show a navigation rail.

`v` opens the complete view chooser at any size. Compact tables keep records
together. A context pane appears on wide screens only when it adds
information. Enter expands full details.

Tab changes views. Arrows/j/k select records. `c` selects a collection. `/`
edits its filter and `s` changes sorting.

Filter text is literal: Enter applies it and Escape discards the draft. `r`
explicitly selects a reference. Enter then opens the chosen record, call or
verified immutable file preview. When the selected entry has one distinct
artifact reference, its available content is previewed directly.

Multiple references still require a choice. **Delivered files** lists captured
evidence independently of application views. Select a file to read its text or
patch. Size and capture limits stay secondary.

Brackets/Page keys scroll details. Escape returns from a local panel or
record/call reference jump, and stays at the top level. q asks before leaving,
with Stay selected. Confirmed live exit continues work inline.

Ctrl-C requests cancellation and waits for cleanup. After execution, cleanup
and delivery settle, result inspection is read-only. It stays open until you
confirm leaving with q or keyboard Ctrl-C, subject to any explicit enclosing
command limit. Initial input, review, file and runtime refusals stay in
ordinary output. The workspace opens only once root execution begins.

Leaving restores your terminal and prints retained essential causes before the
final result. `--display plain` selects nonanimated presentation. `--json` or
effective `--receive` keeps exact existing output and takes precedence over
the dashboard. The workspace needs terminal input/stderr and at least 18
columns/4 rows.

Smaller terminals release to plain output. Normal panes need 50 columns/14
rows. Ordinary `jig run` selects TUI when input and both output streams are
suitable terminals. Otherwise it uses ordinary output.

NO_COLOR keeps TUI controls without color. Activity is bounded session
history. Omission is disclosed, and result evidence remains separate. Use
[saved-result inspection](results.md#reopen-a-saved-result) to reopen a packet
after the dashboard closes, without starting another Run.

Use `jig run --display web` for the same semantic views in a browser. Jig prints
a private local link after execution starts; open that link yourself. Each tab
keeps its own selection, filters and expanded evidence. **Activity**, **Execution**,
domain views, diagnostics and delivered file contents remain available after
settlement until you choose **Close inspection**. That action closes all viewers
of this command; during execution, work continues in the ordinary transcript.
Closing a browser tab alone does not close inspection or cancel work. Terminal
q/Escape also leaves when Jig owns terminal input; live Ctrl-C still cancels work.

Web needs terminal stderr but accepts piped stdin and redirected Run stdout.
`--json` and `--receive` keep their ordinary machine behavior and take precedence.
`--updates off` leaves host observations and files available without receiving
application views. Reload by opening the original terminal link; the browser
does not retain its private access capability in storage. Keep the link private.
See the [local access and lifetime contract](../spec/web-display.md).

## Give a Flow its own workspace

One declaration and one full snapshot are enough:

```ts
const matters = reporter.view('matters', {
  title: 'Document review', landing: true,
  target: {definitionId: 'document-review', instanceKey: 'case-42', subjectKey: 'case-42'},
})
matters.update({
  summary: 'Review the supplied documents and retain findings for a person to check.',
  sections: [{blocks: [{
    kind: 'collection', id: 'matters', title: 'Supplied matters',
    columns: [{key: 'name', label: 'Matter', type: 'text'}],
    rows: [{id: 'one', cells: {name: 'Lease review'}, details: [{
      kind: 'report', text: 'Check the supplied lease against the requested questions.',
    }]}],
  }]}],
})
```

Use `report`, `facts`, explicit count `progress`, captured `content` and typed `collection` blocks.
Compose your domain helper from ordinary records and pure projection functions.
No terminal code or host adapter is needed. Python exposes the same `reporter.view(id, options)` handle
with `update(snapshot)` and `retire()`.

Every update replaces the whole view atomically. Stable collection/row IDs preserve
selection. Keep essential conclusions in the result and files: optional updates
can stop, and frozen views show when their observation ended.
A handle owns its ID for the scope, and retired IDs cannot be reused.
At most eight views per publisher are retained.

Only one view may offer a landing hint.
The root hint selects the initial surface until the operator chooses.

A target separates the reusable definition from its application instance.
For another document set, keep `definitionId: 'document-review'` and choose another stable `instanceKey`.
Use a shared `subjectKey` when different view definitions describe the same application subject.
These keys help navigation without merging views or changing the actual publisher's identity.
Target, landing hint and call association remain fixed during a view's lifetime.

Authors offer complete snapshots as state changes.
The publisher coalesces superseded updates across views and activities while preserving notice, clear and retirement boundaries.
A view supports up to 1,024 rows and 8,192 cells within its encoded byte bound.
Use `previewCollection` when an explicit bounded excerpt better serves the task.
Its whole rows and shown, total and omitted counts preserve the distinction between retained data and complete data.

Typed references address a current same-publisher record, an actual own call, or a declared file.
For example, `{kind: 'call', operationId: 'check-lease'}` names this publisher's operation.
`{kind: 'artifact', attachment: 'deliverables', path: 'draft.txt'}` names verified delivered output.
`{kind: 'input-artifact', attachment: 'source', path: 'scan.jpg'}` instead names an exact captured input member.
Missing targets remain visibly unavailable, and child-only files require explicit remapping through the parent.
References never execute work, apply a patch, open an external program or grant authority.

Previews and full downloads read immutable captured bytes even if original inputs or delivered destinations later change.
Captured input remains distinct from verified delivery and recorded captures.
A clipped preview never substitutes for a complete file download.
[The web display contract](../spec/web-display.md) defines media bounds, generation checks and Close behavior.

### Show captured media and literal detail

A gallery gives ordinary columns explicit presentation roles:

```ts
const photos = reporter.view('photos', {
  title: 'Photos',
  target: {definitionId: 'photos', instanceKey: 'family-2025', subjectKey: 'family-2025'},
})
photos.update({
  summary: 'Inspect the supplied photographs and their captions.',
  sections: [{blocks: [{
    kind: 'collection', id: 'photographs', title: 'Supplied photographs',
    presentation: {kind: 'gallery', media: 'image', title: 'name', alt: 'caption'},
    columns: [
      {key: 'image', label: 'Image', type: 'reference'},
      {key: 'name', label: 'Name', type: 'text'},
      {key: 'caption', label: 'Caption', type: 'text'},
    ],
    rows: [{id: 'one', cells: {
      image: {kind: 'input-artifact', attachment: 'source', path: 'one.jpg'},
      name: 'Family photograph', caption: 'The supplied group by the lake.',
    }}],
  }]}],
})
```

Every field and supplied row detail remains inspectable.
A content block can feature one captured item with `{kind: 'content', reference, title}`.
Reports accept `format: 'plain'`, `format: 'code'` or `format: 'diff'` to preserve intended literal reading.
These declarations add no markup, browser component or execution callback.
A view may simply present information when its application needs no action.

### Retain an explicit final edition

Live updates remain optional observations.
Use the same application projections in a [final display bundle](../spec/display-archive.md) when the application needs retained views.
The TypeScript and Python helpers derive target revision checks from supplied publication context.
Write the encoded bundle through an ordinary declared output.
The operator selects it with `--display-bundle NAME=FILE`.

Jig accepts the selected edition atomically after verified final delivery.
It never substitutes the last live snapshot or publishes checkpoint-only material as final.
The application owns aggregation and domain state, while each child publisher keeps its original attribution.
Retained views can be read with `jig views` independently of execution history.

For software consumers, use `--receive updates --json`, parse complete stdout
lines as JSON, and keep stderr separate. Read `begin`, ordered `data`, `end`, then
`terminal`. Only `terminal.result` reports the Run outcome. A disconnected stream
or missing terminal is incomplete delivery. Live reporting has no retention or replay.
[Run Checkpoint](../spec/run-checkpoint.md) separately retains settled artifacts.

A simpler string channel with explicit reception remains useful when messages
alone suffice. Raw authors must own validation, optional error handling and
cleanup themselves. The profile's shared replacement/count meaning is useful when
callers need current activity state across implementations; it is not required
for every log or output.

## Connect methods while they work

A parent can create a channel and pass its endpoints to exact child slots.
Each child reads its declared endpoints from `run.channels`. Endpoint transfer
and the child result remain separate operations; await the actual child outcome
rather than treating stream completion as success.

Use a direct channel when one consumer needs the data. Use broadcast only when
independent consumers genuinely need the same stream:

```ts
const events = await run.channel({ delivery: 'broadcast', schema: eventSchema })
const display = await events.subscribe()
const recorder = await events.subscribe()
```

Here `eventSchema` is the application's FLOW Schema/0 item schema. This excerpt
allocates endpoints only: the handler must connect the sender, consume or close
each subscription, and settle owned work. Subscribe before dispatch to receive
the beginning. A slow subscription can fail with `LAGGED` independently of other
consumers. Later subscriptions receive a suffix, without replay.

Two direct channels can support requests and replies. Named contracts establish
item meaning; application code checks correlation and bounds. Each participant
owns one writer. Reply EOF alone does not establish completed work.

See the [channel specification](../spec/channels.md) and
[SDK endpoint lifecycle](https://flow.jig.md/spec/run-sdk#9-channel-projection)
for exact transfer, disposal, and cancellation behavior.

## Observe an Agent directly

When a supported native client supplies public updates, a Flow can connect the
Agent capability's optional `events` writer to a channel using the
[public update contract](../spec/agent-run.md). Filter events inside the Flow
before displaying them; preserve spacing when joining text fragments.
Final-only API clients do not provide this stream.

Observation never authorizes a follow-up turn or changes the Agent's powers.
Settle both the observer and the capability call. Add this capability when live
Agent output is the lesson you need; application phases often suffice.
