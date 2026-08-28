# Finite trusted project-session frontier

**Status:** selected on 2026-08-28 as the next product vertical after review
165. This record freezes the private implementation boundary and its proof
gates. It does not yet publish a project-opening function, Plan or lock schema,
CLI spelling, transport, Runtime Adapter, Sandbox Backend, or operational Jig
alpha.

## 1. Requirement and smallest proof

Jig must turn the already-proved private project pipeline into one finite
trusted operation without adding a daemon:

```text
trusted acquisition of one local directory
    -> one descriptor-held project identity
    -> one exclusive project coordinator
    -> authority-neutral plan
    -> explicit retained-digest apply
    -> session-scoped Root Administration
    -> finite status
    -> revocation, fencing, cleanup, and release
```

The implementation reuses the existing activation store, failure-atomic
Candidate/Plan publication, digest-only apply, root controller, and Linux
execution proof. It must not create a second ownership or scheduling model.

The first observable proof is private: two acquisitions cannot issue competing
coordinator epochs, every operation remains bound to the first opened
device/inode, and close releases that owner only after accepted work has
settled or cleanup failure has been reported honestly.

## 2. Ownership model

One trusted host acquisition holds:

```text
PrivateProjectRoot
    descriptor + device/inode identity

PrivateProjectCoordinator
    one exclusive process-held epoch for that same identity

attached PrivateRootAdministrationController
    root submission, recovery, cancellation, fencing, and terminal projection
```

The project session owns those resources in that order and releases them in
reverse order. It uses `attachPrivateRootAdministrationController()`; it does
not call the constructor which acquires a second coordinator.

Fresh acquisition may create only the protected inert `.jig` state required
to take the coordinator lease. That bootstrap grants no admission or Run
authority. A concurrent owner either observes the same safe bootstrap and
wins the single lease or receives `PROJECT_BUSY`.

Path strings are locators, not identity. Source capture borrows the held root
descriptor. Protected-store operations which must reopen a path compare the
new root's device/inode with the held identity before mutation. Coordinator
affinity is likewise device/inode based, never normalized-path equality.
Bun's SQLite VFS still requires a verified visible database path; the existing
before/after descriptor-identity brackets remain the honest same-user local
filesystem boundary. A project-root rename or substitution therefore revokes
the current session and fails closed; Jig does not switch to the replacement
tree or claim open-by-descriptor SQLite semantics it does not possess.

## 3. Provisional object capabilities

The smallest candidate shape is:

```ts
interface ProjectAcquisition {
  acquireProject(request: {
    readonly directory: string;
  }): Promise<ProjectSession>;
}

interface ProjectSession {
  plan(request: {
    readonly lockMode: "update" | "locked";
  }): Promise<ProjectPlanResult>;

  apply(request: {
    readonly planDigest: string;
  }): Promise<ProjectApplyReceipt>;

  readonly rootAdministration: RootAdministration;
  close(): Promise<void>;
}
```

`ProjectAcquisition` is itself a trusted host capability. The package does not
yet export a constructor which lets callers select state paths, package-store
paths, coordinator identity, evaluator, runtime support, Sandbox Backend,
launcher, policy, timeout, or executor. Its concrete factory remains private
until the production host trust root exists.

`RootAdministration` remains exactly `startRun` plus `runStatus`. The session
does not wrap, duplicate, extend, serialize, or turn it into FLOW. Session
closure revokes every reference previously obtained from the
`rootAdministration` property.

## 4. Plan review boundary

Planning is authority-neutral, not read-only. It may:

- bootstrap protected private state;
- capture and evaluate editable source through the bounded evaluator;
- retain immutable Package/1, Candidate, and Plan records; and
- inspect authenticated host availability.

It may not mutate user source or the visible lock, advance admission, or run
package code outside the evaluator envelope.

A digest and operation alone are insufficient for informed approval. The
private Plan/2, Candidate/5, runtime recipe, and provisional private lock are
also not suitable public contracts. Before plan/apply can be packed, the
session must produce one complete bounded sanitized review rendering paired
with the authoritative `planDigest`:

```ts
type ProjectPlanResult =
  | { readonly state: "unchanged" }
  | {
      readonly state: "applicable";
      readonly operation: "admission" | "lock-repair";
      readonly planDigest: string;
      readonly review: {
        readonly mediaType: "text/plain; charset=utf-8";
        readonly text: string;
      };
    };
```

The text is display evidence, not authority. It must be deterministic,
complete, bounded, and non-truncated. It describes the complete proposed
portable policy, target availability, and honestly known authority facts, but
contains no host paths, commands, runtime closure, recipe, Adapter, Backend,
coordinator, database, cgroup, helper, or internal evidence identities.
`apply()` trusts only the retained Plan digest.

This text-first surface serves the first CLI consumer without freezing an
unearned structured Plan-review or public lock schema. A later GUI may earn a
structured review model independently.

A discarded response after committed Plan publication must converge by
replanning unchanged source and host evidence through the same owner to the
same result and `planDigest`, with no admission mutation. Add an idempotency
token only if that content-idempotent proof fails.

## 5. Apply and result boundary

