# Repository scripts

## Purpose

Owns repeatable entrypoints for builds, verification, candidate assembly,
operational baselines, and public-site assembly.

## Ownership

- Root scripts own unprivileged source, package, release, and site operations.
- `test-release.sh` includes the proposal workshop's deterministic application
  tests; it does not claim live Agent quality or independent consumer proof.
- `require-linux-host-conformance.sh` owns the bounded, read-only check that an
  exact publication revision passed the complete Linux host workflow.
- `ci/` owns disposable CI-host provisioning.

## Local Contracts

- Accept explicit arguments and environment inputs; validate them before use.
- Build candidates from clean tracked source into fresh destinations.
- Preserve frozen dependencies, exact archive bytes, hashes, inventories,
  atomic publication, cleanup, and nonzero failure.
- State test claims narrowly. `test-release.sh` is not a Linux proof-host or
  publication-readiness claim.
- Do not hide a weaker fallback behind a successful command.

## Work Guidance

- Prefer POSIX shell for orchestration and TypeScript for non-trivial data or
  protocol logic.
- Keep destructive cleanup limited to paths created by the current script.

## Verification

- Run the changed script against a fresh temporary destination and exercise at
  least one expected failure path.
- Validate the Host Conformance authorization script with `shellcheck` and
  success plus fail-closed API fixtures.

## Child DOX Index

- [ci/AGENTS.md](ci/AGENTS.md) — Disposable privileged CI-host provisioning
  and residue checks.
