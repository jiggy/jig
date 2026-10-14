# Repository automation

## Purpose

Owns CI, host-conformance, package publication, and public-site workflows.

## Ownership

- FLOW specifications, SDKs, conformance, and independent authoring release from `jiggy/flow`.
- This repository freezes released FLOW inputs for Jig qualification. It never publishes FLOW packages.
- Pages builds and deploys Jig directly. No deployment dispatch repository is required.


- `workflows/` owns automation triggers, permissions, jobs, and retained
  artifacts.
- Checked-in justfiles and scripts own reusable build and test logic.

## Local Contracts

- Pin third-party actions by full commit.
- Install Just 1.43.1 in jobs that build packages or sites. The protected npm
  publisher consumes existing archives and requires neither Just nor source.
- Grant each job only the authority it needs. Build jobs must not inherit
  publication or Git-write authority.
- The separate Native Agent API Qualification workflow runs after successful
  Linux Host Conformance on each `main` push. Manual dispatch on `main` uses
  that revision's successful push-run host artifacts. It qualifies Codex and
  Claude Code from `@latest` and the currently supported Pi 0.84.4 standalone
  profile. Codex uses free OpenRouter routing for uncapped Responses requests.
  Claude and Pi use Mistral BYOK through their native API protocols. These are
  qualification inputs, not product defaults.

  Keep the OpenRouter key only in the dedicated test step of the protected
  `native-agent-api` environment. Never expose it to PRs or artifact builds.
  Configure Mistral BYOK to never use shared capacity for that provider so
  exhausted BYOK quota fails instead of using billable OpenRouter capacity.
- Build, test, publish, and tag the exact triggering source and retained
  candidate bytes. Never rebuild a release during publication.
- Linux Host Conformance's optional `workflow_dispatch` input
  `include_startup_profile` runs a bounded startup diagnostic inside the
  installed-evidence host shard, against the exact frozen archives. It is
  explicitly non-gating for the `rootless-linux` check. The host's final
  archive-identity and zero-residue assertions remain mandatory. Retain only its
  bounded mode-0600 profile artifacts for seven days. It performs no model calls
  and does not establish a performance claim. Its 60-minute shard allows the
  30-minute profile command budget to finish before mandatory cleanup.
- CI freezes one canonical eight-package npm bundle and checked Python
  distributions before installed qualification. Source, Linux, hosted Mac and
  native Agent consumers use the same npm bytes. Jobs executing source tests
  build their platform's source workspace separately. Protected publishers
  download the exact original CI artifact by immutable artifact ID. They never
  rebuild a release.
- CI reports quick development/release checks and site builds independently of
  the longer source suite. Candidate jobs retain their archives, then check
  exact public registry bytes read-only so a reused version fails before merge.
  This does not replace publication's complete group preflight and rechecks.
  Preserve `test` as a fail-closed aggregate of every CI job and its observed
  full inventory. Each job must finish successfully with nonempty proof and
  complete profiles. Main and manual runs require complete host coverage.
- npm publication covers HTTP Agent, ACP Agent and Jig, in that dependency
  order, after same-revision CI, host and native gates. FLOW releases from its
  own repository. First publication requires each package's npm setup.

  Installed qualification installs its required tooling without rebuilding
  source packages. Generated implementation comes from the frozen archives.
  Jig's CI receipt records standalone display and packed CLI smokes plus
  ordinary local and global npm checks, without provisioning a containment host.
  Actual native Runs, operational and hostile baselines execute once in Linux's
  installed-evidence shard and remain required for host publication.
- Before any npm mutation, inspect every archive, exact registry version and
  channel tag in the selected release group. Existing versions require byte
  identity even if a newer tag exists. Absent older versions are superseded
  without publication, tags, or releases. Recheck registry state before each
  ordered mutation.
- Publish Agent/Jig npm candidates only after all required gates succeed for the
  exact source revision. These gates are CI, complete Linux Host Conformance,
  complete hosted Intel and Apple Silicon Mac conformance, and Native Agent API
  Qualification. Preflight every selected host archive before mutation.
- CI runs its complete fixed source, site, Python and npm profiles. Source
  targets run serially in one workspace after shared builds and archive
  freezing, with separate complete reports for each stage. A failed stage stops
  later work. Installed smoke checks use the canonical candidate profiles.
- Host workflows always report `affected-linux` and `affected-macos` for PRs. A
  small verified-Git scope check can omit native jobs for independent site,
  non-specification documentation or Python changes. The shared Reporting
  descriptor, source, build, workflow, specifications, mixed and uncertain
  changes run complete hosts. Main and manual runs are always complete. An
  omission records its source and reason and creates no qualification receipt.
  Final gates reconstruct scope and reject any missing, failed or cancelled
  required job.

  Keep these checks and `test` in merge policy. There are no selection modes,
  temporary benchmark predicates, compact witness jobs or scheduled audit runs.

