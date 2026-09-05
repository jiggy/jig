# Repository instructions

## Product authority and entry path

**Expand human possibility** is the shared aspiration. **Capability
compounding** is FLOW's core idea. **Agency** is Jig's core idea, expressed as
**power under control**. Every project decision must respect this doctrine.

The product authority pyramid descends from:

1. Shared aspiration and each project's core idea.
2. Guiding principles that protect those ideas.
3. Design commitments, responsibility boundaries, and accepted tradeoffs.
4. Specifications, roadmap choices, and operational work rules.
5. Implementations, configurations, examples, experiments, and individual edits.

A lower level may refine a higher one but must never contradict it. Constraints
accumulate down the pyramid: invoking a core idea does not authorize bypassing
a specific principle or safeguard. FLOW and Jig are sibling branches; a Jig
decision cannot subordinate FLOW's independence to Jig's convenience.

Before making project decisions, read the
[product compass](.agents/product-compass.md),
[shared purpose](.agents/doctrine/purpose.md), the relevant
[FLOW](.agents/doctrine/flow.md) or [Jig](.agents/doctrine/jig.md) branch (both
for cross-project work), and [design judgment](.agents/doctrine/design-judgment.md).
Relate material choices to the principles they serve. Independent probe
consumers do not make platform decisions and retain their public-only inputs.

Use the [maintainer guide](.agents/maintainer-guide.md) for engineering and the
[roadmap](.agents/ROADMAP.md) for outcome order. Inspect Git, relevant package
registries, and current automation before asserting present implementation or
release state. Transient task lists and reports belong in `.tmp/`.

If a lower-level proposal or existing contract conflicts with a higher-level
commitment, do not implement the conflict or silently reinterpret either side.
Choose a conforming alternative; if none is established, pause the affected
work and ask the owner to resolve the conflict at its owning level. A core
idea does not itself select an API, prove a hypothesis, or authorize new scope.
Doctrinal wording does not silently change an exact public contract: resolve
the conflict through authorized, synchronized revisions to the affected
guidance, specifications, schemas, implementation, and tests before proceeding.
Evidence can motivate a revision; it cannot grant permission to contradict an
unchanged higher-level commitment.

## No prerelease compatibility

Jig and FLOW are prerelease projects. Do not retain deprecated, superseded,
transitional, or compatibility-only code, schemas, formats, migrations, tests,
aliases, or documentation. When one design replaces another, remove the old
path completely in the same change.

Registry-visible development alphas do not by themselves establish a
compatibility promise. Until the owner explicitly promotes a Jig, FLOW, or
Capability Contract interface, keep its current version provisional: replace
draft semantics in place and keep implementation, schemas, fixtures, and
documentation synchronized instead of creating prerelease version archaeology.
This does not permit overwriting an immutable package archive; advance the
package prerelease identifier when publishing changed bytes without treating
that identifier as a compatibility or migration obligation.

Preserve compatibility only when the user explicitly requires it for an
already released external interface.

This removal rule governs active product, test, schema, and normative
documentation surfaces. It does not erase selected non-normative recovery
landmarks or historical field notes isolated under `.agents/`; those records
must remain explicitly subordinate and must never load a compatibility path.

---

# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls only local details consistent with parent contracts; no child may weaken DOX or the product authority pyramid

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be
- Filesystem proximity does not raise product authority: local rules and
  implementation choices remain subject to the higher-level doctrine

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:
- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Write living docs as first-time entrypoints with no assumed conversations or
  prior participation. Lead with the owning core idea or purpose, then a few
  principles, then wider commitments and details. Explain necessary terms
  before relying on them; keep historical narratives in their optional owner
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale instructions from living docs instead of explaining history
  there; keep only selected evidence in its designated non-normative owner
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## User Preferences

- Keep the first releases radically simple: no `jig setup`, user-visible
  lifecycle machinery, second lock protocol, or framework added merely to
  make private implementation convenient.
- Advance the next useful outcome using completed evidence and the existing
  release gates. Do not restart a separate baseline probe campaign unless a
  change or failure invalidates that evidence; independent consumers should
  exercise the next capability being earned.
- Stop for owner direction before a change materially expands product concepts
  or chooses between genuinely different product directions. It is preferable
  to report a precise blocker early than to overcomplicate the solution.
- When the owner authorizes several independent verticals, a blocker in one
  does not stop the others. Commit its stable in-scope work, retain unstable
  evidence on a separate experimental branch only when it is worth keeping,
  record only owner-actionable blockers in `.tmp/`, and continue the other
  authorized verticals.
- Never absorb a development sandbox, proof-host package manager, credential,
  model, or other local limitation into Jig or FLOW architecture. Ask for the
  exact generic environment capability or report its absence.
- Agent clients, endpoints, credentials, and models are trusted host choices,
  never FLOW inputs or development defaults. Keep compatible endpoints named
  by the wire API they actually implement and keep native clients thin over
  the shared ACP lifecycle so future clients do not require FLOW changes.
- Keep design probes disposable under `.tmp/design-probes-*`. Independent
  probe agents receive published artifacts and public documentation, not
  internal source, roadmaps, old probes, or permission to modify the platform
  they are evaluating.
- Keep public material under `docs/`. Put internal engineering orientation,
  recovery indexes, and long-term planning under `.agents/`; keep per-vertical
  pre-mortems and dated reports in `.tmp/` and promote only durable conclusions
  or exceptional causal evidence to their designated owners.
- Historically valuable first-person engineering evidence may be promoted to
  `.agents/field-notes/` when Git and the living guides cannot preserve its
  causality. Field notes are optional, non-normative evidence and must never
  become a competing source of current product truth.
- Use the `jiggy` GitHub organization and keep npm packages under `@jigging/*`
  until the owner obtains and selects the npm `@jiggy` scope. Keep FLOW
  technically and publicly distinct from Jig while retaining the monorepo
  until separation has concrete value.
- When the user requests a durable behavior change, record it here or in the
  relevant child `AGENTS.md`.

## Child DOX Index

- [.agents/AGENTS.md](.agents/AGENTS.md) — Internal product compass and doctrine,
  recovery, planning, optional field notes, and repository-native agent skills.
- [.github/AGENTS.md](.github/AGENTS.md) — Continuous integration, release,
  host-conformance, and public-site automation.
- [conformance/AGENTS.md](conformance/AGENTS.md) — Implementation-independent
  executable evidence for versioned FLOW protocol candidates.
- [docs/AGENTS.md](docs/AGENTS.md) — Public specifications, current product
  guidance, and research catalogues.
- [examples/AGENTS.md](examples/AGENTS.md) — Authored applications exercising
  documented composition, with their own fixtures and checks.
- [packages/AGENTS.md](packages/AGENTS.md) — Publishable SDK and Jig host
  implementations, with their package-local tests and artifacts.
- [scripts/AGENTS.md](scripts/AGENTS.md) — Build, verification,
  release-candidate, and site-assembly entrypoints.
- [site/AGENTS.md](site/AGENTS.md) — FLOW and Jig public-site configuration,
  static root files, shared tooling, and deployment topology.
