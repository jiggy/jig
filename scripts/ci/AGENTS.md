# CI host provisioning

## Purpose

Owns whole-file suite coverage, immutable candidate provenance, observed CI
evidence and release readiness, plus disposable Linux and native Mac proof. Host
preparation never becomes a consumer requirement.

## Ownership

- `../example-inventory.mjs` requires every direct example directory to retain
  its manifest, project definition and application tests. Its host-suite mapping
  must remain selected by Linux and both Mac targets. Application suite ownership
  covers `examples/`, so new tests cannot escape source-stage discovery.
- `test-suites.json` declares whole-file roots, applicability and fixed full
  execution targets. `suite-inventory.mjs` supplies local and pinned-Git
  membership, rejecting unknown, ambiguous or linked tests. Every applicable
  file belongs to one physical suite. Fixtures declare inputs without
  registering independent cases. The explicitly listed `image-thread-candidate`
  belongs only to the experimental profile and retains its manual opt-in. It
  cannot qualify a release.

  Production image decoding uses a disposable process. The portable suite owns
  its lifetime and fallback cases. Those checks do not qualify the thread experiment.
- `host-scope.mjs` avoids native allocation only for a verified two-parent PR
  merge with an entirely independent delta. That delta must contain only site
  files, non-specification documentation, Python SDK/reporting files, or
  reviewed root/agent guidance. The shared Reporting descriptor remains a native
  input. Source, build, workflow, specification, mixed, unknown or unverifiable
  inputs require complete Linux and Apple Silicon. Main and manual
  execution are always full. Final `affected-linux` and `affected-macos` checks
  independently reconstruct this decision and require either every native job's
  success or every job's explicit omission.

  An omitted PR creates no host qualification receipt. No native selection
  modes, native result reuse or compact witnesses exist. Intel has separate nightly
  compatibility coverage.
- `intel-nightly.mjs` selects published Jig and distinct main sources, or an
  explicitly requested open PR merge. It acquires canonical inputs with their
  original producer identities and immutable transport checks. Only scheduled
  main runs may supply verified mirrors. Manual PR runs cannot seed trusted
  inputs. Published archive bytes
  additionally match exact-version npm integrity.

  Intel retains its full whole-file inventory under the `macos-intel` evidence
  scope. The required `macos` scope owns Apple Silicon only. Nightly health
  names the tested version/source and last recorded passing published version.
  Missing, stale or foreign proof fails. Health never grants release readiness.

- `release-base.mjs` selects the required release check's comparison commit.
  It verifies the workflow source and both parents of a PR merge.
  The second parent must equal the event head. The event base must be an
  ancestor of the first parent, which supplies the comparison commit.

  Push checks retain the event's previous revision. Manual checks use the
  source's first parent. Missing, unrelated, or uncertain baselines fail.

  A newer tested base never relaxes generated release replay. The marker must
  name that exact base, even when its advance changes no files.
- Source execution keeps one `source-tests` workflow job and workspace, with
  distinct `source-portable`, `source-protocol`, `source-applications` and
  `source-python` evidence. CI and local execution run selected stages serially
  after shared builds and archive freezing. A failed stage stops later work.
  Canonical installed smoke checks belong to required candidate profiles,
  including Jig's three standalone display gates. Local source execution retains
  those consumers. Source-only Python stages do not build Jig.

  Both portable and protocol stages run `.node.mjs` files under verified Node.
  Actual Node events retain file identities through `source-node-reporter.mjs`.
  The report merger requires complete selected-file coverage across Node and Bun.
  Python executes every selected file, including
  nested additions, and emits exact completed-file markers only after successful
  zero-skip groups. Disposable application reports normalize file paths only
  after source bytes are verified.
- `job-evidence.mjs` binds completed reports to the current Git source, full
  file inventory and runtime profiles. Every fixed target must have positive
  zero-skip/zero-filter proof and a successful owning job. Aggregates reject
  missing, duplicate, stale or incomplete profile rows and require archive and
  native-residue attestations for their owners. Source inventory comes from the
  checkout, never a supplied selection plan. Installed completion markers carry
  no test-case credit.
