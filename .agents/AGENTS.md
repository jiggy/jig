# Internal engineering guidance

## Purpose

Owns the product compass and doctrine, mutable internal orientation, recovery,
long-term planning, and optional historical field notes that maintainers need,
plus project-maintained skills for external libraries.

## Ownership

- `product-compass.md` summarizes enduring product intent and essential
  commitments, and routes readers to deeper reasoning.
- `doctrine/` owns detailed product reasoning, audience, tradeoffs, intended
  experience, and the decision test.
- `maintainer-reentry.md` explains the project's stable mental models,
  engineering lessons, and working method.
- `ROADMAP.md` orders long-term outcome gates without becoming a task tracker.
- `suspended-experiments.md` points to deleted experiments only when their
  evidence may be useful under an explicit reconsideration gate.
- `field-notes/` preserves selected first-person causal evidence without making
  it current architecture or required re-entry reading.
- `skills/` contains tracked skill entrypoints, guides, and references.
- Product behavior, public API documentation, and user guides belong outside
  `.agents/`.

## Local Contracts

- A skill describes how an agent should use an actual public interface; it
  does not create or extend that interface.
- Binding work rules belong in the applicable `AGENTS.md`. Engineering
  rationale belongs in `maintainer-reentry.md`, product rationale in the
  doctrine, and recovery landmarks in `suspended-experiments.md`.
- Edit the compass, doctrine, re-entry guide, roadmap, and recovery index in
  place. Do not put dated snapshots, current blockers, or release anomalies
  in them.
- Promote a retrospective to `field-notes/` only when it preserves useful
  first-hand causality that Git and the living records cannot. It remains
  non-normative, is never default reading, and must not carry current status.
- Keep the compass a concise entrypoint and the doctrine the home of detailed
  product reasoning. Current behavior, implementation mechanics, roadmap
  order, and research catalogues retain their existing owners.
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
- Use the compass's distinct aspiration, core ideas, and product promises.
  Describe Jig's agency for human and software consumers without implying
  that a consumer can grant itself authority.
- Keep the re-entry guide efficient to load. Split out a subject only when it
  acquires a distinct durable owner or verification contract.

## Verification

- Check every internal link after moving or renaming guidance or skill files.

## Child DOX Index

- [doctrine/AGENTS.md](doctrine/AGENTS.md) — Product purpose, FLOW and Jig
  reasoning, and cross-product judgment; the compass remains the entrypoint.
- [field-notes/AGENTS.md](field-notes/AGENTS.md) — Optional non-normative
  engineering retrospectives and historical causal evidence.
