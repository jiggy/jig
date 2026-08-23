---
flow: 1
name: count-text
description: Count words which meet a configured minimum length.
---

# Count text

Accept a JSON object containing `text`. Count words whose length is at least the
Binding setting `minWordLength`.

Return the normal `done` outcome with the non-negative count. This package is
part of a non-runnable design probe; `flow.py` intentionally contains no
implementation behavior.
