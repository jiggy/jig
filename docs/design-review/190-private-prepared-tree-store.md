# Private prepared-tree store checkpoint

**Status:** accepted on 2026-08-29 after focused publication, restart,
corruption, collision, and retained-source tests plus independent review. This
checkpoint closes immutable storage for one exact Bun-prepared SDK subtree. It
does not dispatch preparation, own its lifecycle, make a target READY, or add
a public artifact API.

## 1. Identity remains distinct from Package/1

Package/1 is the exact authored source reviewed, locked, and admitted by the
project. Generated native runtime material must not silently redefine that
identity.

The private prepared-tree record therefore commits:

```text
retained source Package/1 digest
preparation observation and request digests
normalized candidate digest
derived dependency-member digest
exact bounded installed @flowmd/sdk files
```

Its composite digest belongs to a separate private identity domain. Source
Package/1 stays independently retained; the new store owns only the bounded
generated SDK subtree and its composite record. This avoids duplicating up to
the full Package/1 limit while preserving the distinction between authored
source, generated backing, provenance, and execution evidence.

The reference is inert. It grants no admission, launch, retention, or package
authority by itself.

## 2. Publication and reacquisition

Publication accepts only an authentic retained preparation observation and an
authentic normalized candidate whose request, source Package/1, observation,
and dependency member agree.

Before publication it reacquires the source Package/1 and rejects:

- any source path whose first segment case-folds to `node_modules`;
- source/dependency path or Unicode case-fold collisions;
- a file which collides with any required directory prefix; and
- any candidate which failed the preceding exact SDK normalization.

The record is canonical JSON/1 in a content-addressed private shard. Every
directory is exact coordinator-owned `0700`; the final regular file is exact
coordinator-owned `0400`. Publication writes and syncs a unique stage, seals
it read-only, validates it, hard-links it to the absent final name, syncs the
directory, and removes the stage. Concurrent identical publications converge
on the same verified object. An unexpected final leaf is never replaced.

Reacquisition independently validates:

```text
canonical bytes and bounded record size
every identity digest
strictly sorted, collision-free paths
canonical base64 and total decoded bytes
exact @flowmd/sdk@0.0.0 package.json
required dist/index.js
exact 0700/0400 ownership and path identity
the separately retained source Package/1
```

It returns one detached logical capture joining the retained source files with
`node_modules/@flowmd/sdk/**`. Mutable source paths and the earlier candidate
object are unnecessary after publication. Disposing the capture revokes its
reads and releases the source snapshot.

## 3. Failure posture

A missing or changed source Package/1, symlinked/special/wrong-mode record,
malformed self-consistent record, wrong SDK manifest, missing runtime entry,
or changed pathname identity fails closed. Stored bytes are never repaired in
place. Failed publication cleans its own unique stage and leaves an unexpected
final entry untouched.

The store intentionally has no writable runtime mount, mutable prepared-tree
directory, package-manager cache, registry client, garbage collector, or
generic blob-store interface. A later lifecycle owner must bind its exact
prepared-tree reference to the successful candidate outcome before that
reference can support execution.

## 4. Evidence

Focused evidence passes:

```text
TypeScript build                                      passed
prepared-tree publication/reacquisition               7 / 7
prepared-tree expectations                            24
adjacent Package/1 artifact-store integration        18 / 18 combined
adjacent preparation/candidate checks                13 / 13
```

The focused tests cover detached restart reacquisition, eight-way concurrent
publication, stage cleanup, source namespace collision, hostile accessors,
symlink and mode replacement, retained-source drift, and an independently
constructed content-addressed record with the wrong SDK identity.

Independent review found no authority or persistence blocker. Two minor local
implementation debts do not change this checkpoint: a dependency stream
already returned before capture disposal owns detached bytes and can finish,
and read-path handle-close errors are not a durable authority transition.

## 5. Non-claims and next boundary

This checkpoint does not prove:

- durable installer dispatch, cancellation, deadline, or coordinator loss;
- a lifecycle artifact fact correctly bound to this exact reference;
- materialization and final read-only Run execution;
- prepared-tree collection or shared dependency caching;
- general npm, registry, transitive dependency, or lock behavior; or
- a public prepared-tree, package-store, Runtime Adapter, or Backend API.

The next lifecycle checkpoint must use typed facts, bind this reference to the
durable successful candidate, prevent root completion while preparation is
open, and supply one-shot dispatch-to-launch authority. Only the following
concrete controller may join those checkpoints to the existing Linux Backend
and prove restart, fencing, cleanup, and zero residue.
