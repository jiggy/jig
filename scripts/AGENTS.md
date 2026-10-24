# Repository scripts

## Purpose

Owns repeatable entrypoints for builds, verification, candidate assembly,
operational baselines, and public-site assembly.

## Ownership

- Root scripts own unprivileged source, package, release, and site operations.
- `release/` owns package changeset coverage, independent prerelease planning,
  dependency propagation, generated pins, and source-bound release metadata.
  The required quick CI job validates every change against its Git baseline.
  Feature PRs declare intent without editing generated version outputs.
- `check-docs.ts` owns documentation metadata, local links, source anchors,
  changed-paragraph structural writing checks, and built-site routes and anchors.
  It uses an explicit Git baseline without an external skill dependency.
  Unchanged paragraphs retain existing style findings across owner changes.
  New technical paragraphs receive all mechanical style checks.
  `docs/jig/AGENTS.md` owns the temporary software-factory style exclusion.
  It makes no network requests and does not certify ASD-STE100 compliance.
- `new-worktree.sh` owns sibling development-checkout creation. It inherits
  existing ignored `../<same-name>` links from the primary checkout to real
  workspace entries. Tracked source stays local to each checkout. Parent links
  into the primary checkout stay unchanged. It does not copy environment files,
  create shared tool state, install dependencies, or choose another workspace.
  Use Bash 3.2-compatible constructs and portable BSD/GNU link creation.

  Support checkouts with no shared links and refuse collisions while retaining a
  partially created checkout for inspection.
- Justfiles own task composition. Scripts retain substantive orchestration.
  TypeScript candidate and site scripts invoke the relevant justfile, not
  package scripts. Python Just tasks expose the packaging orchestrator, which
  calls the standard Python build frontend directly.
- `build-site.sh` includes the fixed evaluator invocation and recipe schema in
  its exact public inventory, alongside the client and evaluator reference
  pages. Site assembly copies canonical bytes. It never regenerates contracts.
- `preflight.ts` owns local pre-push regression checks. `just preflight` builds
  Jig and its dependencies. It runs quick tooling and portable source checks. On
  an exact supported unprivileged Mac with qualified Bun, it then runs every
  applicable `test/macos/` and exact observer suite sequentially. It uses the
  hosted prerequisite order, excludes ambient credentials and live-client
  opt-ins, checks ownership residue, and stops at the first failure. Other hosts
  report portable-only coverage.

  Unsupported Macs refuse before building. Its ownership snapshot includes both
  explicit lowercase `jig-` paths and automatic `/Volumes/Jig-` mounts. These
  observations establish no cleanup, detach or deletion authority. This is not
  full host qualification. The full local command checks Just, Node and jq
  availability before building. Before local tests, resolve the selected real
  Node 22+ executable.

  Verify it. Supply compiler paths even when PATH uses a version-manager shim.
  Preserve distinct operator compiler overrides and exclude ambient credentials.
  Package-local `jig::check` runs Jig and display-package suites before the same
  native pass.
