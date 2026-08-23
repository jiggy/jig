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
  kanban:
    contract: ./contracts/kanban.capability.json
outcomes:
  blocked: No admitted path can safely continue the ticket.
  duplicate: The submission already has a Kanban card outside initial triage.
---

# Software factory triage

Create or recover the submission's Kanban card in `triage`. The root Spindle
Router then chooses only between the two Flows connected in this
package: `gauntlet` and `majority-vote`. Candidate IDs are local edge IDs, not
Jig Binding IDs, and the choice produces no arguments or authority.

The Gauntlet path requests reference research through the separately bound
`reference-research` `flow/call` slot, then performs a fixed sequential build,
review, revision, and verification sequence through `worker`. The
Majority-Vote path obtains three parallel attachment-free opinions through
`analyst`, then calls `worker` to synthesize, implement, and verify them.

Each material phase enters its revision-checked Kanban stage before doing the
work. Success ends in `done`; every domain `blocked` edge first moves the same
card to `blocked`. Duplicate watcher Events converge on the same card by
submission ID. A later duplicate returns `duplicate` without selecting a
strategy; a simultaneous duplicate loses a revision comparison before it can
advance a second strategy.

Each Agent call selects only its role context: voters select `solution-design`,
implementation and revision select `focused-coding`, and review/verification
select `focused-validation`. Projection makes a selected Skill available; it
does not prove the Agent obeyed it. The Spindle runner itself receives no
workspace view.

This probe intentionally models one ticket at a time. It does not claim that a
shared writable workspace is safe for concurrent tickets.
