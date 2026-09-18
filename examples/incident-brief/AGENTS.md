# Incident brief with a bounded handoff

## Purpose

Prepare an incident brief while an independent worker lists questions for
human review. Replace the drafting conversation once through an explicit
summary when a finite revision replaces source context, without losing supplied context
or newer instructions. Keep the reviewer advancing independently.

## Ownership

- `flows/project/` owns the direct revision channel, two branches and combined
  review packet. Both packages carry identical self-contained revision contracts.
- `flows/worker/` owns input bounds, revision validation, drafting, summary
  preparation and one successor. Its independent mode publishes preliminary
  analysis and any separately supplied replacement before continuing with review questions.
- `bindings/` selects the worker and ordinary native Agent with a two-turn grant.
- `input.json` contains synthetic earlier context, current file text, later
  instructions and an optional replacement. The root sends that replacement
  only to the reviewer to publish; model output never supplies its contents.
  `test/` owns deterministic application checks.

## Local Contracts

- Context and file contents are explicit data, never live filesystem access.
  Later instruction revisions are unique and increasing. Summaries cannot
  overwrite them, earlier context, current files, the task, or remaining bounds.
- Drafting uses at most three application-requested model turns: initial work,
  summary in that same conversation, then one fresh successor. The independent
  branch uses at most two turns. Unwired workers use one turn. Count attempts
  before dispatch; do not reset counters after error or handoff. All work keeps
  the root deadline and host grants.
- Start the successor only after the helper returns actual clean predecessor
  settlement and a valid summary. Never use a cancelled local waiter, progress
  or an accepted control as cleanup evidence. No queue, replay, native tools,
  stored-session restoration or transfer of provider credentials.
- The optional revision feed is finite: at most eight distinct increasing
  revisions and sixteen deliveries. Exact duplicates are inert; conflicts or
  unknown stale revisions fail. Updates replace file text, append instructions
  and carry separately labelled model review notes. They cannot change the task,
  earlier context or turn budget. Include all accepted revisions through clean
  EOF before successor dispatch. Only changed files or appended instructions
  require replacement. Commentary-only revisions use one follow-up in the
  existing conversation, with no interruption, summary or successor. An empty
  feed or empty notes need no follow-up.
- Failed optional update publication is retained without preventing independent
  questions. A failed revision feed prevents drafting replacement. Root
  cancellation still applies to both branches.
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

- `bun test examples/incident-brief/test` checks interruption and settlement
  ordering, finite revision races, budgets, context preservation, disposal
  failures and sibling independence with deterministic peers.
- Record installed/native evidence separately from those method tests.

## Child DOX Index

- None.
