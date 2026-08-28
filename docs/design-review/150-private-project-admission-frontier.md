# Private project admission frontier

**Status:** reviewed on 2026-08-28 and selected for the first local
control-plane slice after the private Service proof. This record does not
publish project opening, a daemon transport, a general administration API, or
new Root Administration methods.

## 1. Exact boundary

The first usable local control plane needs only two project-bound operations:

```ts
interface AdmissionAdministration {
  plan(request: {
    lockMode: "update" | "locked";
  }): Promise<AdmissionPlanResult>;

  apply(request: {
    planDigest: string;
    baseGeneration: string | null;
  }): Promise<AdmissionReceipt>;
}
```

Trusted host code has already opened and authenticated one project before it
issues this object capability. Neither method accepts a project path, runtime,
Sandbox Backend, grants, launch command, candidate, source path, Hook control,
or Service control. This is distinct from `RootAdministration`; portable FLOW
code can invoke neither object.

The first private CLI uses the same value model:

```text
jig plan [root] [--locked] [--json]
jig apply [root] --plan <digest> --base-generation <digest-or-null>
                       [--yes] [--json]
```

The optional root belongs only to trusted CLI project acquisition. Interactive
apply redisplays the exact persisted review and asks for confirmation;
non-interactive apply requires `--yes`. Confirmation is local UX, not an
authentication identity.

## 2. Planning always creates one fresh proposal

`plan()` does not review whichever candidate a watcher happened to publish.
It performs the complete bounded proposal path against current visible source:

```text
descriptor-confined capture
    -> bounded declaration evaluation
    -> package inspection and deterministic linking
    -> retain every exact Package/1 artifact
    -> trusted runtime/Backend planning observation
    -> deterministic dependency resolution
    -> publish one immutable candidate
    -> build one complete canonical review
    -> persist candidate + review + plan digest
    -> release temporary captures and leases
```

The response is not returned until protected candidate, package artifacts,
review bytes, and plan bytes are durable. A candidate-head race before the
review is committed is `PROJECT_BUSY`; Jig never silently reviews a different
candidate.

Target-level `UNAVAILABLE` is reviewable proposal content. It does not by
itself make planning fail. `locked` planning requires visible `jig.lock` to be
byte-identical to the proposal; absence or difference is `LOCK_MISMATCH`.

## 3. One complete, bounded review document

The plan digest commits one canonical review document containing every fact a
user must approve:

- capture, semantic, resolution-input, candidate, plan, and base-generation
  identities;
- observed and proposed portable lock values and their deterministic delta;
- package additions, removals, and replacements;
- direct targets and Bindings, including Run versus Service mode;
- settings, attachments, exact dependencies, and closed candidate sets;
- Hook add/change/remove with publisher, Event type, and exact target;
- each target's intrinsic planning observation and effective READY or
  UNAVAILABLE disposition;
- selected runtime, Backend, and provider identities without host paths,
  commands, cgroup names, or credentials; and
- requested, `wouldGrant`, and planned logical authority.

Service additions state explicitly that admission permits eager activation
only after commit; plan/apply does not claim provider readiness. Hook additions
state that only future matching Journal positions enter the new interval.

The delta is a deterministic index into complete before/after values, not a
second truth. The first version is one bounded value, not a pagination or
partial-approval protocol. Protected storage persists its exact bytes; later
code must not re-render changed prose and call it the same approval.

For the current mechanisms, requested, `wouldGrant`, and planned logical
authority are equal. A future planner which attenuates them must supply a
richer exact review value or fail rather than misrepresent the difference.

## 4. Semantic no-op

Comment, formatting, or declaration-spelling changes which preserve the
admitted normalized meaning and proposed lock do not require a new generation.
`plan()` returns a closed `unchanged` result with the active generation and no
applicable plan digest. Capture digest equality is neither required nor
sufficient.

Visible lock drift remains separately actionable even when project meaning is
unchanged: `locked` rejects it, while `update` may produce a plan whose only
reviewed change restores the exact portable lock.

