# Retained display bundles

Live reporting supplies optional observations. A delivered display bundle supplies one explicitly selected final edition for retained presentation.
Use the same pure projection functions for both. The application's result retains its own business contract.

```ts
import { createDisplayBundle, encodeDisplayBundle } from '@jigging/reporting'

const bundle = createDisplayBundle(context, {
  requestId: publicationId,
  edition: albumEdition,
  views: [{ view: albumView, completeness: 'complete', domainRevision }],
})
const document = encodeDisplayBundle(bundle)
```

The context contains an opaque archive generation and current target heads.
The helper derives revision conditions, including removal fences.
Applications choose request identities, editions, instance keys and domain revisions.
They cannot assign trusted Run provenance or captured byte identities.

Each entry contains a semantic `view`, `expectedRevision` and application-reported `completeness`.
Every retained view requires `target: {definitionId, instanceKey, subjectKey?}`.
A `subjectKey` relates navigation across definitions without merging publisher identities.
An optional `domainRevision` is an application claim, separate from the archive's concurrency revision.

Write the encoded document through an ordinary declared output attachment or artifact result.
The host must explicitly select that final output for publication.
A filename, live reporting snapshot or JSON field cannot select publication implicitly.
These helpers perform no filesystem operations and grant no execution or file authority.

`requiredEvidence` names references whose retention is required for accepting the edition.
Other unavailable evidence remains explicit.
The bundle contains no captured bytes, callbacks, absolute paths, URLs or execution commands.
The finite profile permits 32 views and four MiB of canonical UTF-8 JSON.
Individual views retain reporting's item and semantic limits.

`encodeDisplayBundle` returns canonical JSON followed by one LF.
`decodeDisplayBundle` validates bounded captured bytes without authenticating their producer.
The host binds verified final delivery to its actual source and exact evidence.
Identical request recovery returns the original receipt and provenance.
It does not reinstall material removed after acceptance.
Changed material under that request identity rejects, and archive reset expires older contexts.

Receipts describe acceptance-time facts.
They establish neither continuing evidence availability, application success nor currency against current domain state.