- `test-release.sh` accepts explicit portable, protocol, applications and Python
  stages in one built workspace. Omitted stages perform no setup or execution.
  Selected reports bind the complete whole-file suite inventory. Its default
  runs all stages serially after shared builds and archive freezing. Jig's
  portable build owns its complete local package graph.

  FLOW SDKs and authoring
  use exact versioned public artifacts from `jiggy/flow`, not local builds.

  A failed stage stops later execution and archive-success verification. It
  includes the authored examples' deterministic application tests, the private
  conversation-handoff fixture, and the external FLOW dependency boundary.
  It also checks the shared Agent method and
  ordinary ACP package. FLOW owns SDK, authoring, and conformance qualification.
  Refuse missing Python build/test tools before builds and long tests.

  CI supplies the
  verified canonical eight-package bundle through `CI_CANDIDATE_BUNDLE`. Local
  runs freeze the exact public SDK archive alongside reporting, HTTP Agent, ACP
  Agent, semantic model, web/TUI renderer and Jig archives.

  Local packers and the public SDK fetch place archives under a canonical
  temporary root.
  Source workspace builds remain separate from installed archive proof. It
  passes `FLOW_SDK_PACKAGE_ARCHIVE`, `REPORTING_PACKAGE_ARCHIVE`,
  `AGENT_METHOD_PACKAGE_ARCHIVE`, `AGENT_ACP_PACKAGE_ARCHIVE`,
  `JIG_PACKAGE_ARCHIVE`, `DISPLAY_MODEL_PACKAGE_ARCHIVE`,
  `DISPLAY_WEB_PACKAGE_ARCHIVE` and `DISPLAY_TUI_PACKAGE_ARCHIVE` to the
  relevant tests, and verifies those bytes afterward. With the canonical CI
  bundle, installed Jig, display and FLOW smoke checks belong to their required
  candidate profiles. Source tests still execute their complete selected
  inventories. Local runs retain all selected consumer checks.

  Standalone display consumers install ordinary package closures without Jig.
  Installed Jig composition remains a separate gate. Model and browser consumers
  require the independently verified absolute `FLOW_NODE` executable for their
  Node checks, as well as Bun. Renderer packages are qualification inputs, not
  publication candidates selected by the protected publisher. Hash verification
  uses the already-qualified Node executable on Linux and Mac. The compiler is
  bundled with Jig.

  Managed authoring is checked through its CLI. For application tests, it maps
  applications' declared SDK/Agent dependencies to exact frozen archives in
  disposable copies. The reconstructed application workspace includes nested
  Flow and application-local method package manifests. Root Bun overrides bind
  the complete frozen candidate closure across workspace members and transitive
  dependencies.

  This mapping uses no lifecycle scripts and makes no edits to source manifests.
  Generated workspace `node_modules` links are excluded from those copies.
  Full Jig CI fetches FLOW archives at their exact published versions.
  Publish a newly adopted FLOW candidate before qualifying dependent Jig releases.

  It does not claim live Agent quality or independent consumer proof.
- `test-installed-hostile-baseline.ts` consumes an exact archive, exercising
  containment and binary-safe file Runs, invalid output, resource limits,
  failure suppression, publication collisions and execution-residue checks. Its
  memory probe retains the fixed 256 MiB aggregate ceiling, 320 MiB touched
  child allocation and 60-second command bound. Host-side read-only inspection
  binds exactly one fresh memory Run to its canonical durable checkpoints,
  immutable admission and candidate generation, and exact ready target. Root
  invocation identity and admitted activation-request identity retain their
  distinct protocol domains. Intent and plan bind that target's meaning.

  The plan retains both closed native boot coordinates and the sealed owner's
  matching boot identity. It never derives native coordinates from wall time.
  The same proof requires a prepared Linux owner, positive `memory.events`
  max/oom/oom_kill counters, confirmed fence, complete release and admitted CLI
  terminal.

  It permits a nonzero child status with a successful parent or an accurately
  failed SIGKILL parent only with that same exhaustion proof. A bare kill or
  unrelated failure never qualifies. The counters prove an OOM kill in this Run,
  not its exact victim. The numerical ceiling remains owned by the exact
  installed candidate. Durable evidence contains counters, not a replacement
  limit policy. It passes no private state or helpers to the consumer.
  `installed-memory-proof.ts`

  owns pure integrity and outcome checks exercised by the quick
  operational-baseline checks. Their inert record inputs establish no native
  execution or enforcement evidence.

  Logged evidence contains only Run and receipt
  digests, counters and settlement facts, never owner tokens. Proof rejections
  name only a closed validation stage and never render private values or causes.
  Command checks distinguish JSON parsing, terminal equality, parent terminal
  shape, receipt disposition, exit status and stderr without changing acceptance.
  Like the operational baseline, it always checks live residue.
  `finishOperationalBaseline` removes only successful fixtures. It retains
  failed private state and the bounded memory command transcript.
