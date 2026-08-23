---
flow: 1
name: render-summary
description: Render an already computed word count as a small plain or compact summary.
---

# Render summary

Accept a label and non-negative word count. Render one summary string using the
Binding setting `style`.

Return the normal `done` outcome with the rendered text. This package is part
of a non-runnable design probe; `flow.ts` intentionally contains no
implementation behavior.
