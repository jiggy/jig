# Browser display package

## Purpose

Make supplied observations understandable through an independent readonly
browser inspector. Producers own evidence and authority; viewers own navigation.

## Ownership

- `src/client.ts` owns bounded synchronization, memory capability and preview
  requests; `src/navigation.ts` owns viewer-local semantic selection/references.
- `src/observations.ts` owns quiet synchronization and actual observation spans.
- `src/app.ts`, `src/app.css` and `src/index.html` own inert browser rendering.
- `scripts/build-assets.ts` emits fixed self-contained values for the declared
  `./assets` export; `src/index.ts` declares public browser helpers.
- Package tests, metadata, README, notices and justfile own this release unit.
  Root licensing/pricing text is canonical and copied only during the build.
- The consuming host retains HTTP authentication/CSP, projection, immutable
  capture, IO and retirement; these are not browser-package responsibilities.

## Local Contracts

- Import only model/user-updates and this package's modules; no Jig/TUI import.
- Keep capability in memory and remove its fragment before requests. No storage,
  CDN, router, server framework, automatic Run replay or execution callbacks.
- Retain one snapshot task, bounded SSE reader/retry owner and active preview.
  Equal revisions acknowledge freshness without replacing semantic data.
- Validate incoming snapshot shape before atomic replacement. Incomplete/stale
  bodies disable references; current causes, diagnostics and Close remain usable.
- Preserve local state by stable source/view/collection/row identity. Explicit
  trusted roles select recorded destinations; authored names never do. Local
  destination/map keys tag view IDs through model `displayViewKey`; semantic
  reference targets retain raw IDs. Use `browserView` to resolve selected views.
- Render author/file/diagnostic data as inert text. Only typed scoped references
  navigate; path strings never grant evidence access or assign domain success.
- Fixed bundled Preact is build-only. Installed assets read no sibling source or
  checkout-relative files and initialize no native renderer.

## Work Guidance

- Preserve list/context/expanded-evidence hierarchy, keyboard focus, compact
  navigation, diagnostic uncertainty and captured-file findings.
- Routine replacement belongs in quiet synchronization; actual loss remains
  visible. Observation intervals end at actual transitions, never frame time.
- Exact public behavior remains in owning CLI/web/user-updates specifications.
  Fixture rendering does not qualify a host transport or newcomer usability.

## Verification

- `just check` builds and runs client, navigation, observations, fixed-assets and
  public semantic fixture tests.
- `just test-package` uses exact model/web/user-updates/FLOW archives in an
  external script-disabled consumer with no Jig or native dependency.
- Installed host browser checks separately qualify actual asset embedding,
  authenticated transport, captured files, keyboard use and explicit Close.

## Child DOX Index

- None.
