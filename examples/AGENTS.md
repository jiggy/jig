# Authored applications

## Purpose

Demonstrate useful composition of portable methods under operator-held
authority. These are deliberately authored applications, not independent
consumer evidence or promoted Starters.

## Ownership

- Each application owns its domain method, fixtures, local tests, and exact
  Flow and Binding declarations.
- Public instructions belong in `docs/jig/`; portable procedure descriptions
  remain in each package's `FLOW.md`.
- Platform contracts remain owned by `docs/`, `packages/`, and `conformance/`.

## Local Contracts

- Keep each Flow self-contained and invoke collaborators only through the
  public FLOW SDK. Do not import sibling package source or host internals.
- Pin published SDK dependencies that supply the interfaces actually used;
  generate their locks with the supported authoring tool, never by guessing
  integrity values. State which host release or candidate the example needs.
- Agents, models, credentials, and execution policy remain operator choices.
- Label synthetic evidence and keep it distinct from claims about real users.

## Work Guidance

- Use a small useful application to expose missing boundaries. Do not add a
  framework, general scheduler, or provider configuration surface here.

## Verification

- Run `bun test examples/proposal-workshop/test` for the workshop's
  deterministic completeness, citation, revision, and failure checks. The
  same tests run in `scripts/test-release.sh` and existing CI.
- Exercise package boundaries through an admitted Jig Run before claiming
  host execution; unit tests alone establish only application behavior.
- Run `bun test examples/tested-patch/test` for patch policy and the fixed
  acceptance-checker process after installing that application's repair Flow
  dependency as its Child DOX describes. These tests also run in `scripts/test-release.sh`.

## Child DOX Index

- [proposal-workshop/AGENTS.md](proposal-workshop/AGENTS.md) — A bounded
  proposal workshop with separate drafting and evidence-review methods.
- [tested-patch/AGENTS.md](tested-patch/AGENTS.md) — One isolated source repair
  with a separately executed acceptance checker and inspectable patch evidence.