- `ci-job-results.mjs` writes required job outcomes and source-stage aliases
  before refusing an unsuccessful CI aggregate. Its separate diagnostic report
  preserves failed job identities and optional current-attempt GitHub job
  observations. A cancelled job with an explicitly empty runner and step list
  is reported as unassigned. Missing observations never establish that cause.
  Observations cannot qualify execution, bypass evidence validation or change
  required job outcomes. API unavailability leaves them absent.
- `build-candidates.mjs` archives clean tracked source and freezes seven Jig-owned npm archives and the published FLOW dependency. It uses qualified native Linux x64 Bun 1.3.3/Just 1.43.1, normal
  workspace resolution and package-owned packing. Preserve generated resolution,
  actual tool identities, inventories and hashes. Build-only receipts carry
  pending qualification. Expensive consumer tests run after artifact retention.
  Reporting (`@jigging/reporting`) is an exact canonical qualification input,
  alongside the three display packages, rather than another protected
  publication selector.

  Before archiving, it reads the source-pinned release state from
  `scripts/release/state.mjs`. Candidate receipt version 2 binds that state,
  including the release-plan digest for an eligible generated version commit.
  Pending changeset coverage permits source qualification with unchanged package
  versions. It grants no publication readiness.

  Its Python package is `jiggy-reporting`. Source ownership, distribution
  profiles and descriptor inputs use these same component identities.
  `qualify-candidate.mjs` verifies the immutable bundle before and after fresh
  FLOW/Agent/standalone-display/Jig installed obligations, without rebuilding
  release archives. Display packages qualify through Jig's gate. The protected publication selectors are HTTP Agent, ACP Agent, and Jig.

  FLOW SDK archives are published dependencies frozen as qualification inputs.
  Workspace installation selects only Jig-owned packages, never external FLOW packages.
  Installed qualifications build no source packages.

They consume frozen package exports with tracked test helpers and installed
  tooling. Jig's CI receipt lists only its six actual gates: three standalone
  display consumers, ordinary Jig package smoke and local/global npm help. CI
  keeps native Run flags clear and provisions no containment host. Operational
  and hostile baseline scripts belong exclusively to the complete
  exact-current-candidate Linux qualification. Host publication still requires
  that full Linux receipt.
- `candidate-provenance.mjs` validates exact source, producer, build profile,
  archive contents, resolution and hashes, and writes qualification receipts.
  Its closed release record requires the three protected package versions to
  match their frozen archives. Unknown release fields, foreign source, pending
  external FLOW coverage and malformed eligibility refuse qualification.

  `candidate-transfer.mjs` checks GitHub repository/workflow/event/head
  identity, producer job attempt, immutable artifact ID/digest and expiry before
  safely extracting the bundle. PR head metadata differs from its tested merge
  source. Main-push consumers acquire only main-push CI producers. Manual
  qualification may acquire trusted main push/manual producers on `main`.
  Feature-branch producers are not accepted.

  Release readiness and native Linux lineage require full main-push producers.
  Main/manual consumers never fall back from missing current-attempt artifacts.
  PR consumers may retain only the latest successful canonical-build execution
  within the same original CI run. A later failed rebuild refuses acquisition.
  Linux and hosted Mac acquisition use `--producer-timeout-seconds 1800` to
  await that exact `candidate-build` job. Its run, attempt and head must match
  the selected producer.

  Producer readiness has one absolute deadline, including runner queues.
  Missing, queued or running jobs poll every 30 seconds. Failed, skipped,
  duplicate, stale or completed-but-missing proof refuses immediately. Hosted
  Mac also requires latest `Quick development checks` success through
  `--after-quick true`. Main/manual runs require current-attempt success.

  Readiness pins the workflow run and current attempt, selected build job ID
  and producer attempt before artifact transfer. A later producer change refuses
  acquisition. Transfer retains its separate 300-second Linux or 600-second Mac
  maximum and 10-second polling. Other acquisition callers retain their existing
  bounds without producer waiting. These prerequisites grant no qualification
  and do not wait for unrelated source or Python work.

