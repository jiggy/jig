# User updates

Install this package with its exact `@jigging/flow` peer. The publisher and caller
must share the public SDK's error class and writer implementation; a peer prevents
an independently resolved SDK copy from changing error identity.

Let a Flow report what it is doing while its application result remains the
authority for the outcome. This optional profile uses ordinary FLOW channels.
The provisional agreement is `https://jig.md/contracts/user-updates`, version
`0.1.0`. Its descriptor is exported as `@jigging/user-updates/user-updates.json`;
copy that file with the package's MPL-2.0 license when sharing it with another host.
The identifier is never fetched during execution.

Import the agreement once, declare an optional output, and use one scope:

```sh
mkdir -p contracts
jig import-contract jig:user-updates contracts/user-updates
```

Put the optional channel in `FLOW.contract.json` (create this descriptor if absent):

```json
{"$schema":"https://flow.jig.md/schemas/invocation-contract-0.schema.json","channels":{"updates":{"direction":"send","required":false,"contract":"./contracts/user-updates/user-updates.json"}}}
```

```ts
import { handle } from '@jigging/flow'
import { withUserUpdates } from '@jigging/user-updates'

handle(run => withUserUpdates(run, 'updates', async updates => {
  updates.activity('files', 'Checking files', { completed: 0, total: 3, unit: 'files' })
  // Perform the application's checks, updating the complete snapshot as needed.
  updates.notice('The file checks have ended.')
  updates.clear('files')
  return { outcome: 'done', output: { files: 3 } }
}))
```

Use `jig run <target> --receive updates` to expose ordinary selected-channel
records. Explicit reception retains existing stdout JSON/NDJSON and human
channel behavior. Automatic terminal observation is separately qualified by Jig;
it is not a power granted by this library.

`notice(text, severity?)` appends one complete message (multiline allowed).
Severity is `info` (default), `warning` or `error`; it reports the author's importance
classification, without changing ordering, limits or delivery guarantees. Report
blocking problems immediately and retain them in the final result as well. `activity(id,
label, progress?)` replaces a transient slot's entire state; omitted progress
removes the old count. `clear(id)` removes the slot, with unknown IDs harmless.
Progress counts may decrease or change units; 100%, clearing and EOF never mean
execution success. Consumers must retire all a source's activities on every end.
The exported `validateUserUpdate` returns an immutable snapshot for independent
consumers and enforces semantic rules beyond the descriptor's schema. Browser
consumers can import the same validator, portable message types, canonicalization
and limits from `@jigging/user-updates/validation`. This entry uses standard
JavaScript primitives and imports no publisher, FLOW runtime or Node APIs;
contract identity and publication remain available from the main entry.

The scope owns its sender exclusively: do not send, close, transfer or wrap that
writer independently. Missing observation is allowed. Invalid offers throw even
when unwired; offers after body exit throw. Adjacent unsent activities or views with
the same ID may coalesce; notices, clears and retirements preserve order. Publication is bounded
to 16 retained items/256 KiB, 16 slots, 128 notices/512 KiB, 4096 attempts/4 MiB,
five sends per second, and 32 KiB per item. Local send wait is 500 ms; the aggregate best-effort drain allowance
is 4000 ms from body exit. Drained or unwired scopes add no waiting period. A full
queue can drain with prompt acknowledgements; slow receivers may still lose
updates. The Run deadline remains authoritative and can expire during drain. Exceeding those budgets stops optional publication. Original sends
and close operations still settle before the scope returns, so cleanup can take
longer. Observer LAGGED/DISCONNECTED can degrade; unexpected publication errors
and root cancellation remain errors. A body error stays primary, with a bounded
secondary publisher diagnostic.

Children use separate channels. Parents validate and summarize deliberately,
own their receivers, map child occurrences to fresh IDs, and stop relay callbacks
before ordered clears. Shared publisher budgets can stop healthy siblings.
Do not reinterpret ACP fragments or plans as complete notices or measured counts.
Keep important domain warnings and evidence in the final result or artifacts too.

