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
- `workflows/release-version.yml` maintains one generated release PR from
  pending Changesets. `scripts/release/` owns package coverage and version
  generation. `RELEASING.md` owns contributor and repository setup instructions.

## Local Contracts

- Pin third-party actions by full commit.
- Install Just 1.43.1 in jobs that build packages or sites. The protected npm
  publisher consumes existing archives and requires neither Just nor source.
- Install CI's pinned npm in a fresh runner-temporary prefix and add its binaries
  to `GITHUB_PATH`. Verify the version before exposing that path.
  Do not replace the npm installation performing the install.
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
- Installed Python consumer checks use supported, explicit GitHub runner labels,
  including `macos-15`. Their matrix must exactly match the source catalog's
  evidence profiles. This package check does not qualify Jig's native Mac host.
- CI reports quick development/release checks and site builds independently of
  the longer source suite. Quick checks validate release coverage against the
  tested PR merge's verified first parent, previous main revision, or manual
  source parent. The PR merge must match the workflow source and event head.
  Its first parent may advance beyond the event's recorded base only through
  verified ancestry. Missing or unrelated baselines fail.

  A generated release must reproduce the version plan from that exact base.
  A branch name or bot identity grants no exemption.

  Candidate jobs retain their archives, then perform read-only registry checks.
  Pending changesets distinguish development bytes from versioned release
  candidates. Only validated release state can authorize publication.
  Versioned candidates retain exact registry byte checks. This does not replace
  publication's complete group preflight and rechecks.

  Preserve `test` as a fail-closed aggregate of every CI job and its observed
  full inventory. Each job must finish successfully with nonempty proof and
  complete profiles. Main and manual release runs require complete Linux and
  Apple Silicon coverage.

  PR CI permits failed-job retries within the original run. Resolve the latest
  execution of every job and retain only its immutable successful artifact.
  Verify the exact merge source, workflow digest, runtime profile and complete
  observed inventory. Require unchanged input artifact IDs and digests. Later
  failures or rebuilt inputs invalidate earlier success. Record accepted job IDs
  and attempts in a merge-only receipt.

  Main and manual runs remain fresh, complete current-attempt qualification.
  Retain required job results before rejecting failures or cancellations, even
  after evidence download fails. Optional current-attempt runner observations
  explain allocation failures without granting execution or cleanup evidence.
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
  complete hosted Apple Silicon Mac conformance, and Native Agent API
  Qualification. The canonical candidate must also contain eligible generated
  release metadata bound to that source. Preflight every selected host archive
  before mutation.
- Release generation runs only for main pushes or manual dispatch on main.
  Serialize updates without cancelling an active run. Skip superseded source
  revisions and leave no-change runs without a new PR.
  The version action creates Git changes only. It never publishes packages.

  Install dependencies, plan versions, and execute Changesets only on the
  generation runner with repository read permission. Retain only prepared JSON
  data in an immutable artifact bound to the source, run, and attempt.

  Use a fresh writer runner without installed dependencies or transferred code.
  Download the exact artifact ID. Validate its source and permitted changes
  before restoring its inert workspace lock or minting an App token.
  The pinned version action applies validated data through the standard-library
  helper. It never invokes the local Changesets CLI.

  Retry writer failures by rerunning all jobs or manually dispatching on current
  main. Each attempt must generate its own prepared artifact.

  Report release setup in the writer's job summary using only credential-presence
  flags. Reject incomplete App configuration before token creation.
  Keep authentication guidance in the setup summary. Failure summaries preserve
  the failed outcome and direct maintainers to the exact error and recovery.
  Do not infer authentication problems from a generic step failure.
  Setup diagnostics request no administration authority.

  Scope an optional release App token to this repository with only contents
  and pull-request write permissions. Keep credentials absent from PR checks.
  Without the App, summarize the Actions PR setting and required maintainer
  handoff. Link the generated PR and name its workflow-approval button.
  Optional App-based auto-merge obeys existing checks and review rules.
  Never use the built-in token to merge a release and suppress main-push CI.
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

  Keep these checks and `test` in merge policy. There are no test-name selection
  modes, temporary benchmark predicates or
  compact witnesses. Intel compatibility has its own nightly and manual workflow.

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
- Linux's `examples` shard runs every original example through installation,
  public review and its authored default invocation. It uses unchanged candidate
  packages, a digest-pinned genuine Codex client and a local HTTPS model peer.
  Provision the peer CA through the disposable host's ordinary certificate trust
  before review. Keep TLS keys and consumer trees outside retained artifacts.

  The shard's 90-minute ceiling covers all authored Run budgets plus bounded
  setup, review and settlement. Ordinary source coverage and limits remain
  unchanged. Whole files follow the measured scheduling policy. The aggregate
  and release readiness require this shard's complete
  current-attempt evidence; no filtered or omitted example can qualify.
