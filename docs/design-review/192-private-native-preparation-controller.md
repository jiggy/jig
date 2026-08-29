# Private native-preparation controller checkpoint

**Status:** accepted on 2026-08-29 after independent adversarial review,
focused state tests, and a real cgroup-v2/Bubblewrap proof. This checkpoint
joins one root-owned Bun preparation lifecycle to the existing private Linux
Backend and prepared-tree store. It does not make the target READY, execute the
final prepared Run, or publish a Runtime Adapter, Sandbox Backend, installer,
or preparation API.

## 1. Closed boundary

One concrete private controller now drives:

```text
pinned admitted root request
    -> authentic package-local SDK relation
    -> exact protected package backing and Linux owner
    -> durable possible dispatch
    -> one contained offline Bun worker
    -> complete Backend fence
    -> bounded normalized candidate outcome
    -> immutable prepared/bun-v1 artifact
    -> backing and owner release
    -> durable preparation closure
```

The controller derives the request from the root Run's retained Candidate and
spawn intent. It accepts only the private host's authentic runtime observation,
an exact worker path and digest, and the authentic Linux Backend. Command,
Bun flags, environment, mounts, resource limits, process view, runtime devices,
worker destination, and package destination are fixed controller policy. FLOW
metadata and package code select none of them.

The prepared record uses the already protected package-store root and its fixed
`prepared/bun-v1` namespace. No second caller-selectable store path, writable
output mount, package-manager cache, network access, or ambient interpreter is
introduced.

## 2. One-shot launch and concurrent callers

Plan, retained backing, sealed Sandbox identity, and possible dispatch are
durable before installer bytes can run. The invocation which inserted the
allocation retains its authentic allocation result through bounded exact
transition retries. Dispatch creates one nonserializable launch admission.
The controller creates `sealed.admit(...)` synchronously inside that
admission's `begin` callback; it never claims first and launches later.

A lost dispatch acknowledgement returns no new launch authority. The owner
fences the recorded Sandbox and settles conservatively without redispatch.
Once `begin` has created the admit promise, a later claim error also cannot
retry the token.

Independent review found and rejected an earlier duplicate-call design which
allowed a same-epoch observer to cancel the legitimate caller. The accepted
rule is:

```text
authentic creating invocation
    may drive or recover its current work

same-epoch non-owner
    observes pending/in-progress and mutates nothing

replacement epoch
    may fence and close older work, but never redispatch
```

Two real simultaneous calls now converge on one terminal owner and one
`pending/in-progress` observer. A later call replays the retained terminal.
If the creating invocation and its coordinator disappear, recovery waits for
the replacement epoch rather than guessing that same-epoch work is abandoned.

## 3. Output, fencing, and uncertainty

Stdout and stderr drain concurrently under fixed byte bounds. The complete
enforcement fence is retained before stdout can be parsed or promoted.
Success requires:

```text
prepared-owner evidence
payload_exit / exit 0 / no signal
complete stdout EOF
unchanged worker, runtime, and Backend evidence
authentic preparation observation
exact candidate normalization
```

Only then may the controller retain complete canonical candidate bytes and
publish the composite prepared-tree artifact.

The joined proof exposed and corrected two overly narrow v19 correlations:

- a retained `payload_exit`/0 fence with no durable outcome may close as
  `UNCERTAIN`, because the fence does not preserve complete stdout; and
- a live typed output-bound violation may close as `INVALID_RESULT` even when
  the helper's complete-tree termination receipt is `cancelled`.

If the latter local evidence is lost before outcome commit, recovery has only
the cancelled fence and may conservatively report `CANCELLED`. No public
terminal existed before either durable outcome, and replay after one commits
is exact. Deadline and actual caller cancellation take precedence when their
Backend evidence exists. Malformed, incomplete, oversized, or unobserved
output can never become success.

## 4. Recovery and cleanup

Every state transition is write-once and exact-retryable. After an error the
controller reopens durable state because the transaction may have committed
before its acknowledgement was lost. It never recreates a preparation from a
replayed allocation.

Recovery behavior is deliberately bounded:

- no plan: record the exact cancellation, elapsed-deadline, or setup failure;
- plan but no dispatch: cancel the exact preallocated Linux owner and remove
  any complete or incomplete package materialization;
- dispatch without an outcome: recover the exact Backend fence and record the
  supported conservative terminal, never another launch;
- successful outcome without an artifact: re-observe the retained package
  relation, re-normalize the retained candidate bytes, and publish without
  requiring the old worker or runtime to remain available;
- artifact without release: dispose package backing, release the exact owner,
  and record release; and
- release without closure: close idempotently.

An unconfirmed fence remains `pending/fence-unconfirmed`. Backing, owner state,
and the parent root remain retained. No failure path may release them or
publish a root terminal until fencing is confirmed. Successful work cannot
release before its artifact exists.

## 5. Evidence

Final focused evidence passes:

```text
TypeScript build                                      passed
v19 recovery/correlation regression                   1 / 1, 28 expectations
real contained preparation/controller proof           1 / 1, 21 expectations
```

The privileged proof ran only after the exact capability preflight confirmed
passwordless trusted launch, writable cgroup v2, CPU/memory/PID controllers,
all required child control files, and cleanup. It exercised real installation,
prepared-tree publication, terminal replay, two simultaneous callers, bounded
output termination, package/owner release, and repeated envelopes.

Independent post-run checks found:

```text
residual Jig cgroups                    0
residual Jig private-device dirs        0
host /dev/urandom                       character 1:9, mode 0666
```

The controller received a final independent GO after the same-epoch ownership
race, allocation-only deadline classification, output classification, and
lost-acknowledgement paths were corrected.

## 6. Non-claims and next boundary

This checkpoint is private execution evidence, not an operable alpha. The
joined hostile test does not yet inject every crash between dispatch,
prepared, fence, outcome, artifact, release, and closure. The state and Linux
Backend have broader separate failure corpora; a later readiness/release gate
must retain the remaining joined crash debt rather than calling it complete.

The next boundary is exact READY integration:

1. planning must distinguish the source-only Bun candidate from its required
   package-local preparation;
2. apply must pin the complete preparation identity without adding host
   installation details to FLOW or portable lock values;
3. root execution must obtain or replay the exact prepared-tree artifact
   before package bytes execute; and
4. the final Run must mount a detached read-only prepared capture and retain
   the same fencing, result-admission, and cleanup contract.

Until that join passes, native-dependent targets remain explicitly unavailable
to ordinary root execution. No ambient fallback is allowed.
