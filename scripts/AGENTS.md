# Repository scripts

## Purpose

Owns repeatable entrypoints for builds, verification, candidate assembly,
operational baselines, and public-site assembly.

## Ownership

- Root scripts own unprivileged source, package, release, and site operations.
- `new-worktree.sh` owns sibling development-checkout creation. It inherits
  existing ignored `../<same-name>` links from the primary checkout to real
  workspace entries. Tracked source stays local to each checkout; parent links
  into the primary checkout stay unchanged. It does not copy environment files,
  create shared tool state, install dependencies, or choose another workspace.
- Justfiles own task composition; scripts retain substantive orchestration.
  TypeScript candidate and site scripts invoke the relevant justfile, not
  package scripts. Python Just tasks expose the packaging orchestrator, which
  calls the standard Python build frontend directly.
- `test-release.sh` includes the authored examples' deterministic application
  tests and the optional contract author's Node mapping/type/lifecycle checks.
  It also checks the shared Agent method and ordinary ACP package.
  It freezes complete SDK, HTTP Agent, ACP Agent and Jig archives through their package-owned
  packers, passes `FLOW_SDK_PACKAGE_ARCHIVE`, `AGENT_METHOD_PACKAGE_ARCHIVE`, `AGENT_ACP_PACKAGE_ARCHIVE` and
  `JIG_PACKAGE_ARCHIVE` to the relevant tests, and verifies those bytes afterward.
  The compiler is bundled with Jig; managed authoring is checked through its CLI. For application tests,
  it maps applications' declared SDK/Agent dependencies to the exact frozen
  archives in disposable copies, including nested Flow and application-local
  method package manifests in the reconstructed application workspace, without
  lifecycle scripts or edits to source manifests. Generated workspace
  `node_modules` links are excluded from those
  copies. This permits testing an SDK before its version reaches npm;
  it does not claim live Agent quality or independent
  consumer proof.
- `test-installed-hostile-baseline.ts` consumes an exact archive, exercising
  containment and binary-safe file Runs, invalid output, resource limits,
  failure suppression, publication collisions and execution-residue checks.
- `test-operational-baseline.ts` retains failed fixtures and private command
  transcripts, names their directory on failure, and checks live residue even
  after an assertion fails. Only successful fixtures are removed; residue or
  removal failures never replace the original failure or establish success.
- `require-linux-host-conformance.sh` owns the bounded, read-only check that an
  exact publication revision passed the complete Linux host workflow.
- `build-python-sdk.py` builds and qualifies wheel/sdist pairs; candidate mode
  requires clean Git source and records exact revision and artifact hashes.
- `build-agent-candidate.ts` builds ordinary HTTP/ACP Agent packages from clean
  archived source with normal Bun packing, then checks exact installed bytes
  and records inventory, revision and hashes. It grants no native or model work.
- `pypi-release.py` performs read-only registry reconciliation, staging missing
  distributions and refusing conflicting bytes; it never uploads or rebuilds.
- `ci/` owns disposable CI-host provisioning.
- Site assembly verifies every public HTML page has indexed Markdown and
  full-text bundle coverage, rejects public `AGENTS.md` routes, and includes
  notices for bundled fonts.
- Site assembly requires both products’ home, guide, and understanding routes,
  plus FLOW’s authoring entrypoint and Jig’s request-triage composition guide.
- Site assembly requires Jig's contract identity pages and exact descriptor
  downloads together. The deployed-site check verifies their page titles,
  JSON content types, and canonical bytes; neither operation is runtime
  invocation resolution.
  Agent Run publication includes its complete referenced events, commands and
  replies channel bundle, even when a consumer uses only one-shot calls.

## Local Contracts

- Accept explicit arguments and environment inputs; validate them before use.
- Build candidates from clean tracked source into fresh destinations.
- Package candidates install their selected workspace from manifests, letting
  Bun generate the ignored root lock. Never hand-edit or commit that generated
  workspace lock. Isolated dependencies must support clean builds and external
  packed consumers without ambient installations.
- Preserve exact archive bytes, hashes, inventories,
  atomic publication, cleanup, and nonzero failure.
- State test claims narrowly. `test-release.sh` is not a Linux proof-host or
  publication-readiness claim.
- Do not hide a weaker fallback behind a successful command.

## Work Guidance

- Prefer POSIX shell for orchestration and TypeScript for non-trivial data or
  protocol logic.
- Keep destructive cleanup limited to paths created by the current script.
- Baseline fixtures use one `FLOW.<ext>`, code metadata in `FLOW.meta.json`,
  and invocation declarations in `FLOW.contract.json`. Preserve file-publication,
  diagnostic, authority, and residue assertions when updating their format.
- Validate worktree arguments and shared-link collisions before creating a
  checkout. A later link failure leaves the checkout with an explicit diagnostic;
  never force-remove potentially edited work as failure cleanup.

## Verification

- Run the changed script against a fresh temporary destination and exercise at
  least one expected failure path.
- `python3 -m unittest discover -s scripts -p test_pypi_release.py` verifies
  partial retries, registry failures, and immutable candidate/registry bytes.
- Validate the Host Conformance authorization script with `shellcheck` and
  success plus fail-closed API fixtures.
- `bun test scripts/development-shell.test.ts` exercises the actual shell hook's
  missing-build, mismatched-version, matching-version, and PATH behavior.
- `bun test scripts/new-worktree.test.ts` uses disposable Git repositories to
  verify link ownership, shared environment updates, separate indexes, and
  refusals that preserve existing work and workspace state.
- `just test-tooling` also checks recipe parsing, argument and working-directory
  handling, explicit packing, and build-tool refusal before cleanup or site
  staging. Its no-package-scripts rule covers repository tasks, not imported
  skill toolchains.
- `bun test scripts/operational-baseline-checks.test.ts` checks selector
  diagnostics and failure-preserving teardown without a containment host.

## Child DOX Index

- [ci/AGENTS.md](ci/AGENTS.md) — Disposable privileged CI-host provisioning
  and residue checks.
