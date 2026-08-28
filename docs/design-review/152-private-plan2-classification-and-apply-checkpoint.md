# Private Plan/2 classification and apply checkpoint

**Status:** closed on 2026-08-28 as one private Candidate/5-to-Plan/2 and
Plan/2-to-apply proof. The implementation checkpoint is commit `fb73f69`.
This record does not claim that trusted project acquisition, capture,
evaluation, resolution, and planning are one finished public operation. It
publishes no CLI, administration object, Plan schema, lock schema, or closed
public error model.

## 1. Exact earned boundary

The private path now proves:

```text
one retained Candidate/5 + current protected admission + visible jig.lock
    -> classify unchanged, lock repair, or admission
    -> persist one canonical applicable Plan/2 where needed

one retained Plan/2 digest
    -> authenticate its protected candidate and base
    -> derive rather than trust its operation
    -> replay historical completion before staleness checks
    -> repair only the inert visible lock
       or publish lock-first and advance admission + Hook time
```

The private foreground tool still publishes a candidate first and then asks
the classifier to bind exactly that candidate head. This closes the
interleaving between those two private calls, but it is not the complete
capture-to-plan snapshot described in review 150. A production `plan()` must
still own project acquisition, capture, declaration evaluation, package
retention, resolution, runtime observation, classification, and final
publication under one reviewed retry and error boundary.

## 2. Classification is semantic, not capture-based

Classification compares the proposed Candidate/5 against the candidate named
by the active admission:

```text
same activation meaning + same exact proposed portable lock
    visible lock exact       -> unchanged; no Plan is persisted
    visible lock absent/drifted in update mode
                             -> lock-repair Plan
    visible lock absent/drifted in locked mode
                             -> LOCK_MISMATCH

different meaning or proposed lock
    update mode              -> admission Plan
    locked mode + exact lock -> admission Plan
    locked mode + lock drift -> LOCK_MISMATCH
```

Equivalent recapture may advance the diagnostic candidate head without
creating authority. The foreground classifier takes an expected Candidate/5
head and returns `PROJECT_BUSY` when another publication wins between the
private publish and plan calls, so it never silently reviews a different
candidate.

Plan/2 stores an explicit operation only for review. Apply independently
derives `admission` or `lock-repair` from the protected base and proposed
candidate. A codec-valid Plan whose operation lies, or which persists an
already-exact normalized no-op, is corrupt protected state rather than
authority.

## 3. Digest-only apply and replay

Apply accepts only `planDigest`. It does not accept a caller-provided base,
candidate, lock, source path, runtime observation, or desired operation.
Historical admission and lock-repair receipts are returned before current
staleness and visible-file checks, so acknowledgement loss does not make old
policy current or repeat work.

Admission apply retains the strict candidate-head compare-and-set:

```text
exact Plan row + exact Candidate/5 row
    -> exact Plan-bound admission base
    -> current candidate head still names that Candidate/5
    -> retained artifacts reacquired by identity
    -> visible lock converged and synchronized
    -> candidate and admission heads rechecked
    -> admission + Hook boundary committed atomically
```

A later candidate publication stales an unapplied admission Plan even when
the later candidate is equivalent. Admission changes authority and therefore
continues to require the exact reviewed candidate-head serialization point.

## 4. Lock repairs commute

A lock repair is not an admission. Its validity is rooted in the exact active
admission and exact proposed lock, not in whichever inert candidate happens
to be the latest diagnostic observation. Therefore:

- candidate-head movement does not stale a lock-repair Plan, even when the
  pending candidate would represent different future policy;
- an active-admission change does stale every unapplied repair based on the
  prior admission;
- the visible lock must still be either the exact retained observation or the
  exact proposed bytes;
- each explicitly reviewed equivalent repair Plan may receive its own
  immutable receipt keyed by its distinct Plan digest; and
- equivalent repairs commute because they converge the same inert bytes and
  create no admission, Hook transition, Service work, or authority.

This is deliberately different from competing authority-changing admission
Plans, which retain candidate-head and admission-head compare-and-set and
therefore linearize to one winner. A crash after exact lock publication but
before receipt insertion remains an unapproved inert state. Only explicit
apply of a retained Plan records the repair receipt.

## 5. Private protected-store boundary

The checkpoint replaces the private admission store with exact schema v16.
It adds canonical Plan/2 and lock-repair records and refuses migration or
mixed private authority. Opening fails when any other
`private-activation-admission-v*.sqlite3` database or sidecar is present,
including beside an otherwise valid v16 database. A v16 store never silently
abandons, chooses around, or merges an older private authority source.

This is a pre-release replacement policy, not a public migration promise or
an invitation for users to inspect `.jig`.

## 6. Executable evidence

The focused private corpus proves:

- fresh v16 bootstrap and refusal of preceding databases, abandoned
  sidecars, and valid-v16-plus-alternate mixed state;
- expected-candidate binding across the private foreground publication seam;
- persisted Plan operation tamper and normalized-no-op rejection;
- exact-lock unchanged classification without an applicable Plan;
- lock repair, same-Plan replay, lock-written/no-receipt convergence, and no
  admission or Hook mutation;
- concurrent and distinct equivalent repairs, each with its own receipt;
- repair validity across inert candidate-head advances and staleness after
  active-admission movement; and
- admission candidate-head compare-and-set, lock drift refusal, and
  historical admission replay without moving the active head.

The real private foreground path also continues to execute direct Python and
composed Bun-to-Python admitted Runs through the proven Linux envelope. None
of that promotes Plan/2 or the foreground script to a public interface.

## 7. Remaining gates

Before this becomes a public project control plane, Jig still needs:

1. one complete capture-to-plan operation which owns project acquisition and
   the full source/evaluator/resolver/host-observation snapshot;
2. the remaining classifier and authority proof matrix from review 150,
   including complete intrinsic/effective disposition and authority views;
3. one closed public error wrapper which maps private store/runtime failures
   to the reviewed project-facing union without leaking implementation codes;
4. public canonical Plan and `jig.lock` schemas only after their consumer
   requirements are frozen;
5. authenticated project opening and authority issuance; and
6. a reviewed CLI/API plus an independent packed consumer of exactly that
   published surface.

The finite, root-only foreground product step is now closed in review 153. It
uses the existing coordinator and Root Administration controller, recovers and
drains bounded root and Hook work, then closes. It mounts no eager Service and
introduces no persistent supervisor: admission is not yet pinned for such a
supervisor, and Service loss/restart policy has not been earned.

The next composition vertical is mixed composition: join one admitted root
`effect/call` to one acknowledged Service generation while preserving the
already proved Journal path and Service ownership substrate. That mixed
witness must close root operations and Service leases before fencing and
releasing the Mount. Persistent supervision remains later policy, not an
implication of this checkpoint.

The boundary is:

> Plan/2 now proves one exact reviewed decision can be classified and applied
> without reinterpretation. It does not yet prove the complete product
> operation which creates that decision or keeps a project alive indefinitely.
