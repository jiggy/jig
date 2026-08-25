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
Provider ceiling.

The private Jig Host separately drives both Provider implementations in
`packages/jig/test/service-process.test.ts`.

This is not yet a Service/1 conformance label. The corpus still needs complete
Host-under-test fixtures, request ceilings, framing/failure injection,
deadline and terminal-publication races, detached work, process loss, and
containment cleanup before independent implementations can claim the Host or
Provider label.
