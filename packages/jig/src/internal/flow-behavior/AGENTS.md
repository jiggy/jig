# Source behavior inspection

## Purpose

Explain conditional behavior from a captured Jig project without running its methods.

## Ownership

- `captured-input.ts` borrows source and interface facts from working-tree inspection.
- `source.ts` resolves parsed source and call identities inside one captured package.
- `analyze.ts` evaluates a bounded TypeScript subset through inert values.
- `data.ts` checks which data computations can safely lose value precision.
- `compose.ts` owns configured handoffs, caller continuations, and coverage.
- `reporting-capture.ts` recognizes local installed Reporting bytes.
- `reporting.ts` describes supported authored progress payloads.

## Local Contracts

- Keep analyzer inputs in memory. Use the existing capture owners for filesystem reads.
- Carry hypothetical results and known effects through caller continuations.
- Keep incomplete values distinct from unknown control flow.
- Keep unresolved checks attached to their conditional continuations.
- Retain bounded child paths from the call evaluation that supplied the displayed result.
- At an analysis cutoff, keep established paths and identify omitted alternatives.
- Retain distinct exits before further variants of the same exit.
- Interpret finite literal-array loops and empty error subclasses without executing source.
- Evaluate small inert array transformations through proven data-only callbacks.
- Mark successful continuation of unresolved data mappings as conditional.
- Keep contextual presentation records outside semantic path deduplication.
- Analyze the application within a shared work allowance while preserving each configured use.
- Apply the same known-return contract checks at standalone and child boundaries.
- Bound proven data-only reporting work within the enclosing analysis allowance.
- Source analysis grants no admission, execution, or retry authority.
- Preserve source references, call context, and explicit unsupported regions.
- Keep the private result independent of CLI and display rendering.

## Verification

- `bun test packages/jig/test/portable/flow-behavior.test.ts`
- The installed lifecycle suite checks a callee edit and a native caller Run.

## Child DOX Index
