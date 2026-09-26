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
- `profile-installed-startup.ts` is an opt-in, manual Ubuntu 24.04 x86-64
  diagnostic using the exact frozen Jig and FLOW SDK archives and a deterministic
  three-Flow conversation. It excludes package/fixture setup, records one warmup
  plus five fresh-project trials, and preserves bounded failure evidence. It
  makes no provider calls and is not a performance claim or release threshold.
- `test-operational-baseline.ts` retains failed fixtures and private command
  transcripts, names their directory on failure, and checks live residue even
  after an assertion fails. Only successful fixtures are removed; residue or
  removal failures never replace the original failure or establish success.
- `require-linux-host-conformance.sh` owns the bounded, read-only check that an
  exact publication revision passed the complete Linux host workflow.
- `require-native-agent-api-qualification.sh` owns the bounded, read-only check
  that the exact main-push revision passed the separate live ACP client check
  before npm publication; a manually dispatched check qualifies only when it
  ran on `main` at that same revision.
- `build-python-sdk.py` builds and qualifies wheel/sdist pairs; candidate mode
  requires clean Git source and records exact revision and artifact hashes. It
  uses one fixed archive timestamp so shallow CI checkouts and full-history
  checkouts produce the same bytes for unchanged package source.
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
  plus FLOW’s authoring entrypoint, SDK/Markdown/Skill guides, and Jig’s
  request-triage composition guide.
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
- Startup-profile subprocesses receive an explicit non-credential environment,
  run only frozen/local package inputs, and have a 30-minute aggregate child
  budget plus bounded per-command time and output. Keep raw source and full
  command output out of retained profile artifacts. The supported-host
  workflow's final residue assertion remains mandatory even when the optional
  diagnostic itself is non-gating.

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
- `profile-installed-startup.ts` deliberately refuses non-GitHub, non-Ubuntu
  24.04 x86-64 hosts; validate that refusal locally and obtain actual timing
  evidence only from its opt-in provisioned-host workflow step.
- `python3 -m unittest discover -s scripts -p test_pypi_release.py` verifies
  partial retries, registry failures, and immutable candidate/registry bytes.
- `bun test scripts/npm-publish.test.ts` exercises the protected workflow's
  shell against controlled registry responses without credentials.
- Validate the Host Conformance authorization script with `shellcheck` and
  success plus fail-closed API fixtures.
- Test the native Agent API publication gate with exact-revision success,
  failure, and no-match API fixtures; it must not accept a qualification for
  another source revision.
- `bun test scripts/development-shell.test.ts` exercises the actual shell hook's
  missing-build, mismatched-version, matching-version, and PATH behavior.
- `bun test scripts/new-worktree.test.ts` uses disposable Git repositories to
  verify link ownership, shared environment updates, separate indexes, and
  refusals that preserve existing work and workspace state.
- `just test-tooling` also checks recipe parsing, argument and working-directory
  handling, example dependency versions against public package manifests,
  explicit packing, and build-tool refusal before cleanup or site staging. Its
  no-package-scripts rule covers repository tasks, not imported skill toolchains.
- `bun test scripts/operational-baseline-checks.test.ts` checks selector
  diagnostics and failure-preserving teardown without a containment host.

## Child DOX Index

- [ci/AGENTS.md](ci/AGENTS.md) — Disposable privileged CI-host provisioning
  and residue checks.
