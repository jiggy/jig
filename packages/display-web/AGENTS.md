# Browser display package

## Purpose

Make approved configuration and supplied observations understandable through an independent browser workbench.
Producers own evidence and authority. Viewers own navigation and explicit exploration intent.

## Ownership

- `src/client.ts` owns bounded synchronization, memory capability and preview
  requests. `src/navigation.ts` owns viewer-local semantic selection/references.
- `src/explorer-client.ts` owns bounded project reads, Run status and explicit submission through a separately authorized explorer session.
  `src/explorer-app.ts` and `src/explorer-view.ts` own workflow selection, input drafts and the explorer shell.
- `src/observations.ts` owns quiet synchronization and actual observation spans.
- `src/composition.ts` owns pure map layout and exact Run/component selection.
  `src/composition-view.ts` renders approved calls, with matching observations only when a Run snapshot is supplied.
  Shared model helpers own attribution. The browser never joins component labels.
- `src/application.ts` composes authored reading, media, gallery, document and comparison surfaces.
  Gallery metadata uses a disclosure without dropping supplied columns.
  `src/app.ts`, `src/app.css` and `src/index.html` own inert browser
  rendering.
- `scripts/build-assets.ts` emits fixed self-contained values for the declared
  `./assets` export. `src/index.ts` declares public browser helpers.
- Package tests, metadata, README, notices and justfile own this release unit.
  Root licensing/pricing text is canonical and copied only during the build.
- The consuming host retains HTTP authentication/CSP, projection, immutable
  capture, IO and retirement. These are not browser-package responsibilities.

## Local Contracts

- Captured text uses shared format detection and inert token spans. Complete
  rectangular CSV/TSV excerpts offer Table/Raw views (500 rows, 64 columns).
  Clipped or malformed excerpts stay raw, and search always uses raw text.
- Import only model/reporting and this package's modules. No Jig/TUI import.
- Keep capability in memory and remove its fragment before requests. No storage, CDN, router or server framework.
  The Run observer never submits or retries execution.
  `/explore` uses a distinct host capability for explicit requests and project reads.
  Never transfer that capability to the separate Run observer.
- Explorer submission sends exact input JSON and pins the selected project revision and target identity.
  Never retry submission after a lost response. Read status until the host resolves that request.
  Read global Run state before any request-specific lookup under the same bounded poll owner.
  Request acknowledgments never replace global state for launch gating. Unknown lookup does not prove that execution never started.
- Starting, running, uncertain or stale states disable another launch.
  Close explorer stops its owned Run through host cleanup. Close inspection remains presentation-only.
  An unconfirmed Close keeps launch fenced. Fresh idle status cannot undo that fence, and Close retries require an explicit action.
- Project maps carry no synthetic Run snapshot, elapsed time or zero request counts.
  Approval labels do not establish current source freshness or launch readiness.
  Keep schema and unavailable launch reasons beside the input editor.
  Retain at most sixteen drafts within sixteen MiB, evicting older drafts with visible feedback.
  Preserve an oversized current edit until selection changes, without clipping it.
- Retain one snapshot task, bounded SSE reader/retry owner and active preview.
  Equal revisions acknowledge freshness without replacing semantic data.
- Validate incoming snapshot shape before atomic replacement. Incomplete/stale
  bodies disable references. Current causes, diagnostics and Close remain
  usable.
- Preserve local state by stable source/view/collection/row identity. Explicit
  trusted roles select recorded destinations. Authored names never do. Local
  destination/map keys tag view IDs through model `displayViewKey`. Semantic
  reference targets retain raw IDs. Use `browserView` to resolve selected views.
- Optional live composition appears in Application map after authored root pages.
  Retain component selection by root publisher, admitted root and opaque node ID.
  Available connections never establish order, branch outcomes or target execution.
  Request counts describe retained matches, including separate repeated requests.
  Keep exact per-edge counts, unmatched observations and omissions visible.
  Root facts use the workspace observation without a synthetic child request.
- Matched requests emphasize observed connections and retain mixed states on components and individual slots.
  Active selects active requests. Needs attention selects failed or uncertain requests.
  These viewer-local choices preserve every component, connection, selection and map position.
  Reserve summary space independently of changing observations.
- Invocation view links use the selected call's unambiguous accepted child source.
  Exclude root and host views. Never infer correspondence from names, subjects or operation labels.
  Open the exact tagged destination without subject redirection, and preserve the invocation's return context.
  Missing identity remains unavailable. Stale or incomplete observations disable these links.
- Empty retained snapshots show an explicit empty state without synthetic destinations.
  Diagnostics, Help and Close remain available. Only an existing selected tab labels a tabpanel.
- Render author/file/diagnostic data as inert text. Only typed scoped references
  navigate. Path strings never grant evidence access or assign domain success.
