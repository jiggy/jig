# Python reporting

Report progress, messages and application views from a Flow.
The same declarations work in terminal and web displays.
Install `jiggy-reporting` with its exact `jiggy-flow` peer.

```python
from jiggy.flow import handle
from jiggy.reporting import reporting

async def run(context):
    async with reporting(context, 'updates') as reporter:
        reporter.activity('files', 'Checking files', {'completed': 0, 'total': 3, 'unit': 'files'})
        # Perform the application's checks here.
        reporter.notice('The file checks have ended.')
        reporter.clear('files')
        return {'outcome': 'done', 'output': {'files': 3}}

handle(run)
```

Create the `contracts` parent directory.
Import the agreement with `jig import-contract jig:reporting contracts/reporting`.
Declare an optional send channel in `FLOW.contract.json`:

```json
{"$schema":"https://flow.jig.md/schemas/invocation-contract-0.schema.json","channels":{"updates":{"direction":"send","required":false,"contract":"./contracts/reporting/reporting.json"}}}
```

Use `--receive updates` for explicit observation.
The provisional `0.1.0` agreement is bundled as `jiggy.reporting/reporting.json`.
Share its MPL-2.0 license when copying it to another host.
Identity is derived from that descriptor without a runtime network fetch.

## Whole application views

Use a small application state and pure projection functions.
The scope owns view handles and publishes complete immutable snapshots of supplied values.
Valid offers remain harmless when no observer is connected.
Invalid offers still raise errors.

```python
photos = reporter.view('family-photos', {
    'title': 'Photos', 'landing': True,
    'target': {'definitionId': 'photos', 'instanceKey': 'family', 'subjectKey': 'family'},
})
photos.update({
    'summary': 'Browse the supplied collection.',
    'sections': [{'blocks': [{
        'kind': 'collection', 'id': 'photos', 'title': 'Originals',
        'presentation': {'kind': 'gallery', 'media': 'image', 'title': 'name', 'alt': 'name'},
        'columns': [
            {'key': 'name', 'label': 'Name', 'type': 'text'},
            {'key': 'image', 'label': 'Image', 'type': 'reference'},
        ],
        'rows': [{'id': 'one', 'cells': {
            'name': 'Lake picnic',
            'image': {'kind': 'input-artifact', 'attachment': 'source', 'path': 'picnic.jpg'},
        }, 'details': [{'kind': 'report', 'text': 'The supplied caption.'}]}],
    }]}],
})
```

`view(id, options)` claims one publisher-local handle without sending a message.
`update(snapshot)` replaces its complete snapshot and may change its title.
`retire()` removes an offered view once.
Repeated retirement is harmless, but retired identifiers never revive.
Each scope can claim sixteen view handles.

The optional target separates a view definition from an application instance.
Its `subjectKey` relates views about the same subject without merging their content.
Targets, landing hints and call associations remain fixed for the handle's lifetime.
Actual publisher identity always comes from the host.

Sections contain reports, facts, progress, collections and captured content.
A report's optional `format` is `plain`, `code` or `diff`.
Literal formats preserve text and grant no executable markup.
A content block contains an artifact reference and optional title.

Collections contain exact typed columns, whole rows and optional row details.
The default presentation is a table.
An explicit gallery names its media column and optional text columns for title, alternative text and description.
Every field remains inspectable, including fields without a visual role.

References identify a record, call, delivered artifact or captured input artifact.
`artifact` and `input-artifact` keep separate provenance and inventories.
References resolve only against their actual publisher's verified captured material.
Unavailable targets remain unavailable instead of resolving against newer or unrelated files.

For larger collections, use `preview_collection(collection, limit=15, complete=reference)`.
It retains whole values within the semantic and byte budgets.
The result includes `collection`, `shown`, `total`, `omitted` and an optional complete-artifact reference.
It never modifies the supplied collection or clips individual cell text.

## Final display bundles

Live reporting is optional observation.
A final bundle explicitly selects a finite edition for retained presentation.
Use the same pure projections for both paths.

```python
from jiggy.reporting import create_display_bundle, encode_display_bundle

bundle = create_display_bundle(context, {
    'requestId': publication_id,
    'edition': album_edition,
    'views': [{'view': final_view, 'completeness': 'complete', 'domainRevision': revision}],
})
document = encode_display_bundle(bundle)
```

The application receives opaque publication context through its ordinary declared input or read attachment.
The helper derives revision conditions, including removed targets' revision fences.
It performs no filesystem operation and assigns no trusted Run provenance.
Write the encoded document through an ordinary declared output.
The operator explicitly selects that output with `--display-bundle NAME=FILE`.

Bundles permit thirty-two views within four MiB of canonical JSON, plus one framing LF.
Every retained view requires a target and application-reported `complete` or `partial` completeness.
`domainRevision` is an opaque application claim, separate from archive concurrency revisions.
`requiredEvidence` optionally requires retention of selected typed references.
The host binds exact captured bytes and returns an acceptance receipt.

Identical request recovery returns the original receipt without reinstalling removed material.
Changed material under that identity rejects.
A reset expires the old archive generation.
Receipts establish acceptance-time facts, not continuing evidence availability, application correctness or current domain state.

## Ownership and finite limits

The scope exclusively owns its writer, sends, timers and close operation.
Do not send, close, transfer or wrap that writer independently.
Pending view and activity snapshots coalesce across identifiers within one publication epoch.
Notices, clears, retirements and an already sending item preserve their boundaries.

The finite profile allows 512 KiB per item and five sends per second.
It retains at most sixteen queued or sending items within four MiB.
It allows sixteen active activity identifiers and 128 notices within 512 KiB.
Traffic is bounded by 18,000 attempts and 512 MiB per publisher.

Views permit thirty-two sections, thirty-two layout blocks, 8,192 detail blocks, 1,024 rows and 8,192 cells.
Each collection has at most eight columns, and each row has at most eight detail blocks.
Facts and report references retain their thirty-two-item and eight-item limits.
Identifiers use 1–64 Unicode scalars, titles use 1–128, and summaries use 1–1,024.
Report text and text cells use 0–4,096 scalars.
Counts remain safe nonnegative integers, and collection totals never undercount supplied rows.

Local send waiting allows 500 ms.
The aggregate best-effort drain allows 4,000 ms from body exit.
Drained or unwired scopes add no waiting period.
The original Run deadline remains authoritative.

Overflow or local timeout stops observation while original sends and close still settle before scope exit.
Cancellation also joins those owned operations.
Observer `LAGGED` and `DISCONNECTED` may degrade optional observation.
Unexpected publication errors remain errors, while application exceptions remain primary.

Notices, counts and 100% progress never establish execution success.
Keep essential evidence in application results or artifacts.
Parents explicitly compose child results into root projections while children retain their own useful views and source identities.
The host's actual captured media service serves images and downloads without granting browser execution authority.
