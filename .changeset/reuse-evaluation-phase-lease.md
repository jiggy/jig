---
"@jigging/jig": patch
---

Reuse the original materialization lease when settling a completed evaluation phase, avoiding a redundant recovery capture. Preserve full identity and content checks during disposal, durable recovery, and the original execution deadlines.
