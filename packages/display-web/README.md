# @jigging/display-web

A browser renderer for readonly semantic snapshots, packaged independently of
Jig and the native terminal renderer. The browser presents supplied facts,
reports, collections, actual call relationships and bounded captured content.
It does not own execution or authorize file reads.

```ts
import { webAssets } from '@jigging/display-web/assets'
import { browserRecords, browserLocal } from '@jigging/display-web'

// Fixed self-contained '/', '/assets/app.js' and '/assets/app.css' bodies.
// A local trusted adapter serves these assets and the existing inspector routes.
const records = browserRecords(snapshot.views[0], browserLocal())
```

The `./assets` export contains fixed HTML, JavaScript and CSS values. Importing
it reads no source files, resolves no checkout paths and initializes no native
support. Preact 11.0.1 is bundled at build time and is not an installed runtime
dependency. The browser bundle contains no external module or CDN imports.

The rendered browser uses the existing authenticated local inspector transport:
`#cap=...` bootstraps a memory-only capability, which is immediately removed from
history. Its same-origin routes are `/api/snapshot`, `/api/events`,
`/api/artifacts/<opaque-id>/preview`, and `/api/close`. This is the current local
adapter contract, not a general server or execution API. The trusted host owns
loopback authentication, CSP, safe projection, immutable capture and finite
retirement. Close releases presentation; it never cancels execution.

For the fixed assets, generate 32 unpredictable bytes encoded as unpadded
base64url: exactly 43 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`. Launch
`/#cap=<value>`; `browserCapability` accepts that exact fragment shape. The
browser removes the fragment and sends `Authorization: Bearer <value>` on API
fetches. The server must authenticate it, validate the exact authority and
same-origin requests, and serve inert assets under a restrictive CSP.

`GET /api/snapshot` returns a `DisplaySnapshotEnvelope`. `GET /api/events`
returns `text/event-stream` notifications such as
`event: revision\ndata: 2\n\n`; comments may be used as keepalives. Each positive
safe-integer revision names an already-readable snapshot, and a newly registered
stream announces its current revision. Publish snapshot bytes before announcing
them; coalesce superseded revisions rather than replaying execution. The client
fetches the latest complete replacement on connection/reconnection.
`GET /api/artifacts/<encoded-opaque-id>/preview` returns a `DisplayPreviewReply`
for retained capture only. `POST /api/close`, with the exact Origin, closes
inspection. An adapter owns bounded clients/writes and must terminate open streams
on shutdown. These details do not qualify an independently implemented server.
`client.stop()` stops observation; `await client.closeInspection()` requests the
explicit presentation close. Neither operation starts or cancels a Run.

The main export supplies `BrowserClient`, `RevisionReader`, `BrowserClock`, the
browser-local record/navigation helpers, and observation helpers for consumers
of the same semantic values. Each browser owns its selection, filters, sorting,
disclosure, scroll and preview intent. Full snapshots replace semantic data;
equal revisions acknowledge freshness without replacing it. Incomplete bodies
retain visibly stale prior content with references disabled. Preview replies
must match artifact and capture identity plus the current inventory provenance;
late completion cannot revive a
closed or superseded intent. Content stays inert literal text. `browserTabs` returns destination keys;
`browserView(snapshot, destinationKey)` resolves only tagged view destinations.
Built-in keys remain separate from opaque semantic view IDs, including supplied
IDs named `files`, `overview` or `activity`. Convert a resolved record target's
original `viewId` through model `displayViewKey` before selecting its destination;
reference resolution continues to use original source-scoped semantic IDs.

This provisional package is part of Jig under the retained Bread terms. Personal
use, qualifying organizational use and evaluation follow `LICENSE.md`; company
coverage and pricing follow `PRICING.md`. There is no separate renderer fee or
runtime activation. See `LICENSES.md` and `THIRD_PARTY_NOTICES` for separately
licensed material. Build, check and pack explicitly with the package justfile.

Packed qualification consumes frozen archives supplied through
`DISPLAY_MODEL_PACKAGE_ARCHIVE`, `USER_UPDATES_PACKAGE_ARCHIVE` and
`FLOW_SDK_PACKAGE_ARCHIVE` plus `DISPLAY_WEB_PACKAGE_ARCHIVE`. Set `FLOW_NODE` to an independent Node executable
for the required second runtime check. `just test-package` does not rebuild or repack those
candidates; `just build` and `just pack` explicitly build declared workspace
prerequisites through their owning recipes.
