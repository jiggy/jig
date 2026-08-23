---
name: search-documents
description: Query one configured document index and return bounded matching excerpts.
uses:
  index:
    contract: ./contracts/document-index-read.capability.json
---

# Search documents

Call `index.search` once using the validated query and limit. The result is a
snapshot from one exact provider generation; the Flow makes no consistency
claim across later calls.
