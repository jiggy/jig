---
name: proposal-drafter
description: Draft or revise one proposal using only supplied evidence and explicit feedback.
uses:
  agent:
    contract: ./contracts/agent-run.capability.json
outcomes:
  blocked: The Agent cannot draft the requested proposal.
  limit: The Agent reaches its execution limit.
---

Input contains a request with objective, identified requirements, and identified
evidence; an optional previous proposal; and explicit feedback. This method
makes one fresh Agent call with the package-local `grounded-drafting` Skill.
It returns a structured proposal with one cited section per requirement and
explicit limitations. It does not fetch sources or choose a provider.

The caller must check reference integrity and obtain any review appropriate to
the decision. A completed draft is not approval to act on its recommendation.
