---
name: search-documents
description: Search the configured document index and return bounded matching excerpts.
uses:
  index:
    contract: ./contracts/document-index-read.capability.json
---

# Search documents

Call the exact index reader once with the validated query and return its
bounded result.

