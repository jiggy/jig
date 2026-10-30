---
"@jigging/jig": patch
---

Recheck absolute presentation deadlines before expiring delivery inspection or command completion, so early timer callbacks cannot refuse work before its bound. Preserve the original deadline, cancellation and settled outcomes.
