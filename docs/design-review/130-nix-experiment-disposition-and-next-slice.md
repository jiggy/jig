# Nix experiment disposition and current implementation frontier

**Status:** reviewed roadmap correction after the host-runtime retention
experiment. This record changes implementation priority, not the canonical
Jig or FLOW architecture.

## 1. Disposition

The Nix-specific implementation sequence through commit `d34ccb6` is retained
on the `experiments/nix-runtime-retention` branch. It is not part of the
current `main` implementation frontier.

That experiment addressed one narrow host fact: the available Bun and Python
runtimes happened to reside in `/nix/store`, so an exact private Runtime
Support Closure could be mounted into the Linux cgroup-v2/Bubblewrap proof.
The work then investigated how such host runtime paths might survive
coordinator restarts and Nix garbage collection.

It did **not** implement the future feature normally meant by “Nix support”:
a Jig project supplying `flake.nix`, `flake.lock`, or `shell.nix` and having a
trusted Nix-aware integration prepare its declared environment. It did not
settle flake evaluation, impure shell behavior,
substituter or network authority, project-level versus package-level
environment ownership, prepared-tree identity, or dependency-lock semantics.

The branch therefore remains research material. Its strict store-path and
closure checks, generation-identity work, GC-root measurements, and negative
security findings may inform a later Nix integration. They must be selected
and generalized individually after that feature has its own requirements. The
branch is not a deferred implementation ready to merge wholesale.

One negative result is retained as an architectural warning: a future Nix
integration must not treat `nix-store -q --roots` as a harmless local
observation. It queries daemon-global state and may prune unrelated stale
auto-roots. Any retention feature must use authority confined to Jig-owned
collector state; package code receives neither that authority nor Nix daemon
access.

## 2. Architectural boundary

Nix is not a public or architectural Jig requirement:

- FLOW package metadata or a FLOW conformance requirement;
- a required Jig host dependency;
- a portable Runtime Adapter profile;
- part of project authority merely because a `.nix` file exists; or
- a release gate for the next Jig vertical slice.

One retained private author-evaluator proof still requires Bun and its closure
to be immutable `/nix/store` paths on this particular host. That is an explicit
test-fixture limitation, not the implementation behind the next generic slice.

The reviewed generic boundary remains unchanged:

```text
immutable package + Binding + host policy
    -> trusted Runtime Adapter inspection and planning
    -> Sandbox Backend preparation and activation
    -> pinned evidence, admission, execution, and cleanup
```

A later project-environment integration may prepare retained toolchain
evidence for ordinary Runtime Adapters. Whether package-local Nix metadata
participates is a separate, deliberately open question. The current design
does not conflate those scopes or promise that either already exists.

## 3. Retained implementation evidence

The decontaminated `main` branch keeps the generally useful work:

- the Run/1, Package/1, Schema/1, and TypeScript/Python SDK foundation;
- the Service/1 wire and Provider SDK candidate;
- the private cgroup-v2/Bubblewrap Backend proof, race-free pre-exec
  placement, whole-tree fencing, cleanup ownership, and hostile corpus;
- project authoring, descriptor-confined capture, retained Package/1
  artifacts, static-import evaluation on the proof host, and pure
  package/Binding linking;
- deterministic non-admissible resolution observation;
- strict portable lock projection; and
- durable lock-first planning and admission of an exact `UNAVAILABLE` target.

The Linux proof used host Nix-store paths as test fixtures. That empirical
fact does not make its cgroup, namespace, fencing, or cleanup findings
Nix-specific. Conversely, the proof does not qualify a production Runtime
Adapter or a retained `READY` recipe.

## 4. Current milestone status

| Milestone | Status |
|---|---|
| FLOW Run/1, Package/1, Schema/1, and TypeScript/Python SDKs | Prerelease foundation complete; publication and general certification remain separate gates. |
| Service/1 | Wire and Provider SDK candidates plus the session-local matrix are complete; durable hosting and a second independent Host remain open. |
| Sley compatibility | One real Run/1 integration proves the lower boundary; Jig Graph's definition/compiler interface remains open. |
| Linux containment | Strong private cgroup-v2/Bubblewrap evidence exists; no public Sandbox Backend interface is claimed. |
| Project authoring and capture | Inert authoring, capture, retention, and linking are generic private proofs. The private evaluator now consumes an authenticated sandbox-lifetime runtime-support receipt rather than a Nix lifetime observation; the agent-sandbox observer remains one proof-host input rather than a public host interface. |
| Lock and admission | Private portable projection and durable exact-`UNAVAILABLE` plan/apply path are complete. |
| Runnable admission | No generic retained `READY` recipe or restart-safe spawn lifecycle exists. |
| Public Jig administration | Plan, apply, root-Run, authentication, status, and error interfaces remain release-gated. |
| Journal/Hooks, Agents/Semantic Choice, updates, and Starters | Reviewed semantics exist; implementation/public projections remain later slices. |

