# Private unavailable lock-first apply checkpoint

**Status:** implemented and adversarially reviewed private checkpoint. It can
durably admit one exact unavailable target and replay the resulting historical
receipt. It cannot make any target runnable and does not publish a public API,
schema, or storage contract.

This closes the executable slice frozen by
[review 120](120-private-unavailable-admission-record.md). The implementation
remains deliberately narrower than the full project admission transaction in
the project-policy specification.

## 1. Smallest protected state

The pre-release private database format was replaced, not migrated. Version 2
has exactly five application tables:

```text
candidates
    append-only private revision
    canonical candidate digest and bytes
    canonical proposed-lock bytes

candidate_head
    one nullable private revision

review_plans
    canonical plan digest and bytes
    exact candidate revision

admissions
    append-only private revision
    canonical admission digest and bytes
    unique prior-generation digest
    unique reviewed-plan digest

admission_head
    one nullable private revision
```

The SQLite admission revision is integrity bookkeeping only. It is absent from
canonical admission identity. Candidate revision is derived through the
referenced plan rather than duplicated in the admission row. The singleton
head carries no vacuous uniqueness constraint.

Every open verifies exact schema identity, foreign keys, contiguous candidate
and admission revisions, one linear admission root, the complete canonical
admission chain, every plan/candidate closure, and every admitted candidate's
pinned project-root identity. This is intentionally a full linear verification
pass. The checkpoint prefers simple corruption detection over an unmeasured
incremental-integrity scheme.

## 2. One apply operation

The private operation takes only:

```text
project root
protected package store root
exact persisted plan digest
exact reviewed base-generation digest or null
```

It does not accept candidate bytes, replacement lock bytes, a runtime recipe,
authority, a caller identity, or a target override.

Apply proceeds in this order:

1. open and verify protected state;
2. strictly load the exact persisted plan;
3. return its already-stored admission immediately when it previously
   committed;
4. otherwise load the exact candidate, reprove its project root, and reacquire
   every retained Package/1 artifact named by the candidate;
5. enter `BEGIN IMMEDIATE` and recheck immutable plan/candidate rows, current
   candidate head, current admission base, and complete chain integrity;
6. converge the visible lock under the protocol below;
7. recheck protected rows and both heads;
8. create and insert one canonical admission record;
9. compare-and-set the singleton admission head; and
10. commit, close protected state, then release retained artifacts.

SQLite busy is an unavailable result which requires retry of the complete
operation. There is no resumable transaction, apply-intent row, auxiliary
approval receipt, or advisory serialization file.

## 3. Lock convergence

Update mode accepts exactly two states:

```text
the plan's exact observed lock state
    -> publish the candidate's exact canonical bytes

the candidate's exact canonical lock bytes
    -> synchronize those bytes and continue
```

The second state is the durable recovery state after publication but before
the database compare-and-set. It is also safe when a user independently wrote
the exact bytes: the portable lock is inert and cannot prove authorship.

Locked mode accepts only the exact proposed canonical bytes. It synchronizes
and reverifies the existing inode without replacing it. Any other visible
state is `STALE_PLAN`.

Publication uses one fixed private stage beneath the pinned `.jig` directory.
The implementation:

- rejects symbolic links, special files, wrong owners, links, devices, sizes,
  or modes at the stage boundary;
- removes only a verified safe abandoned stage and synchronizes `.jig`;
- creates the stage with no-follow/no-replace and owner-only initial mode;
- writes, normalizes mode, fsyncs, and reverifies exact bytes and identity;
- synchronizes `.jig`, reobserves the destination, and performs one
  same-filesystem rename;
- reverifies and fsyncs the renamed inode, project root, and `.jig`; and
- reobserves the final exact bytes before the admission insert and head CAS.

A pre-rename failure removes only its still-verified owned stage. A
post-rename failure does not restore the old lock; SQLite rolls back and the
new exact bytes remain inert for explicit retry.

## 4. Replay, races, and crash state

The stored admission record is the idempotent receipt. Replay tests committed
plan identity before current-head freshness:

```text
committed exact plan
    -> return exact historical receipt
    -> do not inspect or change the visible lock
    -> do not move the admission head

uncommitted plan
    -> require current candidate and reviewed base
    -> stale on any mismatch
```

This closes acknowledgement loss without reactivating historical policy.
Concurrent identical applies converge to one row and one receipt. Concurrent
distinct plans sharing a base serialize at SQLite; exactly one creates the
child and the other becomes stale.

The ordinary corpus directly constructs the durable
`exact lock + empty admission head` outcome, adds bounded safe stage residue,
then proves one successful apply, no inode replacement, no stage leakage, and
stable replay. A separate hostile-host test kills a SQLite writer with a hot
rollback journal and proves recovery of the current head. These are separate
claims: the corpus proves the recovery state and SQLite rollback behavior; it
does not claim control over the exact machine instruction at which a real
power loss occurs.

## 5. Evidence

Focused ordinary tests prove:

- sequential generations and exact base snapshots;
- historical receipt replay without head movement;
- complete historical-chain corruption rejection;
- exact published-lock/no-admission convergence;
- successful locked apply with a stable visible-lock inode;
- concurrent identical replay and competing same-base plans;
- safe partial-stage cleanup and unsafe-stage preservation;
- third-state visible-lock drift rejection before admission;
- non-hot rollback-journal acceptance and unsafe/WAL rejection; and
- protected path, schema, digest, and current-head integrity.

The authentic retained-project proof additionally covers factory-only
candidate publication, restart provenance, retained artifact reacquisition,
raw lock-byte observation, sequential plans, stable historical replay, writer
death with a hot journal, contiguous-history corruption, and strict private
database identity.

Two independent implementation reviews challenged filesystem recovery and
SQL/CAS closure. Their blocking findings—missing exact recovery-state proof,
missing locked success, missing concurrent apply, incomplete historical-chain
validation, and missing project-root binding on admitted historical
candidates—were fixed before this checkpoint.

## 6. Explicit omissions and next boundary

This checkpoint adds no:

- READY recipe, Runtime Adapter, Sandbox Backend, provider, or retained host
  generation;
- Run admission, Flow execution, Hook Journal boundary, revocation, or
  tombstone;
- actor authentication, signature, or separate approval evidence;
- equivalent-capture shortcut, pruning, garbage collection, or migration;
- public Jig API, CLI, machine schema, or storage abstraction; or
- protection against an uncooperative same-UID editor, network filesystem,
  hostile FUSE implementation, or arbitrary power-loss model.

The target remains unavailable because no generic retained Runtime
Adapter/Sandbox Backend recipe, active Backend preflight, and durable spawn
lifecycle are implemented and admitted. The next slice must add those facts
through explicit host policy and one restart-safe direct-Run path, without
promoting this private single-target checkpoint into a public compatibility
promise. The archived Nix host-runtime experiment is not a prerequisite; see
[`130-nix-experiment-disposition-and-next-slice.md`](130-nix-experiment-disposition-and-next-slice.md).
