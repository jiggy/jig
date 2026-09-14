# Authored applications

## Purpose

Teach recommended practices for composing useful portable methods under
operator-held authority through reviewed applications. These are deliberately
authored examples, not independent consumer evidence or promoted Starters.

## Ownership

- `README.md` routes readers through the examples by useful outcome.

- Each application owns its domain method, fixtures, local tests, and exact
  Flow and Binding declarations.
- Public instructions belong in `docs/jig/`; portable procedure descriptions
  remain in each package's `FLOW.md`.
- Platform contracts remain owned by `docs/`, `packages/`, and `conformance/`.

## Local Contracts

- Keep each Flow self-contained and invoke collaborators only through the
  public FLOW SDK. Do not import sibling package source or host internals.
- Examples track the current Jig and FLOW source together. Build and test them
  against the current SDK without waiting for npm publication; do not preserve
  superseded APIs, release-order warnings, or compatibility branches.
- Examples remain ordinary editable source projects with declared dependencies.
  Applications and their Flows are Bun workspace members using the checkout SDK
  through `workspace:*`. Root installation and ordinary SDK builds prepare
  development; Jig captures runtime dependencies during review.
  Use the same dependency preparation as other consumers, not specially bundled
  application archives or per-Flow setup loops. Test unpublished SDK candidates
  separately from claims about registry availability.
- Agents, models, credentials, and execution policy remain operator choices.
- Label synthetic evidence and keep it distinct from claims about real users.

## Work Guidance

- Prefer experienced authors and reviewers with full project context. Examples
  should show users how to use the public interfaces well; they do not need the
  fresh-context restrictions that make independent design probes effective.
- Keep the portfolio selective: every example must teach a useful task for
  developers putting intelligence inside software, or make the common code/Agent
  boundary immediately understandable. Delete weak or redundant examples;
  expected future additions are not a reason to preserve filler.
- Introduce the user's outcome before mechanisms. Progress, channels, and
  multiple Agents do not independently justify a standalone example. Host proof
  fixtures belong with their tests, not in the public portfolio.
- Every example has a complexity cap in its local contract: one primary lesson,
  a recognizable task, and only the concepts/setup needed to teach it honestly.
  Examples introduce capabilities; they are not complete production solutions.
- Keep validation and failure handling required by that lesson. Narrow the task
  if those safeguards exceed its teaching budget; do not remove the safeguards.
- Before adding a capability, consider an independent example. Extend an existing
  example only when the interaction itself is the lesson. Optional modes still
  consume complexity; hiding them later in a guide does not remove their cost.
- A separate example must earn its own learning payoff. Do not proliferate generic
  demos or preserve old examples just because a capability exists.
- Use a small useful application to expose missing boundaries. Do not add a
  framework, general scheduler, or provider configuration surface here.

## Verification

- Run `bun test examples/request-triage/test examples/support-case/test examples/tested-patch/test examples/contact-import/test`
  after workspace setup. The release gate repeats these application checks
  against the freshly packed SDK.
- Exercise package boundaries through an admitted Jig Run before claiming
  host execution; unit tests alone establish only application behavior.
- Keep live Agent evidence separate from deterministic substitutes and model-quality claims.

## Child DOX Index

- [request-triage/AGENTS.md](request-triage/AGENTS.md) — One caller and three
  implementations of a queue suggestion, through the same Flow boundary.
- [support-case/AGENTS.md](support-case/AGENTS.md) — Agent interpretation of a
  disputed charge, checked by application-owned credit policy.
- [tested-patch/AGENTS.md](tested-patch/AGENTS.md) — A multi-file Bun project
  repair with contained commands and independently checked patch evidence.
- [contact-import/AGENTS.md](contact-import/AGENTS.md) — A CSV preview with
  interchangeable code, Agent, and mixed column-mapping methods.
