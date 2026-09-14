# Incident brief with a bounded handoff

## Purpose

Prepare an incident brief while an independent worker lists questions for
human review. Replace the drafting conversation once through an explicit
summary, without losing supplied context or newer instructions.

## Ownership

- `flows/project/` owns the two branches and the combined review packet.
- `flows/worker/` owns input bounds, drafting, summary preparation and one
  successor. The same worker's independent mode produces review questions.
- `bindings/` selects the worker and ordinary native Agent with a two-turn grant.
- `input.json` contains synthetic earlier context, current file text and later
  instructions. `test/` owns deterministic application checks.

## Local Contracts

- Context and file contents are explicit data, never live filesystem access.
  Later instruction revisions are unique and increasing. Summaries cannot
  overwrite them, earlier context, current files, the task, or remaining bounds.
- Drafting uses at most three application-requested model turns: initial work,
  summary in that same conversation, then one fresh successor. The independent
  branch uses one turn. Count attempts before dispatch; do not reset counters
  after error or handoff. All work keeps the root deadline and host grants.
- Start the successor only after the helper returns actual clean predecessor
  settlement and a valid summary. Never use a cancelled local waiter, progress
  or an accepted control as cleanup evidence. No queue, replay, native tools,
  stored-session restoration or transfer of provider credentials.
- Received answers, summary and uncertainty are retained as distinct fields.
  An unsuccessful branch does not discard a healthy sibling's result. Root
  cancellation and unconfirmed ownership remain fatal. This in-Run packet is
  not interruption-retained storage or a machine-crash guarantee.
- Briefs and review questions are model suggestions for a person to inspect,
  not independently verified incident facts or permission to publish them.

## Work Guidance

- Use the public Agent conversation helper and ordinary exact calls only.
- Keep domain coordination in this application; do not add host workflow APIs.

## Verification

- `bun test examples/incident-brief/test` checks ordering, budgets, context
  preservation, failures and sibling independence with deterministic peers.
- Record installed/native evidence separately from those method tests.

## Child DOX Index

- None.
