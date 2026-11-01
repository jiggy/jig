# Application workbench design

The browser display makes application material readable inside a shared inspection shell.
Applications choose content and priorities. Jig owns layout, navigation and evidence access.

## Principles

1. Let purpose determine presentation. Reading, observing, comparing and investigating are complete uses.
2. Identify each scope without unnecessary repetition. The shared header identifies the selected application view.
3. Give each region an obvious owner. A selected record owns its inspector, while About this view describes the publisher.
4. Give prominence according to relevance. Show the useful material first and retain important caveats visibly.
5. Choose density appropriate to the material. Align comparison rows and give documents and photographs reading room.
6. Make interactions clear when present. Display-only content needs no invented commands or compulsory inspector.
7. Preserve orientation through change. Keep selection, execution, application outcome, evidence availability and observation freshness distinct.

## Rendering commitments

- Keep the application summary visible. Authors can use it to describe uncertainty or partial results.
- Use one page identity in the shared header. Avoid repeated headings when a section contains one identically named collection.
- Put search and sorting beside their collection. Counts describe retained records and disclose reported totals.
- Gallery images and captions lead. Preserve every supplied column in a metadata disclosure.
- Choose layouts from supplied block types and explicit presentation roles, independently of application names or example fields.
- Preserve document images' proportions and full content, including charts and screenshots. Keep captured-source disclosures accessible for content and covers.
- Use readable prose surfaces for correspondence. Preserve whitespace, code and literal diff formatting.
- Render captured text and patches inline. Complete rectangular CSV excerpts can use a table with raw text available.
- Preserve authentication, exact capture identity, preview bounds and cleanup. No authored URL or path grants file access.
- Keep the selected record when filters hide it. Explain that scope and provide Clear filters without changing selection.
- Open an inspector only when requested. Highlight its owning record and preserve the return path.
- Keep incomplete results, stopped publishers, clipped content and stale observations explicit.

## Acceptance checks

Review the same material in light, dark and monochrome themes at desktop and narrow widths.
Check keyboard focus, coarse-pointer targets, text contrast and responsive detail navigation.

- Photos and Organise show photographs directly, with readable captions and quiet technical metadata.
- Support shows the customer request and draft reply before process details.
- Kitchen compares all shifts in one timetable, with checked and pending assignments distinguished.
- Contacts leads with completed records, retaining mapping and correction reasons.
- Patch review displays captured patches alongside their independently validated checks.
- Plain reports remain useful without selection, search or commands.
- Filtering never silently changes the inspected record. Clearing filters returns focus to its visible control, or the detail Back button on narrow layouts. Typing in search retains focus.
- Unavailable evidence remains a readable state, without a broken image or fabricated successful result.

`test/material.node.mjs` checks semantic rendering, captured content, large galleries and actual HTTP behavior.
Source checks do not establish rendered visual parity. Record browser comparison separately when preview infrastructure is available.
