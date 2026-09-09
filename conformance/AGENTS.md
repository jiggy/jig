# FLOW conformance evidence

## Purpose

Owns executable, implementation-independent evidence for versioned FLOW
protocol candidates.

## Ownership

- `run-1/` owns Run/1 fixtures, black-box harnesses, TypeScript and Python
  peers, integration witnesses, and the evidence matrix.
- `docs/flow/spec/` owns normative behavior.
- Channel fixtures and `channels`/`broadcast` components exercise real exchanges
  against both host peers. SDK disposal-race evidence remains package-owned;
  scripted channel values are not host-broker isolation, native Agent, or
  containment qualification. Broadcast peers check suffix identity and ordinary
  recovery when one subscribed stream fails.
- `channel-wiring` witnesses cover incoming grants, exact-call forwarding and
  sibling-monitor composition. Scripted admission rejection verifies SDK
  recovery, not host contract matching or transfer enforcement.

## Local Contracts

- Test observable protocol behavior through process boundaries; do not depend
  on SDK implementation internals.
- Keep the Python peer independent of the FLOW SDK and Bun peer harness.
- Development skips remain explicit. Release gates never count a skip as a
  pass.
- The SDK parity table maps both projections to executable evidence; SDK-only
  checks and language ergonomics remain distinct from portable wire claims.
- `MATRIX.md` records executable coverage and limitations; it must not imply a
  general certification programme.

## Work Guidance

- Change shared fixtures, both peers, SDK tests, and specifications together
  when portable behavior changes.

## Verification

- `bun test conformance/run-1`
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s conformance/run-1/python-peer -p 'test_*.py' -v`
- Use `scripts/test-release.sh` for release-coupled changes.

## Child DOX Index

- None.