## 5. Next vertical slice

The next milestone is one direct exact root Run, not a Nix feature:

```text
one immutable captured project through a retained generic author evaluator
    -> one discovered zero-configuration Run package
    -> one explicitly installed Runtime Adapter
    -> one explicitly installed Sandbox Backend
    -> READY or exact UNAVAILABLE plan
    -> reviewed lock-first apply
    -> idempotent root Run submission against one admitted generation
    -> contained Run/1 execution
    -> durable terminal result and complete cleanup
```

The slice deliberately excludes Bindings, Services, Hooks, Agents, Semantic
Choice, child Flows, Jig Graph, update watching, and any ambient runtime
fallback. It must close only the candidate host-extension registration,
planning, receipt, policy, lock, and plan/apply/run models needed for this one
path. Cgroup v2 and Bubblewrap remain one private implementation, not portable
schema vocabulary.

The existing Nix-backed evaluator is evidence for sandboxed author-code
execution only. It cannot supply the generic step above. The slice first needs
an exact Runtime Support Closure for both the author evaluator and one direct
Run, or an equivalently narrow host mechanism, without weakening the current
immutability checks or publishing a speculative general interface.

Before implementing that chain, the **administrator**, not Jig, must install
and own the lifetime of one immutable proof substrate. It contains exactly the
runtime support and trusted launch artifacts required by the evaluator and one
Run. Host policy fixes one protected registration for that substrate. Jig owns
only the protected registration and admission evidence it consumes: every new
coordinator reacquires and revalidates the registered paths and bytes, and
absence or identity drift makes the target exactly `UNAVAILABLE`.

Jig does not copy, install, retain, update, garbage-collect, or delete those
physical runtime bytes. It does not query or mutate a package manager to keep
them alive. This is one externally provisioned test substrate, not a generic
runtime store, package-manager abstraction, host-generation system, or public
extension interface. If the selected host cannot provide that lifetime promise
without Jig coordinating a package-manager namespace, daemon, collector, or
mutation API, the checkpoint ends at exact `UNAVAILABLE`. Only after the
substrate works end to end should Jig derive the smallest private
Adapter/Backend candidate model from the path actually consumed.

Later on 2026-08-26, the sandbox host supplied a sandbox-lifetime runtime lease
and bounded read-only receipts. The private observer and evaluator checkpoint
in [review 131](131-private-runtime-lease-observation.md) now proves retained
author evaluation and fresh-process reacquisition without giving Jig Nix
lifecycle authority. The host's isolated live-GC/teardown exercise remains a
deployment check. A narrowly installed production launcher and one retained
Flow execution recipe remain open; the lease does not manufacture either.

Before expansion, the slice must prove:

1. generic retained author-evaluator support on the selected host (**private
   proof complete in review 131**);
2. deterministic Adapter and Backend selection from explicit host policy;
3. one generic retained `READY` disposition beside the existing exact
   `UNAVAILABLE` branch;
4. reviewed-plan staleness and lock-first admission;
5. idempotent root submission against one admitted generation and durable Run
   identity;
6. restart reconciliation around spawn intent and terminal publication,
   recording `lost` or failure when success bytes cannot be recovered and
   never inferring or replaying successful work;
7. cancellation, deadline, process-tree fencing, and zero residue; and
8. an independent consumer probe using only the frozen public subset.

The host-extension plumbing remains private through this proof. The project
may freeze only the user/admin plan, apply, run, status, and error subset the
vertical path actually consumes. A public Runtime Adapter or Sandbox Backend
SPI requires a second independent mechanism to demonstrate the abstraction.

No later subsystem is removed from the roadmap. Its ordering should be chosen
after this vertical slice reveals which shared foundation is actually needed.
