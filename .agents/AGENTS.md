# Repository agent skills

## Purpose

Owns project-maintained skills that help coding agents work against external
libraries used by this repository.

## Ownership

- `skills/` contains the tracked skill entrypoints, guides, and references.
- Product behavior, public API documentation, and user guides belong outside
  `.agents/`.

## Local Contracts

- A skill describes how an agent should use an actual public interface; it
  does not create or extend that interface.
- Keep trigger descriptions precise and keep `SKILL.md` concise by routing
  detailed material to its own `guides/` and `reference/` files.
- Reconcile skill instructions when the referenced public API changes.
- Preserve working relative links within each skill.

## Work Guidance

- Prefer updating an existing guide or reference over duplicating the same
  rule in several skill files.

## Verification

- Read every linked guide or reference after moving or renaming skill files.

## Child DOX Index

- None.