- `profile-installed-startup.ts` is an opt-in diagnostic on selected Ubuntu
  24.04 x86-64 and exact Intel/Apple Silicon Mac hosts. It uses the exact frozen
  Jig and FLOW SDK archives and a deterministic three-Flow conversation. It
  excludes package/fixture setup, records one warmup plus five fresh-project
  trials, and preserves bounded failure evidence. It makes no provider calls and
  is not a performance claim or release threshold. Planning subphases separate
  configuration support verification, envelope startup, execution/settlement and
  workspace capture before selecting a change. Contained-command and HTTP
  effects retain paired planning, allocation, sealing, launch, collection and
  settlement spans.

  Collection includes backend enforcement and cleanup. It does not establish
  child CPU time. The consumer admits the same closed phase names as the private
  recorder. Mac guardian preparation and admission subspans time the existing
  coordinator awaits across root and child Flows and effects. Fixed labels
  provide aggregate counts, not per-operation attribution. Nested and concurrent
  wall spans remain non-additive.

  Retain failure records only through the private recorder's strict normalizer.
  These records contain a fixed host phase and validated cause, never raw errors.
  They do not contribute phase durations or establish successful execution.
- `test-operational-baseline.ts` retains failed fixtures and private command
  transcripts, names their directory on failure, and checks live residue even
  after an assertion fails. Only successful fixtures are removed. Residue or
  removal failures never replace the original failure or establish success.
- `build-agent-candidate.ts` builds ordinary HTTP/ACP Agent packages from clean
  archived source with normal Bun packing, then checks exact installed bytes and
  records inventory, revision and hashes. It grants no native or model work.
- `promote-directory.mjs` publishes complete Agent candidates and site
  directories on Linux and Mac using a same-filesystem move and exact directory
  identity. Refuse existing or racing destinations. Remove only a nested copy of
  the original staging inode, never another builder's output.
- `ci/` owns whole-suite inventories, native PR scope, canonical candidate
  provenance and transfer, observed execution evidence, release readiness, and
  disposable CI-host proof.
- `generate-unicode-normalization.py` verifies the exact Unicode 15.1 source
  digests before generating Jig's canonical normalization tables and official
  conformance vectors. It makes no network requests or contract-version changes.
- Site assembly verifies every public HTML page has indexed Markdown and
  full-text bundle coverage, rejects public `AGENTS.md` routes, and includes
  notices for bundled fonts.
- Site assembly requires Jig's home, guide, and understanding routes, plus its
  contact-import composition guide. FLOW owns its separate site and authoring
  guidance.
- Site assembly requires Jig's contract identity pages and exact descriptor
  downloads together. The deployed-site check verifies their page titles, JSON
  content types, and canonical bytes. Neither operation is runtime invocation
  resolution. Agent Run publication includes its complete referenced events,
  commands and replies channel bundle, even when a consumer uses only one-shot
  calls. User updates publication copies the portable library's exact descriptor
  and MPL-2.0 license. The release gate freezes its archive beside the SDK,
  installs both through ordinary dependencies, and qualifies TypeScript/Node and
  both Python distributions separately.

## Local Contracts

- Accept explicit arguments and environment inputs. Validate them before use.
- Build candidates from clean tracked source into fresh destinations.
- Package candidates install their selected workspace from manifests, letting
  Bun generate the ignored root lock. Never hand-edit or commit that generated
  workspace lock. Isolated dependencies must support clean builds and external
  packed consumers without ambient installations.
- Preserve exact archive bytes, hashes, inventories, atomic publication,
  cleanup, and nonzero failure.
- State test claims narrowly. `test-release.sh` is not a Linux proof-host or
  publication-readiness claim.
- Do not hide a weaker fallback behind a successful command.
- Startup-profile subprocesses receive an explicit non-credential environment.
  They run only frozen/local package inputs. They have a 30-minute aggregate
  child budget plus bounded per-command time and output. Keep raw source and
  full command output out of retained profile artifacts. The supported-host
  workflow's final residue assertion remains mandatory even when the optional
  diagnostic itself is non-gating.

