# Direct-root closure repair

**Status:** closed on 2026-08-27. The five repair gates below now pass focused,
cross-language, package, and privileged hostile proofs. This review supersedes
the root-execution lifecycle and completion claims in reviews 136–141 wherever
they differ. It does not select the succeeding product phase.

This is a correction checkpoint, not a new product phase. It introduces no
public FLOW field, Run/1 method, Root Administration member, Runtime Adapter
SPI, Sandbox Backend SPI, or Sley integration.

## 1. Why the prior closure claim was too strong

Before this repair, the path could:

1. durably allocate one admitted root Run;
2. reproduce an exact Python or Bun recipe;
3. execute the package in the private cgroup-v2/Bubblewrap envelope; and
4. persist and replay a protocol terminal.

Five boundary failures remained:

- a protocol-valid success was persisted without checking the package's
  declared outcomes or `result.schema.json`;
- a launch whose Backend fence could not be confirmed was collapsed into an
  ordinary terminal while its package materialization was released;
- cancellation or deadline expiry before `RunHostSession` started could be
  misclassified as `EXECUTION_FAILED`;
- the component could receive the admitted deadline while the private recipe
  enforced an earlier fixed wall ceiling, allowing a Backend deadline race to
  become a channel or execution failure instead of `DEADLINE_EXCEEDED`; and
- fallible work after committing a spawn intent could prevent the controller
  from receiving its unique launch authority, while replay correctly refused
  to redispatch it.

The first was an application-result admission defect. The other four were one
shared ownership defect: durable allocation, dispatch ownership, Backend
admission, fence evidence, backing lifetime, and terminal publication are not
safe when represented as separate best-effort steps.

## 2. Closed private lifecycle

The repaired implementation preserves this order:

```text
durable spawn intent
    -> recoverable dispatch ownership
    -> exact Run backing retained
    -> Backend admission may begin
    -> complete tree fence confirmed
    -> Run backing released
    -> package result admitted
    -> durable terminal published
```

The exact record layout remains private. One write-once execution allocation
is created with the Run. Its plan contains no-effect identities for both the
Package/1 materialization and Linux owner before either directory is created.
Backend preparation is recorded from the admission callback before package
execution can begin. Provisional result, fence, release, admitted result,
execution closure, and public terminal are distinct monotonic facts.

An exact repeated checkpoint is success and different bytes are conflict. The
final terminal close is also replay-safe and is retried narrowly because its
SQLite transaction may commit before a later owner verification or descriptor
cleanup reports failure.

Public Root Administration continues to expose only `pending` and `terminal`.
A launch remains `pending` while its fence is unproved. Fence uncertainty is
not converted to `EXECUTION_FAILED`, `CANCELLED`, `DEADLINE_EXCEEDED`, or
`COORDINATOR_LOST` merely to settle the record. Only a confirmed fence permits
backing release and terminal publication.

A replacement coordinator only inventories unresolved older-epoch work. The
Root Administration controller synchronously recovers that work before it
returns authority: it reacquires the exact Backend owner, confirms fencing,
releases backing, and only then admits `COORDINATOR_LOST` when no independently
proved result exists. Raw coordinator acquisition never fabricates a terminal.
An unconfirmed fence remains `pending`; the current interface deliberately
offers no liveness promise for an enforcement mechanism which cannot prove its
own terminal state.

## 3. Failure precedence and deadline

After fencing is confirmed:

```text
controller cancellation before a committed root response
    -> CANCELLED

absolute deadline expiry before or during startup
    -> DEADLINE_EXCEEDED

other planning, preparation, or execution failure
    -> EXECUTION_FAILED

clean protocol/process success with an undeclared or schema-invalid result
    -> INVALID_RESULT
```

These distinctions use typed private results or errors, never message matching.
Existing protocol, channel, resource, cancellation, deadline, execution, and
cleanup failures retain precedence over result validation.

The component and Backend share one effective deadline:

```text
effective deadline = min(admitted deadline, activation start + recipe ceiling)
```

Run/1 receives that deadline. The Backend hard wall adds only the fixed private
cooperative-cancellation grace. A helper deadline receipt is the typed fallback
when the host timer and protocol event loop race; it does not become
`CHANNEL_LOST` merely because it arrives first.

## 4. Result admission

For one clean provisional success, the allowed domain outcomes are exactly:

