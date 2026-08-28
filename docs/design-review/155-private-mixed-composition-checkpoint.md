# Private mixed-composition happy-path checkpoint

**Status:** closed on 2026-08-28 for the finite normal path implemented in
commit `3f84952`. This checkpoint does not close the provider-loss or
coordinator-replacement gates from review 154, and it publishes no supervisor,
Service controller, effect registry, Runtime Adapter, Sandbox Backend, or
project API.

## 1. Earned mixed witness

One admitted project now runs this exact composition under one externally
owned coordinator epoch:

```text
one acknowledged Bun counter Service generation
    + Root A: Bun -> Python child + Journal append + counter effect
    + Root B: Bun -> the same counter generation
    -> finite normal shutdown
```

Root A receives `1`. Two concurrent equal calls join that operation and an
exact later replay also returns `1`, without another counter mutation. Changed
reuse is `OPERATION_CONFLICT`; an undeclared method is `UNAVAILABLE`; a
schema-invalid Provider result is durably closed as `INVALID_RESULT`. Root A
also receives the exact Python child result and commits one canonical Journal
Event. After Root A closes, Root B receives and replays `2` from the same
process-local generation.

This proves one authentic Root-to-Service consumer path. It does not claim
that counter state survives Provider loss or that concurrent distinct Service
operations are linearizable.

## 2. Dispatch remains exact and private

The Bun Binding recipe accepts a nonempty set of deterministic direct-Flow and
capability slots. At runtime the existing Flow controller still owns
`flow/call`. The new private effect switch uses the pinned admitted slot:

```text
exact canonical Journal contract + exact `journal` export
    -> canonical Journal controller

any other exact admitted capability slot
    -> private Service effect controller
```

There is no fallback between controllers. The Service path reopens the retained
consumer package and cross-checks its request, portable lock, contract URI,
version and digest, method schemas, Provider Binding/export, live Mount, and
generation lease before dispatch. Input validation happens before invocation
allocation; output and declared application-error values are validated before
their durable terminal is projected to the root.

Private schema v17 removes the former requirement that a live owner still name
the project's current admission head. A focused store check moves the head and
then allocates the old root's lease from its own pinned Candidate/5 revision.
The store continues to reject every alternate-version database or sidecar; no
migration or mixed protected authority is inferred.

## 3. Normal ownership order is closed

The Service controller consumes the existing durable sequence rather than
creating a parallel operation model:

```text
owner-slot lease
    -> invocation allocation
    -> possible-dispatch record before the first Provider request byte
    -> validated terminal
    -> invocation closure
    -> lease release
    -> root release and terminal publication
```

Both roots retain a Service-owner closure digest. Root A additionally retains
its child and Journal closure evidence. The Mount is still neither released
nor closed after both roots terminate. The attached root controller drains and
disposes only its authority; it does not dispose the shared coordinator. Normal
shutdown then fences the Mount, observes that release and closure are still
absent, and finalizes it only after the exact two lease releases are present.

The hostile witness finishes with no Jig cgroup, private-device directory,
package materialization, or Linux owner-state residue, and it verifies that
the host `/dev/urandom` remains unchanged.

## 4. Committed evidence and open gates

Commit `3f84952` adds the focused Service-effect resolver checks, v17 store
checks for pinned-admission leases and Mount-finalization refusal with an open
lease, and the real Linux hostile witness named:

```text
runs one pinned Bun root through Python, Journal, and a shared counter Service
```

That committed witness covers only normal operation. It does **not** prove:

- coordinator loss while a mixed Service invocation is possibly dispatched;
- end-to-end provider loss before or after dispatch admission;
- the required fence -> invocation closure -> lease/root settlement -> Mount
  finalization recovery order;
- mixed-path cancellation and deadline races;
- a persistent supervisor, automatic restart, replacement, or rebinding;
- a portable Host-under-test corpus or second independent Service Host; or
- any public Service-host, effect-routing, project, runtime, or sandbox API.

The next valid checkpoint is the missing mixed loss proof. It must use the
durable v17 facts without redispatching possibly sent work, and must not
generalize normal composition into persistent Service policy.
