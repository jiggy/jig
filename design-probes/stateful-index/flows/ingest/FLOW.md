---
name: ingest-document
description: Add one exact document revision to a configured document index.
uses:
  index:
    contract: ./contracts/document-index-write.capability.json
---

# Ingest document

Call `index.upsert` once with the validated Run input and return the accepted
record. Provider loss or an uncertain call is an execution failure, never a
fabricated domain outcome or a transparent retry against another generation.
