# Project coordination

## Purpose

Own the compact project roadmap and the inbox for postponed work awaiting
triage. Keep follow-up visible without turning every improvement into a release
gate.

## Ownership

- `ROADMAP.md` gives a concise, high-level overview of outcome order and the
  next steps.
- `inbox/*.md` holds postponed tasks that await triage.
- Specifications own current behavior.
- Temporary execution plans, diagnostics and evidence remain in `.tmp/`.

## Local Contracts

- Keep the roadmap small, direct, and focused on the next high-level outcomes.
  Do not expand it into a complete list of upcoming work.
- Add postponed tasks to `inbox/` before triage. Record known context without
  implying approval of scope, priority, or implementation.
- An inbox item preserves work. It does not authorize implementation or
  spending.

## Work Guidance

- Update an existing task rather than creating competing descriptions.
- Keep investigation history and private operational details out of task files.
- Pass `--setup inherit` explicitly when creating a Jig worktree for a coding
  agent with Orca. Use the flag with `orchestration worker-start` or
  `worktree create`. The repository setup hook copies `.agent-sandbox.env`
  before the agent starts. Skipping setup leaves the agent without the project
  configuration, even if the sandbox launcher starts with defaults.
- Use `--timeout-ms 300000` with `orchestration worker-start`.
  This gives Orca five minutes to finish setup and start the agent.
- Before starting a coding agent in an existing Orca worktree, verify that
  setup completed and `.agent-sandbox.env` is present.
- Release finished child-agent sessions promptly once their changes and
  evidence are saved and no follow-up is planned. Use the orchestrator's
  guarded release operation and verify its result. Keep sessions open when
  the user requests it. Reclaim disposable worktrees through the normal
  cleanup workflow once their remaining files are no longer needed.

## Verification

## Child DOX Index

- None.
