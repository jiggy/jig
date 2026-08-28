# Private project admission frontier

**Status:** reviewed on 2026-08-28 as the normative private frontier. The
Candidate/5-to-Plan/2 classification and Plan/2-to-apply subset is closed in
review 152. Complete capture-to-plan acquisition and the public control-plane
surface remain gated. The deferred Root-to-Service invocation controller is
not a prerequisite for reviewing and applying inert project meaning. This
record publishes no project opening, daemon transport, CLI compatibility
promise, administration API, lock schema, or machine schema.

## 1. Exact private boundary

Trusted host code has already opened and authenticated one project before it
issues this private object capability:

```ts
interface AdmissionAdministration {
  plan(request: {
    lockMode: "update" | "locked";
  }): Promise<AdmissionPlanResult>;

  apply(request: {
    planDigest: string;
  }): Promise<AdmissionApplyReceipt>;
}
```

Neither method accepts a project path, runtime, Sandbox Backend, grant,
launch command, candidate, source path, Hook control, Service control, or
base-generation override. The immutable Plan already commits its base. A
second caller-supplied base would add no compare-and-set protection and would
make exact replay needlessly fragile.

The first private CLI uses the same value model:

```text
jig plan [root] [--locked] [--json]
jig apply [root] --plan <digest> [--yes] [--json]
```

The optional root belongs only to trusted CLI project acquisition.
Interactive apply reloads and displays the exact retained Plan before asking
for confirmation; non-interactive apply requires `--yes`. Confirmation is
local UX, not an actor-authentication record. `AdmissionAdministration` and
`RootAdministration` remain distinct trusted host objects. Portable FLOW code
can invoke neither.

## 2. Planning creates one bounded proposal from current source

`plan()` performs the complete proposal path rather than reviewing whichever
candidate a watcher happened to publish:

```text
open or safely bootstrap protected private state
    -> snapshot candidate and admission heads
    -> descriptor-confined source capture
    -> bounded declaration evaluation
    -> package inspection and deterministic linking
    -> retain every exact Package/1 artifact
    -> trusted runtime/Backend planning observation
    -> deterministic dependency resolution
    -> create one complete candidate and portable lock
    -> normalize final activation meaning
    -> classify admission, lock repair, or unchanged
    -> build one canonical Plan/2 review when apply is required
    -> recheck the expected heads
    -> atomically persist the candidate observation and applicable Plan/2
    -> release temporary captures and leases
```

When apply is required, the response is not returned until protected
candidate, Package/1 artifacts, visible-lock observation, and canonical Plan
bytes are durable. An exact unchanged result has no applicable Plan digest and
grants no authority; Jig may retain its equivalent candidate observation for
diagnostics. Planning does not hold a SQLite transaction while capturing or
evaluating editable source.
Instead, it snapshots both protected heads first and rechecks both in the
short final transaction. If either head changed, planning returns
`PROJECT_BUSY`; it never silently changes the proposal's base or overwrites a
concurrent candidate.

Target-level `UNAVAILABLE` is exact reviewable proposal content. It does not
make planning fail. Structurally invalid package meaning, requested authority,
settings, references, or contracts remains `INVALID_CANDIDATE` rather than an
admissible unavailable target. `locked` planning requires visible `jig.lock`
to be byte-identical to the proposal; absence or difference is
`LOCK_MISMATCH`.

The first planner uses one closed dispatcher over only the exact recipes the
repository has proved. It maps an authenticated missing runtime to
`RUNTIME_UNAVAILABLE`, a missing required containment mechanism to
`SANDBOX_UNAVAILABLE`, and a valid request which the closed recipe cannot
enforce to `PERMISSION_UNENFORCEABLE`. Those records commit bounded,
domain-separated evidence identities over the request and authenticated host
facts. They never contain exception text or host paths. Structurally invalid
retained meaning fails the whole proposal as `INVALID_CANDIDATE`; an unexpected
implementation failure is `INTERNAL`. Planning must not turn an arbitrary
caught error into reviewable unavailability.

## 3. Safe empty-store bootstrap

