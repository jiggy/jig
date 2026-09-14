# Authored applications

## Purpose

Teach recommended practices for composing useful portable methods under
operator-held authority through reviewed applications. These are deliberately
authored examples, not independent consumer evidence or promoted Starters.

## Ownership

- `README.md` routes readers through the examples by useful outcome.

- Each application owns its domain method, fixtures, local tests, and exact
  Flow and Binding declarations.
- Public instructions belong in `docs/jig/`; each code package's `README.md`
  explains its procedure, `FLOW.ts` implements it, `flow.meta.json` owns optional
  metadata and slot declarations, and `FLOW.contract.json` owns invocation constraints.
- Platform contracts remain owned by `docs/`, `packages/`, and `conformance/`.

## Local Contracts

- Keep each Flow self-contained and invoke collaborators only through the
  public FLOW SDK. Do not import sibling package source or host internals.
- Use `run.call()` for every declared slot and inspect the complete `RunResult`.
  Copy named native contract bundles with their descriptor-relative channel
  paths intact; declarations never substitute for native host authority.
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
  Agent-using applications choose an ordinary provider by contract or exact slot;
  the operator declares its dependency and configures its resource grants.
  `tested-patch` includes its `npm:` ACP dependency and editable Agent Binding.
  Do not add a source wrapper or repository-only route around that package.
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
- Use a small useful application to expose missing boundaries. Do not add a
  framework, general scheduler, or provider configuration surface here.

## Verification

- Run `bun test examples/request-triage/test examples/support-case/test examples/tested-patch/test examples/incident-brief/test`
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
- [incident-brief/AGENTS.md](incident-brief/AGENTS.md) — Internal drafting with
  one bounded summary handoff and an independent review-question worker.
