# Source behavior inspection

## Purpose

Explain conditional behavior from a captured Jig project without running its methods.
The [workflow editing use cases](../../../../../.agents/use-cases/JOB-001-locate-a-workflow-edit.md) describe the decisions a coding agent needs to make before editing.

## Ownership

- `captured-input.ts` borrows source and interface facts from working-tree inspection.
  It retains the captured declaration path for each Binding.
  It retains local slot declaration paths for optional as well as required slots.
- `input-contract.ts` projects guarantees from captured input schemas into inert values.
  It can list declared input paths for inspection separately from these guarantees.
- `admitted-input.ts` reads exact stored source and recognized dependency bytes for an approved composition.
- `source.ts` resolves parsed source and call identities inside one captured package.
- `source-syntax.ts` owns shared TypeScript syntax helpers and bounded source walks.
- `repetition.ts` locates authored loop control around configured handoffs.
- `result-checks.ts` links authored caller exits to awaited results and their local definitions.
- `call-selection.ts` relates literal slot arguments to a local dispatch helper.
  It keeps literal and conditional input fields at their authored sites.
  It marks possible later overrides and counts omitted call sites by slot.
  It reads fixed keys from identifiable local object returns without running helper code.
  A conditional with two literal slot choices retains both configured targets and their branch conditions.
  A conditional field with literal alternatives retains both values under the same predicate.
- `slot-selection.ts` traces authored lookup rows and key origins into computed slot references.
- `analyze.ts` evaluates a bounded TypeScript subset through inert values.
- `data.ts` checks which data computations can safely lose value precision.
- `file-access.ts` recognizes read-only opens and strict UTF-8 decoding. The interpreter keeps file handles and bytes inert.
- `compose.ts` owns configured handoffs, caller continuations, and coverage.
- `comparison.ts` owns the bounded snapshot format and comparison of represented paths.
- `reporting-capture.ts` recognizes local installed Reporting bytes.
- `reporting.ts` describes supported progress payloads and traces their field sources.

## Local Contracts

- Keep analyzer inputs in memory. Use the existing capture owners for filesystem reads.
- Start standalone analysis with supported input guarantees from the captured contract.
  Keep unknown fields open. Preserve absent optional integers until a numeric default narrows them.
  Follow child calls with the argument supplied by the caller.
- Carry hypothetical results and known effects through caller continuations.
- Keep incomplete values distinct from unknown control flow.
- Follow directly returned helper and qualified Reporting promises through callers
  that consume them, including synchronous forwarding functions.
  Distinguish synchronous throws from rejection, which bypasses the returning
  function's catch unless it awaits inside the try.
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
- Retain progress calculation locations only for identifiable fields of a single block.
  An overwrite replaces a field location, and a joined payload retains only locations shared by its alternatives.
  For an opaque view payload, locate a single authored progress block through bounded local helper references.
  Those source locations guide inspection while the displayed value and returned block remain unresolved.
- Analyze the application within a shared work allowance while preserving each configured use.
- Apply the same known-return contract checks at standalone and child boundaries.
- Bound proven data-only reporting work within the enclosing analysis allowance.
- Source analysis grants no admission, execution, or retry authority.
- Preserve source references, call context, and explicit unsupported regions.
- Pair a direct setting check with its captured Binding through the proven Run context receiver.
  Treat a later authored exit as source evidence. Its captured setting does not establish reachability.
- Prioritize a bounded set of same-package uses when their settings differ from the focused Binding.
  Reuse each use's own analysis for comparisons of shared setting checks.
- For a focused callee, reuse secondary probes at its represented caller slots.
  Carry the same outcome and assumptions into the incoming continuation.
  Analyze the selected target and its upstream callers before the remaining visible scopes.
  An upstream chain can use the existing application allowance within the per-use bounds.
  Use the remaining secondary allowance for direct predecessors on retained caller paths.
  Record a bypass only when a caller returns that earlier result and the route never calls the focused target.
- Carry captured local result contract paths into the behavior inventory for navigation.
  Use the caller's own outcome declarations when showing a forwarding requirement.
- Keep declared input paths and the retained input for a write case separate from route identity.
  Keep declaration evidence available for an authored write when its reachability is unresolved.
- Keep nested continuation evidence within the same retained child evaluation.
  A return may identify its original Call step when it returns the same modeled object.
  Keep this annotation outside route identity and reproduce conditional probes through intermediate callers.
- Explain required slot resolution from captured invocation requirements independently of call reachability.
- Use the captured target inventory to locate a direct entry for a focused handoff's implementation.
  Keep its selector separate from the configured destination and keep the selected scope intact.
- Preserve authored call sites after a cut in their active function frame. Keep lexical
  conditions and result checks separate from interpreted routes.
  A direct prior branch exit can explain bypassed sibling call sites without resolving reachability.
  Bound the distinct exits after gathering their associated call sites.
  A named file write in the same frame can remain visible as an authored destination.
  Keep authored destinations separate from interpreted attempts.
- Link a result check through bounded local definitions with one established write.
  A protected assignment can supply a definition when its catch exits and it has no finalizer.
  Keep the authored definition beside the check without interpreting the helper or assuming a result.
- A repeated handoff can retain its enclosing loop, direct control statements, and nearby exit.
  Keep these references in the active function and disclose unfinished loop analysis.
  Pair a catch with its single protected statement when identifiable.
  Preserve direct earlier exits within a catch when they constrain a shown transfer.
  Disclose any omitted enclosing conditions beside their transfer.
  The false branch of a trailing one-sided exit check reaches the iteration boundary.
- Keep the private result independent of CLI and display rendering.
- Keep per-slot omission counts exact and retain up to three omitted source locations for navigation.
- Package inspection uses source analysis to add call-site locations to configured caller slots.
  Caller slots remain visible without source interpretation.
- Focused source and configured-use expansions put authored call decisions before route details.
  The decision shows where the caller supplies its slot and conditional fields.
  Keep request metadata at the resolved `run.call` and child input at its authored expression or proven forwarding argument.
  Pair helper arguments with one identifiable request in the helper's function body.
  Retain the request field and formal parameter together for each directly forwarded argument.
  Use configured targets to identify other callers of the same implementation.
- Collect related slots once per selected implementation and preserve each configured destination.
- For a focused callee, collect authored requests only from slots that resolve to that exact configured target.
  Keep each caller's Binding identity and source scope distinct even when route analysis stops before the request.
- Supplement cutoffs with source references whose receiver is an SDK context parameter.
  Spend the application route budget on the entrypoint and configured callers first.
  Continue bounded authored inspection when the route budget ends.
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
