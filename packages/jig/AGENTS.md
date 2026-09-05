# Jig package

## Purpose

Implements the `@jigging/jig` authoring API and installed Linux host for
admitted FLOW packages.

## Ownership

- `src/index.ts` and `src/project/author.ts` own the public authoring surface.
- The CLI, package/project capture, schemas, capability parsing, Run host, and
  administration objects are package-owned implementation.
- `test/` owns unit, integration, fault-injection, packed-package, and
  proof-host evidence.
- `scripts/`, `support/`, the manifest, README, licenses, and notices own
  package assembly inputs. Bun generates the ignored root workspace lock;
  `dist/`, `bin/`, and `libexec/` are generated.

## Local Contracts

- `src/index.ts` is the only JavaScript package export. Other exported symbols
  are private composition or test seams.
- Expose only the documented CLI and authoring surface; private host machinery
  is not a provider, runtime, or containment SPI.
- FLOW and Jig specifications and machine schemas are authoritative. Accept
  only bounded, canonical current formats.
- Capture mutable project source before evaluation, admission, preparation, or
  execution; Runs use retained admitted bytes.
- Public output must not disclose credentials, sandbox internals, private
  paths, or internal identity records.
- Make errors actionable: explain the failure, known cause, relevant location,
  and next safe step, alongside useful machine codes. Review must support
  informed consent; result displays must distinguish execution completion from
  achieving the application's objective. Follow the doctrine's
  [usable-control principle](../../.agents/doctrine/jig.md#understandable-feedback-and-actionable-errors).
- Build with the exact pinned Bun version and reconcile dependency changes
  with the lock, package inventory, licenses, and notices.

## Work Guidance

- Change implementation, normative specification, schema, README, and tests
  together when a public contract changes.
- Keep fault-injection seams private.
- Consult `src/internal/AGENTS.md` for containment, durability, or Agent host
  work.

## Verification

- `bun test packages/jig`
- `bun run --cwd packages/jig check`
- Use `scripts/test-release.sh` for packed or cross-protocol changes.
- Trust-boundary changes require the provisioned host-conformance workflow.
- Test diagnostic usefulness as well as redaction, and human-facing output
  alongside its machine-readable contract.

## Child DOX Index

- [src/internal/AGENTS.md](src/internal/AGENTS.md) — Private admission,
  containment, execution, durable state, and Agent-provider boundary.
