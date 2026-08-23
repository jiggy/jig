---
flow: 1
name: create-missing-flow
description: Prepare an inert candidate Flow for an explicitly reported missing dependency.
attachments:
  workspace: read-write
---

# Create a missing Flow proposal

This is an operator-started maintenance Flow. Inspect the supplied missing
binding diagnostic, create and test a proposed FLOW package and Binding only
inside the `workspace` staging attachment, and report what should be reviewed.

Never write active policy, apply a candidate, grant authority, resume a failed
operation, replay a Hook, or claim the proposal is admitted. Normal Jig
planning and explicit apply must happen afterward; the original failed ticket
Run remains terminal.
