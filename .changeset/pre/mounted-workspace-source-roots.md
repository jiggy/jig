---
"@jigging/jig": patch
---

Allow review to capture explicitly selected mounted workspace roots with repeatable `--source-root` operands. Reuse the selected application root while preserving bounded capture, protected-root checks, immutable snapshots, and mount restrictions inside each package.

Preserve closed workspace source failures and project-relative locations so mount boundaries, missing source, links, and access failures receive actionable diagnostics.
