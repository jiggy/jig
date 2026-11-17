# Source behavior inspection

## Purpose

Explain conditional behavior from a captured Jig project without running its methods.

## Ownership

- `captured-input.ts` borrows source and interface facts from working-tree inspection.
- `source.ts` resolves parsed source inside one captured package.
- `analyze.ts` evaluates a bounded TypeScript subset through inert values.
- `compose.ts` owns configured handoffs, caller continuations, and coverage.
- `reporting-capture.ts` recognizes local installed Reporting bytes.
- `reporting.ts` describes supported authored progress payloads.

## Local Contracts

- Keep analyzer inputs in memory. Use the existing capture owners for filesystem reads.
- Keep captured source returns distinct from hypothetical child results.
- Source analysis grants no admission, execution, or retry authority.
- Preserve source references, call context, and explicit unsupported regions.
- Keep the private result independent of CLI and display rendering.

## Verification

- `bun test packages/jig/test/portable/flow-behavior.test.ts`
- The installed lifecycle suite checks a callee edit and a native caller Run.

## Child DOX Index
