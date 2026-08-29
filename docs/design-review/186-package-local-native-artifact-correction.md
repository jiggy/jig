# Package-local native artifact correction

**Status:** accepted on 2026-08-29 after review 179's external blocker was
challenged against the runtime, Package/1, and admission boundaries. This
review supersedes review 179's requirement for an administrator-owned FLOW SDK
archive record while preserving its rejection of caller-asserted retention and
authority.

## 1. The category error

Review 179 correctly rejected an API in which a caller supplied an archive
pathname, expected digest, and assertion that the bytes would remain retained.
Those assertions prove neither stable custody nor reviewed execution meaning.

It then assigned the missing record to the host administrator. That conclusion
was wrong. It conflated two different classes of input:

```text
trusted host machinery
    runtime, loader, installer, Adapter, Backend, helper and policy

untrusted package input
    source, native manifests, locks and dependency archives
```

The administrator must install and retain the first class. The second class is
allowed to be malicious and is safe only because Jig captures it, presents its
exact meaning for review, and executes preparation and the final component
inside the admitted containment envelope. Host custody cannot make arbitrary
dependency bytes approved, and administrator approval is not required for each
npm tarball or Python wheel.

## 2. Correct first proof

The first offline Bun proof uses one self-contained Package/1:

```text
reviewer/
├── FLOW.md
├── flow.ts
├── package.json
└── vendor/
    └── flowmd-sdk-0.0.0.tgz
```

Its native manifest uses an ordinary relative dependency:

```json
{
  "dependencies": {
    "@flowmd/sdk": "file:./vendor/flowmd-sdk-0.0.0.tgz"
  }
}
```

`vendor/` is not FLOW vocabulary or a Jig convention. The relative reference
is interpreted only by the selected Bun Adapter. A later registry-backed,
locked, or ecosystem-specific acquisition mechanism may obtain dependency
bytes differently without changing FLOW.

Package/1 already captures every descendant regular file. The archive
therefore follows the existing authority and lifetime chain:

```text
descriptor-confined source capture
    -> canonical Package/1 digest
    -> protected PackageArtifactRef publication
    -> Candidate and complete review Plan
    -> explicit compare-and-set apply
    -> immutable admitted generation
    -> separately fenced native preparation
```

The original workspace path ceases to matter after capture. A source change
produces another Package digest and therefore another Candidate and Plan.
Restart reacquisition uses the existing protected PackageArtifactRef. The
relative manifest-to-archive relation is reconstructed from those same exact
bytes rather than trusted from a second caller value.

## 3. Authority and provenance

The dependency archive has no authority merely because Jig retained it. It is
untrusted package-controlled input. Applying the complete reviewed Plan admits
the package, exact dependency member, preparation recipe, host machinery and
attenuated execution envelope together.

The relevant evidence remains separate:

| Question | Evidence and owner |
|---|---|
| Which source supplied the bytes? | Captured project/package provenance |
| Which exact archive bytes? | Package/1 plus a derived member digest |
| How are they retained? | Protected PackageArtifact store and generation/Run owners |
| How are they reacquired? | Exact PackageArtifactRef verification |
| Why does the archive satisfy the declaration? | Relative native declaration plus contained package inspection |
| Who approved execution? | Reviewed Plan and explicit apply |
| Which machinery may interpret it? | Administrator-installed Adapter, installer and Sandbox Backend |

An archive may still lie about its name or version, contain hostile paths, or
exploit installer behavior. The Adapter derives and validates the exact
manifest/archive relationship and plans the fixed script-free, networkless
operation. The Sandbox Backend alone invokes and supervises the installer,
fences its complete tree, and returns output for safe-tree validation.
Dependency bytes never become Runtime Support Closure.

## 4. What remains rejected

This correction does not accept:

- a runtime API taking a caller pathname, digest, or lifetime assertion;
- an ambient package cache, registry, home, configuration, `NODE_PATH`, or
  `PYTHONPATH`;
- dependency bytes mounted as Runtime Support Closure;
- a Jig-specific `agent-sandbox` feature or artifact whitelist;
- a public artifact registry, blob-store, source-provider, Adapter, or Backend
  SPI; or
- silently resolving a package's exact registry dependency from a bundled
  artifact with no reviewed native relationship.

A generic sandbox-scoped immutable-blob facility could attest custody and
lifetime, but it could not attest package provenance or grant execution
authority. It is optional infrastructure and is not on Jig's critical path.

## 5. Earned implementation boundary

The next private vertical is review 175's selected contained installer with
the corrected source of dependency bytes:

1. recognize only one exact retained Bun package whose relative local archive
   is inside the same Package/1;
2. derive only the native dependency key, normalized relative member path,
   member digest and synthetic installer inputs from retained package bytes;
3. prove one ephemeral fixed offline, networkless, script-free Bun installation
   in the pinned Backend envelope, and validate the installed package identity
   and bounded output only after its complete descendant tree is fenced;
4. then allocate one durable preparation child and persist spawn intent before
   any installer byte executes;
5. retain one private prepared tree whose identity is distinct from Package/1;
6. launch the final Run read-only with installation disabled; and
7. prove cancellation, deadline, coordinator loss without redispatch,
   malformed/replaced archives, deterministic output and repeated zero
   residue.

The package-local tarball is the narrow pre-publication proof, not a
recommendation that every Flow vendor every dependency. Registry acquisition,
shared dependency stores, remote sources, and general native lock semantics
remain later demand-driven work.

## 6. Product consequence

Native preparation is no longer externally blocked on an SDK-specific host
record. The production launcher/runtime-support installation remains an
external alpha gate, and a real Agent provider remains a separate routing
gate. Neither justifies stopping this local preparation vertical or teaching
`agent-sandbox` about Jig.
