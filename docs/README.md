# Jig + FLOW design documents

These are reviewed design specifications, not shipped packages or stable
conformance labels. Stable SDK publication and several closed machine models
remain release gates; see
[`design-review/102-public-interface-release-gates.md`](design-review/102-public-interface-release-gates.md).

Start here:

1. [`design-review/100-final-seams.md`](design-review/100-final-seams.md) —
   concise adversarial rationale for reviewed decisions.
2. [`design-review/60-reviewed-architecture.md`](design-review/60-reviewed-architecture.md)
   — canonical whole-system architecture.
3. [`decision-index.md`](decision-index.md) — compact traceability map from
   reviewed decisions to their normative sections.
4. Focused specifications:
   - [`spec/json-values.md`](spec/json-values.md)
   - [`spec/package-format.md`](spec/package-format.md)
   - [`spec/schema-files.md`](spec/schema-files.md), with its
     [`machine meta-schema`](spec/machine/schema-1.json)
   - [`spec/run-protocol.md`](spec/run-protocol.md), with its closed candidate
     [`message schema`](spec/machine/run-1.schema.json) and
     [`error registry`](spec/machine/run-1-errors.json)
   - [`spec/run-sdk.md`](spec/run-sdk.md)
   - [`spec/runtime-adapters.md`](spec/runtime-adapters.md)
   - [`spec/capability-contracts.md`](spec/capability-contracts.md), with its
     [`machine descriptor schema`](spec/machine/capability-contract-1.schema.json)
   - [`spec/project-policy.md`](spec/project-policy.md)
   - [`spec/journal-and-hooks.md`](spec/journal-and-hooks.md)
   - [`spec/agents-and-semantic-choice.md`](spec/agents-and-semantic-choice.md)

Current implementation frontier:

- [`design-review/103-phase-1-flow-foundations.md`](design-review/103-phase-1-flow-foundations.md)
  records the completed Run/1, two-peer, Package/Schema, and independent
  author/evaluator SDK gate.
- [`design-review/104-phase-2-security-blocker.md`](design-review/104-phase-2-security-blocker.md)
  preserves the earlier fail-closed environment stop.
- [`design-review/105-phase-2-linux-cgroup-proof.md`](design-review/105-phase-2-linux-cgroup-proof.md)
  records the private cgroup-v2/Bubblewrap implementation, hostile proof, and
  remaining Bun descendant blocker.
- [`design-review/106-service-wire-and-provider-sdk.md`](design-review/106-service-wire-and-provider-sdk.md)
  records the closed Service/1 wire candidate and Provider projections; the
  session-local TypeScript/Python/independent matrix is complete while durable
  hosting and a portable Host-under-test conformance label remain open.
- [`design-review/107-project-authoring-sdk-slice.md`](design-review/107-project-authoring-sdk-slice.md)
  through [`design-review/112-static-author-closure.md`](design-review/112-static-author-closure.md)
  record the private project pipeline now proven through inert authoring,
  descriptor-confined source capture, retained Package/1 artifacts, pure
  package/Binding linking, and one sandboxed static-import evaluator. The
  retained project aggregate is the next boundary.

The focused Run/1 specification owns its finite wire surface. The remaining
cross-cutting system rules are in the canonical architecture:

- [Jig's Run/1 operation and lifecycle policy](design-review/60-reviewed-architecture.md#5-flow-run1)
  and [the Service/1 profile](design-review/60-reviewed-architecture.md#6-flow-service1);
- [effects and Agents](design-review/60-reviewed-architecture.md#9-effects-events-hooks-and-agents);
- [security and sandbox enforcement](design-review/60-reviewed-architecture.md#11-security-and-trust); and
- [updates and reconciliation](design-review/60-reviewed-architecture.md#13-desired-state-direct-editing-and-updates).

The other files under `design-review/` are preserved adversarial drafts,
rebuttals, ballots, and freeze records. They explain how the architecture was
tested, but they are historical and may contain decisions explicitly removed
from the canonical design. Git preserves superseded text; it should not be
copied forward as current specification.

Open interface candidates are explicitly non-normative, including
[`design-review/101-default-targets-and-open-routing-candidate.md`](design-review/101-default-targets-and-open-routing-candidate.md).
