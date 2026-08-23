---
name: document-index
description: Maintain a small persistent text index and publish durable document-indexed facts.
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

Provide an exact write capability containing `upsert` and an exact read
capability containing `get`, `search`, and `stats` over one file-backed index.
Mutations are serialized; reads may observe either complete side of an atomic
state-file replacement.

An accepted mutation writes the document and a pending Event into the same
state-file replacement before calling `journal.append`. The stable publication
operation ID lets the same still-live invocation recover a provable result. The
pending entry is removed only after the Journal result is proven.

Publication is at least once across provider generations. A replacement Mount
which adopts an old pending entry has a new operation namespace and producer
identity, so consumers must converge by `(documentId, revision)`. FLOW does not
claim a transaction spanning Service state and Jig's Journal.

The index attachment permits one writer. A replacement cannot shadow-mount
against the same writable tree; Jig must drain and fence the old Mount before
starting the new one.
