---
name: dataset-investigation
description: Connect a bounded threshold analysis to a sample reader and verify their finding against the original dataset.
outcomes:
  blocked: The conversation or independent verification did not complete successfully.
---

Supply `threshold` and 1–128 nondecreasing Celsius readings in `samples`.
Each reading is `{sample, celsius}` with a unique 1–32 character ASCII letter,
digit, underscore, or hyphen identifier. Numbers follow JSON/1.

The exact `analysis` and `dataset` child slots exchange requests and replies
through two named direct channels. Only ordered identifiers and the threshold
reach analysis; only readings reach the dataset child. No Agent or other
capability is used.

Await both execution results. Independently check observations, request order,
and the claimed first threshold crossing against the original input. Retain
each child result and any public operation failure separately. Failed dispatch
or an unsuccessful participant stops its sibling and settles held channels.
Root cancellation and uncertain cleanup remain execution failures, not findings.
