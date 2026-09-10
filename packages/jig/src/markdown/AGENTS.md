# Markdown procedure runtime

## Purpose

Make captured Markdown methods reusable through finite FLOW calls while keeping
the operator's authority and execution ownership intact.

## Ownership

- The parser owns CommonMark structure, original source spans, frozen exact
  recipes, direct/mixed classification and profile bounds.
- The interpreter owns sequential recipe activation, bounded reasoning context,
  immutable value handles and explicit terminal handling inside one Flow process.
- Host admission, provider selection, process containment and installed worker
  construction remain outside this directory.

## Local Contracts

- Execute only original root-level exact `flow` fences; data and resource content
  cannot register recipes, slots or tools.
- Use the public FLOW SDK. Captured resource reading is the sole injected local
  operation; it grants no URL, shell, mutable-source or general filesystem access.
- Resolve operands before clearing the previous-result cursor. Exact handles
  preserve whole JSON snapshots; fresh literals are an explicit separate choice.
- Reason only through the derived `markdown-agent` slot with the fixed admitted
  template and complete bounded context. Never repair malformed decisions or
  automatically replay uncertain work.
- The template explains that prose-only Skills can finish without recipes or
  tools and places their requested answer inside the required result envelope.
- Direct execution validates all recipes before effects. Mixed execution exposes
  frozen unavailable diagnostics without weakening whole-invocation qualification.
- Failure, cancellation, budgets and owned-work settlement limit success even
  when an Agent returns plausible output.

## Work Guidance

- Keep the selected sequential profile; no generic workflow expressions,
  scheduler, native tools, endpoint transfer or live own-call observation.
- Preserve exact source and value content; exhaustion is visible, never silent
  truncation, implicit summaries or eviction of instruction/operand meaning.

## Verification

- `bun test packages/jig/test/markdown-parser.test.ts packages/jig/test/markdown-runtime.test.ts packages/jig/test/markdown-worker.test.ts`
- Worker tests build current source, exchange ordinary FLOW/1 messages and
  validate the actual native Agent response-schema profile without a provider.
- The installed public-CLI regression is gated by `JIG_LINUX_ROOTLESS_HOSTILE=1`;
  run it only on the provisioned proof host. It reuses the canonical regular
  `.tgz` from `JIG_PACKAGE_ARCHIVE` when supplied; otherwise build the Jig
  package first so the regression can pack its current generated artifacts.
  This gate proves direct and typed child execution, not live Agent quality.

## Child DOX Index
