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
   - [`spec/project-administration.md`](spec/project-administration.md), with its
     [`project-value schema`](spec/machine/project-administration-1.schema.json)
   - [`spec/journal-and-hooks.md`](spec/journal-and-hooks.md)
   - [`spec/agents-and-semantic-choice.md`](spec/agents-and-semantic-choice.md)

Current implementation frontier:

- [`design-review/196-zero-setup-rootless-product-boundary.md`](design-review/196-zero-setup-rootless-product-boundary.md)
  removes Jig-specific host setup from the product. Each Run must prove and
  consume a complete pre-existing unprivileged envelope or fail with
  `SANDBOX_UNAVAILABLE`. The current development sandbox lacks the generic
  rootless user-service/cgroup and patched-Bubblewrap capabilities needed to
  execute that proof.
- [`design-review/195-private-native-root-run-join.md`](design-review/195-private-native-root-run-join.md)
  closes the private root-only join from one exact package-local Bun
  preparation through authenticated prepared-tree materialization and final
  read-only Run/1 execution. Durable ordering prevents late preparation or
  root planning before successful preparation closure; result meaning still
  comes from the original Package/1. Native child `flow/call` remains gated.
- [`design-review/194-private-native-recipe-pinning.md`](design-review/194-private-native-recipe-pinning.md)
  closes mandatory retained-byte classification and one exact planning-only
  recipe for a Bun Run requiring package-local preparation. The recipe pins
  its real controller, worker, runtime, Backend, preparation envelopes, and
  final launch meaning. Review 195 now makes that recipe executable only by
  the private root owner.
- [`design-review/193-private-prepared-tree-materialization.md`](design-review/193-private-prepared-tree-materialization.md)
  closes the private authenticated view which turns one retained prepared tree
  into a restart-verifiable, read-only per-Run materialization without
  relabelling it as Package/1. READY recipe pinning and root execution remain
  separate gates.
- [`design-review/192-private-native-preparation-controller.md`](design-review/192-private-native-preparation-controller.md)
  closes one concrete private controller joining the root-owned v19 lifecycle,
  retained Package/1 backing, Linux cgroup-v2/Bubblewrap owner, and protected
  prepared-tree store. One-shot launch, duplicate-call ownership, bounded
  output, exact fencing, conservative recovery, and zero-residue cleanup pass;
  READY planning and the final read-only prepared Run remain separate gates.
- [`design-review/191-private-native-preparation-state.md`](design-review/191-private-native-preparation-state.md)
  closes the v19 write-once state machine for one root-owned Bun preparation,
  including exact dispatch authority and older-epoch no-redispatch recovery.
  It also removes the proposed output backing as unable to prove complete
  output after coordinator loss. Review 192 closes its first concrete
  controller without yet making the target READY.
- [`design-review/190-private-prepared-tree-store.md`](design-review/190-private-prepared-tree-store.md)
  closes atomic retention and detached restart reacquisition of one composite
  source-Package/1 plus exact installed SDK tree without conflating that
  private execution artifact with authored Package/1.
- [`design-review/189-licensing-and-stewardship-disposition.md`](design-review/189-licensing-and-stewardship-disposition.md)
  selects a corrected, role-specific licensing and governance target without
  yet making an operative grant. It separates FLOW's future Community-Spec
  process from Jig governance and defers licence texts and package metadata
  until provenance, ownership, curation, counsel, and artifact gates close.
- [`design-review/188-contained-native-preparation-feasibility.md`](design-review/188-contained-native-preparation-feasibility.md)
  closes one ephemeral networkless, script-free Bun installation of the real
  packed FLOW SDK inside the private Linux envelope, plus deterministic repeat
  and hostile lifecycle-script evidence. Output becomes only an inert
  candidate after successful exit and complete fencing; the next boundary is
  a durable preparation child and protected prepared-tree artifact.
- [`design-review/187-retained-native-dependency-relation.md`](design-review/187-retained-native-dependency-relation.md)
  closes exact derivation of one package-local SDK member from retained
  Package/1 bytes. It grants no readiness; review 188 closes only the following
  ephemeral contained-install feasibility gate.
- [`design-review/186-package-local-native-artifact-correction.md`](design-review/186-package-local-native-artifact-correction.md)
  corrects the native-preparation ownership boundary: the SDK archive is
  untrusted package-local content captured and admitted through Package/1 and
  Plan/apply, while runtimes, installers and containment remain host-owned.
  No Jig-specific `agent-sandbox` feature or administrator dependency
  whitelist is required.
- [`design-review/185-first-release-external-join.md`](design-review/185-first-release-external-join.md)
  records the remaining production-host and Agent-provider joins after
  deterministic changing-source hardening, fixes the direct-leaf versus
  Agent-worker claim, and defers Event Sources until the independent
  post-routing campaign. Review 186 supersedes its former SDK-artifact blocker.
- [`design-review/184-cancellation-aware-flow-call-resolution.md`](design-review/184-cancellation-aware-flow-call-resolution.md)
  propagates the existing operation signal through complete deterministic
  target filtering, closing a 4,096-target cancellation-latency debt without
  adding a public Resolver or wire operation.
- [`design-review/183-project-run-targets-authoring-campaign.md`](design-review/183-project-run-targets-authoring-campaign.md)
  accepts the inert `projectRunTargets()` Project Authoring SDK/1 value after
  two clean-room consumers and the real retained evaluator converged, while
  keeping operational routing, Agent ranking, and durable Semantic Choice
  explicitly gated.
