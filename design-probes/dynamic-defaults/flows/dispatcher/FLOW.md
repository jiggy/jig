---
name: dispatcher
description: Delegate one text transformation to an admitted Run selected from an explicit open snapshot.
outcomes:
  blocked: The child did not return the small result shape this dispatcher understands.
---

# Dispatcher

Call the configured `delegate` Flow slot with the validated text and the
caller's intent. Validate the child result in ordinary code. Return `done`
with the selected transformation, or `blocked` when the child result is not
usable.

The package does not open the Flow catalogue. Its one authored Binding does
that explicitly with `allRuns()` and therefore owns the reviewed snapshot.
