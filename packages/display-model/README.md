# @jigging/display-model

Readonly semantic values shared by independent browser and terminal renderers.
The producer supplies observations and literal application claims; these values
carry no execution authority, renderer state or file-access power.
Captured preview replies can contain bounded PNG/JPEG data. `validDisplayImage`
checks encoded byte limits, MIME type and matching image-header dimensions; it
does not authenticate the producer or decode pixels.

A minimal producer starts with a complete snapshot; add ordinary reporting
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
  const destinations = displayDestinations(snapshot.mode,
    snapshot.views.map(view => ({ key: view.id, title: view.value.title,
      source: view.sourceLabel, sourceId: view.sourceId, role: view.hostRole })),
    snapshot.rootSourceId)
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

## Configured components and observed requests

A live producer may supply `composition` from the finite Run's admitted configuration.
The map contains configured Flows, Bindings, native resources and caller-local slots.
It does not certify launch readiness, execution order or behavior for an input.

Composition is complete or explicitly unavailable.
Other producers may lack admission evidence.
Recorded packets and retained application views cannot acquire composition from their claims.
IDs remain opaque and carry no authority.

Use `compositionObservations` with a validated complete snapshot:

```ts
import { compositionObservations, type DisplaySnapshot } from '@jigging/display-model'

export function componentRequests(snapshot: DisplaySnapshot, nodeId: string) {
  const observed = compositionObservations(snapshot)
  const calls = new Map(snapshot.calls.map(call => [call.id, call]))
  return {
    requests: observed.matches
      .filter(match => match.targetNodeId === nodeId)
      .map(match => calls.get(match.callId)!),
    unmatched: observed.unmatched,
  }
}
```

Each match identifies a retained invocation request and its configured route.
Keep the supplied call state.
A match does not prove execution or success.
The helper uses exact root, caller, slot and child publisher identities.
Labels and array order cannot establish those relationships.

Missing ancestry, unavailable slots and conflicting identities remain unmatched.
The helper invents no root invocation or skipped work.
Observation omissions remain separate from the supplied configuration.

The model owns these fixed per-composition allowances:

| Export | Allowance |
| --- | --- |
| `DISPLAY_COMPOSITION_NODE_LIMIT` | 256 nodes |
| `DISPLAY_COMPOSITION_EDGE_LIMIT` | 1,024 edges |
| `DISPLAY_COMPOSITION_BYTE_LIMIT` | 256 KiB of encoded UTF-8 JSON |

These observer allowances have no override and remain inside the complete snapshot allowance.
When a complete map exceeds them, the producer supplies `{ state: 'unavailable', reason: 'limit' }`.
It must not publish partial routes.

## Explore an approved project before running

`DisplayProjectSnapshot` is independent of `DisplaySnapshot`. It contains a
bounded catalogue of reviewed targets and the selected target's configured map,
declared input schema, attachment requirements and browser launch availability.
It has no Run identity, execution clock or observed requests. Input definitions
remain beside their schema so references retain their invocation-contract scope.

`validateDisplayProjectSnapshot` owns an immutable copy and verifies catalogue,
selection and map identity. The allowances are 4,096 targets, 256 KiB for a
selected input schema with definitions, and 16 MiB for the complete projection.
The existing map allowances still apply. Projection data contains no settings,
grants, private selectors, tickets or file authority.

`DisplayProjectRunRequest` and `DisplayProjectRun` describe an explicit launch
intent and the local host's reported status. Their validators check inert data,
finite JSON values and the exact numeric-loopback viewer URL profile. They do
not execute work, authorize a target, compile its schema or retry an uncertain
request. The separate host must bind the selected opaque revision and target to
the same approved generation, perform ordinary validation and own the Run.
Requests have a 16 MiB encoded envelope allowance.

## Captured evidence and shared helpers

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

Captured text helpers are `detectDisplayTextFormat`, `displayTextTokens` and
`displayDelimitedRows`. They share conservative filename/content detection,
lexical colour roles and bounded strict CSV/TSV parsing across renderers. They
perform no IO; formatting hints do not validate syntax or grant file access.

Pure helpers are `compositionObservations`, `displayDestinations`, `displayViewKey`, `callObservationSpans`, `displayDuration`,
`referenceKey`, `recordReferences` and `attentionImportance`. Observation spans
end at the latest supplied observation and omit invalid/reversed clocks.
They never infer execution duration or a domain verdict.

`displayDestinations` accepts
original semantic view IDs in its input `key` fields and returns tagged view
destination keys from `displayViewKey(id)`. Built-in `overview`, `activity` and
`files` keys remain disjoint even when a supplied view has one of those IDs.
Destination keys are only for viewer selection. Snapshots and source-scoped
reference joins retain their original semantic IDs. `recordReferences` includes
hidden collection cells and details and deduplicates exact typed identities.

This provisional package is part of Jig under the retained Bread terms. Personal
use, qualifying organizational use and evaluation follow `LICENSE.md`; company
coverage and pricing follow `PRICING.md`. There is no separate renderer fee or
runtime activation. See `LICENSES.md` and `THIRD_PARTY_NOTICES` for separately
licensed material. Build, check and pack explicitly with the package justfile.

Packed qualification consumes frozen archives supplied through
`DISPLAY_MODEL_PACKAGE_ARCHIVE`, `REPORTING_PACKAGE_ARCHIVE` and
`FLOW_SDK_PACKAGE_ARCHIVE`. Set `FLOW_NODE` to an independent Node executable
for the required second runtime check. `just test-package` does not rebuild or repack those
candidates; `just build` and `just pack` explicitly build declared workspace
prerequisites through their owning recipes.

Application targets, presentation roles and captured content retain their reporting semantics.
`inputs` supplies a separate captured-input inventory. File IDs remain unique across both inventories.
`retained-views` presents retained application projections without execution history.
Per-file source and attachment bindings prevent references from borrowing another publication’s evidence.

Delivered files may carry explicit `bindings` with `sourceId`, `attachment` and attachment-relative `path`.
These verified joins remain separate from retained packet paths, including forwarded child artifacts.
An empty binding list authorizes no authored references.
The complete snapshot allowance is 16 MiB.
