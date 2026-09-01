# Suspended experiment recovery index

This non-normative file records only deleted work that may inform a future
vertical. It is not a roadmap, a compatibility promise, or a source of current
interfaces. Git is the archive: inspect old invariants and tests, then
reimplement the smallest needed behavior against the current specifications.
Never restore or cherry-pick a former subsystem wholesale.

`6aa93e1` is the last common tree containing the Jig-side experiments below;
`06eac5d` removed them from the direct alpha. A `commit:path` reference can be
read with `git show commit:path`.

## Evidence worth reconsidering

| Area | Recovery landmarks | Why suspended | Reconsider only when |
| --- | --- | --- | --- |
| Exact child `flow/call` | Implementations `80e8113`, `132285d`, `2469eb8`, and `fb52409`; reviews `6aa93e1:docs/design-review/143-deterministic-child-flow-slice.md` and `6aa93e1:docs/design-review/144-deterministic-child-flow-closure.md` | Its private lifecycle, persistence, and catalogue machinery had no public routing consumer. | One approved closed-routing vertical needs one exact admitted child call. |
| Journal and admitted Hooks | Implementations `2fb9578`, `3d87b0a`, `1d74f86`, and `9d6efdc`; reviews `6aa93e1:docs/design-review/146-private-journal-effect-closure.md`, `6aa93e1:docs/design-review/147-private-hook-authoring-boundary.md`, and `6aa93e1:docs/design-review/148-private-hook-runtime-frontier.md` | Durable facts and Hook-derived Runs enlarged admission and storage before an Event Source existed. | One real external fact must activate one admitted Run durably. Start from that outcome, not from the former Journal schema. |
| Durable Services | Implementations `0fcf403`, `28b719d`, `3f84952`, and `1586625`; reviews `6aa93e1:docs/design-review/149-private-service-hosting-frontier.md`, `6aa93e1:docs/design-review/151-private-service-hosting-checkpoint.md`, `6aa93e1:docs/design-review/155-private-mixed-composition-checkpoint.md`, and `6aa93e1:docs/design-review/162-private-mixed-loss-checkpoint.md` | One private stateful provider proved lifecycle semantics, but no alpha application needed a long-lived Mount and portable conformance remained incomplete. | A concrete application requires process-local state across calls, and the portable profile has independent conformance evidence. |
| Agent skill projection | Implementation `66821ba`; reviews `6aa93e1:docs/design-review/157-private-agent-projection-checkpoint.md` and `6aa93e1:docs/design-review/158-agent-provider-boundary.md`; source `6aa93e1:packages/jig/src/internal/private-agent-run-projection.ts` | The logical projection proof had no retained, authenticated, contained Agent provider. | One operator-owned exact provider can perform a contained one-shot call with durable no-redispatch semantics. |
| Semantic Choice and changing Run candidates | Implementations `8337350` and `60725c1`; reviews `6aa93e1:docs/design-review/159-private-semantic-choice-checkpoint.md` and `6aa93e1:docs/design-review/160-changing-run-universe-disposition.md` | Pure allowlisted selection had neither a durable Agent owner nor a shipped routing consumer. | Exact Agent invocation and one deterministic admitted candidate set meet inside a closed router. |
| Python direct execution | Planner `8a9014d`, containment sequence through `820b2d4`, and source `6aa93e1:packages/jig/src/internal/python-direct-run.ts` | The alpha deliberately selected one runtime and one execution path. | A real Python FLOW package justifies a second exact recipe after the Bun path is stable. |

## Negative boundaries to preserve

- **Jig Graph over Sley:** review
  `6aa93e1:docs/design-review/161-private-jig-route-lowering.md` records the
  successful negative result. The deleted candidate needed 478 implementation
  and 343 test lines to wrap roughly 45 lines of direct Sley, with no stored
  graph consumer. Retry only when a real independently stored graph contains
  meaningful non-router or nested behavior that direct Sley cannot express
  clearly.
- **Privileged cgroup backend:** the proof starts at `4ab1caf`; its last source
  and review are
  `b9f9473^:packages/jig/src/internal/linux-cgroup-backend.ts` and
  `6aa93e1:docs/design-review/105-phase-2-linux-cgroup-proof.md`. `b9f9473`
  replaced it with the canonical rootless path. Reuse hostile-test lessons,
  but never restore its host authority as a fallback.
- **Nix runtime retention:** the lab branch is
  `experiments/nix-runtime-retention` at `d34ccb6`; quarantine and correction
  commits are `d6a0ad2` and `7ebd25f`; disposition is
  `6aa93e1:docs/design-review/130-nix-experiment-disposition-and-next-slice.md`.
  Nix may be reconsidered only as an explicitly selected project-environment
  integration. It must not become Jig runtime retention, dependency locking,
  package-manager lifecycle, or FLOW vocabulary.
- **Compiled-Bun distribution:** review
  `6aa93e1:docs/design-review/199-compiled-bun-runtime-feasibility.md` proves
  the runtime mechanism; `cb5b343`, `f75fb56`, and `7aa66d8` record the later
  installed candidate and its licensing blocker, visible together at
  `47ad9f6:packages/jig/THIRD_PARTY_NOTICES`. Runtime feasibility is not lawful
  distribution. Reconsider embedding Bun only if a reviewed, reproducible
  source-and-relinking solution satisfies every applicable license obligation
  and remains simpler than consuming one exact release-owned runtime package.
