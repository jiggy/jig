---
name: document-index
description: Maintain a persistent text index and publish document-indexed facts.
service: 1
attachments:
  index: read-write
uses:
  journal:
    contract: ./contracts/journal.capability.json
provides:
  reader: ./contracts/document-index-read.capability.json
  writer: ./contracts/document-index-write.capability.json
---

# Document index

Expose separate read and write capabilities over one file-backed document
index. Serialize mutations and replace the state file atomically. An accepted
revision is recorded with a pending publication before the Journal is called;
the pending marker is removed only after publication is proven.

This package is repeated from the stateful-Service experiment so this GUI
project remains a complete independently inspectable Jig project. The GUI
does not receive these capabilities directly.