Planning, not apply, may create the first private project state. Trusted
project acquisition authenticates and pins the project root, then creates the
protected `.jig` owner and exact private database before source capture so
Jig's own directory creation cannot race its capture.

Bootstrap uses the existing descriptor-confined, owner-only, no-follow
boundary and one exact pre-release schema identity. It creates null candidate
and admission heads and grants no execution authority. It never:

- interprets a partial or different schema as the current format;
- migrates an unknown private store in place;
- replaces an unsafe link, non-directory, wrong-owner object, or unrelated
  file;
- infers a candidate, consent, or admission from visible source or
  `jig.lock`; or
- lets `apply()` manufacture a missing Plan or store.

Concurrent creators converge only when they observe the same exact initialized
store. Otherwise the operation fails closed. Because these formats are still
private, the implementation may replace its prior test schema deliberately;
it must not call that replacement a public migration path.

## 4. Final activation meaning is distinct from observed semantics

The current resolution `semanticDigest` describes package meaning plus
**observed** planning dispositions. A planned target is represented there by
its observation digest. Candidate construction later promotes it to exact
`READY(recipeDigest, observationDigest)`. The observed semantic digest and
portable lock therefore do not by themselves identify the final admissible
activation.

The corrected candidate adds a domain-separated final identity:

```text
activationMeaningDigest = digest(
    observed normalized project semantics,
    ordered final target meanings:
        exact activation request,
        READY(recipe digest, observation digest)
        or
        UNAVAILABLE(code, evidence digests)
)
```

The existing digest should be named or documented as
`observedSemanticDigest`; it must not be used as final admission meaning.
Runtime paths, commands, PIDs, live Mount generations, and realized receipts
remain outside `activationMeaningDigest`. A Service restart against the same
admitted recipe does not change project meaning.

### 4.1 Exact `UNAVAILABLE`

An unavailable final target commits its exact code and sorted unique evidence
digests into `activationMeaningDigest` and Plan/2. No runtime, Backend, recipe,
provider readiness, `wouldGrant`, or planned authority is inferred when its
closed record does not contain those facts. Dependency-derived unavailability
commits the exact provider-dependency evidence used by deterministic
propagation. Machinery becoming available later never promotes an admitted
target; a fresh Plan and admission are required. Conversely, machinery loss
after an exact `READY` recipe was selected never turns apply or execution into
fallback selection.

## 5. Plan/2 is the one canonical machine review

`Plan/2` is one bounded canonical JSON/1 value. Its digest commits:

- the exact base admission digest or null;
- its exact persisted candidate revision and digest;
- capture, resolution-input, and planning-observation identities;
- `observedSemanticDigest` and final `activationMeaningDigest`;
- lock mode and complete proposed portable-lock identity/value;
- the exact visible-lock observation at planning time;
- the complete authoritative **proposed** review state;
- ordered final target dispositions; and
- whether applying the Plan can create an admission or only repair the
  visible lock.

The proposed review state is deliberately not a second package, Binding, Hook,
or authority model. Its complete canonical shape is the proposed private lock
and the ordered final activation targets:

```text
proposed
    lockDigest
    lock
    targets
```

The lock already carries the earned normalized package, Binding, contract,
provider-edge, Hook, and portable requested-authority facts. Each complete
activation request carries its settings, attachments, slots, and closed
candidate sets. Each final disposition carries exact `READY` recipe and
observation identities or exact `UNAVAILABLE` code and evidence. Expanded
`before`, delta, authority, and provider views are derived renderings, not
additional policy truth. Canonical ordering and closed unions make the Plan
bytes the review authority; explanatory CLI prose is not part of Plan
identity.

The active `before` state is not duplicated in Plan bytes. It is derived from
the immutable admission named by `baseGeneration`, or from the specified empty
state when the base is null. The delta is likewise a deterministic view of
that derived prior state and Plan's authoritative proposed state. A decoder
or renderer which cannot reopen and validate the bound base fails; it does not
substitute current source or another generation. Persisting `before`, `after`,
and `delta` as three truths would enlarge the corruption and consistency
surface without granting more authority.