- Model and web/TUI display packages enter dependency ownership, source and host
  test inventories, and frozen standalone artifact gates. Their
  JavaScript/assets are bundled into Jig. Protected publisher package selection
  remains unchanged.
- Jig GitHub release notes link the matching tagged source archive and build
  instructions. Npm remains the runnable distribution.
- CI separately freezes the experimental Python reporting wheel/sdist and checks
  them against the same SDK wheel on the interpreter/OS matrix. These artifacts
  are qualification inputs, not added publication candidates. Host
  installed-update checks also receive the frozen reporting npm archive.
- After npm convergence and source tagging, create missing
  package-specific GitHub prereleases. Include exact registry version links,
  install commands, and docs. Preserve existing release notes on retries. Never
  present source archives as the installable package.
- Keep FLOW and Jig site publication independent.
- The CI site job checks documentation metadata, local links, source anchors,
  changed technical paragraphs, and the rendered Jig site before recording success.
  PR style checks use the base SHA. Push checks use the previous SHA.
  Manual checks use the checked revision's parent. Missing baselines fail.

## Work Guidance

- Put substantial shell or TypeScript logic in `scripts/` and call it here.
- Preserve zero-residue checks around provisioned Jig host tests. Mac snapshots
  retain explicit lowercase `jig-` paths and automatic `/Volumes/Jig-` volume
  names. The self-hosted workflow uses the same qualifier. These are
  observations, not process, mount or filesystem cleanup authority.
- Acquire the original canonical CI bundle once, then run the complete Linux
  suite in independent shards on separately provisioned hosts. Every shard
  rechecks the frozen archive hashes, performs zero-residue verification, and
  contributes to the aggregate `rootless-linux` check. A skipped, cancelled, or
  failed shard must prevent that aggregate from succeeding.
- Linux package-lifecycle runs preparation, retained progress, finite ACP,
  Markdown and public workspace-dependency proof in whole physical suite files.
  The shared catalog assigns each file once across the three source shards. No
  test-name filter or skipped case supplies passing evidence. Installed-evidence
  runs complete packed CLI composition, operational and hostile baselines on a
  separate proof host, plus standalone display consumers against the frozen
  archives. Supply an absolute `FLOW_NODE` for the model/browser consumers'
  independent Node checks. Pass the runner's absolute Node and npm executables
  to the packed smoke test.

  The acquisition host uses a fixed path that excludes runner tool-cache
  binaries. The trusted npm installation step uses the selected Node directory
  for its interpreter. Contained package execution keeps its ordinary policy.
- Native Agent API Qualification consumes the exact host archives from the
  successful `Linux host conformance` run, then tests one native client per
  disposable rootless host. It records resolved client versions and keeps API
  credentials out of setup, build, and archive steps. Its Codex case also
  exercises immediate follow-up interruption through the frozen Jig CLI archive
  in an ordinary temporary consumer with published conversation dependencies.
  Pass `JIG_PACKAGE_ARCHIVE` through delegation. Qualifying an older registry
  CLI would prevent source fixes from satisfying the prepublication gate.
- Linux's three source shards and Mac source-test shards build the linked
  workspace packages used by their source tests. Generated `dist` output is
  runner-local and is not created by a filtered dependency install. Linux's
  installed-evidence shard retains tooling and filtered dependencies but builds
  no source packages: all six installed obligations consume the frozen archives.
  Host provision, archive rechecks, residue assertions and complete evidence
  remain mandatory. Frozen archives remain the inputs to installed gates.
- Failed operational-baseline command transcripts are retained for seven days.
  Upload only the explicit transcript files, not consumer trees, admission
  databases, credentials, or retained native state.
- Install the declared public FLOW SDK before host fixtures that exercise
  SDK-authored Flows. Source tests resolve its public distribution.
- Host conformance includes Agent method and contract-authoring source changes.
  Consume the built SDK, HTTP Agent, ACP Agent, reporting, display model/web/TUI
  and Jig archives from the canonical producer. Pass
  `AGENT_METHOD_PACKAGE_ARCHIVE` and `AGENT_ACP_PACKAGE_ARCHIVE` to lifecycle
  tests and the Jig/SDK archives to installed Markdown tests across the
  provisioned host boundary. Verify the same archive hashes afterward. Jig's
  packer supplies the complete private authoring closure. Agent source rebuilds
  use ordinary declared dependencies.

  Frozen archives are test inputs, never embedded dependencies.

