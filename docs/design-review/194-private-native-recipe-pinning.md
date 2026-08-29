# Private native-recipe pinning checkpoint

**Status:** accepted on 2026-08-29 after focused tests, a TypeScript build,
and two independent adversarial reviews. This checkpoint closes the planning
identity for one Bun Run which requires the already proven package-local
preparation. It does not execute that recipe, make the target operationally
READY, or publish a Runtime Adapter, Sandbox Backend, dependency, or artifact
interface.

## Closed routing decision

Every private Bun planner now reopens retained Package/1 bytes before choosing
between the dependency-free and prepared recipes. Classification is mandatory;
omitting preparation support is not evidence that dependencies are absent.

The closed result is:

```text
no package manifest or only the narrow inert manifest fields
    -> dependency-free Bun recipe

exact package-local @flowmd/sdk archive relation
    + exact trusted preparation worker
    -> distinct planning-only native recipe

anything else
    -> exact unavailability / fail closed
```

Any `node_modules` path segment, recognized lockfile basename, second
dependency collection, or non-allowlisted manifest field is rejected. The
one recognized relation remains Binding-only and is re-derived from the
retained package; visible source, ambient caches, registries, and caller
assertions are never consulted.

All current production planner callers supply the retained package store.
The Project Session intentionally supplies no preparation worker yet, so a
native-dependent target cannot enter its ordinary executable path before the
root join exists.

## Exact planning identity

The new private recipe pins:

```text
activation request and retained Package/1 relation
preparation-controller artifact and policy observation
exact worker bytes (but not their host path)
retained Bun Runtime Support Closure
Linux Backend mechanism observation
non-null preparation plan and envelope digests
final prepared-tree launch-envelope digest
authority and resource ceilings
```

The controller observation is authentic and includes its implementation
artifact, revision, fixed worker/package destinations, Bun policy, stdout and
stderr bounds, preparation resource limits, and required process/runtime
predicates. Revalidation reacquires the controller, worker, runtime, and
Backend evidence. Relocating identical worker bytes preserves logical recipe
identity; changing those bytes fails.

The recipe and observation remain host-local evidence. No host path, digest,
runtime profile, or preparation field enters FLOW metadata, Package/1,
portable Lock values, or public Project Authoring values. Apply remains a
pure admission operation and runs no preparation.

## Execution refusal

The planning recipe is accepted by the private candidate machinery so the
following join can pin it, but it is not executable yet. Every generic
consumer is exhaustive:

- direct Run execution rejects the native recipe;
- root execution rejects it before allocation or launch;
- child Flow execution rejects it before allocation or launch; and
- no non-Bun fallthrough can interpret it as a Python recipe.

This preserves the distinction between a complete logical recipe identity and
an implemented root-owned realization. A later checkpoint must remove those
refusals only while joining the exact durable preparation and prepared-tree
materialization lifecycles.

## Evidence and remaining boundary

Focused evidence passes:

```text
retained classification and recipe planning    11 tests, 83 expectations
TypeScript build                               passed
independent adversarial review                 GO (twice)
```

The regressions cover mandatory classification, missing trusted worker,
root and nested `node_modules`, known lockfiles including
`npm-shrinkwrap.json`, unknown manager/install metadata, malformed dependency
relations, retained-byte corruption, forged values, path-independent worker
identity, and post-plan worker drift.

No Candidate, Plan, database, portable Lock, prepared-artifact, or Package/1
format changed. The next boundary is the root-owned join:

1. the trusted Project Session must receive and pin one exact worker;
2. root execution must create or recover the exact preparation owner without
   redispatching possibly dispatched work;
3. successful preparation must become the existing detached read-only
   materialization; and
4. the final Bun Run must use that tree while preserving result admission,
   cancellation, deadline, fencing, restart, and zero-residue guarantees.

Until that proof passes, the new recipe is planning evidence only.
