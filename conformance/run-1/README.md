# Run/1 conformance slice

This directory contains pre-release executable evidence for the closed
candidate in
[`docs/flow/spec/run-protocol.md`](../../docs/flow/spec/run-protocol.md).
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

`sley-integration.test.ts` separately runs one external component implemented
with published `@jigging/sley` and the private local `@jigging/flow` candidate.
It proves that a graph can sit behind the ordinary Run/1 boundary and exercises
the component-local unwrapping needed to preserve an existing Run/1
operational classification through Sley's structured failure wrapper. This is
integration evidence, not another independent Run/1 peer, a Sley conformance
claim, or a public FLOW-to-Sley adapter API.

Run it with:

```console
bun test conformance/run-1
```

That fast development command uses Python when it is available. A missing
Python runtime is reported as a skipped parity case, never as a pass.

Run the independent peer with:

```console
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s conformance/run-1/python-peer -p 'test_*.py' -v
```

The canonical release gate does not permit that skip. It runs the Bun corpus,
both package tests, Python SDK tests, and the independent Python peer, and fails
if Python or its `build` module is unavailable:

```console
just test-release
```

Passing this corpus does not create a general certification programme. The
exact evidence and limits of the release-candidate claim are recorded in
[`MATRIX.md`](MATRIX.md).
