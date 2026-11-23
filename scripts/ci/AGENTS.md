# CI host provisioning

## Purpose

Owns whole-file suite coverage, immutable candidate provenance, observed CI
evidence and release readiness, plus disposable Linux and native Mac proof. Host
preparation never becomes a consumer requirement.

## Ownership

- `../example-inventory.mjs` requires every direct example directory to retain
  its manifest, project definition and application tests. Its host-suite mapping
  must remain selected by Linux and the Mac target. Application suite ownership
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
- `host-scope.mjs` selects complete Linux and Apple Silicon qualification.
  A verified two-parent PR merge can omit native jobs for an entirely independent delta. That delta must contain only site
  files, non-specification documentation, Python SDK/reporting files, or
  reviewed root/agent guidance. The shared Reporting descriptor remains a native
  input. Source, build, workflow, specification, mixed, unknown or unverifiable
  inputs require complete Linux and Apple Silicon. Manual execution is always full.

  Linux main pushes remain complete, preserving native diagnostics' upstream lineage.
  Verified feature, pending and stale main sources omit Mac jobs.
  Eligible generated releases and unknown eligibility require complete qualification.
  The selector verifies the main ref, repository and exact push SHA before reading source-pinned release metadata.

  Final `affected-linux` and `affected-macos` checks
  independently reconstruct this decision and require complete observed native qualification or explicit omission.
  The collector verifies selected workers for PRs and the complete major matrix for other events.
  Raw candidate results grant no qualification.

  An omitted PR or nonrelease Mac main source creates no host qualification receipt.
  Apple Silicon is the supported Mac architecture. Nightly diagnostics retain complete oldest/current major coverage without granting release readiness.

- `skill-reference-changes.mjs` transfers generated references as inert data between read-only generation and a fresh trusted writer.
  Bind every transfer to its exact PR source and originating workflow run and attempt.
  Explicit source identity remains distinct from the writer's own run identity.
  Admit only regular files under `skills/*/reference/`, preserving original blob identities and rejecting linked ancestors.
  Build the replacement Git tree with a temporary index, without checking out or executing PR code.

  The workflow commits that tree as a direct child and uses an exact branch lease.
  Concurrent updates and resets must remain untouched.
- `skill-reference-run.mjs` selects a successful same-repository PR producer from current GitHub metadata.
  It verifies the workflow path, source, attempt, and one matching open PR into the default branch.
  Missing PR associations and associations with newer heads omit writing and report that no changes were written.
  Malformed producers and ambiguous associations still fail. Required Quick checks continue to enforce committed reference freshness.

  It reuses candidate-transfer helpers for exact artifact selection, digest verification, and safe inert extraction.
  Producer or PR changes during transfer prevent writing.
  Missing artifacts indicate no prepared changes and acquire no write authority.
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
  CI retains raw runtime reports beside successful merged reports.
  Node also prints readable failure details into the existing job transcript.
  Raw reports remain diagnostic and cannot supply successful stage evidence.

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
  before refusing an unsuccessful CI aggregate.
  Its separate diagnostic report preserves raw failed results and optional current-attempt GitHub job conclusions.
  An `abandoned` needs result remains unsuccessful even when the API reports `cancelled`.
  A cancelled job with an explicitly empty runner and step list
  is reported as unassigned. Missing observations never establish that cause.

  Observations cannot qualify execution, bypass evidence validation or change
  required job outcomes. API unavailability leaves them absent.
- `native-preflight.mjs` validates an explicitly reviewed open PR merge and its canonical CI producer.
  Trusted main-workflow code repeats selection after protected approval and verifies exact artifact transport and source.
  Require a current-head approval from an independent reviewer with repository write permission.
  Reject dismissed or stale approvals and outstanding change requests. Read every review page within the bounded API budget.

  Recheck approval immediately before the key-bearing step. Only trusted workflow-revision scripts and harnesses execute there.
  Forks, stale merge revisions, foreign workflows and producer attempt changes refuse diagnosis.
  This diagnostic creates no native qualification receipt and cannot authorize publication.
