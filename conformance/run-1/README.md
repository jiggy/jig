# Run/1 conformance slice

This directory contains pre-release executable evidence for the closed
candidate in [`docs/spec/run-protocol.md`](../../docs/spec/run-protocol.md).
It is deliberately separate from the SDK implementations.

The current corpus has five layers:

- `fixtures/messages.json` checks the context-free message schemas;
- `fixtures/framing.json` records raw JSON/1 and framing boundaries;
- `components.test.ts` drives one golden full-duplex conversation through the
  TypeScript and Python SDK components;
- `component-matrix.test.ts` exercises black-box state, root and call-specific
  cancellation, abandoned-call quiescence, framing, request bounds, response
  correlation, operation identity, and process-exit behavior against both SDK
  components, plus one deliberately malicious component; and
- `python-peer/` independently implements JSON/1 framing and a host peer, then
  drives both SDK components through the golden conversation and the main
  direction, root lifecycle, cancellation, framing, request-bound,
  operation-identity, and hostile-response cases.

Run it with:

```console
bun test conformance/run-1
```

Python parity uses `python3` when it is available. In this development
environment the harness also understands the installed `need` launcher. A
missing Python runtime is reported as a skipped parity case, never as a pass.

Run the independent peer with:

```console
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s conformance/run-1/python-peer -p 'test_*.py' -v
```

Passing this slice does not claim complete Run/1 conformance. The exact
coverage and remaining stable-label gates are recorded in
[`MATRIX.md`](MATRIX.md). The independent Python peer now covers the main
black-box component matrix, but not every schema fixture or hostile frame.
