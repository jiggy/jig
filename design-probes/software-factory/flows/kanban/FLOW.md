---
name: kanban
description: Persist software-factory cards and revision-checked stage transitions.
service: 1
attachments:
  board: read-write
provides:
  kanban: ./contracts/kanban.capability.json
---

# Kanban

Store one JSON card per deterministic submission ID. `ensure` is idempotent
for identical submission content. `transition` is a compare-and-set over the
card revision and enforces the small software-factory stage graph.

The Service serializes mutations and publishes each card by atomic rename.
Jig must give this Mount the only writable lease for the board attachment; an
update drains the old writer before mounting its replacement.
