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
- Runnable examples must include their dependency closure. Preparing it is
  repository build/distribution work, not a quickstart loop in which consumers
  visit each Flow and generate its lock. Preserve real artifact identities and
  use supported tooling; never invent registry integrity or imply that a
  missing dependency has been supplied. Link to the current installation guide.
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

## Child DOX Index

- [proposal-workshop/AGENTS.md](proposal-workshop/AGENTS.md) — A bounded
  proposal workshop with separate drafting and evidence-review methods.
- [tested-patch/AGENTS.md](tested-patch/AGENTS.md) — A multi-file Bun project
  repair with contained commands and independently checked patch evidence.
- [live-agent/AGENTS.md](live-agent/AGENTS.md) — One Agent call with application-owned
  live progress filtering and an independently interpreted final result.
