---
name: count-text
description: Count words which meet a configured minimum length.
---

# Count text

Accept a JSON object containing `text`. Count words whose length is at least the
Binding setting `minWordLength`.

Return the normal `done` outcome with the non-negative count. This package is
part of a non-runnable design probe; `flow.py` contains complete pseudocode
against a hypothetical FLOW Run/1 Python SDK.