- Visible captured media shares one serial request queue with evidence inspection.
  Retain at most 24 visible requests and forty MiB of cached replies.
  Each preview response allows three MiB of JSON for a bounded two-MiB raster.
  Complete downloads require the exact capture generation and declared availability.
  Closing the client fences previews, media and downloads.

  Media requests settle independently of cache residency while their exact intent remains visible.
  Eviction cannot requeue a settled visible intent.
  Missing media can retry after leaving visibility or changing capture identity.
- Captured images use validated bounded PNG/JPEG data URLs in image elements.
  Never insert SVG into the DOM or load image paths/URLs from authored text.
- Fixed bundled Preact is build-only. Installed assets read no sibling source or
  checkout-relative files and initialize no native renderer.

## Work Guidance

- Appearance uses fixed accessible icon buttons with names, tooltips, focus
  and pressed state. Default System follows browser preference. Choices are
  viewer-local.
- The compact application frame puts routine host facts in Run details while retaining visible attention and Close.
- Document covers and downloads use exact current capture bindings and generation checks.
  The summary record owns its cover reference, preserving inspection across the first selection change.
- Resolved record references keep exact view destinations. Only general tab navigation redirects within the current subject.
- Presentation follows supplied block types and explicit roles, independently of application names.
  Document content preserves image proportions. Content and covers retain accessible captured-source disclosures.
- All authored publishers share material rendering, including attributed child views.
  Publisher placement never reduces reports or collections to inspection teasers.
- Table columns size to their content and preserve readable identifiers. Overflowing tables expose scroll controls beside the complete collection.
  Repeated collection titles use section context and stable IDs to distinguish their scroll controls.
  Preserve natural line lengths for ordinary values. Keep prose bounded and avoid redundant cards around reading content.
- Adjacent reading sections share wide content space and stack when the available reading area narrows.
- Small collections disclose search and sorting. Active filters remain visible.
  Complete counts stay compact. Retained and reported differences remain explicit.
- Content and formatted reports share responsive comparison regions with their supplied context.
- Host and authored details open on request and share narrow-screen return navigation.
  Technical instance identities belong inside About this view.
  Narrow navigation uses a labeled native chooser with every exact destination and publisher context.
  Repeated titles disclose distinguishing publisher or instance identity. Exact chooser selections preserve their destination across subjects.
  Breakpoint focus recovery yields to subsequent panel or navigation actions.
  Appearance remains available on narrow screens. Coarse-pointer targets retain their 44-pixel minimum.
- Root application pages precede Inspector and child views by verified
  publisher identity. Compose authored sections in place. Details open on
  demand. Preserve full columns, literal data, stable local state and all
  inspection destinations.
- Keep the map compact, with callers left, targets right and counts beside their slots.
  Use explicit CSS lengths for HTML cards and their shared SVG coordinate space.
  Keep zoom, Fit and component selection local to the viewer.
  Place request observations and incoming caller context in the selected component's inspector.
- Map resources use human names and retain native kind in the identity disclosure.
  Checkpoints stay available with secondary styling. Complete slots and labels
  remain readable in the map, component details and connection table.
  Opening an exact request clears unrelated call filters and retains a return to
  its selected component. General observed-call navigation preserves its filter.
- Follow [DESIGN.md](DESIGN.md) for the approved workbench hierarchy and material-specific acceptance criteria.
- Preserve application selection through local filtering. Explain hidden selections and allow clearing filters without selecting another record.
  Clear filters restores focus to the selected control, or the visible detail Back button at narrow widths.
  Search input keeps focus while typing.
- Render captured text, delimited tables and diffs inline. Keep unavailable and clipped captures explicit.
- Preserve list/context/expanded-evidence hierarchy, keyboard focus, compact
  navigation, diagnostic uncertainty and captured-file findings.
- Routine replacement belongs in quiet synchronization. Actual loss remains
  visible. Observation intervals end at actual transitions, never frame time.
- Exact public behavior remains in owning CLI/web/reporting specifications.
  Fixture rendering does not qualify a host transport or newcomer usability.

The visual review matrix serves identical observations to current and PR-base production assets.
It includes initial pages and selected call, file and child-record details.
Its HTML pairs and manifests identify both revisions. They do not replace an original approved mockup.

## Verification

- `just check` builds and runs client, explorer, navigation, observations, composition, fixed-assets
  and public semantic fixture tests.
- `just test-browser` exercises mounted production assets through authenticated fixture HTTP.
  It checks host views, actual application projections, responsive navigation, focus and evidence access.
- `just test-package` uses exact model/web/reporting/FLOW archives in an
  external script-disabled consumer with no Jig or native dependency.
  The harness matches the installed version to this package's source manifest.
- Installed host browser checks separately qualify actual asset embedding,
  authenticated transport, captured files, keyboard use and explicit Close.
  Explorer protocol tests use real HTTP and inert data. They do not qualify admission, native execution or visual usability.

## Child DOX Index

- None.
