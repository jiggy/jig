# Proposal workshop

## Purpose

Produce a source-linked proposal from supplied evidence using a drafting
method, a separate evidence-review method, and deterministic checks.

## Ownership

- `flows/workshop/` coordinates sequential calls, checks requirement coverage
  and citation identities, and permits at most one revision.
- `flows/drafter/` drafts or revises one proposal using its selected Skill.
- `flows/reviewer/` reviews one proposal in a fresh Agent call using its own
  selected Skill and admitted review-focus setting.
- `bindings/` pins the workshop's exact collaborators and reviewer settings.
- `fixtures/` contains explicitly synthetic supplied evidence.
- `test/` checks application behavior with deterministic call substitutes;
  those checks do not establish Agent quality or host lifecycle behavior.

## Local Contracts

- A valid proposal covers every requested requirement exactly once and each
  section cites at least one supplied evidence ID. These checks establish
  reference integrity and completeness, not factual entailment.
- Only a proposal passing mechanical checks and receiving an approving review
  returns `done`. Failed reviews and incomplete revisions stay visible.
- A blocked or limited specialist stops the workshop. Protocol, cancellation,
  provider, and uncertain-dispatch errors propagate without automatic retry.
- The reviewer is a leaf Binding. Child settings and Agent context come from
  its own admitted target; parent configuration never becomes child authority.
- The reviewer derives its public verdict from Agent findings: any blocking
  finding wins, other findings require revision, and only an empty list
  approves. Blank reasons and unknown finding kinds are invalid.
- Findings identify a concrete evidence defect or unmet explicit requirement
  and its consequence, not optional presentation preferences. Disclosed launch
  prerequisites do not prevent a responsible conditional proposal; approval
  of a draft never authorizes its execution.
- A completed reviewer Run returns `done` even when its `output.verdict`
  requires revision or blocks the proposal. Agent inability to complete is a
  separate Flow outcome.

## Work Guidance

- Keep the revision ceiling fixed at one and make feedback inspectable.
- Keep source URLs as supplied display links; no Flow fetches them.

## Verification

- From the repository root, run `bun test examples/proposal-workshop/test`.
- For host execution, follow the
  [public workshop guide](../../docs/jig/guide/proposal-workshop.md) and retain
  its Run result separately from unit-test evidence.

## Child DOX Index

- None.