## Work Guidance

- Prefer POSIX shell for orchestration and TypeScript for non-trivial data or
  protocol logic.
- Keep destructive cleanup limited to paths created by the current script.
- Baseline fixtures use one `FLOW.<ext>`, code metadata in `FLOW.meta.json`, and
  invocation declarations in `FLOW.contract.json`. Preserve file-publication,
  diagnostic, authority, and residue assertions when updating their format.
- Validate worktree arguments and shared-link collisions before creating a
  checkout. A later link failure leaves the checkout with an explicit
  diagnostic. Never force-remove potentially edited work as failure cleanup.

## Verification

- `bun test scripts/test-release-applications.test.ts` runs the complete source
  applications stage with real builds, frozen archives and a fresh Bun cache.
  It verifies all six installations and source-checked application reports.
- `bun test scripts/check-docs.test.ts` verifies documentation refusal and baseline handling.
- `bun scripts/check-docs.ts` checks current source documentation.

- Run the changed script against a fresh temporary destination and exercise at
  least one expected failure path.
- `profile-installed-startup.ts` refuses hosts outside the exact Linux and Mac
  qualification profiles. Validate that refusal and obtain timing evidence from
  the opt-in host workflow steps.
- `bun test scripts/npm-publish.test.ts` exercises the protected workflow's
  shell against controlled registry responses without credentials, including
  host-group preflight refusal. Controlled
  registry/API emulators use the test runner's Bun to avoid repeated mock
  interpreter startup. The real publisher still performs its Node checks.
- `node --test scripts/ci/*.test.mjs` checks complete suite execution, verified
  native PR scope, artifact and run/attempt lineage, fresh qualification, and
  fail-closed release readiness. It uses disposable Git repositories, archives
  and controlled API responses.
- `bun test scripts/development-shell.test.ts` exercises the actual shell hook's
  missing-build, mismatched-version, matching-version, and PATH behavior.
- `bun test scripts/new-worktree.test.ts` uses disposable Git repositories. It
  verifies link ownership, setup without shared links, shared environment
  updates and separate indexes. It also verifies refusals that preserve existing
  work and workspace state. On macOS it invokes `/bin/bash` to cover the bundled
  Bash 3.2.
- `just test-tooling` checks recipe parsing, argument and working-directory
  handling, Linux host shard proof-step coverage and fail-closed aggregation. It
  checks example dependency versions against public package manifests and
  explicit packing. It also checks build-tool refusal before cleanup or site
  staging. Its no-package-scripts rule covers repository tasks, not imported
  skill toolchains. Manifest checks include tracked and non-ignored new source
  files present in the working tree. Deleted files and ignored generated state
  are excluded.

  It includes all quick CI checks and the protected npm publisher's controlled
  registry tests. The publisher uses Node hashing so these checks also run on
  Mac. The frozen application closure regression runs actual builds, archive
  installs and complete source-checked application tests with an isolated Bun cache.
  Every discovered Node CI test file runs once in the ordinary pool,
  followed by the Bun tooling checks only after successful policy execution.
- `bun test scripts/operational-baseline-checks.test.ts` checks selector
  diagnostics and failure-preserving teardown without a containment host.
- `bun test scripts/preflight.test.ts` checks exact host refusal, exhaustive
  native inventory, real compiler selection and early refusal, environment
  isolation and failure-preserving residue checks. Execute `just preflight` on a
  qualified native Mac after changing its runner.

## Child DOX Index

- [release/AGENTS.md](release/AGENTS.md) — Changeset coverage, version generation,
  derived dependency pins, and release eligibility.
- [ci/AGENTS.md](ci/AGENTS.md) — Whole-suite inventories, native PR scope,
  canonical candidates, release readiness, observed proof, disposable Linux
  hosts and native Macs.
