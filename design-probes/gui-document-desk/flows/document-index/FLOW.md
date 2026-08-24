---
name: document-index
description: Maintain a small persistent text index for local application Runs.
service: 1
attachments:
  index: read-write
provides:
  reader: ./contracts/document-index-read.capability.json
  writer: ./contracts/document-index-write.capability.json
---

# Document index

Expose separate read and write capabilities over one file-backed document
index. Serialize mutations and replace the state file atomically.

This package is repeated from the stateful-Service experiment so this GUI
project remains a complete independently inspectable Jig project. The GUI
does not receive these capabilities directly.
