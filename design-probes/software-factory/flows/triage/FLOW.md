---
name: software-factory-triage
description: Choose and run one fixed software-factory strategy for a committed inbox Event.
uses:
  worker:
    contract: ./contracts/agent-run.capability.json
  analyst:
    contract: ./contracts/agent-run.capability.json
  choice:
    contract: ./contracts/semantic-choice.capability.json
outcomes:
  blocked: No admitted path can safely continue the ticket.
---

# Software factory triage

The root Spindle Router chooses only between the two Flows connected in this
package: `gauntlet` and `majority-vote`. Candidate IDs are local edge IDs, not
Jig Binding IDs, and the choice produces no arguments or authority.

The Gauntlet path requests reference research through the separately bound
`reference-research` `flow/call` slot, then performs a fixed sequential build,
review, revision, and verification sequence through `worker`. The
Majority-Vote path obtains three parallel attachment-free opinions through
`analyst`, then calls `worker` once to synthesize and implement them.

Verification and synthesis explicitly request the projected
`focused-validation` skill. Projection makes the skill available; it does not
prove the Agent selected or obeyed it. The Spindle runner itself receives no
workspace view.

This probe intentionally models one ticket at a time. It does not claim that a
shared writable workspace is safe for concurrent tickets.
