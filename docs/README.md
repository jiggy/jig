# Jig + FLOW design documents

Start here:

1. [`design-review/100-final-seams.md`](design-review/100-final-seams.md) —
   concise record of the final disputed decisions and why they won.
2. [`design-review/60-reviewed-architecture.md`](design-review/60-reviewed-architecture.md)
   — canonical whole-system architecture.
3. [`decision-index.md`](decision-index.md) — compact traceability map from
   stable decisions to their normative sections.
4. Focused specifications:
   - [`spec/json-values.md`](spec/json-values.md)
   - [`spec/package-format.md`](spec/package-format.md)
   - [`spec/schema-files.md`](spec/schema-files.md)
   - [`spec/runtime-adapters.md`](spec/runtime-adapters.md)
   - [`spec/capability-contracts.md`](spec/capability-contracts.md)
   - [`spec/project-policy.md`](spec/project-policy.md)
   - [`spec/journal-and-hooks.md`](spec/journal-and-hooks.md)
   - [`spec/agents-and-semantic-choice.md`](spec/agents-and-semantic-choice.md)

The remaining cross-cutting lifecycle rules are in the canonical architecture:

- [Run/1](design-review/60-reviewed-architecture.md#5-flow-run1) and
  [Service/1](design-review/60-reviewed-architecture.md#6-flow-service1);
- [effects and Agents](design-review/60-reviewed-architecture.md#9-effects-events-hooks-and-agents);
- [security and sandbox enforcement](design-review/60-reviewed-architecture.md#11-security-and-trust); and
- [updates and reconciliation](design-review/60-reviewed-architecture.md#13-desired-state-direct-editing-and-updates).

The other files under `design-review/` are preserved adversarial drafts,
rebuttals, ballots, and freeze records. They explain how the architecture was
tested, but they are historical and may contain decisions explicitly removed
from the canonical design. Git preserves superseded text; it should not be
copied forward as current specification.

Post-freeze candidates which still require a focused review are explicitly
labelled, including
[`design-review/101-frontend-control-candidate.md`](design-review/101-frontend-control-candidate.md).
