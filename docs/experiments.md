# Deleted experiment index

This non-normative index locates implementation evidence that was removed from
the direct alpha. It is not a roadmap, a compatibility promise, or a source of
current interfaces.

The last tree containing all listed Jig-side experiments is commit `6aa93e1`.
Commit `06eac5d` removed the coupled experiments. If an area earns re-entry,
inspect its old code, tests, and reviews for invariants and failure cases, then
reimplement the smallest required vertical against the current specifications.
Do not restore or cherry-pick the old subsystem wholesale.

| Experiment | Git evidence | Disposition | Re-entry gate |
| --- | --- | --- | --- |
| Deterministic child Flow composition | `80e8113`, `132285d`, `2469eb8`, `fb52409`, and `6aa93e1:packages/jig/src/internal/root-flow-call-*` | Removed from the direct alpha because its lifecycle, persistence, and catalogue machinery were not exercised by a public Run path. | One approved closed-routing vertical needs an exact admitted `flow/call`. |
| Journal and admitted Hooks | `2fb9578`, `3d87b0a`, `1d74f86`, `9d6efdc`, and the corresponding files at `6aa93e1` | Removed because event persistence and Hook-derived Runs enlarged admission and storage before an Event Source was needed. | One real external fact must need to activate one admitted Run durably. |
| Durable Services | `8ad4caa`, `0fcf403`, `28b719d`, `3f84952`, `1586625`, and the Service files at `6aa93e1` | Jig hosting was removed in `06eac5d`; the premature portable profile was removed in `6aa93e1`. | A concrete long-lived provider must require process-local state, and portable behavior must earn independent conformance evidence. |
| Agent skill projection | `66821ba`, `396d616`, `a297434`, and `6aa93e1:packages/jig/src/internal/private-agent-run-projection.ts` | The logical projection proof survived review, but no real retained, contained Agent provider existed. | An operator-owned exact Agent provider is available for a one-shot contained call. |
| Semantic Choice and changing Run candidates | `8337350`, `60725c1`, `88b9bcd`, `efd31f0`, `6aa93e1:packages/jig/src/project/package-project.ts`, and `6aa93e1:packages/jig/test/private-project-run-targets-catalogue.test.ts` | Removed because pure selection had no durable Agent owner or shipped routing consumer. | Exact Agent invocation and a deterministic admitted candidate set both exist in one closed router. |
| Python direct execution | `8a9014d` and the root-execution sequence through `820b2d4`; final source at `6aa93e1:packages/jig/src/internal/python-direct-run.ts` | Removed when the alpha selected one Bun runtime and one installed path. | A real Python FLOW package justifies a second exact runtime recipe after the Bun release path is stable. |

## Rejected or superseded evidence

These records are useful negative evidence, not suspended implementations:

- Jig Graph's Sley lowering was removed after the experiment showed that the
  wrapper was much larger than direct Sley for the available consumer. Its
  implementation and tests were deliberately removed before commit; the only
  durable record is review `1b9a5a4`. Retry only for a real independently
  stored graph that direct Sley cannot represent adequately.
- The former durable Bun native-preparation lifecycle runs from `b2ebfe4`
  through `f99d799`; its final source, tests, and reviews are available at
  `6aa93e1`, and `06eac5d` deleted it. The direct alpha now has the smaller
  locked Bun-only path established by `c6740f7`, `ec4f61d`, `51aafd7`, and
  `48ca203`. The old controllers, store, tables, and recovery tests are
  failure-case evidence, not code to restore.
- The Nix retention work is isolated at branch
  `experiments/nix-runtime-retention` (`d34ccb6`), with quarantine and roadmap
  corrections at `d6a0ad2` and `7ebd25f`. It must not return as Jig runtime or
  package-manager architecture.
- The privileged cgroup proof begins at `4ab1caf` and closes through
  `820b2d4`. Its final backend and proof review are available at
  `b9f9473^:packages/jig/src/internal/linux-cgroup-backend.ts` and
  `b9f9473^:docs/design-review/105-phase-2-linux-cgroup-proof.md`; `b9f9473`
  deleted it in favor of the canonical rootless path. Its hostile tests may
  inform future containment work, but its host authority model must not be
  restored as an alpha fallback.
