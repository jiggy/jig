# Project guidance

## Purpose

This directory owns the product compass, doctrine, audience strategy,
communication strategy, and first-time engineering orientation. It also owns
recovery, long-term planning, optional historical field notes for maintainers,
and project-maintained skills for external libraries.

## Ownership

- `product-compass.md` introduces the product authority pyramid and routes
  readers from core ideas through principles to detailed commitments.
- `doctrine/` owns detailed product and architectural reasoning, tradeoffs,
  intended product experience, and the decision test.
- `audience.md` owns the initial ICP, felt problems, domain understanding,
  participant needs, and adoption hypotheses.
- `communication.md` owns positioning, narrative progression, vocabulary, and
  public editorial judgment, drawing on the audience and doctrine.
- `brand.md` owns the selected Jig and FLOW names, emblems, wordmarks, colors,
  proportions, and implementation asset map.
- `maintainer-guide.md` owns repository-wide engineering workflow and invariants.
  It covers modular methods, usable interfaces, real-boundary verification and host qualification.
  Detailed product mechanics stay in their linked specifications.
- `coordination/` owns project coordination records. Its `ROADMAP.md` gives a
  compact, high-level view of outcome order and the next steps. Its `inbox/`
  holds postponed tasks that await triage.
- `suspended-experiments.md` points to deleted experiments only when their
  evidence may be useful under an explicit reconsideration gate.
- `field-notes/` preserves selected first-person causal evidence without making
  it current architecture or required introductory reading.
- `marketing/` owns concrete promotional materials and video production guides,
  applying audience and communication strategy without redefining it.
- `skills/` contains tracked skill entrypoints, guides, and references.
- Product behavior, public API documentation, and user guides belong outside
  `.agents/`.

## Local Contracts

- A skill describes how an agent should use an actual public interface. It does
  not create or extend that interface.
- Scoped work rules belong in the applicable `AGENTS.md`. Repository-wide
  engineering workflow and rationale belong in `maintainer-guide.md`, required
  by the root entrypoint. Product rationale belongs in the doctrine. Recovery
  landmarks belong in `suspended-experiments.md`.
- Edit the compass, doctrine, audience, communication guide, maintainer guide,
  roadmap, and recovery index in place. Keep dated snapshots, current blockers,
  and release anomalies in `.tmp/`.
- Promote a retrospective to `field-notes/` only when it preserves useful
  first-hand causality that Git and the living records cannot. It remains
  non-normative, is never default reading, and must not carry current status.
- Keep purpose, audience strategy, and communication in their separate owners.
  Purpose and the compass reference the strategy documents. Target segments and
  editorial choices do not define product purpose or public contracts. Audience
  strategy owns the opportunity of bringing Agents into production software.
  Communication explains the design conviction and its benefits.
- Keep product identity decisions in `brand.md`. Public communication follows
  that system without adding publisher names to product marks.
- Keep the compass a concise entrypoint and the doctrine the home of detailed
  product reasoning. Current behavior, implementation mechanics, roadmap order,
  and research catalogues retain their existing owners.
- All of these owners respect the root product authority pyramid. Specific
  engineering guidance may implement, but never override, product principles.
- Before an approved vertical, use one transient `.tmp/` pre-mortem when it
  helps coordination. Promote only stable rules, decisions, and recovery gates
  into tracked documents when the vertical closes.
- Keep trigger descriptions precise and keep `SKILL.md` concise by routing
  detailed material to its own `guides/` and `reference/` files.
- Reconcile skill instructions when the referenced public API changes.
- Preserve working relative links within each skill.

## Work Guidance

- Apply the technical English rules in
  [maintainer-guide.md](maintainer-guide.md#write-clear-technical-english).
- Prefer updating an existing owner over duplicating the same rule in several
  internal files.
- Use the compass's distinct aspiration, core ideas, and product promises.
  Describe Jig's agency for human and software consumers without implying that a
  consumer can grant itself authority.
- Teach concepts without assuming project history. Keep the maintainer guide
  efficient to load. Give a subject a separate document only when it acquires a
  distinct durable owner or verification contract.
- Keep the roadmap tied to the doctrine. Limit it to a small, direct overview of
  outcomes and the next steps. Do not expand it into a complete task list or
  subsystem inventory. Put postponed, untriaged tasks in
  `coordination/inbox/*.md`. Release status, active execution plans and blockers
  remain in `.tmp/`.

## Verification

- Check every internal link after moving or renaming guidance or skill files.

## Child DOX Index

- [brand.md](brand.md) — Selected Jig and FLOW product identity and visual
  system.
- [doctrine/AGENTS.md](doctrine/AGENTS.md) — Product purpose, FLOW and Jig
  reasoning, and cross-product judgment. The compass remains the entrypoint.
- [coordination/AGENTS.md](coordination/AGENTS.md) — Project roadmap and
  untriaged postponed-task inbox.
- [field-notes/AGENTS.md](field-notes/AGENTS.md) — Optional non-normative
  engineering retrospectives and historical causal evidence.
- [marketing/AGENTS.md](marketing/AGENTS.md) — Promotional materials,
  demonstration scripts, and recording guides grounded in public examples.
