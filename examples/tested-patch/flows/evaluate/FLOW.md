---
name: evaluate-module
description: Observe bounded JSON results from a supplied module in this Flow's disposable execution boundary.
---

Input supplies bounded text `files`, an `entry` path, an `exportName`, and
`calls` containing JSON argument arrays. This package materializes those files
only in its own scratch tree, imports the entry, and calls the named export.
It supports synchronous JSON-returning functions, not package installation or
arbitrary test commands. It returns `values` in call order: `{returned: value}`
or `{threw: errorName}` for each invocation, never pass flags.

Treat the entire child, including its result, as candidate-controlled. The
caller owns its expectations and validates the observations independently.
The host supplies isolation, limits, cancellation, and cleanup. This package
declares no capabilities and receives no parent files or Agent credentials.