- `native-responses-probe.mjs` observes the existing free Responses endpoint
  once after a Codex qualification test command fails. It sends one fixed
  prompt with a 32-token output cap and `store:false`, without retry or
  endpoint/model overrides. This bounded availability request differs from the
  native uncapped request and cannot establish native compatibility.

  One 30-second deadline covers acquisition and streaming. The workflow bounds
  the Node process separately at 30 seconds, with two seconds for forced exit.
  Response input stops at 64 KiB. Output contains only actual HTTP status, a listed numeric provider
  error code and a closed terminal observation.

  The original native exit status remains authoritative. This fresh diagnostic
  call does not replay the failed operation or establish qualification. It does
  not retain raw bodies, error messages, headers or response identifiers.
- `ci-performance.mjs` reports workflow, queue and execution intervals from
  read-only GitHub metadata. It separates pre-job delay from job queues and
  preserves every attempt's observed conclusions. Job queues combine concurrency
  and runner allocation waits without identifying either cause. Event-head groups provide
  diagnostic workflow envelopes without establishing tested merge identity.

  PR envelope reporting includes P95, maximum, and 25-minute breaches.
  Preserve failed, cancelled, incomplete and ambiguous groups in the denominator.
  Separate runs with and without retries. Measure from original workflow creation
  through observed completion, without claiming exact push or merge-ready latency.

  Earlier successful jobs retained in the latest history supply observed runner
  time only. Receipt acceptance and hypothetical latency savings remain unproved.
  Copied successful checks contribute no execution time. Their unique observed
  origin, missing origin or ambiguous origins remain explicit diagnostics.

  The report infers no flake rate and changes no scheduling weights or qualification.
  Collection refuses incomplete pagination, changing runs and excessive windows.
  It requires GitHub CLI read access and permits windows of at most 31 days.

  Collection sets its budget from remaining core API requests at startup,
  leaving 500 for qualification and permitting at most 200 reads.
  It checks the window's minimum request cost
  before collecting individual run histories. Insufficient budget refuses the
  complete report without sampling. Use a narrower manual window after refusal.
- `qualified-bun.json` owns qualified Bun metadata. It defines the runtime
  version, revision, platform, architecture, and exact Just version for builds
  and checks.
- `bump-qualified-bun.ts` automates workspace-wide qualified Bun upgrades,
  reconciling metadata, package dependencies, workflows, documentation,
  fixtures, and changesets from an exact version and tag revision.
- `build-candidates.mjs` archives clean tracked source and freezes seven Jig-owned npm archives and the published FLOW dependency. It uses qualified native Linux x64 Bun 1.4.4/Just 1.43.1, normal
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

  Producer readiness has one absolute deadline, including job queues.
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

  Native automation checks `releaseState` against the exact triggering source before allocating protected client jobs.
  The scope validator executes from the trusted workflow revision, while release metadata comes from the exact triggering Git revision.
  Workflow tests reject fork, PR, failed and non-main events at each native checkout boundary.

  Only eligible generated releases start automatically. Explicit manual dispatch on main retains diagnostic qualification for nonrelease sources.
  Omission emits no native receipt and cannot satisfy publication.
  Both native clients must qualify with verified candidate and Linux lineage.

  Codex stops after its first failing case. A successful file still requires its complete inventory, including the installed conversation case.

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

  The collector-to-publisher regression requires four runs and five artifacts from the actual readiness output.
  Missing or extra artifacts refuse publication.
  Snapshots bind successful runs/jobs/attempts and artifact identities so the
  isolated trusted publisher can revalidate after queueing and before mutation.
  Exercise the actual readiness snapshot against the workflow's admission guard.
  Reject missing and extra artifacts before registry access.

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
  It installs the exact official Codex 0.166.0 package after digest verification,
  preserving its executable/resource layout. Its fixed public asset download retries transport failures within the existing attempt and time limits.
  TLS and digest checks remain mandatory before extraction.

  It creates one private local HTTPS
  certificate and installs its CA through ordinary disposable-host trust.
  The runner receives only executable, certificate and key paths.
  Delete the signing key after certificate creation. Never retain TLS keys in
  CI artifacts or pass live model credentials.

  The complete `linux-host/example-smoke.test.ts` file belongs only to the
  canonical `examples` shard. Ordinary source files follow the measured scheduling
  policy. This shard uses real acquisition, native execution and cleanup, with ordinary
  source and candidate verification. The aggregate and release readiness require
  its current-attempt proof alongside the other Linux shards.
