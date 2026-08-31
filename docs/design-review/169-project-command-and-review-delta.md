# Finite command lifecycle and review delta checkpoint

**Status:** private checkpoint closed on 2026-08-29. It advances the
deterministic operational baseline without publishing project acquisition or
an operational CLI. Review 198 supersedes its former host-policy-dependent
next step with the proved rootless Project Session join.

## 1. Complete review evidence

The earlier Project Administration candidate returned a complete proposed
snapshot but did not expose what changed from the active generation. That was
safe but insufficient for meaningful approval once the project catalogue can
change dynamically.

The private review value now carries the active Candidate derived from the
authenticated `baseGeneration` admission chain. The renderer emits:

```text
current
proposed
changes
    packages
    bindings
    journalPublishers
    hooks
    targets
        added
        removed
        changed
```

Both full states remain visible, so the change summary is navigation rather
than a lossy authority model. Target projections include exact configured
settings, attachments, slots, package identity, entrypoint, and readiness
code while omitting recipe and host-observation identities. The existing
target-change detector compares the protected records before redaction, so a
recipe or observation change still names the affected target without exposing
the changed private identity. The existing
ASCII-only and four-MiB precommit gate still runs before Candidate or Plan
publication. A renderer failure therefore leaves no visible Candidate head or
review Plan.

The base is not serialized into Plan/2. Plan authority still names its one
base generation and exact proposal. Reopening a Plan rederives and
cross-checks the base Candidate through protected state.

## 2. Proof-independent foreground lifecycle

One private module now owns the finite command invariant independently of the
agent-sandbox proof host:

```text
acquire one ProjectSession through injected trusted machinery
    -> perform exactly one plan, apply, or root Run
    -> wait for a root terminal without a frontend timeout
    -> close the same finite session
    -> publish success only after close succeeds
```

It normalizes root requests before dispatch, initiates memoized close on
cancellation, and preserves the operation failure followed by the close
failure even when either thrown value is not an `Error`. It does not open a
project itself, choose host machinery, parse CLI input, or add status/list,
detach, watch, cancel, daemon, or transport concepts.

This is the reusable internal seam for a later finite CLI. The installed CLI
must remain non-operational until administrator-owned project acquisition and
host support exist; this module is not evidence for such an installation.

## 3. Evidence and remaining gates

Focused evidence passes:

- 5 finite-command lifecycle tests;
- 5 review rendering, private-evidence redaction, and bound tests;
- initial Plan create/reload with null base;
- sequential admission, lock repair, and changed-generation Plan with an
  authenticated base; and
- the existing 5 finite Project Session lifecycle tests and TypeScript build.

Still open on the critical path:

- the independent Project Authoring Probe/1 result and resulting bare shape;
- an administrator-owned production Linux/Bun trust root and installed
  acquisition function;
- a public prerelease lock format and native dependency preparation;
- strict file/stdin CLI input and sanitized output/error policy;
- `projectRunTargets()` expansion and its new lock/review semantics; and
- the independent operational baseline on a fresh supported host.