## 5. Apply consumes only retained facts

`apply()` performs no source discovery, capture, declaration evaluation,
resolution, or runtime replanning. It may reauthenticate the project identity,
protected plan, candidate, package artifacts, and visible lock, but it never
opens current project source as a substitute for the reviewed proposal.

```text
normalize digest and base
    -> load exact plan and canonical review
    -> replay an already committed plan before staleness checks
    -> reacquire every retained Package/1 artifact by identity
    -> recheck reviewed candidate, base, and visible lock
    -> prepare Hook interval transition at the current Journal head
    -> durably publish exact jig.lock first
    -> recheck protected heads
    -> atomically insert admission + Hook transition and advance head
    -> return immutable admission receipt
```

A crash after lock publication but before the SQLite admission commit may
leave the reviewed lock visible. Retrying the same retained plan converges
those exact bytes and completes the admission; it does not reread source.

The receipt contains the existing closed admission evidence:

```text
admission digest
base generation
plan digest
candidate revision and digest
lock digest
Hook boundary digest
```

It reports admission, not Run completion, Hook-derived completion, or Service
readiness.

## 6. Ownership and post-commit work

Admission apply does not seize the long-lived Run coordinator merely to mutate
project policy. SQLite serializes admission writers, and no Flow or Service
bytes execute inside the transaction.

After commit, a powerless best-effort wake may notify the current controller
to pump pending Hook roots and reconcile eager Services. Wake failure never
rewrites a committed apply as failure; startup and explicit fixed-point scans
recover it. Existing Runs and Service leases remain pinned to their previously
admitted generations.

Unresolved ownership which makes a safe policy transition impossible is
`PROJECT_BUSY`; apply does not steal, overwrite, or infer completion. A later
persistent supervisor may coordinate this boundary without changing the two
values above.

## 7. Closed errors

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
- an unknown valid digest is `PLAN_NOT_FOUND`;
- a supplied base differing from the stored plan, changed candidate/base, or
  visible-lock drift during apply is `STALE_PLAN`;
- absent or differing lock under locked planning is `LOCK_MISMATCH`;
- invalid changing or inconsistent authored meaning is `INVALID_CANDIDATE`;
- a missing retained artifact or required host substrate is `UNAVAILABLE`;
- protected-state corruption and violated invariants are `INTERNAL`; and
- calls after object revocation are `PROJECT_CLOSED`.

Project-not-found and unsafe-project-location failures belong to trusted CLI
acquisition, not this object's method union. Bounded error details may name an
underlying code and target, but never host paths, commands, secrets, or stacks.

## 8. Private-first implementation gates

Before freezing a public candidate, the private slice must prove:

1. plan captures current source and reopens byte-identical complete review
   evidence after a separate process restart;
2. source, declarations, Bindings, Hooks, and packages changed after planning
   are never read by apply;
3. missing or changed retained artifacts fail without recapture;
4. update, locked, absent-lock, lock-only repair, and normalized no-op behavior;
5. candidate, base-generation, and visible-lock staleness;
6. replay-first same-plan apply and concurrent-apply linearization;
7. failure after lock durability but before admission commit converges on
   exact retry;
8. Hook add/change/remove establishes its Journal boundary in the admission
   transaction;
9. apply returns independently of Service readiness and only wakes Service
   reconciliation after commit;
10. object closure and project-busy behavior;
11. one CLI plan process and separate CLI apply process use only the retained
    digest/base pair; and
12. an independent consumer uses only the frozen two-operation subset before
    any package export or machine schema is added.

The implementation remains private until those gates pass. It adds no
`openProject`, daemon, socket, list/watch/cancel, remote authentication,
provider management, or public project-control schema.

The invariant is:

> Planning turns editable source and current trusted observations into one
> durable, fully reviewable immutable proposal. Apply consumes only that
> proposal, publishes its portable lock first, and atomically advances
> admission and Hook time. It never reinterprets the project.