- `qualify-macos-host.sh` owns Apple Silicon qualification on macOS 15 and later with pinned Bun and verified Node.
  It verifies same-source frozen archives, sequential native execution, installed consumers, genuine offline clients, and host residue.
  Mount observations include explicit lowercase `jig-` paths and automatic `/Volumes/Jig-` volumes.
  Observations never authorize cleanup or detachment.
  Hosted shards consume one frozen plan. Every worker runs native prerequisites, and the installed owner runs consumer checks.

  The full Jig package smoke receives `JIG_PACKAGE_SMOKE_DIAGNOSTIC_DIRECTORY`
  from the existing Mac evidence directory or Linux's installed-evidence command directory.
  Linux selects its canonical same-user, mode-0700 `linux-command-evidence` directory.
  The command-scoped selection does not reach later commands or Flow input.
  Exclusive mode-0600 JSON retains closed failed-command metadata.
  Fixed mapped-files leaf and composed profiles retain bounded phases, timings, outcomes, and allowlisted causes.

  Existing Mac upload patterns and Linux's seven-day host evidence artifact retain these bounded files.
  Raw private command transcripts and consumer trees stay outside hosted artifacts.
  Diagnostics establish neither cleanup nor qualification. Hosted qualification consumes
  `JIG_CI_CANDIDATE_DIRECTORY` after verifying provenance and copies its exact
  archives. Ordinary platform source builds remain separate. Full self-hosted
  local mode uses the owning local packers.

  An existing `JIG_MACOS_TEST_TIMINGS_DIRECTORY` selection enables
  `JIG_HOST_TEST_TIMING=1` for checkpoint, workspace and foundation fixture
  diagnostics. Their closed wall intervals and bounded profile projections appear
  in the existing job log. Timing changes no deadlines, inventories or outcomes.

  Per-test and product deadlines stay unchanged. Each assigned PR worker has its own execution allowance.
  Queue observations and execution ceilings remain separate.
  Exact allocations belong to `.github/AGENTS.md` and the workflow.
- `macos-host-test-shards.mjs` obtains full Mac membership from the shared suite
  catalog, retaining portable files until a separate audit proves host
  neutrality. Eleven native prerequisite files run on every worker, including
  the genuine Codex preference observer and its inherited-sandbox and payload
  boundaries. Installed startup runs separately on the final shard. Every other selected
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
- The Mac planner freezes complete inventory, source, policy, balanced groups, and digest before execution.
  Target duration and minimum/maximum capacity determine useful shard count. New files enter discovery automatically.

  The default permits up to three useful workers. The PR workflow permits a
  fourth when the three-worker plan exceeds the target. Timing observations
  affect placement, never required coverage.
  Every worker and collector independently validate the frozen plan against source inventory.
  Frozen plans are bounded regular files read through one no-follow, nonblocking descriptor.

  The default planning target is 1,200 estimated seconds.
  Every worker reserves 59 estimated seconds for native checks. One installed owner reserves 315 estimated seconds for consumer work.
  These placement estimates establish no measured turnaround guarantee.
- `mac-command-budget.mjs` bounds worker commands and reserves cleanup and evidence time before the GitHub job backstop.
  It verifies the current assigned execution before establishing the absolute deadline.
  Child process groups settle after completion or failure. Expired work cannot publish a completion marker.
