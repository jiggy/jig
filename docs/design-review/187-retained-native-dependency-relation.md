# Retained native dependency relation checkpoint

**Status:** accepted on 2026-08-29 after implementation and an independent
hostile review. This checkpoint closes retained-byte recognition only. It does
not claim installer feasibility, a prepared tree, readiness, or execution.

## 1. Implemented boundary

One private observer now accepts only the first Bun reviewer shape:

```text
retained PackageArtifactRef
    -> exact Run Binding request
    -> retained Package/1 reinspection
    -> bounded strict package.json
    -> exactly @flowmd/sdk = file:./<portable member>.tgz
    -> exact captured member size and SHA-256
    -> frozen authenticated observation
```

The observer derives the dependency key, normalized relative member path,
member size and digest from the retained package. It accepts no caller archive
path, caller digest, cache, registry result, or retention assertion. Source
changes after capture do not affect the observation; protected-store
corruption fails closed.

It deliberately does not inspect tar metadata. Direct Flows, alternative
dependency collections, multiple dependencies, registry specifiers, path
aliases, missing or oversized members, pre-existing `node_modules`, and every
non-Bun/non-Binding activation remain unavailable for this private recipe.
That is recipe unavailability, not invalid FLOW.

## 2. Evidence

The focused relation plus PackageArtifact-store shard passes:

```text
19 tests
57 expectations
TypeScript build passed
```

The independent audit attacked duplicate JSON keys, escaped names, path
traversal and encoding, Package/1 collisions, bounded reads, member hashing,
store corruption, request/package drift, forged getters, and source mutation.
It returned **GO** with no required changes.

## 3. Deliberate non-claims

The observation is inert inspection evidence. It is not:

- proof that the member is a valid npm archive;
- a native-preparation Plan;
- permission to run Bun;
- a prepared-tree identity or store;
- Candidate readiness; or
- a public Runtime Adapter, Sandbox Backend, dependency, or artifact API.

The next proof remains one ephemeral, offline, script-free Bun installation in
the existing containment envelope. Candidate output may be buffered while the
worker runs, but Jig may parse or accept it only after the Backend confirms the
complete process-tree fence. Durable ownership and prepared-tree persistence
remain downstream of that feasibility result.
