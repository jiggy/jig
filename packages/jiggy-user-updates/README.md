# Python user updates

Report complete notices and replace transient activity while a Flow works:

```python
from jiggy.flow import handle, RunResult
from jiggy.user_updates import user_updates

async def run(context):
    async with user_updates(context, "updates") as updates:
        updates.activity("files", "Checking files", {"completed": 0, "total": 3, "unit": "files"})
        # Perform the application's checks here.
        updates.notice("The file checks have ended.")
        updates.clear("files")
        return RunResult(outcome="done", output={"files": 3})

handle(run)
```

Create the `contracts` parent directory, import the agreement with `jig import-contract jig:user-updates
contracts/user-updates`, then declare an optional send channel:
`{"$schema":"https://flow.jig.md/schemas/invocation-contract-0.schema.json","channels":{"updates":{"direction":"send","required":false,"contract":"./contracts/user-updates/user-updates.json"}}}`
in `FLOW.contract.json` (create this descriptor if absent).
Use `--receive updates` for explicit observation. The exact same provisional
`0.1.0` agreement is also bundled as `jiggy.user_updates/user-updates.json`;
share its MPL-2.0 license when copying it to other hosts. Identity is derived
from the descriptor, with no runtime network fetch.

Offers validate and snapshot even without an observer. The scope exclusively
owns its writer; do not send, close, transfer or wrap it independently. Adjacent
unsent activities may coalesce; notices and clears preserve order. Activity fully
replaces the label and optional count, which may decrease or change units. Clear
and source ending remove transient state. Notices, counts and even 100% never
establish execution success. Keep essential evidence in results or artifacts.

The publisher bounds retained messages (16/256 KiB), active IDs (16), notices
(128/512 KiB), attempts/traffic (4096/4 MiB), item size (32 KiB) and rate (5/s).
Local send wait is 500 ms; aggregate best-effort drain allows 4000 ms from body
exit. Drained or unwired scopes add no waiting period. Prompt acknowledgements
allow a full backlog to drain; slower receivers may still lose updates. The Run
deadline remains authoritative and can expire during drain. Local overflow or timeout
stops observation; original sends and close still settle before scope exit,
which may therefore take longer. Observer LAGGED/DISCONNECTED may degrade.
Unexpected publication errors remain errors; application exceptions remain
primary with a bounded secondary diagnostic. Cancellation stops publication and
joins owned operations while the SDK keeps ownership of retained wire requests.

Parents explicitly validate/summarize child observations and own their receivers.
Give each child occurrence fresh IDs and fence relays before ordered clears.
Shared budgets can stop healthy siblings. ACP fragments and plans have a
separate contract; this helper does not convert them.

`updates.notice(text, severity="error")` reports an important application error.
Severity is info (default), warning or error. It changes prominence, not ordering,
limits, delivery or cancellation. Keep essential failure reasons in results too.

## Read-only views

Use the same scope for domain views:

```python
jobs = updates.view('jobs', {'title': 'Jobs', 'landing': True})
jobs.update({
    'summary': 'Checking the supplied matters; human review is required.',
    'sections': [{'blocks': [{
        'kind': 'collection', 'id': 'matters', 'title': 'Matters',
        'columns': [{'key': 'name', 'label': 'Matter', 'type': 'text'}],
        'rows': [{'id': 'm1', 'cells': {'name': 'Document review'},
                  'details': [{'kind': 'report', 'text': 'Compare the supplied documents.'}]}],
    }]}],
})
```

`view(id, options)` claims one local handle; it sends nothing until `update`.
Updates replace the complete snapshot; optional `title` changes its title.
`retire()` removes an offered view once. Repeated retirement is harmless;
updates after retirement/draining and ID reuse throw. At most 16 handles belong
to one scope. Valid disabled offers are no-ops; invalid offers still throw.

Sections contain reports (`text`, optional `references`), facts (`items` of
`label`/`value`), progress (`label`, `completed`, optional `total`/`unit`) and
collections (`id`, `title`, typed `columns`, `rows`, optional reported `total`).
Rows have stable `id`, exact column keys in `cells`, optional non-collection
`details`. Column types are text, number, boolean and reference; null is unknown.
References are closed record (`viewId`, `collectionId`, `rowId`), call
(`operationId`) or artifact (`attachment`, safe relative `path`) objects with
`kind`. All resolve only in the actual publisher namespace. A missing target
stays unavailable; previews require immutable verified delivery evidence.

`jig run --display dashboard` opens the read-only keyboard inspector;
`--display plain` emits complete changed summaries. Automatic display yields to
`--json` and effective `--receive`. Source EOF freezes views with ended context,
while abnormal endings mark them incomplete. Domain statuses do not establish
host execution or application success. Report blocking causes as notices and
retain them in final evidence too.

The same descriptor limits apply in both languages: 32 KiB per item; 8 sections,
32 total blocks including details, 128 rows, 8 columns per collection, 1024
cells, 8 details per row, 32 facts per block and 8 references per report. IDs and
keys have 1–64 Unicode scalars, titles/labels 1–128, summaries 1–1024, report/text
values 0–4096, units 1–32. IDs, titles, keys, labels and units are single-line.
Counts are safe nonnegative integers with completed <= total; collection total
never undercounts supplied rows. Only consecutive unsent replacements of the
same view/activity coalesce; notices and removals are barriers. No executable
content or execution-changing action crosses this contract.
