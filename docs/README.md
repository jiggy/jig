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
   - [`spec/project-sdk.md`](spec/project-sdk.md), with its
     [`authoring-value schema`](spec/machine/project-authoring-1.schema.json)
   - [`spec/root-administration.md`](spec/root-administration.md), with its
     [`administration-value schema`](spec/machine/root-administration-1.schema.json)
   - [`spec/journal-and-hooks.md`](spec/journal-and-hooks.md)
   - [`spec/agents-and-semantic-choice.md`](spec/agents-and-semantic-choice.md)

Current implementation frontier:

- [`design-review/165-roadmap-closure-and-product-frontier.md`](design-review/165-roadmap-closure-and-product-frontier.md)
  consolidates every completed, blocked, open, and negative vertical, selects
  the Bun-only first Jig posture, and fixes the finite trusted local project
  session as the next product code boundary.
- [`design-review/130-nix-experiment-disposition-and-next-slice.md`](design-review/130-nix-experiment-disposition-and-next-slice.md)
  explains why the archived host-runtime Nix experiment is not a Jig or FLOW
  release gate. Its direct-root milestone is complete.
- [`design-review/103-phase-1-flow-foundations.md`](design-review/103-phase-1-flow-foundations.md)
  records the completed Run/1, two-peer, Package/Schema, and independent
  author/evaluator SDK gate.
- [`design-review/104-phase-2-security-blocker.md`](design-review/104-phase-2-security-blocker.md)
  preserves the earlier fail-closed environment stop.
- [`design-review/105-phase-2-linux-cgroup-proof.md`](design-review/105-phase-2-linux-cgroup-proof.md)
  records the initial private cgroup-v2/Bubblewrap implementation and hostile
  proof. [`design-review/141-bun-and-run-lifecycle-closure.md`](design-review/141-bun-and-run-lifecycle-closure.md)
  closes its Bun and descendant-lifecycle blockers with the same containment
  contract used by Python.
- [`design-review/140-root-administration-and-bun-boundary.md`](design-review/140-root-administration-and-bun-boundary.md)
  makes the host-control-plane/FLOW boundary explicit and scopes the Bun
  blocker to the current general descendant-capable recipe construction.
- [`design-review/106-service-wire-and-provider-sdk.md`](design-review/106-service-wire-and-provider-sdk.md)
  records the closed Service/1 wire candidate and Provider projections; the
  session-local TypeScript/Python/independent matrix is complete. Review
  [`151`](design-review/151-private-service-hosting-checkpoint.md) closes one
  durable Bun hosting substrate, and review
  [`155`](design-review/155-private-mixed-composition-checkpoint.md) closes its
  finite normal Root/child/Journal/Service composition, while review
  [`162`](design-review/162-private-mixed-loss-checkpoint.md) closes one manual
  provider/coordinator-loss recovery choreography without a supervisor or
  redispatch. A portable Host-under-test conformance label remains open.
- [`design-review/107-project-authoring-sdk-slice.md`](design-review/107-project-authoring-sdk-slice.md)
  through [`design-review/139-independent-root-administration-review.md`](design-review/139-independent-root-administration-review.md)
  record the private project pipeline now proven through inert authoring,
  descriptor-confined source capture, retained Package/1 artifacts, pure
  package/Binding linking, one sandboxed static-import evaluator, and one
  retained package-only project aggregate; deterministic non-admissible
  resolution; a strict portable lock projection; one durable activation store
  spanning exact `READY` and `UNAVAILABLE`; and lock-first admission of exact
  Python and Bun targets. The evaluator and Runs consume authenticated
  sandbox-lifetime runtime support, while Jig remains outside runtime retention
  and package-manager lifecycle. The smallest root start/status interface and
  its private controller now pass a clean public-surface consumer and the real
  hostile path. Independent packed-package consumer review also passes after
  rejecting and forcing closure of three ambiguous semantics. Generic
  host-extension and public plan/apply models remain later gates.
- [`design-review/157-private-agent-projection-checkpoint.md`](design-review/157-private-agent-projection-checkpoint.md)
  closes the first private Agent Run value and Flow-local skill-projection
  proof. It deliberately leaves provider registration, real containment,
  durable effect ownership, and the public provider ABI open.
- [`design-review/158-agent-provider-boundary.md`](design-review/158-agent-provider-boundary.md)
  records why the next contained Agent-provider checkpoint cannot honestly be
  derived from a mutable fixture or an absent operator registration substrate.
- [`design-review/159-private-semantic-choice-checkpoint.md`](design-review/159-private-semantic-choice-checkpoint.md)
  closes the pure canonical closed-choice value boundary without wiring it
  into resolution, durability, project policy, Agents, Services, or Sley.
- [`design-review/160-changing-run-universe-disposition.md`](design-review/160-changing-run-universe-disposition.md)
  selects the minimal `projectRunTargets()` authoring direction after two
  frozen-interface clean-room consumers, while keeping implementation gated.
- [`design-review/161-private-jig-route-lowering.md`](design-review/161-private-jig-route-lowering.md)
  records the successful-but-removed router-lowering experiment. A Jig Graph
  compiler now waits for a real stored graph consumer rather than inventing a
  DSL around synthetic terminal nodes.
- [`design-review/163-private-atomic-plan-publication.md`](design-review/163-private-atomic-plan-publication.md)
  closes the private both-head snapshot and failure-atomic Candidate/Plan
  publication seam while leaving trusted project acquisition public-gated.
- [`design-review/164-packed-tooling-and-alpha-disposition.md`](design-review/164-packed-tooling-and-alpha-disposition.md)
  closes package-tree decontamination and separates the private tooling
  candidate from the still-blocked operational Jig-host alpha.

The focused Run/1 specification owns its finite wire surface. The remaining
cross-cutting system rules are in the canonical architecture:

- [Jig's Run/1 operation and lifecycle policy](design-review/60-reviewed-architecture.md#5-flow-run1)
  and [the Service/1 profile](design-review/60-reviewed-architecture.md#6-flow-service1);
- [effects and Agents](design-review/60-reviewed-architecture.md#9-effects-events-hooks-and-agents);
- [security and sandbox enforcement](design-review/60-reviewed-architecture.md#11-security-and-trust); and
- [updates and reconciliation](design-review/60-reviewed-architecture.md#13-desired-state-direct-editing-and-updates).

Most other files under `design-review/` are preserved adversarial drafts,
rebuttals, ballots, and freeze records. They explain how the architecture was
tested, but they are historical and may contain decisions explicitly removed
from the canonical design. The removed Nix-retention sequence remains on
`experiments/nix-runtime-retention`; review 130 records its disposition. Git
preserves superseded text; it should not be copied forward as current
specification.

Open interface candidates are explicitly non-normative, including
[`design-review/101-default-targets-and-open-routing-candidate.md`](design-review/101-default-targets-and-open-routing-candidate.md).
