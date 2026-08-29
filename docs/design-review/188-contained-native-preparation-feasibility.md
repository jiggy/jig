# Contained native preparation feasibility checkpoint

**Status:** accepted on 2026-08-29 after focused pure tests, a real privileged
envelope proof, and independent adversarial review. This checkpoint closes
ephemeral installer feasibility only. It does not create durable preparation,
a prepared-tree store, a READY disposition, or a public Adapter/Backend API.

## 1. Implemented boundary

One private path now exercises the retained relation from review 187:

```text
authentic Bun Run Binding request
    -> exact retained Package/1 and package-local SDK archive
    -> one fixture-built, trusted-side-selected read-only worker snapshot
    -> fixed networkless cgroup-v2/Bubblewrap owner
    -> script-free offline Bun install in private /work
    -> exact install-tree and package-identity checks
    -> bounded detached candidate bytes
    -> successful payload exit plus complete descendant fence
    -> pure candidate normalization
    -> ephemeral materialization cleanup
```

The worker is bundled before activation. The preparation owner mounts that
single bundle, the retained package materialization, and the exact retained
Bun Runtime Support Closure read-only. It does not see the Jig source tree,
ambient package caches, registry configuration, a host home, host networking,
host cgroupfs, or host devices other than the Backend's already-proved private
least-mode projections.

The fixed installation has exactly one synthetic dependency and uses Bun with
production-only, no-save, ignored-script, no-cache, bounded-cache,
single-network-worker and copy-file settings. Network absence is enforced by
the Backend namespace rather than represented as package metadata or a Bun
profile.

## 2. Output and lifecycle boundary

The worker never imports or evaluates the installed package. It accepts only
an exact project tree containing the synthetic manifest and one
`node_modules/@flowmd/sdk` tree. Lockfiles, sibling or hoisted packages,
transitive `node_modules`, links, special files, empty directories, unstable
reads, excessive files/directories/bytes, the wrong name/version, and missing
runtime entry bytes fail closed.

Worker stdout remains untrusted. The host drains stdout and stderr under
pre-append bounds, fences on overflow, and does not parse or accept the
candidate until all of these are true:

```text
exitCode = 0
signal = null
stopReason = payload_exit
complete Backend enforcement receipt
worker artifact still has the selected digest
```

The normalizer independently checks strict canonical JSON/1, the retained
archive digest, exact shape, sorted collision-free paths, canonical base64,
aggregate and manifest bounds, exact SDK name/version, and `dist/index.js`.
Its frozen value is still only an inert candidate. It is not a prepared tree,
mount, recipe, authority, or fence receipt.

On an ambiguous fence the proof retains internal materialized backing and
returns a distinct private fence-unconfirmed error. It deliberately exposes no
cleanup/recovery handle. That is an honest feasibility limitation, not a
product lifecycle. Durable preparation must persist its owner and backing
before dispatch so a replacement coordinator can reacquire and fence them.

## 3. Evidence

The focused pure shard passes:

```text
retained relation plus candidate normalization    13 tests / 67 expectations
TypeScript build                                  passed
```

After the Linux capability preflight passed, the focused privileged proof
performed three contained installations:

1. the real packed `@flowmd/sdk@0.0.0` archive;
2. an identical repeat proving deterministic candidate identity; and
3. a synthetic exact SDK archive carrying a hostile `postinstall`, proving the
   fixed installer ignores lifecycle scripts (execution would also have
   violated the exact project-tree check).

```text
hostile feasibility test                          1 / 1
hostile expectations                              10
residual Jig cgroups                              0
residual Jig private-device directories           0
host /dev/urandom                                 char 1:9, mode 0666
```

The proof fixture's unique `0400` worker bundle is built in a trusted-side
temporary test tree, digested before and after execution, inode-sealed by the
Backend, and retained through the fence. This is sufficient evidence for the
ephemeral checkpoint only. It is not administrator-installed,
restart-reacquirable product machinery.

## 4. Deliberate non-claims

This checkpoint does not establish:

- a durable native-preparation child or spawn-intent record;
- restart recovery, coordinator-loss fencing, or no-redispatch semantics;
- a protected immutable prepared-tree artifact and reference;
- Candidate readiness or final Flow execution from prepared bytes;
- an adversarial proof that installed package code cannot be imported or
  executed beyond the worker's fixed no-import construction and exact-tree
  validation;
- malformed-archive, output-overflow, cancellation, deadline, and
  coordinator-loss matrices, which remain part of the later durable lifecycle
  proof;
- registry acquisition, shared caches, general npm dependency semantics, or
  dependency locking;
- a host installation/registration format for the worker bundle;
- a public Runtime Adapter, Sandbox Backend, installer, artifact-store, or
  preparation API; or
- any Jig-specific `agent-sandbox` feature.

The successful use of a package-local tarball validates review 186's ownership
correction: dependency bytes are untrusted package content. Runtime support,
the installer worker, and containment machinery remain host-owned.

## 5. Next boundary

The next private checkpoint is one durable preparation child:

1. allocate and persist exact preparation identity, worker/runtime/package
   evidence, owner-state allocation, and output backing before dispatch;
2. record possible dispatch before installer bytes can execute;
3. reacquire and fence after coordinator loss without redispatch;
4. publish a protected immutable prepared-tree artifact only after successful
   exit, complete fence, candidate validation, and exact materialization;
5. retain that artifact independently of Package/1; and
6. keep all preparation machinery private until another real mechanism earns
   an interface.

Final read-only Run execution and READY admission remain later checkpoints.