- `release-readiness.mjs` rechecks all current-attempt CI, Linux, hosted Mac and
  native obligations after completion events. Qualification receipts bind the
  original CI candidate. Native receipts additionally bind the exact full Linux
  receipt. Early native input receipts route pending/failing descendants but
  cannot qualify them.

  After canonical CI validation, inspect all host run states before receipt
  validation. Report simultaneous pending and failed gates with current-attempt
  links and candidate versions. Diagnostics never grant publication authority.

  Summaries distinguish waiting, blocked, ready and sources without generated
  releases. Blocked evidence returns nonzero. Manual reconciliation also returns
  nonzero while waiting. Every existing receipt and supersession check remains
  required before readiness.

  Canonical source must be an eligible generated release with no pending
  changesets. Feature source and stale release plans cannot receive readiness,
  even when all execution evidence passed. Every protected publication retains
  complete CI, Linux, Apple Silicon and native-client qualification.

  Required CI job names match the current workflow, including Python reporting.
  Candidate acquisition imports readiness validators statically so the CLI cannot deadlock on a circular dynamic import.

  Snapshots bind successful runs/jobs/attempts and artifact identities so the
  isolated trusted publisher can revalidate after queueing and before mutation.

  Native descendant discovery bounds creation history at the earliest verified
  main-push CI run for the exact source, preserving older reruns that acquire a
  newer producer. Manual native runs use a separate exact-source/main/dispatch
  query because protected queues can precede candidate acquisition. Union run
  IDs before the unchanged newest-match and receipt checks. Validate creation
  timestamps, keep inclusive boundaries and refuse incomplete bounded
  pagination.
- `provision-github-rootless-host.sh` owns provision, cleanup, and clean-state
  assertions for that runner.
- `provision-example-smoke.sh` prepares the dedicated Linux example shard.
  It installs the exact official Codex 0.152.1 package after digest verification,
  preserving its executable/resource layout. It creates one private local HTTPS
  certificate and installs its CA through ordinary disposable-host trust.
  The runner receives only executable, certificate and key paths.
  Delete the signing key after certificate creation. Never retain TLS keys in
  CI artifacts or pass live model credentials.

  The complete `linux-host/example-smoke.test.ts` file belongs only to the
  canonical `examples` shard. Ordinary source files follow the measured scheduling
  policy. This shard uses real acquisition, native execution and cleanup, with ordinary
  source and candidate verification. The aggregate and release readiness require
  its current-attempt proof alongside the other Linux shards.
- `qualify-macos-host.sh` owns the exact selected Intel 23E224, Intel/Apple
  Silicon 24G830, and Apple Silicon 24H232 profiles. The hosted pool admits Intel
  24G830 and either exact Apple Silicon 24G830 or 24H232 tuple.

  It owns Bun 1.4.2 and real Node 22+
  preflight, and frozen same-revision host/model/renderer archives with digest
  rechecks. It owns ordinary native npm installation through the same fresh full
  Jig package-smoke consumer. That consumer verifies the matching optional
  runtime and CLI. The script also owns sequential native tests, standalone
  display consumers, and comparison of owned host residue before and after
  qualification. Mount evidence includes explicit lowercase `jig-` paths and
  automatic `/Volumes/Jig-` native volumes, including duplicate-name suffixes.

  Observed paths never authorize cleanup or detachment. Its full mode remains
  the self-hosted entrypoint. Hosted `--shard` runs one isolated portion of the
  same complete suite: four Intel shards or one complete Apple Silicon host.
  Shard zero runs native prerequisites and the final shard runs installed
  consumer and genuine-client checks on each architecture. Both roles run once
  on the single Apple Silicon host.

  The full Jig package smoke
  receives `JIG_PACKAGE_SMOKE_DIAGNOSTIC_DIRECTORY` only from the existing Mac
  evidence directory. Its flat exclusive mode-0600 JSON retains closed
  failed-command metadata.

  The existing JSON upload pattern carries it on failure. Raw command
  transcripts and private consumer trees stay outside hosted artifacts. Metadata
  is diagnostic, never cleanup or qualification. Hosted qualification consumes
  `JIG_CI_CANDIDATE_DIRECTORY` after verifying provenance and copies its exact
  archives. Ordinary platform source builds remain separate. Full self-hosted
  local mode uses the owning local packers.

  An existing `JIG_MACOS_TEST_TIMINGS_DIRECTORY` selection enables
  `JIG_HOST_TEST_TIMING=1` for checkpoint, workspace and foundation fixture
  diagnostics. Their closed wall intervals and bounded profile projections appear
  in the existing job log. Timing changes no deadlines, inventories or outcomes.

  The workflow reallocates the former two Apple Silicon jobs' allowance to one
  complete host, with a smaller aggregate allowance and shared setup. Per-test
  and product deadlines stay unchanged. The exact allocations belong to
  `.github/AGENTS.md` and the workflow.
