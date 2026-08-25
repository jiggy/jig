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
The process matrix also exercises the inclusive 16 MiB frame boundary,
oversize rejection, invalid UTF-8, and incomplete EOF in both SDKs.

The private Jig Host separately drives both Provider implementations in
`packages/jig/test/service-process.test.ts`.

This is not yet a Service/1 conformance label. The existing evidence must still
be packaged as portable Host-under-test fixtures, and a second independent Host
must pass them. Durable provider generations and lease behavior remain Jig
controller gates rather than Service wire cases.

[`MATRIX.md`](MATRIX.md) records the current required-case coverage and the
remaining durable-generation and independent-Host gap.
