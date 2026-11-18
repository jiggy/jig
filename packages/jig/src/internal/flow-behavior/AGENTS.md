# Source behavior inspection

## Purpose

Explain conditional behavior from a captured Jig project without running its methods.

## Ownership

- `captured-input.ts` borrows source and interface facts from working-tree inspection.
- `source.ts` resolves parsed source and call identities inside one captured package.
- `source-syntax.ts` owns shared TypeScript syntax helpers and bounded source walks.
- `slot-selection.ts` traces authored lookup rows and key origins into computed slot references.
- `analyze.ts` evaluates a bounded TypeScript subset through inert values.
- `data.ts` checks which data computations can safely lose value precision.
- `file-access.ts` recognizes read-only opens and strict UTF-8 decoding. The interpreter keeps file handles and bytes inert.
- `compose.ts` owns configured handoffs, caller continuations, and coverage.
- `comparison.ts` owns the bounded snapshot format and comparison of represented paths.
- `reporting-capture.ts` recognizes local installed Reporting bytes.
- `reporting.ts` describes supported authored progress payloads.

## Local Contracts

- Keep analyzer inputs in memory. Use the existing capture owners for filesystem reads.
- Carry hypothetical results and known effects through caller continuations.
- Keep incomplete values distinct from unknown control flow.
- Follow directly returned local async helpers through promise adoption.
  Keep rejection outside local catches unless the caller awaits inside the try.
  Disclose unsupported finalizer interleavings.
- Preserve the truthiness of a short-circuit operand without substituting a Boolean value.
- Keep unresolved checks attached to their conditional continuations.
  Show known numeric comparison operands as context at entry to the check.
- Retain bounded child paths from the call evaluation that supplied the displayed result.
- At an analysis cutoff, keep established paths and identify omitted alternatives.
- Retain distinct exits before further variants of the same exit.
- Interpret finite literal-array loops and empty error subclasses without executing source.
- Evaluate small inert array transformations through proven data-only callbacks.
- Interpret spreads of small, known scalar sets and literal numeric products.
- Keep read-only file attempts and operational checks in the Flow that performs them.
  Carry child completion, consequential guards, and writes into the caller.
  Combine equivalent operational failures at the caller and label their representative child path.
- Carry possible UTF-8 and JSON validation failures without reading file data.
  Keep the original source reference when a handler rethrows the same modeled error.
- Mark successful continuation of unresolved data mappings as conditional.
- Keep contextual presentation records outside semantic path deduplication.
- Analyze the application within a shared work allowance while preserving each configured use.
- Apply the same known-return contract checks at standalone and child boundaries.
- Bound proven data-only reporting work within the enclosing analysis allowance.
- Source analysis grants no admission, execution, or retry authority.
- Preserve source references, call context, and explicit unsupported regions.
- Preserve authored call sites after a cut in their active function frame. Keep lexical
  conditions and result checks separate from interpreted routes.
- Keep the private result independent of CLI and display rendering.
- Package inspection uses source analysis to add call-site locations to configured caller slots.
  Caller slots remain visible without source interpretation.
- Supplement cutoffs with source references whose receiver is an SDK context parameter.
  Keep computed slot expressions separate from exact configured handoffs.
  Attach literal lookup rows only when a strict-equality lookup and its helper argument are identifiable.
  Keep source assignments, conditions, and early returns distinct from analyzed paths.
- Compare ordered facts without deriving execution or authority from a supplied baseline.
  Keep source coordinates outside path identity. Pair changed paths only when their captured checks and evidence kind correspond uniquely.
  A call-order summary needs both slots on one captured source path. Preserve unresolved baseline order.

## Verification

- `bun test packages/jig/test/portable/flow-behavior.test.ts`
- The installed lifecycle suite checks a callee edit and a native caller Run.

## Child DOX Index
