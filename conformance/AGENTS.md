# FLOW conformance evidence

## Purpose

Owns executable, implementation-independent evidence for versioned FLOW
protocol candidates.

## Ownership

- `run-0/` owns Run/0 fixtures, black-box harnesses, TypeScript and Python
  peers, integration witnesses, and the evidence matrix.
- `docs/flow/spec/` owns normative behavior.
- Shared invocation fixtures use only `flow/call`, return complete
  `{outcome, output}` results, and keep declared domain outcomes separate from
  operational errors. Invocation descriptor tests cover structural acceptance;
  digest closure, graph compilation, and package/runtime qualification remain
  separate host responsibilities.
- `run-0/fixtures/invocation-features.json` supplies shared feature catalog
  acceptance/rejection values and exact identity vectors. `schema.test.ts`
  validates catalog structure; Jig's parser tests validate JSON/0 and closure.
  Python's `test_invocation_features.py` independently checks the vectors using
  their bounded JCS-equivalent value subset, not a general package inspector.
- Channel fixtures and `channels`/`broadcast` components exercise real exchanges
  against both host peers. SDK disposal-race evidence remains package-owned;
  scripted channel values are not host-broker isolation, native Agent, or
  containment qualification. Broadcast peers check suffix identity and ordinary
  recovery when one subscribed stream fails.
  Shared message fixtures include closed slot/channel agreement references;
  both schema validation and the independent Python peer check their shape.
- `channel-wiring` witnesses cover incoming grants, exact-call forwarding and
  sibling-monitor composition. Scripted admission rejection verifies SDK
  recovery, not host contract matching or transfer enforcement.
- `conversation` components and peers forward real structured requests and
  replies between opposite-language SDK processes. The finite adaptive-search
  witness owns its two named fixture descriptors, domain checks, close ordering
  and cancellation traces; scripted admission is not production host proof.

## Local Contracts

- Test observable protocol behavior through process boundaries; do not depend
  on SDK implementation internals.
- Operation reference ledgers are invocation-local. They preserve optional-key
  presence and exclude only `operationId` from the unified call identity;
  they do not model production durability or route authorization.
- Keep the Python peer independent of the FLOW SDK and Bun peer harness.
- Development skips remain explicit. Release gates never count a skip as a
  pass.
- The SDK parity table maps both projections to executable evidence; SDK-only
  checks and language ergonomics remain distinct from portable wire claims.
- `MATRIX.md` records executable coverage and limitations; it must not imply a
  general certification programme.
- `schema.test.ts` checks JSON-RPC examples in the FLOW implementer guides
  against Run/0 schemas. `python-peer/test_guide_examples.py` runs the platform
  guide's exact host snippet against controlled process fixtures, checking
  correlation, the granted route, results, timeout, exit and trailing-output
  failures. This is documentation regression evidence, not production host
  containment or independent consumer proof.

## Work Guidance

- Change shared fixtures, both peers, SDK tests, and specifications together
  when portable behavior changes.
- Use `node:assert/strict`'s `rejects` for failures that await subprocess exit.
  Bun's promise rejection matcher can stall exit observation in the pinned
  runner. Preserve checks for exit status, trailing frames, and partial bytes.
- `run-0/package.json` and its lock own the pinned Ajv schema-test and Sley
  integration dependencies; prepare them with
  `bun install --cwd conformance/run-0 --frozen-lockfile`.

## Verification

- `bun test conformance/run-0`
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s conformance/run-0/python-peer -p 'test_*.py' -v`
- Use `scripts/test-release.sh` for release-coupled changes.

## Child DOX Index

- None.
