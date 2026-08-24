# Run/1 conformance slice

This directory is the initial executable-evidence seed for the closed candidate in
[`docs/spec/run-protocol.md`](../../docs/spec/run-protocol.md). It tests the
wire independently of either SDK implementation.

The corpus has three layers:

- `fixtures/messages.json` checks the context-free message schemas;
- `fixtures/framing.json` records raw JSON/1 and framing boundaries;
- `components.test.ts` drives the same semantic conversation through the
  TypeScript and Python SDK components.

Run it with:

```console
bun test conformance/run-1
```

Python parity uses `python3` when it is available. In this development
environment the harness also understands the installed `need` launcher. A
missing Python runtime is reported as a skipped parity case, never as a pass.

Passing this slice does not claim complete Run/1 conformance. The remaining
release-gate matrix includes operation identity, cancellation and deadline
races, request bounds, fatal framing, quiescence, exit behavior, and a second
independent peer implementation rather than two projections of the same
codec. Resource benchmarking must also close total-ID lifetime and legal-frame
memory amplification before hostile multi-tenant claims.
