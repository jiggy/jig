# Internal engineering guidance

## Purpose

Owns the mutable internal orientation, recovery, and long-term planning that
maintainers need, plus project-maintained skills for external libraries.

## Ownership

- `maintainer-reentry.md` explains the project's stable mental models,
  engineering lessons, and working method.
- `ROADMAP.md` orders long-term outcome gates without becoming a task tracker.
- `suspended-experiments.md` points to deleted experiments only when their
  evidence may be useful under an explicit reconsideration gate.
- `skills/` contains tracked skill entrypoints, guides, and references.
- Product behavior, public API documentation, and user guides belong outside
  `.agents/`.

## Local Contracts

- A skill describes how an agent should use an actual public interface; it
  does not create or extend that interface.
- Binding work rules belong in the applicable `AGENTS.md`. Explanatory
  rationale belongs in `maintainer-reentry.md`; recovery landmarks belong in
  `suspended-experiments.md`.
- Edit these living records in place. Do not add dated snapshots, current
  blockers, release anomalies, or per-agent memoirs; Git and `.tmp/` preserve
  those histories.
- Before an approved vertical, use one transient `.tmp/` pre-mortem when it
  helps coordination. Promote only stable rules, decisions, and recovery gates
  into tracked documents when the vertical closes.
- Keep trigger descriptions precise and keep `SKILL.md` concise by routing
  detailed material to its own `guides/` and `reference/` files.
- Reconcile skill instructions when the referenced public API changes.
- Preserve working relative links within each skill.

## Work Guidance

- Prefer updating an existing owner over duplicating the same rule in several
  internal files.
- Keep the re-entry guide efficient to load. Split out a subject only when it
  acquires a distinct durable owner or verification contract.

## Verification

- Check every internal link after moving or renaming guidance or skill files.

## Child DOX Index

- `skills/` — Repository-native skills and their maintained references.
