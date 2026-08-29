# Project Administration/1

**Status:** private prerelease value and object-capability candidate. The value
schema and TypeScript types are frozen for packed-consumer testing. Jig does
not yet publish a project opener, host installation contract, transport, or
operational alpha.

Project Administration/1 is the finite trusted host-side seam which turns one
already acquired local project into review, explicit admission, exact root
operations, and deterministic closure. It is not FLOW, is never available to
package code, and does not describe Runtime Adapters or Sandbox Backends.

The machine-readable value branches are in
[`machine/project-administration-1.schema.json`](machine/project-administration-1.schema.json).
Root operations retain their separate
[`Root Administration/1`](root-administration.md) contract.

## 1. Object capability

```ts
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

A trusted host supplies the object after authenticating and exclusively
acquiring one project identity. This specification does not publish a
constructor. Callers cannot select the state database, coordinator epoch,
runtime support, launcher, sandbox mechanism, host policy, or executor.

The session owns one descriptor-held project identity and coordinator.
Locator strings are not identity. Root substitution revokes the complete
session rather than attaching it to a replacement tree.

## 2. Planning

Planning is authority-neutral, not read-only. It may capture and evaluate
source in a bounded envelope and retain immutable packages, Candidates, and
Plans in protected state. It may not edit source or the visible lock, advance
admission, or execute package implementations.

`lockMode: "update"` allows the retained Plan to propose creation or
replacement of `jig.lock`. Apply writes it only when the exact lock observation
made during planning is still current. This is the only mode which can produce
a `lock-repair` operation. `lockMode: "locked"` requires the visible lock to
already equal the proposed canonical bytes during both plan and apply; plan
reports `LOCK_MISMATCH` for an initial mismatch, later drift is `STALE_PLAN`,
and Jig never writes the lock in this mode. Both modes may report `unchanged`
or propose an `admission`; locked mode does not freeze the active admission.

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

The bounded review text contains the complete current and proposed portable
states plus explicit added, removed, and changed identities for packages,
Bindings, Journal publishers, Hooks, and Run targets. It is deterministic,
non-truncated, and ASCII display-safe: project-controlled controls and Unicode
are emitted as JSON escapes. The active base is loaded from the authenticated
admission chain inside the same protected transaction; it is review evidence,
not another field in portable Plan authority. The review is not authority.
Only the retained `planDigest` identifies the exact applicable Plan. Private
Plan, Candidate, lock, recipe, runtime, Backend, coordinator, database, cgroup,
and helper representations never cross this boundary.

The renderer accepts at most 4,194,304 ASCII bytes and proves that limit before
Candidate or Plan publication. This conservative ceiling leaves room for the
review string's outer JSON escaping within FLOW JSON/1's string and whole-value
bounds. An unrenderable complete proposal is `UNAVAILABLE`; Jig never stores a
Plan which this interface cannot return for review.

If a successful Plan response is lost, planning unchanged source and host
evidence converges to the same result and digest without advancing admission.

## 3. Apply

`apply({ planDigest })` reopens retained bytes. It never rediscovers or
re-evaluates visible source. It independently derives whether the operation is
an admission or lock-only repair, rejects stale state, and returns an
idempotent minimal receipt:

```ts
type ProjectApplyReceipt = {
  readonly operation: "admission" | "lock-repair";
  readonly planDigest: string;
};
```

The receipt repeats the exact retained authority and the independently derived
operation; on success, `operation` equals the operation in the applicable
result for that exact `planDigest`. Private admission-generation and
lock-repair record identities are
not public receipts. Apply does not start a Run and does not imply Service
readiness.

## 4. Root authority and close

`rootAdministration` is the unchanged nonserializable Root Administration/1
object for the acquired project. Before an active admission exists,
`startRun` rejects with the Root Administration `UNAVAILABLE` error and
allocates no Run. A lock repair leaves the active generation unchanged.
References which escape from the session are revoked when the session closes.

Every call takes a synchronous operation lease. Calls entering after close
begins reject `PROJECT_CLOSED`. An accepted apply preserves its exact result or
sanitized operation error. Planning may be cancelled. Root work is cancelled,
fenced, and durably settled before ownership is released.

`close()` is idempotent and returns the same Promise. A normal close of live
work records `CANCELLED`. Process loss is different: a later trusted owner may
record `COORDINATOR_LOST` only after reacquiring the complete execution fence,
and never redispatches possibly dispatched work. Fence uncertainty makes close
fail `UNAVAILABLE`; it is never relabelled success.
`close()` failures are `ProjectAdministrationError` values. Cleanup or fence
uncertainty—including cleanup after project-identity loss—rejects with
`UNAVAILABLE`, but the session and every issued root authority remain
irrevocably closed; a later trusted owner performs recovery.
Consumers which combine an operation with close must preserve both failures
rather than allowing cleanup failure to erase the earlier operation error.

## 5. Errors

Project acquisition, plan, and apply use `ProjectAdministrationError` with one
closed code and a well-formed FLOW JSON/1 message containing 1 to 1,024 Unicode
scalar values. There is no generic details bag. Consumers branch on `code`;
messages are diagnostic text.

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

Values expose no raw path, `errno`, SQLite detail, runtime receipt, recipe,
helper, cgroup, coordinator epoch, or launch command. Root calls keep their
separate Root Administration error and terminal models.

Schema/1 can check only the 71-scalar digest shape because it has no regular
expression keyword. The trusted normalizer additionally requires exactly
`sha256:` followed by 64 lowercase hexadecimal digits. Structural schema
acceptance alone is not authority to apply a Plan.

## 6. Deliberate omissions

Project Administration/1 defines no daemon, socket, watch/list/cancel API,
public opener, Service/Hook/Agent administration, Semantic Choice, update or
rollback operation, Starter, Runtime Adapter SPI, Sandbox Backend SPI,
distributed scheduler, or durable arbitrary graph continuation.

The current private implementation proves descriptor confinement, exclusive
ownership, review/apply replay, root revocation, normal cancellation,
coordinator-loss recovery, and cleanup under one Linux proof mechanism. That
evidence does not make the private mechanism a portable interface.
