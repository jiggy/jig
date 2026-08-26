# Private unavailable candidate head and review-plan store

**Status:** implemented private persistence checkpoint. It stores immutable
single-target unavailable candidates and inert review plans. It does not write
`jig.lock`, apply a plan, create an active generation, return an admission
receipt, approve anything, or make a target runnable.

This closes the first restart boundary after the canonical candidate from
[review 118](118-private-unavailable-candidate.md). The store deliberately
contains only the state needed by its current consumers.

## 1. Three tables, three meanings

The private SQLite format has exactly three application tables:

```text
candidates
    append-only revision
    canonical candidate digest and bytes
    exact canonical proposed-lock bytes

candidate_head
    one singleton row
    null for an empty store, otherwise the latest candidate revision

review_plans
    plan digest
    exact candidate revision
    canonical plan bytes
```

There is no generation, receipt, approval, status, activation, runtime recipe,
or current-admission table. `application_id` and `user_version` identify this
private database format; they confer no authority.

Candidate revisions are positive safe integers and remain contiguous. Every
open and operation requires either an empty candidate table with a null head,
or:

```text
minimum revision = 1
row count = maximum revision = head revision
```

The current head row is strictly decoded and rehashed, and its embedded
project-root identity must match the pinned current root. This catches a
missing, regressed, advanced, gapped, malformed, or copied non-empty head.
An empty database is not permanently tied to one inode because it contains no
project evidence yet.

Publication is monotonic:

```text
A, A       -> revisions 1, 1
A, B, A    -> revisions 1, 2, 3
```

Only the invocation-local retained-project factory result may be published.
An identical latest candidate is idempotent only when its digest and both byte
records match exactly. A later return to an older semantic candidate still
creates a new revision; there is no digest uniqueness shortcut which could
hide ABA history.

## 2. Plans are durable snapshots, not consent

Plan creation observes one exact candidate head and one exact visible-lock
state, then persists:

```text
private-unavailable-plan/1
    candidate digest and revision
    baseGeneration: null
    lockMode: update | locked
    observedLock: absent | exact raw-file SHA-256
```

`baseGeneration` must remain null until active-generation storage actually
exists. `update` means a later apply is allowed to publish the proposed lock;
it does not write it now. `locked` requires the visible `jig.lock` bytes to
already equal the candidate's exact canonical lock bytes. Absence, drift,
alternate JSON spelling, symlinks, hardlinks, and a changing observation fail.

The observed digest hashes the exact visible canonical file bytes, not a
second semantic lock identity. This makes the future apply comparison a byte
comparison. Plan identity remains its separately domain-separated canonical
record digest.

A plan row is immutable and digest-addressed. Repeating one observation
converges only when plan bytes and candidate revision are identical. Old plans
remain inspectable after the candidate head advances, but no stored plan is
current authority. Future apply must reload it and repeat its compare-and-set
checks.

## 3. Restart provenance requires retained artifacts

Strict candidate decoding remains inert. The store mints a separate
restart-local provenance only after all of these succeed:

1. protected database and project-root checks;
2. canonical row decoding and row-key digest verification;
3. exact plan-to-candidate cross-checking;
4. reacquisition of every unique Package/1 referenced by the candidate lock;
5. reacquisition of the retained declaration Package/1; and
6. an exact inspection comparison for each locked Flow package.

Flow comparison covers Package/1 digest, Run/Service mode, direct-Run
eligibility, attachments, used capability identities, and provided capability
identities. Duplicate package digests at different project paths must satisfy
every path's expected projection. The declaration archive is retained bytes,
not a Flow package, so it is reacquired but not Flow-inspected.

The declaration closure digest, aggregate capture digest, semantic digest, and
some request facts cannot be reconstructed from the portable lock. They remain
attestations originally created by the retained factory and protected by the
immutable database row. This checkpoint does not misdescribe reacquisition as
an independent re-evaluation of those facts.

Reacquisition currently holds one anonymous Package/1 capture per unique
digest until the protected row is rechecked and the transaction settles. Very
large authentic projects may therefore fail unavailable on file-descriptor or
temporary-storage exhaustion. A future protected-store pin primitive or a
tighter admission aggregate budget requires measured need; this checkpoint
does not silently introduce one.