- `macos-host-test-shards.mjs` obtains full Mac membership from the shared suite
  catalog, retaining portable files until a separate audit proves host
  neutrality. Eight native prerequisite files run once on shard zero and genuine
  installed startup runs separately on the final shard. Every other selected
  file runs once in a fresh sequential process, without name filters.
  `.node.mjs` files use verified Node. Other files use Bun. Both runtimes retain
  exact file identities in their JUnit reports.

  `host-test-durations.json` retains source-bound successful whole-file timing
  observations and their source, run, attempt and job identities. Split incident
  scenarios retain complete case observations and an explicit per-file startup
  allowance until fresh whole-file observations replace those estimates.

  `host-test-scheduling.mjs` balances complete files on Linux and Mac, including
  native and installed tail costs. Timings affect placement, never membership,
  limits or qualification. Unknown lifecycle files reserve
  sixty seconds. Other unknown files reserve two seconds.

  After balancing, each shard runs its
  `macos-native` whole files before long application scenarios, preserving order
  within both partitions.

  This exposes primitive failures early without moving files between runners or
  changing weights, commands, limits or qualification obligations.
- `merge-attempts.mjs` selects the newest authoritative execution of each named
  job without falling back from failures. `merge-retry.mjs` owns PR CI input
  acquisition and per-job evidence across attempts within one original run.
  It downloads immutable artifact IDs and verifies ZIP transport hashes before
  extraction.

  Native PR acquisition may retain that run's original successful canonical
  producer. Each native shard still executes and reports freshly. Main/manual
  candidate acquisition and release readiness remain current-attempt.

  Hosted runner family and architecture must match the job's fixed label.
  Exact image build versions are retained observations of that execution.

  GitHub may copy successful checks into later attempts with new IDs after
  their original execution ended. Such copies require one earlier successful
  execution with identical timestamps, runner identity, labels and complete step
  observations. Receipts retain that original job ID and attempt. Missing or
  ambiguous origins refuse reuse. Later actual failures remain authoritative.

  After verifying merge identity, runtime profiles, target coverage and immutable
  inputs, the collector summarizes current and retained job executions.
  It records their attempts, job IDs and evidence artifact IDs.
  Summary output is diagnostic. Its absence cannot alter the retained receipt
  or grant execution credit. No saved-duration estimate is inferred.
- `test-reports.mjs` owns the shared JUnit case reader for source/job evidence
  and Mac reports. It rejects empty, failed, skipped, incomplete or
  duplicate-case reports. Each consumer enforces its owning file inventory. The
  Mac validator reconstructs the complete source-pinned shard plan and reads
  every owning report and completion marker once.

  Every shard's retained prerequisites must match an exact admitted architecture,
  kernel, build and Bun tuple. A complete architecture plan must use one observed
  tuple. Its summary and retained qualification artifact name that tuple, without
  extending qualification to another admitted build.

  Linux Bun commands retain their stdout parser. Linux Node commands retain
  exact single-file JUnit reports
  beside their transcripts. Installed scripts retain completion markers.
  `macos-host-summary.py` projects validated Mac counts and optional job timing.

  It does not implement another XML or plan validator. Timing cannot grant or
  remove qualification. The evidence writer consumes that owning summary without
  reparsing Mac reports.
- The matching Linux and Mac host-conformance workflows own runner selection.
- `npm-candidate-preflight.mjs` checks a frozen candidate's source revision,
  digest and manifest, then compares any existing exact public npm version's
  whole archive bytes. A verified canonical pending changeset may defer this
  comparison only for its covered Jig-owned package. The required release-impact
  check independently verifies the PR's new coverage. FLOW and final generated
  versions retain the complete registry check. Only an explicit registry E404
  means unpublished. It executes no package code, publishes nothing, and cannot
  replace the protected publisher's later group and channel reconciliation.
