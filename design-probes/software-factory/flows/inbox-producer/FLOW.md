---
flow: 1
name: inbox-producer
description: Commit one immutable inbox-item Event from an explicitly submitted file.
uses:
  journal:
    contract: https://jig.dev/contracts/journal
    version: 1.0.0
    digest: sha256:dd749f53de3a5f80e02386699355e28c1fd7e707b2b12bdf2d5c725eb436ddf9
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