`apply({ planDigest })` reopens exact retained bytes, independently derives the
operation, detects staleness, and never captures, evaluates, resolves, or
replans visible source. Its smallest receipt is:

```ts
type ProjectApplyReceipt =
  | {
      readonly operation: "admission";
      readonly planDigest: string;
      readonly receiptDigest: string;
    }
  | {
      readonly operation: "lock-repair";
      readonly planDigest: string;
      readonly receiptDigest: string;
    };
```

Same-Plan replay returns the same receipt. Apply cannot start a Run or imply
Service readiness.

## 6. Errors

Project acquisition, planning, and apply use a separate closed
`ProjectAdministrationError`. Root operations retain their existing
`RootAdministrationError` and Run terminals.

The candidate project error codes are:

```text
INVALID_REQUEST
PROJECT_NOT_FOUND
PROJECT_UNSAFE
INVALID_CANDIDATE
LOCK_MISMATCH
PLAN_NOT_FOUND
STALE_PLAN
PROJECT_BUSY
PROJECT_CLOSED
UNAVAILABLE
INTERNAL
```

Consumers branch only on `code`. V1 error values contain bounded sanitized
`code` and `message`, with no generic details bag. Raw paths, `errno`, SQLite,
schema-table names, runtime receipts, recipes, helpers, cgroups, coordinator
epochs, and cleanup internals never cross this boundary.

Root identity loss during an open session atomically revokes that session and
surfaces `PROJECT_CLOSED`; it is not retryable `PROJECT_BUSY` and can never
reattach the object to a replacement path. `PROJECT_UNSAFE` is an acquisition
result, not a way to reinterpret a live session.

## 7. Operation and close linearization

The session state is:

```text
opening -> open -> closing -> closed
```

Every method obtains one synchronous operation lease. A call admitted before
the transition to `closing` may finish; close waits for it. A call entering
after the transition rejects `PROJECT_CLOSED`.

`close()` memoizes one promise and synchronously:

1. prevents new session operations;
2. revokes the attached Root Administration controller;
3. aborts bounded evaluator/capture work and waits for accepted planning;
4. lets an accepted apply finish its exact retained-digest transaction;
5. cancels live root launches and waits for durable terminal plus confirmed
   Backend fence and cleanup;
6. releases the coordinator lease; and
7. closes the held project descriptor.

Accepted root records remain durable. Normal close settles a live Run as
`CANCELLED`. Wrapper process loss is different: a replacement coordinator
may publish `COORDINATOR_LOST` only after it has reacquired and confirmed the
old execution fence, and it never redispatches possibly dispatched work.

Fence uncertainty never becomes successful close. The session remains
revoked, preserves retained Run backing, returns a sanitized `UNAVAILABLE`
cleanup failure, and releases only the coordinator/process-local resources
needed for a later trusted acquisition to recover. Repeated `close()` observes
the same settled promise.

## 8. Implementation checkpoints

1. **Acquisition and identity.** Add borrowed-root source/state seams,
   device/inode coordinator affinity, fresh protected bootstrap, exclusive
   acquisition, substitution refusal, and cleanup/reacquisition tests.
2. **Authority-neutral plan.** Move the foreground planning pipeline behind
   the session, prove failure atomicity, evaluator cancellation, lost-response
   convergence, and the complete sanitized rendering.
3. **Digest-only apply.** Prove no source/evaluator invocation, every stale
   axis, admission and lock-repair replay, and minimal receipts.
4. **Session-scoped roots.** Attach the existing root controller, make both
   `startRun` and `runStatus` participate in the operation gate, and prove
   escaped-authority revocation.
5. **Closure and crash.** Prove close races, normal cancellation/fencing,
   wrapper `SIGKILL`, coordinator replacement, no redispatch, and zero Run
   residue.
6. **Independent consumer.** Only then add packed exports, candidate machine
   schemas, and CLI spelling actually consumed. The packed tree must continue
   excluding every private implementation module.

Each checkpoint is independently commit-worthy. Failure to prove one does
not authorize a daemon, path-based fallback, weaker sandbox, ambient runtime,
public extension SPI, or later product subsystem.

## 9. Explicit exclusions and stop conditions

This vertical excludes Services, Hooks, Event Sources, Agents, Semantic
Choice, changing Run universes, updates, rollback, `jig init`, Starters,
Jig Graph/Sley lowering, public Runtime Adapter or Sandbox Backend SPIs,
daemon/IPC transport, list/watch/cancel, and distributed execution.

Stop and report rather than broaden if correctness would require:

- treating a path as identity after its descriptor identity changed;
- exposing a private Plan/lock/recipe solely to satisfy the consumer;
- replaying possibly dispatched work;
- weakening Backend fencing or cleanup;
- adding a daemon to keep one finite session alive;
- selecting host machinery from project input; or
- deriving a public extension interface from the one proof mechanism.

The boundary is:

> One trusted finite object owns one project identity and one coordinator,
> turns source into review without authority, applies only reviewed bytes,
> delegates roots to the existing durable controller, and closes without
> hiding uncertainty. Nothing else enters the first product session.
