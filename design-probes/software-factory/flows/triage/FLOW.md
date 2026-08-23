---
flow: 1
name: software-factory-triage
description: Choose and run one fixed software-factory strategy for a committed inbox Event.
uses:
  agent:
    contract: https://jig.dev/contracts/agent-run
    version: 1.0.0
    digest: sha256:124668db4b2b003532062d8da291d2e69696d782a38bd2cae9c0140057bd0f9b
  choice:
    contract: https://jig.dev/contracts/semantic-choice
    version: 1.0.0
    digest: sha256:83767b89d02163d8a36c5e4f561d7c164135866a6bfdee1acd20f76370971e02
outcomes:
  blocked: No admitted path can safely continue the ticket.
---

# Software factory triage

The root Spindle Router chooses only between the two Flows connected in this
package: `gauntlet` and `majority-vote`. Candidate IDs are local edge IDs, not
Jig Binding IDs, and the choice produces no arguments or authority.

The Gauntlet path requests reference research through the separately bound
`reference-research` `flow/call` slot, then performs a fixed build, review,
revision, and verification sequence. The Majority-Vote path obtains three
independent reviews and synthesizes them. Agent work may use this package's
read-only `skills/` projection and the exact workspace owned by the bound
Agent configuration. The Spindle runner itself receives no workspace view.

This probe intentionally models one ticket at a time. It does not claim that a
shared writable workspace is safe for concurrent tickets.
