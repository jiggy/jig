# Private native-preparation state checkpoint

**Status:** accepted on 2026-08-29 after focused lifecycle, schema, replay,
coordinator-loss, root-close linearization, and preceding-version refusal
tests. This checkpoint closes durable state for one root-owned Bun
preparation. It does not dispatch the installer, publish a prepared tree, make
a target READY, or add a public child/runtime interface.

## 1. Implemented boundary

The private admission store advances to schema v19 and adds one concrete
subordinate owner beneath an already allocated root Run:

```text
root Run and spawn intent
    -> one exact Bun preparation allocation
    -> write-once lifecycle facts
    -> exact closure over present and absent facts
```

The allocation commits the parent Run and coordinator epoch, source request
and Package/1, the admitted root-recipe observation, the distinct native-
preparation observation and dependency, selected worker, runtime observation,
Backend mechanism, and a deadline no later than the parent intent. The two
observation identities are deliberately separate: one authenticates the
already admitted executable recipe; the other authenticates the derived
installed tree.

Allocation is accepted only for the exact READY target and root spawn intent
already pinned by the admitted generation. A second preparation for the same
root replays only when every canonical field is equal; changed reuse is an
operation conflict.

The new tables are deliberately private and concrete:

```text
root_bun_preparations
root_bun_preparation_facts
root_bun_preparation_closures
```

They do not establish a generic child owner, preparation registry, Runtime
Adapter SPI, Sandbox Backend SPI, or FLOW vocabulary.

## 2. Monotonic lifecycle

The complete fact vocabulary is:

```text
plan
backing
sandbox
dispatch
prepared
fence
outcome
artifact
release
```

Every fact is a closed typed canonical JSON/1 value, write-once, digest-bound
to the allocation, and replayable only with identical bytes. The store
validates the lifecycle and all cross-fact identities again whenever it
reconstructs retained rows. Malformed, digest-invalid, cross-owner, or
cross-fact evidence is protected-state corruption rather than a new state.
Truth of the serializable receipts still depends on the later joined trusted
controller and Backend proof; this state layer does not authenticate arbitrary
internal callers by itself.

The plan is constrained to deterministic protected project-owned
materialization and Linux-owner paths and names, exact package-owner
correlation, one bounded Backend Run ID derived from the parent Run, and the
real Linux planner's random owner token. The later Sandbox owner must preserve
that exact token. Callers cannot redirect cleanup or owner allocation to
another same-UID directory. The successful outcome embeds
the exact bounded canonical worker bytes and reuses the complete candidate
codec, including path, topology, file-count, byte-count, SDK-manifest, and
runtime-entry checks. The artifact must name that candidate and the distinct
preparation observation exactly. Failure codes must agree with their retained
fence evidence.

The success path requires:

```text
plan
    -> retained source backing
    -> sealed Sandbox owner
    -> possible dispatch
    -> Backend prepared-owner persistence
    -> complete fence
    -> normalized successful candidate outcome
    -> immutable prepared-tree reference
    -> backing/owner release
    -> closure
```

Pre-dispatch cancellation or failure may close without planning. Once a
Sandbox owner exists, it must be fenced before outcome or release. A
successful outcome requires durable dispatch, prepared-owner evidence, and a
complete successful fence; it cannot release before a prepared-tree artifact
is recorded. A failed outcome cannot acquire an artifact.

The closure binds the allocation plus the digest or exact absence of every
fact. Closing is replay-safe and removes the owner from the open-work query; it
does not erase its durable history.

## 3. Dispatch and recovery authority

Only the invocation-local result which inserted a new allocation may create
the `dispatch` fact. The successful transition returns one nonserializable,
coordinator-bound launch admission. Claiming it re-verifies the originating
coordinator and consumes it exactly once. A replayed allocation, reconstructed
value, closed coordinator, lost dispatch acknowledgement, or replacement
coordinator cannot regain that authority.

Concurrent exact dispatch attempts using the authentic creator converge
through the database transition: one may create the fact and mint the
admission; every other attempt observes exact replay without a launch
admission.

This is intentionally conservative. A commit whose acknowledgement was lost
must not become permission to run the installer again. After coordinator
replacement, older work may only:

```text
fence an existing Sandbox owner
record a conservative outcome
publish an artifact from an already durable successful candidate
release retained backing
close the lifecycle
```

It cannot create plan, backing, Sandbox, dispatch, or prepared work. A durable
dispatch with no durable outcome therefore never authorizes redispatch.

The state layer does not itself infer whether a process ran. A focused loss
test retains real `dispatch` and `prepared` facts, closes the originating
coordinator, proves that its held launch admission is dead, and then records
an exact `UNCERTAIN` outcome under a replacement coordinator without another
dispatch. The later controller must reproduce and authenticate exact
plan/backing/owner evidence, recover the Backend fence, and choose only the
bounded outcome supported by that evidence.

Root closure and preparation allocation are serialized through the same
protected database owner. A root terminal cannot publish while its
preparation remains open; a concurrent allocate-versus-close race therefore
has one winner rather than stranding subordinate work beneath a terminal root.

## 4. Removed output-backing proposal

Review 188 proposed a separate durable output backing before dispatch. The
integration review rejected it as false precision.

The existing Backend exposes only read-only package mounts. A trusted-side
stdout spool would still lack helper-owned proof of EOF and successful process
settlement after coordinator death. It would add another filesystem owner and
cleanup path without turning partial bytes into a complete response.

The smaller correct rule is:

```text
bounded stdout in the live owner
    + successful payload exit
    + complete Backend fence
    -> normalize candidate
    -> durably record the complete candidate in outcome
```

Loss before the outcome commit is uncertainty and never redispatches. Loss
after it can resume artifact publication from the retained candidate. No
output file, output fact, writable Sandbox mount, or Backend/helper expansion
was added.

## 5. Evidence and non-claims

Focused evidence passes:

```text
TypeScript build                                      passed
candidate-byte codec                                  5 / 5, 34 expectations
successful/replay/loss/root-race lifecycle tests      3 / 3, 65 expectations
schema and legacy-path/version refusal                5 / 5, 24 expectations
adjacent Project Session                              4 / 4, 13 expectations
adjacent root Flow-call resolution                    11 / 11, 37 expectations
adjacent foreground boundary                          2 passed, 1 proof-host skip
```

The schema sweep moves current private test consumers to v19 while preserving
v18 as the exact preceding-version negative fixture. The store still rejects
every alternate database or sidecar rather than migrating, merging, or
choosing among protected authority sources.

Review 190 already proves the separate protected prepared-tree store. This
checkpoint binds the shape of an artifact fact to that store's reference but
does not call the store or prove the joined lifecycle.

This checkpoint does not prove:

- installer launch, cancellation, deadline, or coordinator-kill behavior;
- controller-driven prepared-tree publication or final read-only
  materialization;
- result bytes surviving loss before their durable outcome;
- READY planning or exact final Run execution;
- generic recursive scheduling or reusable subordinate-owner APIs; or
- an operational production launcher/runtime installation.

## 6. Next boundary

One concrete private controller may now join this state, retained Package/1
materialization, review 190's prepared-tree store, and the existing Linux
Backend. The prepared-store root must be derived from protected project state,
not accepted as caller policy. The controller must prove possible dispatch
before execution, complete fencing, conservative restart without redispatch,
authentic re-normalization of retained candidate bytes, idempotent publication
and release, cancellation/deadline behavior, and zero residue before this
state can contribute to READY.