- [`design-review/182-private-settings-only-binding-child.md`](design-review/182-private-settings-only-binding-child.md)
  closes one private Bun configuration-only child Binding with exact retained
  settings, independent allocation authority checks, no attachments or slots,
  and no inherited effect dispatcher.
- [`design-review/181-private-deterministic-flow-call-dispatch.md`](design-review/181-private-deterministic-flow-call-dispatch.md)
  connects one deterministic direct-Flow survivor to the existing durable
  child lifecycle, proves same-generation allocation authority and contained
  one-survivor/many-survivor behavior, and keeps configured Bindings and
  semantic routing gated.
- [`design-review/180-private-root-flow-call-filtering.md`](design-review/180-private-root-flow-call-filtering.md)
  closes complete invocation-local filtering for direct Flow targets over one
  retained admitted slot, including exact-versus-broad input ordering,
  canonical rejection evidence, and the untruncated 4,096-target boundary,
  while leaving configured Bindings, durable dispatch, and Semantic Choice
  separate.
- [`design-review/179-native-preparation-artifact-boundary.md`](design-review/179-native-preparation-artifact-boundary.md)
  preserves the rejection of caller-asserted path, digest, and lifetime claims.
  Its administrator-owned SDK conclusion is superseded by review 186.
- [`design-review/178-project-run-target-review-delta.md`](design-review/178-project-run-target-review-delta.md)
  adds one bounded navigation delta for changing Run-target slots, including
  private target-meaning revisions without disclosing their evidence, while
  leaving filtering and selection separate.
- [`design-review/177-private-project-run-target-retained-format.md`](design-review/177-private-project-run-target-retained-format.md)
  advances the private lock to Lock/3, activation requests to Request/2, and
  the then-current admission store to v18 so exact source intent and the complete bounded
  `projectRunTargets()` expansion survive strict decoding and admission,
  while runtime filtering and selection remain gated. Review 191 advances the
  current private store to v19 without changing those retained formats.
- [`design-review/176-private-project-run-target-linker.md`](design-review/176-private-project-run-target-linker.md)
  closes the private two-phase `projectRunTargets()` expansion, exact source
  identity, caller-owned aggregate bound, and existing-work-budget accounting
  while leaving the later retained-format, filtering, and runtime boundaries
  separate.
- [`design-review/175-exact-native-preparation-frontier.md`](design-review/175-exact-native-preparation-frontier.md)
  selects one offline native-installer preparation owner and a distinct
  private prepared-tree identity after rejecting a Jig-owned npm/wheel
  extractor and any Package/1 identity conflation.
- [`design-review/174-private-project-run-target-evaluator.md`](design-review/174-private-project-run-target-evaluator.md)
  seals the exact private `projectRunTargets()` Binding profile inside the
  real author evaluator while public authoring and the ordinary linker still
  reject it.
- [`design-review/173-bare-project-initializer.md`](design-review/173-bare-project-initializer.md)
  closes the fixed inert `jig init --bare <new-directory>` tree, exclusive
  destination claim, bounded owned-entry cleanup, concurrent-winner proof, and
  packed type-check without claiming atomic crash recovery, installation, or
  an operational host.
- [`design-review/172-private-project-run-target-catalogue.md`](design-review/172-private-project-run-target-catalogue.md)
  derives the complete authenticated structural Run universe without yet
  integrating the private marker, lock, Resolver, or runtime.
- [`design-review/171-private-project-run-target-marker.md`](design-review/171-private-project-run-target-marker.md)
  closes only the private minimal `projectRunTargets()` marker shape while
  keeping public authoring, evaluation, linking, locks, and execution gated.
- [`design-review/170-project-authoring-probe-disposition.md`](design-review/170-project-authoring-probe-disposition.md)
  records the passed clean-room public authoring campaign, the Run-result
  ergonomics correction it earned, and the still-open native dependency and
  operational-host gates.
- [`design-review/169-project-command-and-review-delta.md`](design-review/169-project-command-and-review-delta.md)
  closes the proof-independent one-command Project Session lifecycle and the
  authenticated current-to-proposed review delta while deliberately leaving
  installed acquisition and an operational CLI blocked on host policy.
- [`design-review/168-agentic-routing-product-frontier.md`](design-review/168-agentic-routing-product-frontier.md)
  makes a reviewed independent Agentic Routing campaign the first promotional
  milestone and a rebuilt software factory the first showcase milestone. It
  preserves separate authoring and deterministic operational gates, fixes the
  Agent/provider/choice dependency chain, and keeps Services, GUI/Cordis,
  updates, and Jig Graph outside the first-release critical path.
- [`design-review/167-finite-project-session-checkpoint.md`](design-review/167-finite-project-session-checkpoint.md)
  closes the private descriptor-held project session, display-safe pre-commit
  review, digest-only apply, session-owned Root Administration, close/recovery
  semantics, packed injected-session consumer, and real hostile lifecycle
  proof while keeping project acquisition and host installation unpublished.
- [`design-review/166-finite-project-session-frontier.md`](design-review/166-finite-project-session-frontier.md)
  is the superseded selection record for that boundary: one descriptor-held
  identity and coordinator, authority-neutral plan, retained-digest apply,
  unchanged Root Administration, exact close/recovery semantics, and a
  public-surface gate which refuses to expose private Plan/lock/host records.
- [`design-review/165-roadmap-closure-and-product-frontier.md`](design-review/165-roadmap-closure-and-product-frontier.md)
  consolidates every completed, blocked, open, and negative vertical, selects
  the Bun-only first Jig posture, and records the now-completed finite trusted
  local project session as its selected product boundary. Review 168
  supersedes only its current-frontier ordering.
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
