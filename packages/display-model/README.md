# @jigging/display-model

Readonly semantic values shared by independent browser and terminal renderers.
The producer supplies observations and literal application claims; these values
carry no execution authority, renderer state or file-access power.

A minimal producer starts with a complete snapshot; add ordinary user-updates
views and observed calls when available:

```ts
const receivedData = {
  kind: 'snapshot', revision: 1, mode: 'live-run', rootSourceId: 'root',
  workspace: { target: 'Document review', phase: 'live',
    hostStage: 'Checking supplied documents', elapsedMs: 0 },
  context: 'Application reports remain literal claims',
  omissions: { calls: 0, journal: { flow: 0, host: 0, diagnostic: 0 } },
  views: [], calls: [], activities: [], journal: [], attention: [],
  artifacts: { generation: 'capture-1', sourceId: 'root',
    provenance: 'verified-delivery', phase: 'ready',
    permittedAttachments: ['evidence'], files: [] },
} as const
```

```ts
import { validateDisplaySnapshot, displayDestinations } from '@jigging/display-model'

const snapshot = validateDisplaySnapshot(receivedData)
if (snapshot.kind === 'snapshot') {
  const destinations = displayDestinations(snapshot.mode === 'recorded-packet',
    snapshot.views.map(view => ({ key: view.id, title: view.value.title,
      source: view.sourceLabel, role: view.hostRole })))
}
```

`DisplaySnapshot` is one complete replacement. `DisplayIncompleteSnapshot`
contains current facts, retained causes, diagnostics and omissions; a renderer
may retain a visibly stale prior body but must disable its references.
`validateDisplaySnapshot` returns an owned immutable copy or throws a bounded
`TypeError`; it accepts bounded opaque IDs independently of the producer's
identity scheme. Validation checks shape and bounds, not the truth or authority
of supplied observations. An omitted relationship remains unavailable. Each source
has at most one current view per authored `value.id` and one call per `operationId`;
validation rejects ambiguous source-scoped reference joins atomically. The same
authored identifiers may belong to different sources; opaque outer IDs stay unchanged.

Snapshots explicitly separate execution, literal application outcome, cleanup,
delivery and observation completeness. `rootSourceId` identifies the root
publisher independently of captured files. `hostRole` comes from a trusted
recorded adapter; authored titles and IDs must never assign a role. Attention
`transcriptCommitted` records successful output delivery, not application success.

`DisplayPreviewReply` binds captured content to `artifactId` and
`captureGeneration`. A renderer asks a separately supplied bounded service for
that identity; this package performs no IO. `WebAssets` describes fixed browser
asset bodies and content types.

An artifact reference `{ kind: 'artifact', attachment: 'evidence', path: 'notes.txt' }`
requires the source's inventory to permit `evidence` and contain a file whose
`path` is exactly `notes.txt`. The inventory path does not include the attachment
name. The renderer resolves that match to the file's opaque `id`; the preview
service receives only that ID and the capture generation. Pending or absent
inventory entries remain unavailable regardless of a reference's declaration.

Pure helpers are `displayDestinations`, `displayViewKey`, `callObservationSpans`, `displayDuration`,
`referenceKey`, `recordReferences` and `attentionImportance`. Observation spans
end at the latest supplied observation and omit invalid/reversed clocks; they
never infer execution duration or a domain verdict. `displayDestinations` accepts
original semantic view IDs in its input `key` fields and returns tagged view
destination keys from `displayViewKey(id)`. Built-in `overview`, `activity` and
`files` keys remain disjoint even when a supplied view has one of those IDs.
Destination keys are only for viewer selection; snapshots and source-scoped
reference joins retain their original semantic IDs. `recordReferences` includes
hidden collection cells and details and deduplicates exact typed identities.

This provisional package is part of Jig under the retained Bread terms. Personal
use, qualifying organizational use and evaluation follow `LICENSE.md`; company
coverage and pricing follow `PRICING.md`. There is no separate renderer fee or
runtime activation. See `LICENSES.md` and `THIRD_PARTY_NOTICES` for separately
licensed material. Build, check and pack explicitly with the package justfile.

Packed qualification consumes frozen archives supplied through
`DISPLAY_MODEL_PACKAGE_ARCHIVE`, `USER_UPDATES_PACKAGE_ARCHIVE` and
`FLOW_SDK_PACKAGE_ARCHIVE`. Set `FLOW_NODE` to an independent Node executable
for the required second runtime check. `just test-package` does not rebuild or repack those
candidates; `just build` and `just pack` explicitly build declared workspace
prerequisites through their owning recipes.
