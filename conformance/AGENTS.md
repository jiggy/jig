# FLOW conformance evidence

## Purpose

Owns executable, implementation-independent evidence for versioned FLOW
protocol candidates.

## Ownership

- `run-1/` owns Run/1 fixtures, black-box harnesses, TypeScript and Python
  peers, integration witnesses, and the evidence matrix.
- `docs/flow/spec/` owns normative behavior.

## Local Contracts

- Test observable protocol behavior through process boundaries; do not depend
  on SDK implementation internals.
- Keep the Python peer independent of the FLOW SDK and Bun peer harness.
- Development skips remain explicit. Release gates never count a skip as a
  pass.
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