## Read-only application views

The same optional writer can publish domain views. A view needs one local handle
and complete snapshots; it adds no channel or Flow configuration:

```ts
const jobs = updates.view('jobs', { title: 'Jobs', landing: true })
jobs.update({
  summary: 'Checking two requested repairs; changes need human review.',
  sections: [{ blocks: [{
    kind: 'collection', id: 'jobs', title: 'Requested repairs',
    columns: [
      { key: 'name', label: 'Job', type: 'text' },
      { key: 'call', label: 'Execution', type: 'reference' },
    ],
    rows: [{ id: 'timesheet', cells: {
      name: 'Correct weekly totals',
      call: { kind: 'call', operationId: 'repair:timesheet' },
    }, details: [{ kind: 'report', text: 'Check totals against the supplied cases.' }] }],
    total: 2,
  }] }],
})
```

Jig's inline display shows the root's landing view. `jig run --display tui`
opens a keyboard inspector with multiple views, collections, filtering, sorting,
row details and verified file previews. `--display plain` emits complete changed
summaries. `--json` or effective `--receive` keeps existing exact output and
turns off automatic Flow observations. No view controls execution.

`updates.view(id, {title, landing?, operationId?})` creates a local handle without
sending. `handle.update({title?, summary, sections})` validates synchronously,
including when unwired, and offers a whole replacement. `handle.retire()` removes
an offered view once; repeated retirement is harmless. Never reuse an ID in one
scope. Updating after retirement or scope exit throws. At most 16 handles may be
claimed per scope. A changed title can be supplied with the snapshot.

Sections have optional titles and blocks. The four block kinds are:

- `report`: literal `text` and optional `references`.
- `facts`: `items` of `{label, value}`.
- `progress`: `label`, `completed`, optional `total` and `unit`. An unknown or zero
  denominator shows counts without a percentage.
- `collection`: stable `id`, `title`, typed `columns`, `rows`, optional reported
  `total`. Each row has `id`, exactly the column keys in `cells`, and optional
  `details` made of reports, facts or progress. Collections cannot nest.

Column types are `text`, `number`, `boolean`, `reference`. Null means unknown.
Values are finite JSON/0 numbers (integral values must be safe integers), strings,
booleans, null, or closed references:
`{kind:'record', viewId, collectionId, rowId}`, `{kind:'call', operationId}`, or
`{kind:'artifact', attachment, path}`. References resolve only in the actual
publisher's namespace. Missing targets remain unavailable and may resolve later;
they never create speculative calls or grant file access. Artifact references
name declared output attachments and safe relative paths. Previews require
verified delivered bytes; mutable destination files are never reopened as evidence.

One item is at most 32 KiB. A view has at most 8 sections, 32 blocks including
row details, 128 rows, 8 columns per collection, 1024 cells, 8 detail blocks per
row, 32 facts per block and 8 references per report. IDs and column keys have
1–64 Unicode scalars; titles/labels 1–128; summaries 1–1024; report/text values
0–4096; units 1–32. IDs, keys, titles, labels and units are single-line.
Collections have unique IDs per view, unique column keys and unique row IDs.
Reported total cannot be less than supplied rows. The exported types describe
all records; `validateUserUpdate` also enforces cross-field and aggregate limits.

Source EOF removes activities and freezes views with observation-ended context;
lost or invalid observation marks them incomplete. Ending observation, a count,
a status string or a returned call never establishes application success.
Important blocking causes belong in notices and final evidence, even if a view
also contains them. Only adjacent unsent replacements of the same view/activity
coalesce. Notices, removals and in-flight sends remain ordering barriers.

Use ordinary pure functions to build domain blocks. Children need explicitly
owned channels and deliberate validated relays; a parent remaps IDs/references
into its own namespace and strips child landing hints. There are no executable
widgets, layout callbacks, arbitrary links or execution-changing controls.
