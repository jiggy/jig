---
name: ingest-document
description: Insert one exact document revision through the configured index writer.
uses:
  index:
    contract: ./contracts/document-index-write.capability.json
---

# Ingest document

Pass the validated document to the exact index writer Binding and return the
accepted record. Do not retry an uncertain call under a new operation ID.

