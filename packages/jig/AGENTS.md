# Jig package

## Purpose

Provide agency through exact approved execution and usable control. This package
owns the public authoring API and installed Linux and qualified Mac hosts.

## Ownership

- The CLI, package/project capture, invocation contracts, Run host, and
  administration objects are package-owned implementation.

- `src/markdown/` owns the sequential Markdown parser and interpreter, using the
  public FLOW SDK inside the ordinary contained runtime. Root
  `FLOW.contract.json` owns invocation declarations. Code metadata uses
  `FLOW.meta.json` and Markdown uses optional frontmatter. Exactly one
  `FLOW.<ext>` is executable.

- Execution requests and process evidence are private host-neutral contracts in
  `src/internal/execution-intent.ts` and `execution-process.ts`. Jig controllers
  retain policy and durable lifecycle. Host translation owns physical launch
  layout. `src/run/session.ts` consumes process evidence without owning backend
  types. These private contracts add no package export, FLOW wire contract or host plugin interface.

- Root licensing and pricing are canonical. The build copies their retained
  texts. Source delivery belongs to the matching GitHub release and its tagged
  repository archive. Never embed source archives or add source-assembly
  machinery to the npm package. `RELEASING.md` owns source-build instructions.

- The package README summarizes free eligibility, company coverage, lasting
  release rights, and distributed-source duties, linking to those retained
  terms.

The guides contain module indexes. Each selected guide remains required reading.
Read every guide that matches the affected files or responsibilities:

| Work | Required guide |
| --- | --- |
| `src/project/`, `src/package/`, initialization, declarations, slots, grants, contracts or source capture | [Authoring and project interfaces](authoring-guidance.md) |
| `src/client.ts`, attempt contracts, `src/cli*`, machine requests, command grammar, completion, progress, inspection, terminal output or display integration | [Command presentation and application client](cli-guidance.md) |
| Builds, packing, patches, installed artifacts, platform promotion, native or release qualification | [Assembly and qualification](qualification-guidance.md) |
| `src/internal/`, containment, durable authority, execution or native resources | [Private host](src/internal/AGENTS.md) and its required domain guides |
| Markdown parsing or interpretation | [Markdown runtime](src/markdown/AGENTS.md) |
| Test construction, applicability or evidence | [Test suites](test/AGENTS.md) and the guide for the behavior under test |

Cross-domain changes must read all affected rows. A source change does not
qualify an installed artifact or a different platform.

## Local Contracts

- The root JavaScript export is inert authoring. `./client` is the separate
  installed-host execution client. Other exported symbols remain private composition
  or test seams. Expose only documented public surfaces.
  Private host machinery is not a provider, runtime, or containment SPI.

- FLOW and Jig specifications and machine schemas are authoritative. Accept only
  bounded, canonical current formats.

- Capture mutable project source before evaluation, admission, preparation, or
  execution. Runs use retained admitted bytes.

- Public output must not disclose credentials, sandbox internals, private paths,
  or internal identity records. Review may show the resolved operator-selected
  native Agent executable path for informed selection.

- Make errors actionable: explain the failure, known cause, relevant location,
  and next safe step, alongside useful machine codes. Review must support
  informed consent. Result displays must distinguish execution completion from
  achieving the application's objective. Follow the doctrine's
  [usable-control principle](../../.agents/doctrine/jig.md#understandable-feedback-and-actionable-errors).

- Build with the exact pinned Bun version and reconcile dependency changes with
  the lock, package inventory, licenses, and notices.

## Work Guidance

- Change implementation, normative specification, schema, README, and tests
  together when a public contract changes.

- Follow the maintainer guide's
  [no-mocks rule](../../.agents/maintainer-guide.md#test-real-boundaries-never-mocks).
  Use real stores and subprocesses. Installed and native claims require their
  ordinary public and qualified native paths. Never rewrite workers or simulate owners.

- Attach expected rejection handlers before cancellation or asynchronous
  teardown can settle pending test operations. Still await both rejection and
  cleanup.

- Test fixtures use canonical dependency paths, including through Bun workspace
  symlinks. Source-tree proof commands reuse
  `test/fixtures/installed-bun-location.ts` rather than defining their own
  runtime locations. Do not rewrite source to manufacture host evidence.

- Consult `src/internal/AGENTS.md` for containment, durability, or Agent host
  work.

## Verification

- `just jig::test`
- `just jig::check`
- Use `scripts/test-release.sh` for packed or cross-protocol changes.
- Trust-boundary changes require the provisioned host-conformance workflow.

Use the selected domain's checks and the current whole-file inventory in
[`scripts/ci/test-suites.json`](../../scripts/ci/test-suites.json). Keep source
tests, installed consumers and native qualification distinct.

## Child DOX Index

- [authoring-guidance.md](authoring-guidance.md) — Authored values, captured
  packages, contracts, routes and resource selection.
- [cli-guidance.md](cli-guidance.md) — Shared presentation, application client,
  command semantics, inspection and renderer integration.
- [qualification-guidance.md](qualification-guidance.md) — Artifact assembly,
  native evidence and installed consumers.
- [test/AGENTS.md](test/AGENTS.md) — Whole-file suite applicability, installed
  consumers, live prerequisites and evidence.
- [support/AGENTS.md](support/AGENTS.md) — Native policy assets and the private
  Mac pre-exec boundary. Installed-platform promotion remains package-owned.
- [src/internal/AGENTS.md](src/internal/AGENTS.md) — Private admission,
  containment, execution, durable state, and Agent-provider boundary.
- [test/fixtures/channel-conversation/AGENTS.md](test/fixtures/channel-conversation/AGENTS.md)
  — Internal request/reply peers for installed channel and cancellation proof.
- [test/fixtures/repair-batch/AGENTS.md](test/fixtures/repair-batch/AGENTS.md) —
  Batch/checkpoint host-proof additions assembled over the focused repair
  example.
- [src/markdown/AGENTS.md](src/markdown/AGENTS.md) — Frozen recipe parsing,
  finite interpretation, whole-value handles and bounded reasoning context.
