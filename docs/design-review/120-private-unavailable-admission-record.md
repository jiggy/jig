# Private unavailable admission record and lock-first protocol

**Status:** canonical record implemented; protected apply remains the next
executable slice. This review freezes its minimum state machine before the
private SQLite format changes.

## 1. Admission is not readiness

Jig keeps an admission head even when its sole target is unavailable. The head
identifies the locally reviewed project-policy snapshot, not a runnable
activation. Root admission against it returns the exact target's unavailable
code and evidence and starts nothing.

This distinction is necessary because it:

- gives the next plan one exact compare-and-set base;
- permits later aggregate generations to contain both ready and unavailable
  targets;
- prevents a later host runtime installation from silently promoting the
  target; and
- records which source, resolution, lock, and unavailable evidence the local
  administrator actually admitted.

Availability remains a target disposition inside the candidate. There is no
generation-level ready/unavailable flag.

## 2. One record, not generation plus nominal approval

The private slice has no actor-authentication or signature boundary. A second
record named `approval receipt` would duplicate the plan and generation while
falsely suggesting proof of who approved it.

The one canonical record is therefore:

```text
private-unavailable-admission/1
    baseGeneration      null or exact prior admission digest
    planDigest
    candidateRevision
    candidateDigest
    lockDigest
```

Its domain-separated digest is the generation ID. Returning the same strictly
decoded stored record is the idempotent admission receipt. It proves only that
protected Jig state committed this exact persisted plan and advanced its head
at that time. It does not prove an actor identity, comprehension, continued
readiness, or that the generation is still current.

The candidate reference already commits project root, capture, normalized
semantics, complete resolution input, planning evidence, declaration artifact,
target disposition, and exact portable lock. Repeating those fields in the
admission would create drift. A canonical generation sequence number is also
omitted: the base-generation digest chain already supplies order and ABA
resistance. SQLite may use private row IDs for efficient integrity checks, but
they do not enter record identity.

The codec is closed, canonical JSON/1 plus LF, deeply immutable, bounded by the
existing JSON/1 ceiling, and independently domain-digested as
`JIG-Private-Unavailable-Admission/1`.

## 3. Planning now snapshots the admission head

Once admission storage exists, plan creation must read the current admission
head inside its protected transaction:

```text
fresh project       -> baseGeneration: null
after generation G  -> baseGeneration: digest(G)
```

The previous store's hardcoded null base was correct only while no admission
head existed. Keeping it would prove bootstrap but make a second reviewed
change impossible. Sequential unavailable generations use the same plan and
CAS model; later ready or multi-target record versions may reuse it.

## 4. Replay and stale are ordered deliberately

Apply takes the exact reviewed `(planDigest, expectedBaseGeneration)` pair.
Within protected state it first asks whether that plan already committed:

```text
committed exact plan
    -> return its immutable historical admission receipt
    -> never touch jig.lock or the admission head

uncommitted exact plan
    -> require current candidate and admission heads to equal its bases
    -> otherwise STALE_PLAN
```

This ordering resolves acknowledgement loss even if a later generation has
since become active. Returning historical evidence does not reactivate it.
Without an existing committed record, candidate, base-generation, or reviewed
lock drift is stale and no authority changes.

Missing retained artifacts are unavailable. Mismatching canonical rows,
digests, references, or artifacts are invalid/corrupt. A busy SQLite writer
causes the caller to retry the complete operation; apply never resumes inside a
transaction.

## 5. One transaction and one fixed lock stage

No advisory serialization file is added. One SQLite `BEGIN IMMEDIATE` spans
the final candidate/base validation, lock publication, admission insertion,
and head compare-and-set. It serializes cooperating Jig administrators and is
released by SQLite recovery after coordinator death. Another lock could not
serialize an editor which ignores it.

Update mode admits exactly two visible-lock states:

```text
the plan's exact observed state
    -> publish is required

the candidate's exact proposed canonical bytes
    -> already converged; fsync and continue
```

Exact proposed bytes may have come from a prior crashed apply or a manual
write. That authorship distinction has no safety meaning: `jig.lock` is inert,
and authority changes only in the protected admission CAS. Any third state is
drift and stale. Locked mode accepts only exact proposed bytes and never
stages or writes.

The publisher uses one fixed reserved path under pinned `.jig`, so crash debris
is bounded. Under the reviewed cooperative same-UID local-filesystem boundary:

1. validate candidate and admission heads before any file mutation;
2. reject unsafe reserved-stage types, owners, links, devices, or modes;
3. remove only a safe abandoned reserved stage and synchronize `.jig`;
4. create the stage with no-follow/no-replace semantics and owner-only initial
   permissions;
5. write exact bytes, set the deterministic visible mode, fsync and reverify
   descriptor/path identity, then synchronize `.jig`;
6. reobserve the destination and atomically rename on the same filesystem;
7. reverify and fsync the renamed visible inode, project root, and `.jig`;
8. reobserve exact visible bytes and protected heads;
9. insert the immutable admission, compare-and-set the head, and commit.

A pre-rename failure removes only the still-verified reserved stage. A
post-rename failure never tries to restore the former lock: the new exact lock
remains inert and SQLite rolls back. Recovery may converge only through exact
proposed bytes and still-current plan bases.

The protocol does not claim filesystem compare-and-set against an
uncooperative same-user editor or arbitrary hostile filesystem/power-loss
semantics. It does guarantee that the protected admission transaction never
commits before exact lock bytes have been synchronized and reverified within
the stated host boundary.

## 6. Crash outcomes

```text
before rename
    old lock + optional bounded safe stage + old admission head

after rename, before SQLite commit
    exact new inert lock + old admission head

during SQLite commit
    old complete state or new complete state

after commit, before response
    new complete state; replay returns the stored historical receipt
```

Startup never infers consent from a lock or stage and never auto-completes an
apply. It reports the unapplied delta and requires an explicit retry of the
exact persisted plan.

## 7. Explicit omissions

This slice adds no:

- ready recipe, runtime, Backend, provider, or host-generation evidence;
- separate approval/authentication record;
- status or apply-intent table;
- Hook Journal placeholder;
- revocation, tombstone, garbage collection, or equivalent-capture shortcut;
- public API, public schema, migration framework, or storage abstraction; or
- stronger filesystem claim than review 119.

The next implementation replaces the private database format with the smallest
version containing immutable admissions and one admission-head pointer, then
proves sequential apply, concurrent apply, crash convergence, historical
replay, and zero stage leakage.
