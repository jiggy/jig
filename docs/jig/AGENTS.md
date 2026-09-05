# Jig documentation

## Purpose

Owns Jig's current host documentation and its non-normative catalogue of
use-case and orchestration hypotheses.

## Ownership

- `spec/` owns current Jig host requirements and machine companions.
- `index.md` and `guide/` teach implemented behavior and recommended practice,
  identifying any example that requires a source candidate rather than a
  published artifact.
- `use-cases.md` records outcome-oriented product hypotheses.
- `orchestration-patterns.md` records candidate reusable methods.

## Local Contracts

- Feature claims in guides describe only implemented behavior and defer to
  Jig specifications. General design advice must not imply that a future host
  surface is currently available.
- Use cases and patterns are research, not commands, APIs, primitives, product
  availability, or roadmap promises.
- Jig should be able to host workflow methods without having to own each one.
  Keep method-specific semantics inside Flows, prompts, skills, graph
  libraries, or specialist packages unless the host must enforce authority or
  lifecycle.
- Put each concern in its smallest honest layer. These are overlapping design
  dimensions, not mutually exclusive method categories:
  - prompt technique: an Agent instruction, skill, or Flow recipe;
  - graph shape: ordinary Flow or graph-library composition;
  - feedback source: evidence supplied to a check, gate, or loop;
  - specialized optimizer: a reusable Flow or library;
  - recipe: concise runnable guidance using a current public surface;
  - host responsibility: admission, authority, containment, durable
    lifecycle, binding, or approval that Jig must enforce;
  - named pattern: a reusable structure whose boundary prevents a distinct
    failure.
- Add a candidate pattern only when it addresses a recurring named failure,
  has a minimum structure whose removal changes the claim, is more than an
  ordinary graph shape, plausibly transfers to materially different jobs,
  states its collapse condition, and defines a falsifiable comparison against
  the strongest credible simpler baseline, including cost and latency.
- Call a pattern supported only when comparative evidence isolates the value
  of its irreducible structure from extra calls, tokens, tools, or authority,
  and the result transfers beyond its originating example.
- Merge or remove a candidate when it collapses into a primitive, established
  method, domain recipe, or implementation brand. Preserve useful negative
  evidence with the relevant use case rather than keeping a dead pattern.
- Use an established name when its semantics fit. Do not rebrand a known
  technique merely because Jig can host it.
- Lesser or adjacent techniques may appear as short primary-source links
  grouped by family when they clarify provenance, mechanism, or selection.
  Do not write local surveys or full briefs merely for completeness.
- Organize probes around workflow families and their distinguishing property,
  not every branded technique. Compare one representative with the strongest
  simpler baseline. A passing probe supports only the tested variant.
- Multi-Agent structure is neither required nor sufficient for pattern
  status.
- Prefer executable, environmental, independent, or human feedback when it is
  available. Do not call self-critique verification.
- Preserve the current uniform record shape within each catalogue.

## Work Guidance

- Start with the user's visible result and the simplest credible alternative.
- Explain an unfamiliar name in one short paragraph before presenting tests,
  topology, prerequisites, or metrics.
- Add structure only when it removes a demonstrated failure or enforces a
  boundary the simpler design cannot.

## Verification

- Check every local anchor and relative link after changing either catalogue.
- Build the Jig site into a fresh directory with `scripts/build-site.sh`.

## Child DOX Index

- [spec/AGENTS.md](spec/AGENTS.md) — Current Jig specifications, machine
  schemas, and exact capability contracts.
