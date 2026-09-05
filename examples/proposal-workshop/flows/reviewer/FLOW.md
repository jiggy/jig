---
name: evidence-reviewer
description: Review a proposal against supplied evidence and an admitted review focus.
uses:
  agent:
    contract: ./contracts/agent-run.capability.json
outcomes:
  blocked: The Agent or reviewer cannot complete the review from the evidence.
  limit: The Agent reaches its execution limit.
---

Input supplies an objective, requirements, evidence records, and one proposal.
The required `reviewFocus` setting describes the concerns this configured use
should scrutinize. It is guidance, not permission to use tools or choose an
Agent provider. This method makes one fresh Agent call with the package-local
`evidence-review` Skill. The Agent supplies material findings with reasons;
ordinary code returns blocked if any finding blocks the proposal, revise if
other findings remain, and approve only for an empty list. The public result
contains that verdict and the issues.

A completed review returns `done` with an `output.verdict` of `approve`,
`revise`, or `blocked`; an Agent that cannot complete its work instead returns
the Flow outcome `blocked` or `limit`. Review completion is not approval.
Findings identify material evidence defects or unmet explicit requirements,
not optional presentation improvements. A responsible conditional proposal
may disclose prerequisites without claiming they have already been satisfied.

This method owns no child Flow slots and depends on no workshop implementation.
Another application can supply the same ordinary input and its own admitted
review focus. Its judgment is advisory; an approval is not authority to act.