- `macos-host-profiles.mjs` declares each architecture's finite pool of exact
  hosted kernel, build and Bun tuples. The suite catalog retains each target's
  complete file inventory. The Apple Silicon pool includes both builds observed
  during GitHub's image rollout. One complete host executes its full plan, so a
  mixed pool cannot combine partial results from different builds.

  The Apple Silicon execution profile names its architecture and pinned Bun,
  rather than one configured build. Its canonical G/H inventory is identical.
  Complete evidence establishes only the observed build's qualification.
  Prerequisite files are opened once with no-follow and nonblocking flags.
  The descriptor must name a regular file, and reads stop at 8,193 bytes to
  enforce the 8,192-byte limit even if the file grows.
- `probe-macos-host.ts` observes native process identity and coalition
  accounting prerequisites. Hosted mode rejects target drift before native
  compilation and source builds. Failed target checks retain the observed tuple.
  Prerequisites start no package work and never establish backend qualification.
- `install-macos-test-clients.ts` extracts digest-pinned native Codex, Claude
  and Pi archives into a fresh runner-owned directory for offline startup
  qualification. It neither executes clients nor provisions consumer machines.
  Acquisition allows three attempts with a two-minute deadline per request/body
  and one-/two-second backoff. HTTP status and attempt diagnostics go to stderr.
  Stdout contains only environment assignments. Digest mismatch fails
  immediately before extraction.

  Retries never substitute a version, mirror or client.

## Local Contracts

- Every executing job runs its selected physical suites freshly. PR CI alone may
  retain a completed successful job from an earlier attempt of the same workflow
  run. `merge-retry.mjs` verifies the exact tested merge source, workflow digest,
  job ID and attempt, and declared runtime profile. It requires complete
  target/profile inventories and unchanged input artifact IDs and transport
  digests.

  Workflow digests hash the Git blob at the exact tested revision. Checkout
  line endings cannot change this identity.

  The latest job execution wins. A later failed or incomplete job cannot inherit
  green. Rebuilt inputs invalidate dependent reports even at the same source
  revision.

  Never reuse consumer installations, native execution, cleanup or live-client
  qualification. Host, main and manual qualification still require complete
  current-attempt coverage. Merge-only receipts cannot qualify publication.
  Native jobs omitted for an independent PR cannot qualify publication.
- Canonical artifacts use `candidates-SHA-rRUN-aATTEMPT`. Host shard evidence
  and qualification artifacts also include run and attempt. Every host shard
  compares the canonical candidate metadata and unchanged archives after
  execution. Full host aggregates require all current-attempt shards. Qualification
  artifacts contain root `QUALIFICATION.json`. Early native lineage uses root
  `INPUTS.json`.

  Expired artifacts require a new candidate and fresh requalification. Never mix
  an old native or host receipt with a rebuilt candidate from the same source.
- Mac qualification runs unprivileged without host provisioning. Require all
  three genuine native client paths for full qualification and the installed
  consumer shard. Missing prerequisites fail explicitly. Claude and Pi must
  complete offline startup. Codex must complete offline startup on Intel 23E224
  and return the explicit unsupported-preferences refusal on 24G830 and 24H232
  profiles. The selected path remains genuine and the case never skips.

  Qualification passes that expected outcome through
  `JIG_CODEX_MACOS_STARTUP_EXPECTATION`. The test independently checks the
  actual kernel profile before accepting it. Include the trusted preference
  observer in host residue comparisons. No model credentials or online model
  calls are part of this host check.
- Use `sudo` only while provisioning the disposable runner. Jig and package code
  run unprivileged.
- Keep fetched host tools version- and digest-pinned.
- Preserve the distinction between inherited and newly acquired cgroup
  authority, and require zero Jig residue at completion.
- Never expose privileged host controls to Flow or project code.

## Work Guidance

- Review the matching host-conformance workflow in the same change.

## Verification