- `macos-pr-race.mjs` selects PR workers before native work. Candidates publish unique readiness offers.
  One Ubuntu selector per role publishes a decision bound to its actual execution and the chosen offer's immutable ID and digest.
  Both records bind source, run, attempt, allocated worker, frozen plan and prepared inputs.
  Artifact names do not provide mutual exclusion. Duplicate decisions, unverified transport and mismatched identities refuse.

  A listed artifact may not yet have a readable archive. Transient archive reads remain pending under the original observation deadline.
  API transport retries allow at most three reads with one-second backoff. Authorization, record, digest and identity failures remain fatal.

  Candidates wait for their role's decision. Failed selected workers cannot inherit another OS's success.
  Selectors watch their chosen worker so failed-job retries include failed roles.
  Verified retention no-ops preserve successful reports when only another role needs retrying.
  Rebuilt inputs exclude decisions older than the actual preparation attempt.
  No installation, native owner, mutable fixture or Jig Run is retained.
- `macos-qualification.mjs` validates the source-bound plan, required compatibility majors, and original execution identities in release receipts.
  Explicit PR scope requires one selected physical execution per shard. Strict release scope requires every shard on both majors.
  Publication validators reject PR coverage, including attempts to relabel a mixed-major union as complete release coverage.
  Release readiness derives required job names from this complete receipt and verifies actual current-attempt job identities.
- `macos-host-collect.mjs` reconciles immutable per-shard artifacts against the complete plan for every required macOS major.
  It rejects missing or failed reports, changed inputs, foreign jobs, ambiguous artifacts, and unconfirmed completion.
  GitHub metadata reads reuse the selector's bounded transport retries, including HTTP 5xx and HTTP/2 stream cancellation, before validating the response.
  PR failed-job retries may retain successful shard evidence within the original run and unchanged qualification session.
  A queued retry of a selected worker keeps collection pending before it receives a runner.
  An unrelated queued candidate does not delay an accepted winner.

  The latest actual execution is authoritative. Later failures cannot fall back to earlier green.
  Original execution IDs, attempts, timestamps, and artifact identities remain visible.

  Main and release qualification require fresh current-attempt coverage.
  This retains test evidence only. Jig Runs, installations, owners, and mutable fixtures are never reused.

  The collector has no dependency on the raw candidate matrix. PR observation is bounded to forty minutes with a forty-five-minute job backstop.
  Strict dual-major observation allows eighty minutes, or 170 minutes with optional startup profiling, with ninety- or 180-minute job backstops.
  These bounds cover sequential capacity waves and establish no turnaround guarantee.

  It does not wait for unused PR candidates. It retains original worker, selector, decision and evidence identities and verifies each worker's decision copy.
  Decision caching retains immutable bytes only. Current retention and metadata are revalidated.

- `merge-attempts.mjs` selects the newest authoritative execution of each named
  job without falling back from failures. `merge-retry.mjs` owns PR CI input
  acquisition and per-job evidence across attempts within one original run.
  It downloads immutable artifact IDs and verifies ZIP transport hashes before
  extraction.
  PR CI metadata and archive reads reuse the bounded GitHub transport policy of
  three attempts with one-second backoff. Validation of artifact identity,
  digest, receipt and coverage remains fail-closed.

  Native PR acquisition may retain that run's original successful canonical
  producer. Newly executing native shards always use fresh fixtures. Main/manual
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

  `readMacReports` reconciles the frozen source inventory across every required shard.
  Every shard supplies a complete native baseline. Unique file coverage and repeated native executions remain distinct counts.
  Each observed host retains its architecture, kernel, build, and pinned Bun revision.

  Patch-build equality across workers is unnecessary. Strict major reports require every host to match that major.
  Explicit PR reports require one selected supported major per frozen shard and validate each actual host against that selection.

  Linux Bun commands retain their stdout parser. Linux Node commands retain
  exact single-file JUnit reports
  beside their transcripts. Installed scripts retain completion markers.
  The collector projects validated file counts, case counts, original job identities, and timing into its summary.
  Timing cannot grant or remove qualification. The evidence writer consumes the validated summary without reparsing reports.
