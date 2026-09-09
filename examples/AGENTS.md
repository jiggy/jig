# Authored applications

## Purpose

Teach recommended practices for composing useful portable methods under
operator-held authority through reviewed applications. These are deliberately
authored examples, not independent consumer evidence or promoted Starters.

## Ownership

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
  Use the same dependency preparation as other consumers, not specially bundled
  application archives or per-Flow setup loops. Test unpublished SDK candidates
  separately from claims about registry availability.
- Agents, models, credentials, and execution policy remain operator choices.
- Label synthetic evidence and keep it distinct from claims about real users.

## Work Guidance

- Prefer experienced authors and reviewers with full project context. Examples
  should show users how to use the public interfaces well; they do not need the
  fresh-context restrictions that make independent design probes effective.
- Use a small useful application to expose missing boundaries. Do not add a
  framework, general scheduler, or provider configuration surface here.

## Verification

- Run `bun test examples/proposal-workshop/test` for the workshop's
  deterministic completeness, citation, revision, and failure checks. The
  same tests run in `scripts/test-release.sh` and existing CI.
- Exercise package boundaries through an admitted Jig Run before claiming
  host execution; unit tests alone establish only application behavior.
- Run `bun test examples/tested-patch/test` for multi-file patch policy and
  independent acceptance of command observations after installing that application's development
  dependencies as its Child DOX describes. These tests also run in `scripts/test-release.sh`.
- Run `bun test examples/dataset-analysis/test` for bounded adaptive requests,
  reply validation, and independent crossing verification after preparing its
  development dependency. These tests also run in `scripts/test-release.sh`.

## Child DOX Index

- [proposal-workshop/AGENTS.md](proposal-workshop/AGENTS.md) — A bounded
  proposal workshop with separate drafting and evidence-review methods.
- [tested-patch/AGENTS.md](tested-patch/AGENTS.md) — A multi-file Bun project
  repair with contained commands and independently checked patch evidence.
- [live-agent/AGENTS.md](live-agent/AGENTS.md) — One Agent call with application-owned
  live progress filtering and an independently interpreted final result.
- [dataset-analysis/AGENTS.md](dataset-analysis/AGENTS.md) — Adaptive threshold
  search through two named channels and separately checked child results.
