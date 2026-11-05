# @jigging/display-web

A browser renderer for semantic snapshots and approved project configuration, packaged independently of Jig and the native terminal renderer.
The browser presents supplied facts, reports, collections, actual call relationships and bounded captured content.
The explorer sends explicit Run intent to its trusted host. The renderer never owns execution or authorizes file reads.

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

The read-only Run browser uses the existing authenticated local inspector transport:
`#cap=...` bootstraps a memory-only capability, which is immediately removed from
history. Its same-origin routes are `/api/snapshot`, `/api/events`,
`/api/artifacts/<opaque-id>/preview`, and `/api/close`. This is the current local
adapter contract, not a general server or execution API. The trusted host owns
loopback authentication, CSP, safe projection, immutable capture and finite
retirement. Close releases presentation. It never cancels execution.

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
disclosure, scroll and preview intent.

Full snapshots replace semantic data. Equal revisions acknowledge freshness
without replacing it. Incomplete bodies retain visibly stale prior content with
references disabled.

Preview replies must match artifact and capture identity plus the current inventory
provenance. Late completion cannot revive a closed or superseded intent.
Content stays inert literal text.

`browserTabs` returns destination keys.
`browserView(snapshot, destinationKey)` resolves only tagged view destinations.
Built-in keys remain separate from opaque semantic view IDs, including supplied
IDs named `files`, `overview`, `activity` or `composition`. Convert a resolved record target's
original `viewId` through model `displayViewKey` before selecting its destination.
Reference resolution continues to use original source-scoped semantic IDs.

Live snapshots can supply an admitted composition for the optional Application map.
Authored application pages keep their navigation priority and landing behavior.
The map shows available component calls, with complete slot labels and a selected component inspector.
It keeps Flow, Binding and resource identities distinct even when their labels match.

Callers appear left of configured targets, with request counts beside each slot.
Zoom and Fit explore larger compositions without changing the application.
Selecting a component shows incoming callers, configured child calls and its retained requests.

Per-component and per-slot counts describe exact retained invocation requests.
Repeated requests remain separately inspectable through the existing observed-call view.
Unplaced requests, omitted observations and unavailable maps remain explicit.
The Run root uses the supplied workspace facts rather than a synthetic request count.

Connections do not establish execution order, internal conditions or data transformations.
A request keeps its observed state and does not itself prove its target started or completed.
Missing retained requests do not establish skipped calls.
The browser retains component selection by exact Run and component identity across refresh and inspection return.
The map adds no execution or editing controls, and recorded snapshots retain their existing destinations.

## Explore before running

The same fixed assets also serve `/explore#cap=<value>` for a separately authorized local explorer.
It reads `DisplayProjectSnapshot` from `GET /api/project`, with an optional opaque `target` query.
The workflow list selects approved Flows and Bindings before any Run exists.
Configuration-only maps show no synthetic workspace facts or zero request counts.
The input panel starts blank and exposes the retained schema and launch prerequisites.

`POST /api/run` sends one explicit request containing `requestId`, `revision`, `targetId` and `input`.
The exact JSON text reaches the host, preserving duplicate members for strict refusal.
The complete request fits the shared sixteen MiB allowance.
`GET /api/run` reads the host's `DisplayProjectRun` state.
Lost acknowledgments trigger status reads, never another submission.
Stale project reads, unresolved requests and active Runs disable launch.

Open run follows a separately scoped numeric-loopback observer link in another tab.
The explorer retains workflow input and map position without transferring its control capability.
It retains up to sixteen drafts within sixteen MiB and explains eviction of older drafts.
Closing the explorer requests host cleanup of active work. Closing the ordinary observer remains presentation-only.
These routes belong to the local trusted adapter, not a portable execution API.

This provisional package is part of Jig under the retained Bread terms. Personal
use, qualifying organizational use and evaluation follow `LICENSE.md`; company
coverage and pricing follow `PRICING.md`. There is no separate renderer fee or
runtime activation. See `LICENSES.md` and `THIRD_PARTY_NOTICES` for separately
licensed material. Build, check and pack explicitly with the package justfile.

Packed qualification consumes frozen archives supplied through
`DISPLAY_MODEL_PACKAGE_ARCHIVE`, `REPORTING_PACKAGE_ARCHIVE` and
`FLOW_SDK_PACKAGE_ARCHIVE` plus `DISPLAY_WEB_PACKAGE_ARCHIVE`. Set `FLOW_NODE` to an independent Node executable
for the required second runtime check. `just test-package` does not rebuild or repack those
candidates; `just build` and `just pack` explicitly build declared workspace
prerequisites through their owning recipes.

Appearance uses monitor, sun, moon and monochrome icon buttons, with accessible
names and tooltips. System follows the browser preference by default; selection
is local to the current viewer and does not change supplied observations.

Application views preserve explicit gallery roles, literal report formats and captured content references.
Gallery cards lead with images and captions. A disclosure retains every supplied column.
Reading surfaces preserve prose spacing. Captured text, CSV tables and patches appear inline.

The shell identifies each page once. Collection filters preserve the inspected record and explain hidden selections.
[DESIGN.md](DESIGN.md) records the approved prototype reference and acceptance criteria.
Plain display pages need no inspection button. Related navigation uses the publisher and application subject.

Captured inputs retain distinct provenance from delivered outputs.
Visible media shares one serial preview request queue and an eight MiB cache.
Full-file downloads require the exact capture generation and declared captured availability.
The client retains no authorization after Close and fences late media completions.
Retained application views present no execution history or invented duration.
