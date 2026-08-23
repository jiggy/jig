---
name: audit-index-event
description: Verify that a document-indexed Event refers to visible index state.
uses:
  index:
    contract: ./contracts/document-index-read.capability.json
outcomes:
  stale: The Event refers to a revision newer than the visible index record.
---

# Audit index Event

Read the indexed document and current index statistics through the exact
Service generation pinned to this Run. A newer visible revision still confirms
an older Event; a missing or older record returns `stale` rather than mutating
state.
