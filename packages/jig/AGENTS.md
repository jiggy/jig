# Jig package

## Purpose

Implements the `@jigging/jig` authoring API and installed Linux host for
admitted FLOW packages.

## Ownership

- `src/index.ts` and `src/project/author.ts` own the public authoring surface.
- The CLI, package/project capture, schemas, capability parsing, Run host, and
  administration objects are package-owned implementation.
- `src/run/channels.ts` owns finite participant-scoped endpoint rights, atomic
  transfer, bounded direct delivery, isolated broadcast subscriptions and source
  lifetime. It is not an event bus or execution scheduler; package validation
  precedes implicit writer sealing.
- `test/` owns unit, integration, fault-injection, packed-package, and
  proof-host evidence.
- `justfile`, `scripts/`, `support/`, the manifest, README, licenses, and notices own
  package assembly inputs. Bun generates the ignored root workspace lock;
  `dist/`, `bin/`, and `libexec/` are generated.

## Local Contracts

- `src/index.ts` is the only JavaScript package export. Other exported symbols
  are private composition or test seams.
- Expose only the documented CLI and authoring surface; private host machinery
  is not a provider, runtime, or containment SPI.
- Default `init` writes a greeting Flow with a string input and a world fallback; `--bare` writes only the
  skeleton. Neither installs, networks, approves, or executes. Generated
  packages use the same dependency review as consumer-authored packages. The
  greeting names the exact tested SDK version; its regression checks the SDK
  manifest so a moving npm tag cannot silently select a different wire contract.
- Command help and syntax errors do not acquire execution authority. Review
  leads with complete changed policy; `--details` includes unchanged policy.
  Run stdout is readable on terminals; redirection or `--json` selects exact
  JSON/NDJSON. Elapsed status uses terminal stderr only;
  cancellation requested and cleanup confirmed are separate facts. Acquisition
  reports Jig runtime verification, Agent verification, and project-state recovery
  as separate stages instead of hiding them behind a prerequisites label.
- FLOW and Jig specifications and machine schemas are authoritative. Accept
  only bounded, canonical current formats.
- Capture mutable project source before evaluation, admission, preparation, or
  execution; Runs use retained admitted bytes.
- Public output must not disclose credentials, sandbox internals, private
  paths, or internal identity records. Review may show the resolved
  operator-selected native Agent executable path for informed selection.
- Make errors actionable: explain the failure, known cause, relevant location,
  and next safe step, alongside useful machine codes. Review must support
  informed consent; result displays must distinguish execution completion from
  achieving the application's objective. Follow the doctrine's
  [usable-control principle](../../.agents/doctrine/jig.md#understandable-feedback-and-actionable-errors).
- Build with the exact pinned Bun version and reconcile dependency changes
  with the lock, package inventory, licenses, and notices.

## Work Guidance

- Before any public CLI output change, read and apply
  [the CLI experience contract](../../docs/jig/spec/cli-experience.md).
  `src/cli-presentation.ts` and `src/cli-progress.ts` own shared human
  presentation; launcher failures follow the same structure. Never introduce
  a separate raw diagnostic style or route machine output through styling.
  Major terminal sections need visible boundaries; secondary metadata uses
  gray while consent, policy values, and recovery actions remain prominent.
  Structured human policy uses the shared syntax highlighter and `JIG_THEME`
  palettes; preserve exact escaped values and never style machine records.
  Review uses contextual field diffs; identity-only target changes need an
  concrete explanation of the changed execution environment or prepared files,
  unchanged policy, and approval consequence, never identical previous/proposed
  blocks or an unexplained "retained identity" label. Ignore object
  insertion order when comparing review records; preserve array order.
  `cli-run-presentation.ts` owns human Run results and channel streaming. Join
  text fragments exactly, label channel switches and endings, escape controls,
  and preserve separate execution, application, delivery, and cleanup outcomes.
  A generic failure without diagnostics must state the missing evidence; do not
  imply that the Flow never started or repeat an identical raw error block.
  Generic human failure summaries must retain specific terminal failure messages;
  hiding the structured result's message must never discard its cause. Quote and
  escape reported text as data, and do not infer missing evidence from empty
  stderr when the terminal already carries a specific explanation.
  Render host-only REVIEW_REQUIRED with `jig review` as the next action.
  Flow-supplied error details cannot establish that execution never started.

- Change implementation, normative specification, schema, README, and tests
  together when a public contract changes.
- Keep fault-injection seams private.
- Test fixtures use canonical dependency paths, including through Bun workspace
  symlinks. Source-tree proof commands reuse `test/fixtures/installed-bun-location.ts`
  rather than defining their own runtime locations. Source-rewriting hostile
  fixtures must also construct successfully in ordinary tests, so source
  formatting cannot silently break the host gate.
- Consult `src/internal/AGENTS.md` for containment, durability, or Agent host
  work.

## Verification

- `bun test packages/jig`
- `just jig::check`
- Use `scripts/test-release.sh` for packed or cross-protocol changes.
- Trust-boundary changes require the provisioned host-conformance workflow.
- CLI acceptance: `bun test packages/jig/test/cli.test.ts packages/jig/test/cli-presentation.test.ts packages/jig/test/cli-run-presentation.test.ts packages/jig/test/cli-output.test.ts packages/jig/test/project-plan-review.test.ts`.
  Check rendered success, failure, waits, cancellation, uncertain cleanup,
  plain/redirected output, narrow widths, and light/dark terminal palettes.
  Preserve byte-exact machine records and complete changed review policy.

## Child DOX Index

- [src/internal/AGENTS.md](src/internal/AGENTS.md) — Private admission,
  containment, execution, durable state, and Agent-provider boundary.