- The matching Linux and Mac host-conformance workflows own runner selection.
- `npm-candidate-preflight.mjs` checks a frozen candidate's source revision,
  digest and manifest, then compares any existing exact public npm version's
  whole archive bytes. A verified canonical pending changeset may defer this
  comparison only for its covered Jig-owned package. The required release-impact
  check independently verifies the PR's new coverage. FLOW and final generated
  versions retain the complete registry check. Only an explicit registry E404
  means unpublished. It executes no package code, publishes nothing, and cannot
  replace the protected publisher's later group and channel reconciliation.
- `macos-host-profiles.mjs` validates Apple Silicon behavioral prerequisites and pinned Bun, without an exact OS-build allowlist.
  Release compatibility covers macOS 15 and macOS 26. Native baselines establish enforcement on every executing worker.
  Observed kernel and build remain retained evidence, without certifying arbitrary future versions.
  Prerequisite reads use no-follow and nonblocking descriptors. Bounded regular files remain mandatory.
- `probe-macos-host.ts` observes native process identity and coalition
  accounting prerequisites. Hosted mode rejects target drift before native
  compilation and source builds. Failed target checks retain the observed tuple.
  Prerequisites start no package work and never establish backend qualification.
- `install-macos-test-clients.ts` extracts digest-pinned native Codex and Claude
  archives into a fresh runner-owned directory for offline startup
  qualification. It neither executes clients nor provisions consumer machines.
  Acquisition allows three attempts with a two-minute deadline per request/body
  and one-/two-second backoff. HTTP status and attempt diagnostics go to stderr.
  Stdout contains only environment assignments. Digest mismatch fails
  immediately before extraction.

  Retries never substitute a version, mirror or client.

## Diagnostic observations

- `orchestration-probe.mjs` dispatches one isolated main-only child and observes actual queued-sibling cancellation.
  It validates the child identity and requires an unallocated sibling with no executed steps.
  It reports cancellation settlement separately from execution and requests cleanup on failure.

  Failure summaries retain the closed observation phase, verified child link, queue observation, and cleanup acknowledgement without response bodies or credentials.
  Cleanup verifies the run ID, parent marker, repository, workflow, main branch, and dispatch event before requesting cancellation.
  A cancellation acknowledgement does not establish settlement. Diagnostic retention cannot replace the original verdict.
  HTTP 409 cleanup conflicts require a fresh completed observation of the same child ID, source, and attempt.
  The probe uses no Mac runners, product tests, publication inputs, or host qualification receipts.
- Host scope summaries distinguish required execution, verified completion, and intentional omission.
  Omitted native work supplies no execution credit. Readiness summaries distinguish nonrelease sources from pending qualification.

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

  Never reuse consumer installations, live owners, mutable fixtures, or live-client qualification.
  PR Mac retries may retain verified complete shard receipts within their original run.
  Main and release host qualification require complete current-attempt coverage. Merge-only receipts cannot qualify publication.
  Native jobs omitted for an independent PR cannot qualify publication.
- Canonical artifacts use `candidates-SHA-rRUN-aATTEMPT`. Host shard evidence
  and qualification artifacts also include run and attempt. Every host shard
  compares the canonical candidate metadata and unchanged archives after
  execution. Full host aggregates require all current-attempt shards. Qualification
  artifacts contain root `QUALIFICATION.json`. Early native lineage uses root
  `INPUTS.json`.

  Expired artifacts require a new candidate and fresh requalification. Never mix
  an old native or host receipt with a rebuilt candidate from the same source.
- Mac qualification runs unprivileged without host provisioning. Require both
  genuine native client paths for full qualification and the installed
  consumer shard. Missing prerequisites fail explicitly. Codex and Claude
  must create genuine native sessions and confirm fencing and cleanup.
  Unsupported Codex refusal is not a passing alternative.

  The ARM Codex helper must use real framework calls and preserve forced-policy
  and inherited-sandbox refusals. Include its actual native boundary canaries
  and authenticated helper checks on macOS 15 and 26. Record the trusted
  observer in residue comparisons. Offline placeholder credentials do not prove
  subscription authentication, endpoint access or model execution.
  Actual forced-policy refusal and stalled-framework alarm expiry remain
  separate native evidence obligations. No injected result can satisfy them.
