# Round-two adversarial decision record

**Decision:** accept the revised architecture in
[`60-reviewed-architecture.md`](60-reviewed-architecture.md) as the current
design baseline, subject to its explicit conformance gates. Three independent
reviewers—a minimalist critic, a systems/lifecycle critic, and an
ecosystem/security critic—returned `PASS` after their release blockers were
incorporated and rechecked.

This record captures the decisions that materially changed during the second
review. It is not a second specification.

## Accepted refinements

1. **Schema files have one narrow purpose.** `input.schema.json`,
   `settings.schema.json`, and `result.schema.json` validate invocation input,
   immutable Binding settings, and the complete normal Run result. They are
   governed by one closed, bounded Schema/1 dialect and the shared FLOW JSON/1
   value model. They are not files through which Runs exchange live data.
2. **Runtime selection is explicit but not machine pinning.** A code-backed
   package names one FLOW-owned profile such as `deno@1`. That profile fixes
   portable preparation and launch semantics; it does not name a local binary,
   author a binary version range, or contain a digest. Native manifests and
   lockfiles own application dependencies. The host maps a profile to a local
   trusted Runtime Runner and records the realized toolchain.
3. **The entrypoint stays visually obvious.** A package contains at most one
   root `flow` or `flow.<single-suffix>` implementation. Suffixes and shebangs
   are inert package bytes. Neither is portable launcher authority.
4. **Instruction fallback is fail-safe.** Exact execution is preferred.
   Instruction interpretation is possible only when both the package and the
   selected Binding permit it, is selected before preparation, and is never a
   recovery path after an exact implementation fails.
5. **Resolution has a deterministic safety boundary.** Project admission,
   schema compatibility, trust, permissions, availability, and exact candidate
   identity are resolved without an LLM. An optional Semantic Resolver may
   rank only the remaining allowlisted candidates. It can also be used directly
   by an authored graph Router for an intentional local choice.
6. **Catalogues scale without becoming live authority.** The generated default
   `jig.ts` explicitly discovers `./flows`; the kernel has no magic directory.
   Large catalogues may be materialized into ordinary reviewed Bindings and an
   immutable candidate-set snapshot. Runtime execution never binds against a
   directory that is changing underneath it.
7. **Security is a host boundary, not a Flow wrapper.** Packages request only
   named attachment modes and effect slots. Bindings map those names to exact
   resources. A host-selected Sandbox Backend enforces the resulting authority
   for every package-influenced process, including dependency preparation.
   Runtime-native permission flags are defense in depth. Host preferences live
   outside projects and Starters.
8. **Lifecycle correctness begins before spawn.** Jig durably records ownership,
   fencing, and spawn intent before creating a process; it does not claim safe
   recovery from a crash window that its backend cannot enumerate and contain.
   Uncertain external work is surfaced rather than silently replayed.
9. **Service support is official but separately conforming.** Run-only hosts
   remain small. Jig implements Service/1 so Cordis/DSH-class long-lived,
   multi-operation providers are a first-class interoperability target without
   taxing every simple Flow.
10. **Events, effects, and Hooks remain distinct.** Effects are explicit calls;
    Events are durable committed facts; diagnostics are stderr; Hooks are inert
    exact Event-to-Flow admission rules. Events do not become middleware and
    Hooks do not hide continuation inside callbacks.
11. **Configuration is per configured use.** One Binding pins package,
    settings, attachments, effects, grants, and fallback policy. Settings have
    a schema only when a package exposes that seam. There is no ambient
    variable interpolation or giant global settings namespace.
12. **Local source remains directly editable.** Updates use the classic
    `BASE + LOCAL + UPSTREAM` three-way merge in staging, followed by
    deterministic validation and optional Agent-assisted repair. Persistent
    runtime patch overlays are not part of the model.

## Deliberate rejections

- No author-declared Deno, Bun, Node, or Python binary version or digest.
- No raw command template, package-controlled argv, or normative shebang.
- No implicit runtime switch based only on a filename suffix.
- No automatic instruction fallback after preparation or execution failure.
- No live catalogue lookup during an admitted generation.
- No Semantic Resolver authority over compatibility, trust, permissions, or
  success.
- No sandbox implemented as an ordinary Flow; it must dominate Flow launch.
- No public arbitrary `Scope`, `Context`, `Mount`, `Task`, `Work`, or worktree
  object model in v1.
- No capability contract requirement for ordinary finite Flow invocation.
- No permanent patch stack or runtime overlay as the source of local truth.
- No Caskada-specific in-process bypass of FLOW/1.

## Remaining proof obligations

The reviewers passed the architecture, not an implementation. A `1.0` claim
still requires executable conformance fixtures for, at minimum:

- package snapshotting and path safety;
- every published Runtime Profile and its locked/offline preparation behavior;
- FLOW JSON/1 and Schema/1 cross-language agreement and limit exhaustion;
- Run/1 framing, ownership, cancellation, uncertainty, and result commit;
- Service/1 provider loss, draining, and contract behavior;
- Sandbox Backend authority realization and crash fencing;
- deterministic Binding materialization and Semantic Resolver containment;
- durable Event/Hook admission and idempotency;
- update staging, validation, atomic publication, and rollback.

Until those gates pass, the numbered profiles are design targets rather than a
compatibility promise.