- Workflow contract tests parse YAML 1.2 and check GitHub trigger keys and registry environments.
  They require the release-impact check in Quick and its existing aggregate.
  The check uses the verified Git comparison resolver before release validation.
  They check main-only version generation without registry authority, scoped App
  tokens, and the protected release PR merge policy.
  They require dependency execution in a read-only job and an immutable artifact handoff to a fresh writer.
  The writer validates prepared data before App token creation and installs no workspace dependencies.

  They execute the setup shell for absent, complete, and incomplete App
  configuration. They exercise failure summaries and successful PR handoffs
  without credentials or API calls. Generic failures must not imply an
  authentication or policy cause.

  They execute main Mac lane selection with real Node and check bounded native
  queues, independent workflow admission and preserved PR cancellation.

- `node --test scripts/ci/release-base.test.mjs` exercises real Git comparisons,
  advancing PR bases, push ranges, manual parents, and invalid event identities.
  Release-plan integration tests reject stale generated plans after an empty
  base advance. They preserve feature coverage after unrelated main version changes.
- `node --test scripts/ci/*.test.mjs` includes disposable Git fixtures for suite
  discovery, exact PR merge state, independent input scope and failed or forged
  host-job results. Archive/API fixtures cover source/run/attempt/profile/digest
  drift, forks, expiry, reruns, descendant SHA drift and failed host gates
  beside independent FLOW readiness.
- Inspect every workflow's permissions, executable modes, profile inventory,
  attempt-specific artifact flow and final gate when changing these interfaces.
- `node --test scripts/ci/merge-retry.test.mjs` exercises complete PR CI
  aggregation through real ZIP transports. One matrix job is retried while
  other successful job evidence remains bound to unchanged inputs. Rejections
  cover source, job, workflow, profile and input drift. They also cover later
  failures, expired or foreign artifacts, transport changes, incomplete
  inventories and attempt races. Candidate-transfer tests retain strict main
  behavior and exercise native PR acquisition after a CI-only retry.
- `node --test scripts/ci/source-stages.test.mjs` checks serial order, failure
  propagation, canonical-input reuse and protocol-only prerequisites through the
  actual source shell with controlled tools on Bash and POSIX sh.
  It executes actual Node tests through the owning reporter and Python merger.
  It also checks both source inventories through the root test recipe.
- Exercise provision, the hostile suite, cleanup, and `assert-clean` on a
  disposable supported runner.
- `node --test scripts/ci/host-test-coverage.test.mjs` verifies exhaustive Mac
  file assignment, including each display package and future files. It verifies
  whole-file profile assignment and balanced scheduling using synthetic weights
  and out-of-file costs. It does not freeze measured timing hints. Workflow role
  checks parse YAML and inspect commands, conditions and evidence contexts
  rather than indentation, scalar quoting or step names. Exact Codex
  startup/refusal host selection without running native clients, and that every
  Linux hostile test file enters provisioned host conformance.
- `node --test scripts/ci/macos-host-summary.test.mjs` exercises both
  architecture aggregates, nested reports, installed-client evidence, duplicate
  execution, missing/cancelled/stale proof and optional timing failures.
- `node --test scripts/ci/macos-host-profiles.test.mjs` checks the exact admitted
  tuples, neighboring kernel and toolchain refusal, and complete prerequisite
  evidence. Ordinary input records establish no native qualification.
- `node --test scripts/ci/macos-candidate-archives.test.mjs` executes the
  qualifier's actual archive staging and revalidation sections with real tools.
  It checks isolated copies, ambiguous archives and changed bytes without native qualification claims.
- `node --test scripts/ci/npm-candidate-preflight.test.mjs` verifies unpublished
  and identical versions, immutable collisions, registry errors and changed
  candidate evidence without credentials or registry mutations. It also checks
  pending package coverage, strict final-version and FLOW comparisons, and
  refusal of malformed canonical release evidence.
- `node --test scripts/ci/promote-directory.test.mjs` verifies exact directory
  promotion and preservation of existing or racing outputs on Linux and Mac.
- `node --test scripts/ci/install-macos-test-clients.test.mjs` exercises bounded
  acquisition through Bun against a local server, including HTTP/network/body
  failures, exhaustion, both digest formats and changed-byte refusal.

## Child DOX Index

- None.