The visible lock is the exception because it is mutable and cannot be derived
from the active admission. Plan storage retains exact absence or the complete
decoded canonical private-lock value and its recomputed digest. In this first
boundary a present `jig.lock` is reviewable only when its bytes are the one
bounded canonical serialization of that value. Malformed, noncanonical,
oversized, unsafe, or unreadable lock state is `LOCK_MISMATCH`; planning does
not retain arbitrary bytes, guess an encoding, or silently overwrite them.
The user may remove or repair the file and plan again. The complete Plan and
retained observation must remain within the private bounded-value limits or
planning fails rather than truncating review evidence.

Later UI changes may render the same canonical facts differently. If exact
display retention becomes a compliance requirement, that display belongs in
a separate observational journal; it must not become duplicated policy truth.

## 6. Exact authority and provider claims

The review must not expand opaque digests into facts the implementation has
not earned.

### 6.1 Requested

Current project evidence can report exact requested logical authority from:

- package attachment ceilings and Binding attachment projections;
- exact Flow-call candidate sets;
- exact capability contract dependencies and provider Binding/export edges;
- the transitive mediated authority reachable through those exact
  dependencies; and
- the fixed portable denied-by-default baseline, shown separately from
  requested additions.

Settings participate in admitted meaning but are not authority.

### 6.2 `wouldGrant`

For the currently supported exact `READY` recipes, host policy either accepts
the complete narrow logical request or makes the target unavailable. Only for
those recipes may Plan/2 show `wouldGrant` equal to requested logical
authority. This is not a generic attenuation model. An unavailable target
without an accepted recipe has no invented `wouldGrant` projection.

### 6.3 planned and realized

The present `plannedAuthorityDigest` repeats the logical attachments/slots
digest; it is not a structured description of every containment predicate.
Plan/2 may separately retain the facts actually authenticated by the closed
recipe boundary:

- recipe and planning-observation identities;
- fixed runtime-support/executable identity without host paths;
- exact private Adapter and Backend artifact/revision identities;
- fixed package/runtime visibility, scratch, empty environment, resource
  ceilings, and required Backend mechanisms; and
- exact mediated Flow/Journal/Service edges supported by that recipe.

It must not claim a general planned-authority projection merely from one
opaque digest. Realized authority never appears in a Plan; only execution-time
Backend or provider receipts can establish it.

### 6.4 providers and Services

Currently earned provider facts are limited to:

- portable logical provider Binding/export and exact contract selection;
- Service Package/1 and export identity;
- exact selected Service recipe identity for a `READY` target; and
- the canonical Journal publisher Binding, contract, and Event allowlist.

Admission permits later eager Service activation. It does not prove a live
Service generation, readiness, Mount, lease, credential, or projected
resource. Generic host-capability and Agent provider registrations remain
release-gated and cannot appear as if selected.

For dependency-derived unavailability, Plan/2 may show both intrinsic and
effective dispositions only after the resolution/candidate path retains both
exact values. The current effective-only value does not justify reconstructing
an intrinsic recipe after the fact.

## 7. Normalized no-op matrix

Capture equality is neither required nor sufficient. Planning compares final
admitted meaning and the proposed portable lock:

| Final meaning | Proposed lock vs active | Visible lock and mode | Result |
|---|---|---|---|
| same | same | exact, either mode | `unchanged`; no applicable Plan |
| same | same | absent/drifted, update | persist a lock-repair Plan/2 |
| same | same | absent/drifted, locked | `LOCK_MISMATCH` |
| changed or same | changed | any valid observation, update | persist an admission Plan/2 |
| changed | same | any valid observation, update | persist an admission Plan/2 |
| changed or proposed lock changed | either | exact proposed, locked | persist an admission Plan/2 |
| changed or proposed lock changed | either | absent/drifted, locked | `LOCK_MISMATCH` |

A formatting, comment, declaration-location, or equivalent-capture change
which preserves final meaning and portable lock is a no-op. A different exact
recipe, READY/UNAVAILABLE transition, unavailable evidence change, settings or
Hook meaning change, or provider selection is not. Visible lock repair never
retargets an outstanding Plan to a later capture.

## 8. Apply consumes only the retained Plan

