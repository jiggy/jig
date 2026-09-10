# Reusable Agent method

## Purpose

Make a bounded Agent procedure independently reusable as a library and an
ordinary Flow, preserving operator ownership of Agent execution.

## Ownership

- `src/` owns prompt preparation, structured schema checking, JSON/1 decoding,
  result assembly, the optional package Skill reader, and ordinary Run/1 wiring.
- The root `FLOW.ts` supplies the literal package root to the bundled runtime.
- `contracts/agent-exchange/` mirrors the exact public descriptor and channel
  closure owned by `docs/jig/spec/contracts/agent-exchange/`.
- Package source, declarations, built runtime, licenses, tests, and build
  instructions form one release artifact.
- `scripts/pack.ts` owns artifact staging. Packed `tooling/flow-sdk.tgz` is the
  complete ordinary SDK package; `tooling/flow-sdk.json` records its identity
  and SHA-256. Both are generated, included build inputs.

## Local Contracts

- Pure exports perform no provider dispatch or filesystem access. The separate
  `./skills` export reads only explicitly selected package-local Skill trees.
- The ordinary Flow exchanges once and forwards an unused optional events
  endpoint directly. Its selected Skills belong to this package, never callers.
- Preserve the shared 64-group, 1,024-item, 1 MiB content and 1 MiB rendered
  prompt limits. Reject duplicate selections, invalid UTF-8 and symlinks.
- Runtime dependencies are bundled; installed consumers need no build hook.
- The source workspace uses `workspace:*` for SDK development. Packing changes
  only the staged manifest to `file:./tooling/flow-sdk.tgz`, so normal development
  installation uses the included candidate SDK bytes. Repacking an extracted
  method preserves those bytes and checks their recorded digest.
- Workspace packing may consume `FLOW_SDK_PACKAGE_ARCHIVE` to include the exact
  complete SDK artifact already tested by release automation. Match its package
  identity; the supplied archive digest records the actual candidate bytes.
- Native Jig imports this same method and independently validates its trusted
  boundaries. This package does not assert native caller context or authority.

## Work Guidance

- Keep the bounded JSON/1 codec and schema profile local; no sibling private
  imports or general provider/schema framework.
- Update source and rebuild the corresponding packed runtime when adapting the
  method. Do not edit generated `dist/` files.

## Verification

- `just build` compiles declarations and bundles the ordinary runtime.
- `just test` checks the method, JSON/1, bounded reader, and Flow wiring.
- `just pack --destination <directory>` builds the complete archive explicitly.
- After building, `bun scripts/pack.ts --destination <directory>` packs existing
  output without rebuilding. The package test also verifies SDK closure and
  repacking; it requires the existing method and SDK build outputs.

## Child DOX Index