- Use `sudo` only while provisioning the disposable runner. Jig and package code
  run unprivileged.
- Keep fetched host tools version- and digest-pinned.
- Preserve the distinction between inherited and newly acquired cgroup
  authority, and require zero Jig residue at completion.
- Never expose privileged host controls to Flow or project code.

## Work Guidance

- Review the matching host-conformance workflow in the same change.

## Verification

- `node --test scripts/ci/skill-reference-*.test.mjs` checks generation, producer selection, and generated-data transfer.
  Real Git repositories exercise additions, removals, unchanged authored files, malformed transfers, and concurrent branch changes.
  Workflow checks cover fork refusal, credential separation, exact artifact selection, and missing App or base-tooling configuration.
  Metadata checks reject stale attempts, wrong workflows, foreign sources, closed PRs, retargeting, and expired or ambiguous artifacts.
- `node --test scripts/ci/sync-skills.test.mjs` exercises deterministic reference generation, drift detection, and standalone links.
  It verifies preserved examples, machine bytes, licenses, private-source refusals, and symbolic-link refusals.
  Real Git branches verify that independent documentation edits merge without generated checksum conflicts.
  Equivalent manifest formatting and source order must leave generated references unchanged.
  Trusted-tooling checks process a separate source checkout without executing its scripts.

- `node --test scripts/ci/ci-performance.test.mjs` checks actual snapshot CLI
  execution, independent timing intervals, partial retries, copied checks, failure classifications
  and ambiguous or foreign metadata refusal.
  Collect a report with `node scripts/ci/ci-performance.mjs --repository jiggy/jig --since 2026-10-30T00:00:00Z --until 2026-10-31T00:00:00Z`.
  Use explicit UTC bounds and redirect output into `.tmp/` when retaining reports.

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

  They execute generated Mac planning and check bounded useful concurrency, complete coverage, and preserved PR cancellation.

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
- `node --test scripts/ci/native-responses-probe.test.mjs` uses actual local
  HTTP responses to check streaming, error-code filtering, malformed input,
  response bounds and deadlines. The actual workflow hook preserves native and
  transcript failures independently of the diagnostic command's outcome.
- `node --test scripts/ci/merge-retry.test.mjs` exercises complete PR CI
  aggregation through real ZIP transports. One matrix job is retried while
  other successful job evidence remains bound to unchanged inputs. Rejections
  cover source, job, workflow, profile and input drift. They also cover later
  failures, expired or foreign artifacts, transport changes, incomplete
  inventories and attempt races. Candidate-transfer tests retain strict main
  behavior and exercise native PR acquisition after a CI-only retry.
  The PR CI CLI test retries transient metadata and ZIP reads and refuses
  persistent transport errors and corrupt archive bytes.
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
  rather than indentation, scalar quoting or step names. Policy tests check
  required genuine Codex startup without claiming native execution. They also
  require every Linux hostile test file in provisioned host conformance.
- `node --test scripts/ci/macos-host-collect.test.mjs` checks complete generated matrices and original-run retry lineage.
  It rejects changed inputs, failed latest executions, missing shards, and stale qualification sessions.
  The collector CLI test verifies recovery from a transient GitHub jobs response before evidence validation.
- `node --test scripts/ci/macos-pr-race.test.mjs scripts/ci/macos-qualification.test.mjs` verifies bounded offers and sole-writer decisions, pre-test worker selection, failed-winner refusal, retry no-ops and explicit mixed-major PR scope.
  Real ZIP transports test record digests and exact contents. These portable checks establish no native enforcement or GitHub service atomicity.
- `node --test scripts/ci/macos-host-profiles.test.mjs` checks behavioral prerequisites, pinned runtimes, unsupported architecture refusal, and bounded evidence. Ordinary input records establish no native qualification.
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