```text
done + the own keys of FLOW.md outcomes
```

If `result.schema.json` exists, it validates the complete
`{ outcome, output }` value. Absence admits any FLOW JSON/1 output after the
base envelope and declared-outcome rule pass. Rejection is `INVALID_RESULT`
and preserves bounded process diagnostics plus Schema/1 diagnostic details.

The validator uses the protected admitted Package/1 inspection. It never
rereads visible project source after execution.

## 5. Protected package launch

The first integrated proof failed because Bubblewrap entered a new user
namespace as host root and could not traverse a coordinator-owned `0700`
materialization. Passing source descriptors did not solve that boundary:
Bubblewrap 0.11.0 still reopened FD-backed paths and rejected the protected
ancestor. The rejected relay was removed rather than becoming another private
protocol.

The smaller implemented boundary is:

```text
trusted root trampoline enters the configured Run cgroup
    -> readiness proves pre-package placement
    -> exact admitted sudo launcher drops to coordinator UID/GID
    -> exact Bash resets cwd and environment
    -> unprivileged Bubblewrap constructs the namespace
    -> package bytes execute
```

The private Backend requires its configured payload UID/GID to equal the
trusted coordinator UID/GID. At sealing it canonicalizes each source, rejects
pseudo-filesystem and device aliases, records device/inode/type, and proves
that this identity can traverse every ancestor without supplementary-group
authority. It revalidates device/inode/type immediately before launch. The
captured package remains beneath an unchanged `0700` owner and is mounted with
ordinary read-only Bubblewrap binds.

Package code receives neither sudo, host cgroupfs, the host process view,
mount-source descriptors, nor a host-control path. The only host-side
traversable staging directory is the Backend's unique root-owned private-device
directory; it contains exactly fresh `null` and read-only `urandom` character
devices and is removed after fencing.

This proof assumes one trusted same-UID mutator for the protected tree. It is
not a general cross-UID launcher, public Runtime Adapter, or Sandbox Backend
contract. A future mechanism with a different trust model must prove its own
source-object and privilege-transfer boundary rather than inheriting this
implementation detail.

## 6. Closure evidence

The completed focused and hostile proofs cover:

- valid `done` and custom outcomes, undeclared and reserved outcomes, and
  correlated result-schema acceptance and rejection;
- cancellation and deadline expiry before admission, between admission and
  readiness, and after readiness;
- loss of the Backend terminal fencing receipt and retained backing while a
  fence remains unproved;
- coordinator failure and exact cleanup-owner reacquisition;
- a fallible post-allocation step without an orphaned current-epoch Run;
- no terminal before exact process-tree quiescence and cleanup;
- replay of admitted failure without package redispatch;
- real contained Python and Bun Runs; and
- zero residual processes, cgroups, private devices, control sockets, owner
  state, and package materializations after every settled case.

Observed release evidence:

- TypeScript build and packed `@jigging/jig` package smoke pass;
- ordinary Jig tests pass 329 cases with 23 privileged cases skipped; the
  isolated Service-process matrix passes its remaining 8 cases when supplied
  the exact authenticated leased Python path rather than ambient `PATH`;
- Python SDK tests pass 40 cases;
- the independent Python Run/1 peer passes 21 cases;
- the final serial privileged matrix passes 23 cases and 212 assertions;
- capability preflight proves writable delegated cgroup v2 with CPU, memory,
  and PID controllers; KVM and TUN are present but unused; and
- an independent post-run scan finds no Jig cgroups, private-device
  directories, control directories, or owner directories, while host
  `/dev/urandom` remains a character device with mode `0666`.

## 7. Preserved boundary

The repair did not add:

- a public Backend, Runtime Adapter, scheduler, or cleanup SPI;
- ambient cgroup or process scanning;
- weaker process-group, `ulimit`, or `/proc` fallback semantics;
- a content-addressed prepared-tree store, retention manager, or package GC;
- Nix lifecycle management or another package-manager integration;
- child Flows, effects, Agents, Hooks, Services, Semantic Choice, or Sley; or
- terminal publication before an exact fence can be proved.

The direct-root slice is closed again for the two exact private recipes and one
private Linux mechanism. `RootAdministration` still exposes only `startRun`
and `runStatus`. Runtime/Backend registration, public project opening,
transport, cancellation, and the next product phase remain open decisions.
