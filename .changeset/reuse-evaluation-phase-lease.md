---
"@jigging/jig": patch
---

Avoid repeated directory walks and intermediate directory syncs during package materialization. Reuse the original materialization lease when settling a completed evaluation phase, avoiding a redundant recovery capture. Preserve full identity and content checks, durable recovery, and the original execution deadlines.
