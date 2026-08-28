# Private failure-atomic Plan publication checkpoint

**Status:** closed on 2026-08-28 for one private atomic-publication seam. This
checkpoint does not close trusted project acquisition, a public `plan()` API,
Plan or Lock schemas, a public error model, or an operational Jig release.

## 1. Exact earned boundary

The private foreground planner now captures one opaque policy base before it
evaluates editable project source:

```text
filesystem-verified protected state owner
    -> candidate head revision + digest
    -> admission head revision + digest
    -> project-root device + inode
    -> WeakMap-authenticated, nonserializable process-local token
```

After descriptor-confined capture, evaluation, retention, resolution, and
closed host recipe planning produce one factory-authentic Candidate/5, the
final operation performs this short transaction:

```text
open exact protected state owner
    -> authenticate token, project root, and factory Candidate
    -> reacquire every Candidate artifact outside the database transaction
    -> BEGIN IMMEDIATE
    -> recheck both captured heads and their digests
    -> insert or byte-verify the Candidate row
    -> observe visible jig.lock
    -> classify unchanged, lock repair, or admission
    -> persist the canonical applicable Plan/2 when required
    -> advance candidate head only after classification succeeds
    -> verify the exact resulting head
    -> COMMIT
```

Every failure before commit leaves Candidate rows, candidate head, review Plan
rows, and admission state unchanged. The returned applicable result reloads
the Candidate from protected storage and marks that decoded value as stored;
it never relabels the caller's factory-created object.

The legacy publish-then-classify functions remain private test and migration-
free implementation seams, but now share the same insertion, classification,
and persistence primitives. The proof-host foreground script uses only the new
combined publication path.

## 2. Concurrency and visible-file meaning

Candidate-head or admission-head movement after base capture produces exact
`PROJECT_BUSY` before Candidate insertion. Competing same-base attempts which
would change the candidate head therefore have one head-changing winner.
Exact current-candidate reuse can converge without such a winner; it remains
content-idempotent and verifies canonical bytes rather than trusting a digest
collision.

`jig.lock` is observed during the final transaction and its exact normalized
state enters Plan/2. A later visible-file edit cannot grant authority: apply
still reopens the retained Plan by digest and performs the already proved lock
and admission compare-and-set checks. An `unchanged` observation is likewise
not an authority record.

## 3. Executable evidence

The authentic retained-project hostile witness proves:

1. a fabricated planning base is rejected;
2. an authentic base from another project root is rejected;
3. `locked` planning with a missing lock rolls back the inserted Candidate and
   Plan completely;
4. the same authentic base can then publish Candidate/5 and Plan/2 together;
5. a real admission-head winner makes the captured base stale without another
   Candidate publication; and
6. a real candidate-head winner does the same.

The final focused run passed with 99 assertions. The TypeScript build, four
focused ordinary admission checks, and the proof-host foreground Python plus
composed Bun/Python path also passed. The Linux capability preflight preceded
the hostile run; afterward there were no Jig Run cgroups or private device
directories and `/dev/urandom` remained character device `1:9`, mode `0666`.

## 4. Deliberate non-claims

This checkpoint is narrower than the complete product operation in review
150:

- the foreground script still accepts and reopens a project path rather than
  receiving one long-lived trusted project object capability;
- descriptor-confined multi-file source capture is still not an atomic
  filesystem snapshot; review 150's edit-timing model remains unchanged;
- it does not prove a same-token acknowledgement-replay contract for Plan
  publication; a post-commit error may require fresh acquisition and
  content-idempotent rediscovery;
- rollback covers protected Candidate, head, Plan, and admission state. Safe
  empty `.jig` bootstrap and immutable content-addressed Package/1 blobs
  retained before final publication may remain and confer no authority;
- it does not close the remaining authority/classifier inspection matrix,
  public Plan/2 or Lock/1 schemas, or project-facing error union; and
- it does not make the proof-host script, evaluator, runtime receipt,
  Runtime Adapter, or Sandbox Backend public.

The precise closed statement is:

> Captured opaque policy heads plus one factory Candidate/5 now produce a
> Candidate observation and applicable Plan/2 publication which are
> failure-atomic at the final protected transaction, or an unchanged result.
> Trusted project acquisition and the public control plane remain later work.
