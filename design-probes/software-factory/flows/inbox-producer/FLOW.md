---
name: inbox-producer
description: Commit one immutable inbox-item Event from an explicitly submitted file.
uses:
  journal:
    contract: ./contracts/journal.capability.json
attachments:
  inbox: read
---

# Inbox producer

Read the requested regular Markdown file from the `inbox` attachment. Commit
exactly one `https://jig.example/events/inbox-item-created` Event through the
bound `journal` effect. Its data contains the item name and complete request
text; its subject is the item name.

The caller never supplies Event identity, source, Journal position, commit
time, Run identity, or correlation fields. A committed Event remains a fact if
this Run is later cancelled or loses its response.
