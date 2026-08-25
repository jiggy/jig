# FLOW Service/1 conformance candidate

This directory contains the machine-message fixtures and the first black-box
Provider matrix for the closed Service/1 candidate.

```sh
bun test conformance/service-1
```

The matrix uses an independent Bun protocol peer to drive both the TypeScript
and Python `@flowmd/sdk` / `flowmd-sdk` Provider projections. It covers fixed
readiness, concurrent invocation, declared errors, Mount- and
invocation-attributed calls, cancellation which cannot be swallowed, clean
Mount shutdown, detached-work rejection and wire quiescence, premature
invocation, invalid readiness acknowledgement, and the 64-request concurrent
Provider ceiling. Both invocation-owned and voluntarily abandoned Mount work
are covered. Unknown methods and invalid params remain request-local, while a
malformed cancellation closes the channel.

The exact 65,536-request lifetime cases are deliberately slower than the rest
of the matrix. They remain in the ordinary conformance command because the
inclusive boundary is protocol behavior, not a performance benchmark.

The private Jig Host separately drives both Provider implementations in
`packages/jig/test/service-process.test.ts`.

This is not yet a Service/1 conformance label. The corpus still needs complete
Host-under-test fixtures, request ceilings, framing/failure injection,
deadline and terminal-publication races, detached work, process loss, and
containment cleanup before independent implementations can claim the Host or
Provider label.
