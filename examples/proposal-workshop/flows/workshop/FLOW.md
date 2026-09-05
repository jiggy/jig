---
name: proposal-workshop
description: Draft, check, review separately, and revise one proposal from supplied evidence.
outcomes:
  blocked: A specialist cannot produce or approve a proposal from the supplied evidence.
  limit: A specialist or the workshop's one-revision budget is exhausted.
---

This method calls a drafter and a separate reviewer through host-admitted
`drafter` and `reviewer` slots. It checks every requested section and evidence
reference before asking for a review. It permits one revision, so at most two
drafts and two reviews occur, sequentially.

Input supplies an objective, uniquely identified requirements, and uniquely
identified evidence records containing source URLs and text. Source URLs are
display links, never fetched. The result includes the latest proposal, review,
attempt count, mechanical feedback, and rendered Markdown. Only an approving
review of a mechanically complete proposal returns `done`.

Reference checks establish that sources were supplied and requirements were
covered. They do not prove that a claim follows from its source. The reviewer
provides a separate judgment, which can still be wrong. A real decision remains
with the proposal's recipient. No result authorizes implementation or spending.