## 4. Filesystem and SQLite boundary

The implemented authority is deliberately narrow:

```text
cooperating Jig administrators
    + one validated local filesystem
    + one effective POSIX user
```

It is not authenticated storage against a malicious project owner running as
the same user. It makes no NFS, SMB, FUSE, hostile-overlay, arbitrary power-loss,
or filesystem-wide compare-and-swap claim.

The implementation:

- pins the project root and `.jig` directory with open descriptors;
- requires `.jig` to be effective-user-owned mode `0700` on the project
  filesystem;
- requires the database to be a single-link effective-user-owned mode `0600`
  regular file on that filesystem;
- precreates and syncs the database and parent directories, including
  concurrent creation losers;
- opens SQLite through the verified visible absolute database path with
  `SQLITE_OPEN_NOFOLLOW`;
- verifies the visible root, directory, and database identities against the
  pinned descriptors immediately before and after that open and around every
  transaction; and
- never exposes this state or its descriptors to package code.

Bun's SQLite VFS cannot open `/proc/self/fd/<directory-fd>/...` with
`SQLITE_OPEN_NOFOLLOW`: the procfs descriptor component itself is a symlink.
The visible-path open plus descriptor identity bracket is the smallest honest
boundary with Bun's current API. It does not pretend to be an `openat2` or
open-by-file-descriptor handoff.

Every fresh connection requires:

```text
journal_mode = DELETE
synchronous = EXTRA
foreign_keys = ON
trusted_schema = OFF
bounded busy_timeout before the first database query
```

Operations use explicit `BEGIN IMMEDIATE`; no async transaction wrapper owns
the boundary. A busy database fails the complete operation with a retryable
unavailable result. Callers may retry the whole operation; they do not resume
inside a transaction.

A safe rollback journal may be hot or non-hot and may remain after a successful
operation. Jig validates its filesystem identity and leaves recovery and
retention entirely to SQLite. It never deletes or rewrites a possible journal.
WAL and shared-memory sidecars are rejected because this format requires the
reviewed rollback-journal lifecycle. SQLite documents both rollback-journal
atomic commit and `synchronous=EXTRA` directory synchronization semantics:
[atomic commit](https://sqlite.org/atomiccommit.html),
[PRAGMA synchronous](https://sqlite.org/pragma.html#pragma_synchronous).

## 5. Evidence and limits

Ordinary Linux/Bun tests, with no cgroup or privileged-host requirement, prove:

- exact schema and format tags;
- concurrent identical plan creation converges to one persisted row;
- fresh restart reload mints only stored provenance;
- safe non-hot journals remain accepted and untouched;
- unsafe journals and WAL sidecars reject;
- current-head digest corruption rejects; and
- weakened `.jig` or database modes reject.

The authentic hostile-host path additionally proves:

- factory-only candidate publication from a retained project;
- concurrent same-candidate publication;
- A/A/B/A revision behavior;
- persisted and old-plan reload after head advancement;
- exact raw lock-byte observation and locked-mode rejection;
- rollback recovery after killing a writer with a hot journal;
- current-head recovery rather than merely an unrelated historical read;
- contiguous-history deletion detection; and
- stored-candidate and retained-factory provenance remain distinct.

The store still has no public API or machine schema. Its types and database are
private implementation checkpoints, so the format may be replaced rather than
migrated before release.

## 6. Next boundary

The next slice is lock-first apply for this one unavailable case:

```text
reload exact persisted plan
    -> recheck candidate head and visible-lock observation
    -> durably stage and publish the exact proposed jig.lock when update mode permits
    -> fsync the visible file and both parent directories
    -> commit one local generation compare-and-set
    -> persist and return one canonical admission record as the idempotent receipt
```

That slice must define the one admission/receipt record before extending storage.
It must handle the crash window between visible lock publication and SQLite
commit without pretending rename is a filesystem-wide CAS against an
uncooperative editor. Until then, no function in this checkpoint applies a
plan or changes admission.