- `workflows/macos-host-conformance.yml` qualifies the rootless candidate only
  on a self-hosted Intel runner labeled `jig-macos-23E224`. Keep manual dispatch
  restricted to this repository's main or mac-support branch and the protected
  `macos-host-conformance` environment. Never run arbitrary PR code on this
  runner. Configure absolute native executable paths through the environment's
  `JIG_CODEX_STARTUP_PATH`, `JIG_CLAUDE_STARTUP_PATH`, and `JIG_PI_STARTUP_PATH`
  variables. This candidate workflow does not replace Linux publication gates or
  claim live model/API qualification.
- `workflows/macos-hosted-candidates.yml` qualifies disposable GitHub-hosted
  Intel (`macos-15-intel`) and Apple Silicon (`macos-15`) runners. Three Intel
  and two Apple Silicon shards fit the observed five-slot capacity, with
  `max-parallel: 5`. Actual runner availability still determines start times.
  Before full native allocation, the existing Ubuntu acquisition job waits for
  the exact canonical CI producer's current-attempt `Quick development checks`
  success. This wait permits up to 600 seconds within the job's 15-minute
  budget. Keep every test and profile.


  Measure queue effects separately. This head start does not guarantee Python
  Mac work has completed or establish faster native execution. Each isolated
  shard checks the exact kernel/build, native Bun, process prerequisites,
  ordinary build, frozen archive identity and ownership residue. The
  deterministic test plan covers every discovered Jig and display test file. It
  balances physical lifecycle/provider suites with all other applicable files.
  Tests run in fresh, sequential per-group Bun processes inside each host.

  One shard per architecture additionally checks genuine pinned clients offline,
  ordinary npm installation and packed consumer execution. On 24G830, it
  requires Codex preference-profile refusal while Claude and Pi start. Native
  containment/recovery and descriptor-handoff probes run once in a dedicated
  step on shard zero. Per-architecture aggregate checks require exact-revision
  success markers, matching retained test plans and complete successful JUnit
  reports from every selected shard. Prerequisite success alone is insufficient.
  Their retained summaries separate executed cases with zero skipped or filtered
  registrations, and runner wait from job execution.

  Read-only acquisition and aggregate jobs receive `actions: read` to verify
  provenance or retrieve current-attempt timing. Unavailable timing cannot
  qualify or reject proof. Hosted setup installs no privileged helper and uses
  no model credentials. Each shard retains per-test timing evidence. Optional
  manual dispatch profiles installed startup on both architectures with the same
  fixed conversation used by Linux. The profile is non-gating, bounded, and
  leaves archive identity and zero-residue checks mandatory.

  The final shard on each architecture owns installed-consumer checks and their
  startup reports. Declare Intel shards first, with installed-consumer work
  first. Declaration order is not runner priority. Fail fast after a shard
  fails. Cancelled shards cannot qualify. Reconstruct native scope for every PR
  and run complete hosts for every main push.

  Manual dispatch remains available for full diagnostics. Cancel superseded
  PR/feature runs, but retain main-push qualification. PR results do not qualify
  a different merged revision.
- Release completion events from CI, Linux, hosted Mac and native Agent
  workflows each run a short read-only readiness check. Duplicate and
  out-of-order events converge. Manual reconciliation accepts a full main-push
  source revision. FLOW uses complete CI evidence independently of host
  readiness. Agent/Jig also require all current-attempt Linux shards, both Mac
  architectures and all three native clients against the same canonical
  candidate and verified Linux lineage. Native descendant workflow SHA is
  metadata, not the tested source revision.

  Missing, expired, stale, failed or cancelled evidence cannot authorize
  release. Full reruns regenerate every required current-attempt proof. Partial
  reruns cannot inherit old shards or rebuilt candidates. Publication
  revalidates readiness after approvals and queueing and before registry
  mutations. FLOW and host mutation queues are independent. Waiting for host
  qualification holds no runner or registry mutation lock.

  The protected publisher searches native supersession from the live authorized
  native run's validated creation time inclusively. Newer IDs created in the
  same second remain visible. Keep current-attempt checks and bounded
  pagination: unrelated older history cannot block publication, and incomplete
  current history cannot authorize it. Readiness separately preserves
  same-source native reruns and manual runs created before protected approval or
  acquisition.

## Verification

- After any automation change, validate the called script locally where
  possible. Inspect the complete workflow permission and artifact flow.
- `just test-tooling` runs the host coverage checks to catch omitted host-only
  cases and incomplete Mac shard assignment before host qualification.
- `bun test scripts/npm-publish.test.ts` exercises the publisher's actual shell
  with controlled registry responses, including reverse completion and retries.

## Child DOX Index

- None.
