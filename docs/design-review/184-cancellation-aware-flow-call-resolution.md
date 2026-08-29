# Cancellation-aware Flow-call resolution checkpoint

**Status:** accepted on 2026-08-29 as private lifecycle hardening. This closes
the remaining cancellation-responsiveness debt in the complete deterministic
Flow-call scan. It adds no public Resolver or Run/1 vocabulary.

## 1. Exact correction

The root controller previously held an operation `AbortSignal`, but checked it
only after deterministic resolution had scanned as many as 4,096 pinned
targets. No package code ran during that scan, yet project close or an explicit
Run/1 cancellation could wait for every retained Package/1 inspection and
Schema/1 compatibility check.

The controller now passes that existing signal into the private Resolver. The
Resolver checks it:

- before reading the pinned candidate;
- between every candidate;
- before compatibility validation;
- after each non-interruptible retained-package capture and inspection has
  been disposed; and
- before returning a completed survivor set.

One already-running filesystem or schema operation is allowed to finish. The
checkpoint does not claim that ordinary platform I/O or synchronous Schema/1
evaluation is preemptible. It guarantees bounded cancellation latency at the
next safe ownership boundary and never abandons a captured-package handle.

Cancellation before durable child allocation returns the existing Run
operation failure `CANCELLED`. It creates no child operation, spawn intent, or
package execution. Protected corruption and real inspection failure are not
hidden merely because a signal changed concurrently.

## 2. Evidence

```text
private Flow-call resolution             11 tests, 37 assertions
complete untruncated scan                 4,096 targets
real mid-scan AbortController             passed
already-aborted refusal                   passed
child allocations after cancellation     0
captured descriptors after cancellation  unchanged
TypeScript build                          passed
```

The mid-scan case uses a 257-target admitted changing source, aborts while
asynchronous retained-package work is active, and observes `CANCELLED` before
the complete ambiguity result. A separate already-aborted call refuses before
reacquisition.

## 3. Stop boundary

This change adds no parallel resolver, worker pool, public cancellation API,
new wire error, recursive owner chain, wait graph, semantic chooser, provider,
or broader configured-Binding execution. Immediate parent exclusion remains
sufficient for the currently supported non-recursive leaf-child profile.

With this debt closed, the first-release path reaches native preparation plus
the external operational-host and Agent-provider boundaries. Review 186 later
corrects the native artifact to locally actionable package input; reviews 158
and 168 retain the external Agent/provider boundary.