`apply({ planDigest })` performs no source discovery, capture, declaration
evaluation, resolution, or runtime replanning. It may reauthenticate project
identity, protected Plan/candidate/base rows, Package/1 artifacts, and visible
lock state, but it never opens current project source as a substitute for the
reviewed proposal.

For an admission Plan:

```text
normalize digest
    -> load and strictly verify exact Plan/2
    -> replay a committed admission before staleness checks
    -> reopen the Plan-bound base and proposed candidate
    -> reacquire every retained Package/1 artifact by identity
    -> require current candidate/admission heads to match the Plan
    -> prepare the Hook interval transition at current Journal head
    -> durably converge exact jig.lock first
    -> recheck protected heads and immutable rows
    -> atomically insert admission + Hook transition and advance head
    -> return immutable admission receipt
```

The protected Plan base supplies the compare-and-set value. A separate caller
base neither strengthens the race check nor proves review. A committed Plan is
replayed before current-head or visible-lock checks so acknowledgement loss
returns its immutable historical receipt without reactivation.

The admission receipt remains the existing closed evidence:

```text
admission digest
base generation
plan digest
candidate revision and digest
lock digest
Hook boundary digest
```

It reports admission, not Run completion, derived Hook completion, Service
readiness, or realized authority.

## 9. Lock repair is durable but creates no generation

A lock-repair Plan applies through a separate append-only protected table
keyed uniquely by `planDigest`. Its canonical private receipt contains only:

```text
kind: private-lock-repair/1
plan digest
active admission digest
proposed lock digest
```

The Plan already commits the exact observed-lock evidence, candidate, and
proposed review; duplicating them in the receipt would create drift. The
receipt's domain-separated digest is its identity.

Apply ordering is:

```text
existing exact repair receipt
    -> return historical receipt before staleness or file checks

otherwise
    -> require the Plan-bound active generation
    -> authenticate the exact Plan and its retained candidate row
    -> require current visible lock to be either the reviewed observation
       or the exact proposed bytes
    -> durably publish/synchronize and reverify exact proposed lock
    -> recheck the active admission and immutable Plan/candidate rows
    -> insert one immutable repair receipt
    -> commit without changing admission_head or Hook state
```

It allocates no admission generation, Hook interval, derived Run, Service
reconciliation, or authority. Candidate-head movement is inert with respect to
an already reviewed repair and does not stale it. A changed active admission
makes an unapplied repair stale. Equivalent repair Plans based on the same
active admission and exact proposed lock commute; because their retained lock
observations and Plan digests differ, each explicitly applied Plan may receive
its own immutable receipt. Competing authority-changing admission Plans retain
the candidate-head and admission-head compare-and-set and linearize to one
winner.

Crash and replay semantics are closed:

```text
before lock replacement
    reviewed old lock + no receipt

after replacement, before receipt commit
    exact proposed inert lock + no receipt; exact retry converges

during receipt commit
    no receipt or one complete receipt

after commit, before response
    complete receipt; replay returns it without inspecting the current lock
```

Startup never infers approval from exact visible bytes and never auto-applies
the repair. The explicit retained Plan retry is the only convergence action.

## 10. Ownership and post-commit work

Admission apply and lock repair do not seize the long-lived Run coordinator
merely to mutate policy. SQLite serializes cooperating admission writers, and
no Flow or Service bytes execute inside either transaction.

After an **admission** commit, a powerless best-effort wake may notify the
current controller to pump pending Hook roots and reconcile eager Services.
Wake failure never rewrites committed apply as failure; startup and explicit
fixed-point scans recover it. Lock repair emits no such wake. Existing Runs
and Service leases remain pinned to their prior admitted generations.

Unresolved ownership which makes a safe policy transition impossible is
`PROJECT_BUSY`; apply does not steal, overwrite, or infer completion. The
finite root-only foreground session which reuses the existing coordinator and
Root Administration controller is closed in review 153. It drains bounded
root and Hook work, then closes. No persistent Service supervisor is earned by
Plan/2 or that session. The next mixed-composition slice must join one
authentic root effect to one acknowledged Service generation and prove phased
operation, lease, Mount, and loss cleanup.

