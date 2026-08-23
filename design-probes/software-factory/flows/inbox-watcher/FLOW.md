---
name: inbox-watcher
description: Watch stable inbox files and commit immutable inbox-item Events.
service: 1
uses:
  journal:
    contract: ./contracts/journal.capability.json
attachments:
  inbox: read
---

# Inbox watcher

Watch immediate regular `*.md` files in the read-only `inbox` attachment. A
file becomes a submission only after its size, modification time, and bytes are
stable across one settle interval. Commit an
`https://jig.example/events/inbox-item-created` Event through `journal`; its
data contains the item name, complete request text, and a deterministic
submission ID derived from both.

The caller never supplies Event identity, source, Journal position, commit
time, Run identity, or correlation fields. A committed Event remains a fact if
the watcher later loses its Mount. Watch delivery is at least once across Mount
restart; consumers use `submissionId` for domain idempotency.
