# Browser run inspector

## Purpose

Make Jig's power understandable through a read-only local browser inspector.
The host owns observed execution and evidence; authors supply display-neutral
semantic reports, facts, progress and collections.

## Ownership

- `client.ts` owns bounded authenticated synchronization, connection generations,
  capability memory and preview requests.
- `navigation.ts` owns viewer-local semantic selection/reference projection.
- `app.ts` owns native browser interaction and inert Preact rendering.
- `app.css` and `index.html` are fixed host assets. The installed CLI build embeds
  them and the bundled browser code through `../cli-web-assets.ts`.
- `../cli-web-snapshot.ts` owns safe host projection; `../cli-web.ts` owns HTTP,
  presentation lifetime and immutable preview access. Neither viewer navigation
  nor browser disconnect controls execution.

## Local Contracts

- Keep capability only in memory; remove its URL fragment immediately. Reload
  explains how to reopen the original terminal link without restarting work.
- Fetch fixed same-origin routes with the bearer header. Retain one snapshot
  request, one bounded SSE reader, one retry timer and one active preview.
  Equal revision is a freshness acknowledgment, not a semantic replacement.
  Fence asynchronous completion with connection and selection generations.
- Render author/file/diagnostic data as isolated inert text. Never interpolate
  it into HTML, styling, event handlers or URLs. Only typed resolved references
  navigate. Unknown severity, loss, stale body and excerpt limits remain visible.
- Preserve local state by source/view/collection/row identity. Preview only a
  sole distinct typed artifact reference or an explicitly selected file/reference.
  Stale body references are disabled; current causes/Diagnostics/Close survive.
- Preact is an exact build-only dependency bundled into fixed assets; no router,
  compatibility layer, CDN, development server or runtime package resolution.

## Work Guidance

- Keep task/context/evidence ahead of metadata. Native controls, visible focus,
  keyboard behavior, narrow return navigation and restrained color roles must
  preserve the information hierarchy without assigning domain verdicts.
  Back and Escape from selected detail restore focus to the selected record,
  file or observed call so keyboard navigation continues in the list.
- Changing a public meaning also requires the owning CLI/user-updates specs.
  Fixture rendering does not qualify installed transport or newcomer usability.

## Verification

- `test/cli-web-client.test.ts` checks transport bounds, equal/behind revisions,
  retry ownership and stale preview fencing with controlled responses.
- `test/cli-web-navigation.test.ts` checks semantic traversal, reference intent
  and publisher-scoped resolution without domain heuristics.
- `test/cli-web-assets.test.ts` checks fixed self-contained asset output, erased
  server type imports and the build-only dependency/public archive boundary.
- Installed browser checks qualify actual bundled assets, wide/narrow/themes,
  keyboard use, hostile content, captured files and explicit command Close.

## Child DOX Index