## 11. Closed errors

The object uses only:

```text
INVALID_REQUEST
INVALID_CANDIDATE
LOCK_MISMATCH
PLAN_NOT_FOUND
STALE_PLAN
PROJECT_BUSY
PROJECT_CLOSED
UNAVAILABLE
INTERNAL
```

- malformed values or digest syntax are `INVALID_REQUEST`;
- an unknown valid Plan digest is `PLAN_NOT_FOUND`;
- changed expected heads, Plan-bound base, candidate, immutable Plan evidence,
  or visible-lock state during apply is `STALE_PLAN`;
- absent or differing lock under locked planning is `LOCK_MISMATCH`;
- invalid or inconsistent authored meaning is `INVALID_CANDIDATE`;
- a missing retained artifact or required host substrate is `UNAVAILABLE`;
- protected-state corruption and violated invariants are `INTERNAL`; and
- calls after object revocation are `PROJECT_CLOSED`.

Project-not-found and unsafe-project-location failures belong to trusted CLI
acquisition, not this object's method union. Bounded details may name an
underlying code and target, but never host paths, commands, secrets, or stacks.

## 12. Corrected private-first proof gates

Before freezing any public candidate, the private slice must prove:

1. safe first-plan bootstrap creates only exact empty protected state and
   rejects unsafe, partial, or different stores;
2. planning captures current source and reopens byte-identical Plan/2,
   proposed state, Plan-bound base, and exact visible-lock evidence after a
   separate process restart;
3. candidate-head and admission-head changes during planning return
   `PROJECT_BUSY` without publishing a mismatched Plan;
4. source, declarations, Bindings, Hooks, packages, and host policy changed
   after planning are never re-read or substituted by apply;
5. missing or changed retained artifacts fail without recapture;
6. final `activationMeaningDigest` changes for recipe and final-disposition
   changes while equivalent captures remain no-ops;
7. the complete no-op matrix covers update, locked, absent lock, exact lock,
   normalized equivalence, and meaningful change;
8. lock-only repair persists and replays one receipt, survives the exact
   lock/no-receipt crash state, creates no admission or Hook transition, and
   emits no Service wake;
9. exact intrinsic/effective `UNAVAILABLE` evidence is retained only where the
   implementation actually owns both values;
10. admission Plans fail closed on candidate-head, base-generation, Plan-row,
    and visible-lock staleness; lock-repair Plans ignore inert candidate-head
    movement but require the exact Plan-bound active admission, immutable
    Plan/candidate rows, and reviewed-or-proposed visible lock;
11. same-Plan admission and repair replay occur before staleness checks;
    competing authority-changing admission Plans linearize to one winner,
    while equivalent repair Plans commute and each explicitly applied Plan may
    persist its own receipt; an active-admission change stales an unapplied
    repair;
12. failure after lock durability but before admission or repair commit
    converges through exact retry;
13. an admission Plan, and only an admission Plan, establishes its Hook
    boundary in the admission transaction and may wake Service reconciliation
    after commit;
14. requested, `wouldGrant`, planned, provider, Service, and realized facts are
    inspected at the honest limits in section 6;
15. object closure, project-busy behavior, bounded review values, and corrupt
    base-chain rejection are exact;
16. one private plan process and a separate private apply process communicate
    only the retained `planDigest`; the installed CLI remains gated on a
    trusted project-opening and host-policy acquisition path; and
17. a separately compiled test-only consumer uses an explicitly copied closed
    two-operation candidate surface. A package export and independent packed
    consumer are later publication gates, not prerequisites which can somehow
    consume an unexported interface.

Implementation remains private until those gates pass. It adds no
`openProject`, daemon, socket, list/watch/cancel, remote authentication,
provider management, public lock schema, public Plan schema, or public
administration package.

The invariant is:

> Planning turns editable source and current trusted observations into one
> durable canonical proposal. Apply consumes only that proposal. Meaningful
> policy change publishes the portable lock first and atomically advances
> admission and Hook time; equivalent meaning may only repair the inert lock
> and record that repair. Neither path reinterprets the project.