- Linux package-lifecycle runs preparation, retained progress, Markdown and public
  workspace-dependency proof in whole physical suite files.
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
  exercises immediate follow-up interruption through an ordinary temporary
  consumer of the frozen Jig, ACP, Agent method and FLOW SDK archives.
  Pass all four archive paths through delegation and verify their installed
  versions. Historical registry pins cannot qualify current candidate changes.
- Linux's ordinary source and example shards and Mac source-test shards build the linked
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
- `workflows/macos-hosted-candidates.yml` requires one complete Apple Silicon
  host on `macos-15` for applicable PRs and all main pushes. `affected-macos`
  reconciles only this architecture. Linux and Apple Silicon remain release
  gates. Intel evidence never grants publication readiness.

  Linux and required hosted Mac acquisition wait for the exact canonical
  `candidate-build` job before starting the artifact transfer bound. PR retries
  select its latest successful execution within that run. Main/manual runs
  require current-attempt success. Producer readiness permits 1,800 seconds,
  including runner queues. Failed or invalid producer jobs refuse immediately.

  Hosted Mac also requires that producer's latest `Quick development checks`
  success before native allocation. Main/manual runs require current-attempt
  Quick success. Transfer permits 300 seconds on Linux or 600 seconds on Mac.
  Acquisition jobs allow 40 and 45 minutes respectively, including setup and
  settlement. Exact profiles, frozen archive identities, complete coverage and
  zero-residue checks stay mandatory.

  Manual startup profiling remains optional and non-gating.

  The Apple Silicon pool admits exact Darwin 24.6.0 builds 24G830 and 24H232.
  The hosted probe rejects other tuples before compilation or dependency setup.
  One host executes the complete native, source and installed plan, so results
  from different kernel builds cannot be combined. Aggregate evidence names the
  observed architecture, kernel, build and pinned Bun revision.

  The complete ARM job retains main's 60-minute allocation, or 90 minutes with
  optional profiling. Individual test and product deadlines stay unchanged.
  Node material files run under verified Node, with complete per-file JUnit
  evidence alongside Bun files.
- `workflows/macos-intel-nightly.yml` checks the published Jig `alpha` source and
  exact archives, then distinct main source, daily at 02:23 UTC. Its four Intel
  shards retain the complete suite and native/installed/client obligations.
  Two Intel jobs run concurrently to leave capacity for feature checks.

  Dispatch this workflow from main with an optional open PR number. Hosted PR
  execution has no protected model credentials. The self-hosted Intel workflow
  remains manual and never executes arbitrary PR source.

  Verified scheduled-main input mirrors retain exact bytes across CI artifact
  expiry. Manual PR runs cannot supply these mirrors.
  Published Jig archive bytes must match npm integrity. Missing or mismatched
  inputs fail. Rebuilding does not establish published compatibility.

  Nightly failures and last passing published versions remain visible separately
  from
  release readiness. Qualified nightly receipts cannot replace main-push proof.

- Release completion events from CI, Linux, hosted Mac and native Agent
  workflows each run a short read-only readiness check. Duplicate and
  out-of-order events converge. Ignore PR completions, foreign repositories,
  non-main branches and wholly skipped native descendants before runner allocation.

  Manual reconciliation accepts a full main-push
  source revision. FLOW uses complete CI evidence independently of host
  readiness. Agent/Jig also require all current-attempt Linux shards, Apple Silicon
  and all three native clients against the same canonical
  candidate and verified Linux lineage. Native descendant workflow SHA is
  metadata, not the tested source revision.

  Readiness summaries show the source, verified candidate versions and links to
  current qualification attempts. Failed qualification or invalid evidence fails
  reconciliation. Expected asynchronous waiting publishes nothing and remains
  distinct from blocked qualification. Manual reconciliation fails until ready.
  Version generation links to the publisher even when no changesets remain.
  Completed publication summarizes each package's actual registry result.

  Native recovery summaries retain the job outcome and selected model without
  copying credentials, raw transcripts or private responses. A closed limit
  diagnostic does not establish its underlying cause. Preserve complete reruns,
  mandatory settlement, archive identity and cleanup checks.

  Missing, expired, stale, failed or cancelled evidence cannot authorize
  release. Full reruns regenerate every required current-attempt proof. Partial
  reruns cannot inherit old shards or rebuilt candidates. PR CI's merge-only
  retry receipt does not alter these host/publication rules.

  Publication revalidates readiness after approvals and queueing and before registry
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
