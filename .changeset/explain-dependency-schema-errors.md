---
'@jigging/jig': patch
---

Report unsupported schema keywords in dependency-backed Flow contracts as invalid authored candidates.
Preserve workspace contract paths and JSON pointers, name the unsupported keyword, and keep preparation paths private.
Retain malformed-contract field diagnostics for ancestor workspace packages without relaxing location validation.
