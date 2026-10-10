# Repository automation

## Purpose

Owns CI, host-conformance, package publication, and public-site workflows.

## Ownership

- `workflows/` owns automation triggers, permissions, jobs, and retained
  artifacts.
- Checked-in justfiles and scripts own reusable build and test logic.

## Local Contracts

- Pin third-party actions by full commit.
- Install Just 1.43.1 in jobs that build packages or sites. The protected npm
  publisher consumes existing archives and requires neither Just nor source.
- Grant each job only the authority it needs; build jobs must not inherit
  publication or Git-write authority.
- The separate Native Agent API Qualification workflow runs after successful
  Linux Host Conformance on each `main` push and can be dispatched manually
  on `main` against that revision's successful push-run host artifacts. It qualifies Codex and Claude
  Code from `@latest` and the currently supported Pi 0.84.4 standalone profile,
  using free OpenRouter routing for Codex's uncapped Responses requests and
  Mistral BYOK for Claude and Pi through their native API protocols. These are
  qualification inputs, not product defaults. Keep
  the OpenRouter key only in the dedicated test step of the protected
  `native-agent-api` environment; never expose it to PRs or artifact builds.
  Configure Mistral BYOK to never use shared capacity for that provider so
  exhausted BYOK quota fails instead of using billable OpenRouter capacity.
- Build, test, publish, and tag the exact triggering source and retained
  candidate bytes. Never rebuild a release during publication.
- Linux Host Conformance's optional `workflow_dispatch` input
  `include_startup_profile` runs a bounded startup diagnostic inside the
  installed-evidence host shard, against the exact frozen archives. It is
  explicitly non-gating for the `rootless-linux` check; the host's final
  archive-identity and zero-residue assertions remain mandatory. Retain only
  its bounded mode-0600 profile artifacts for seven days; it performs no model
  calls and does not establish a performance claim. Its 60-minute shard allows
  the 30-minute profile command budget to finish before mandatory cleanup.
- CI freezes one canonical eight-package npm bundle and checked Python
  distributions before installed qualification. Source, Linux, hosted Mac and
  native Agent consumers use the same npm bytes while rebuilding their platform's
  source workspace separately. Protected publishers download the exact original
  CI artifact by immutable artifact ID; they never rebuild a release.
- CI reports quick development/release checks and site builds independently
  of the longer source suite. Candidate jobs retain their archives, then check
  exact public registry bytes read-only so a reused version fails before merge.
  This does not replace publication's complete group preflight and rechecks.
  Preserve `test` as a fail-closed aggregate of the independently reconstructed
  plan and observed execution. Selected jobs must finish successfully with
  nonempty proof and complete profiles; only reconstructed policy omissions may
  skip jobs. Main, manual and weekly audit events always select full coverage.
- npm candidates cover FLOW, HTTP Agent, ACP Agent and Jig. Publish in that
  dependency order. FLOW publishes after its successful main-push CI run;
  the Agent/Jig group additionally requires same-revision host and native gates.
  Both groups use the isolated trusted publisher in `npm-publish.yml`. First
  publication requires each package's npm setup.
- Before any npm mutation, inspect every archive, exact registry version and
  channel tag in the selected release group. Existing versions require byte identity even if a
  newer tag exists; absent older versions are superseded without publication,
  tags, or releases. Recheck registry state before each ordered mutation.
- Publish Agent/Jig npm candidates only after CI, complete Linux Host Conformance,
  complete hosted Intel and Apple Silicon Mac conformance, and Native Agent API
  Qualification succeed for the exact source revision. FLOW
  SDK npm publication and source tagging are independent of those Jig gates;
  Python also uses its own CI-qualified artifacts. Each group preflights its own
  archives before mutation. A host failure cannot block FLOW publication.
- CI, Linux and hosted Mac always plan each PR; runner allocation follows the
  repository-owned conservative policy instead of workflow path filters.
  `JIG_CI_SELECTION_MODE` defaults to `shadow`: proposed exclusions are retained
  while every existing target executes freshly. `active` allows only public site
  assets and isolated Python implementation/tests; Python retains the full source
  gate. Shared, unknown, build, harness, contract, license, pricing and bundled
  web changes select full work. `JIG_CI_FORCE_FULL=true` overrides exclusions.
  Active PR selection deterministically samples about 20% of PR head revisions
  for full fresh execution. CI and both host workflows use the same verified
  PR head and reviewed hash policy, retaining the narrower proposal for audit
  comparison; reruns and unrelated merge-base advances cannot change sampling.
  Keep shadow mode until representative same-revision audits and seeded failures
  show no missed regression, including resolution of relevant known failures.
  Before activating exclusions, require `test`, `affected-linux` and
  `affected-macos` in merge policy. The existing full Linux and architecture
  checks remain complete release evidence and never claim an omitted full pass.
  Sampled PR and weekly Sunday full audits supplement full main checks; include
  their cost when measuring savings. Do not cache passing results or
  native/consumer execution.
- Model and web/TUI display packages enter dependency ownership, source and host
  test inventories, and frozen standalone artifact gates. Their JavaScript/assets
  are bundled into Jig; protected publisher package selection remains unchanged.
- Jig GitHub release notes link the matching tagged
  source archive and build instructions; npm remains the runnable distribution.
- Python publication qualifies the exact retained wheel/sdist on its supported
  interpreter/OS matrix. Read-only jobs prepare and verify registry bytes; the
  isolated OIDC publisher executes no repository code. Duplicate-upload skipping
  never substitutes for digest verification.
  CI SDK and user-updates artifacts include source, producer run and attempt.
  A short Python-only readiness check binds all six installed profiles, source
  execution and the final CI gate to the successful current main-push attempt,
  original SDK artifact ID/digest and source-bound distribution receipt. Prepare
  and post-publication verification retrieve that immutable SDK artifact;
  the checkout-free publisher revalidates the snapshot after approvals/queueing
  and checks each pending archive against the original receipt before mutation.
  A delayed success event cannot authorize an unfinished or failed rerun.
- CI separately freezes the experimental Python user-updates wheel/sdist and
  checks them against the same SDK wheel on the interpreter/OS matrix. These
  artifacts are qualification inputs, not added publication candidates. Host
  installed-update checks also receive the frozen user-updates npm archive.
- After npm or PyPI convergence and source tagging, create missing package-specific
  GitHub prereleases with exact registry version links, install commands, and docs.
  Preserve existing release notes on retries; never present source archives as
  the installable package.
- Keep FLOW and Jig site publication independent.

## Work Guidance

- Put substantial shell or TypeScript logic in `scripts/` and call it here.
- Preserve zero-residue checks around provisioned Jig host tests.
- Acquire the original canonical CI bundle once, then run the complete Linux suite in independent
  shards on separately provisioned hosts. Every shard rechecks the frozen
  archive hashes, performs zero-residue verification, and contributes to the
  aggregate `rootless-linux` check; a skipped, cancelled, or failed shard must
  prevent that aggregate from succeeding.
- Linux package-lifecycle runs preparation, retained progress, finite ACP,
  Markdown and public workspace-dependency proof. Its packed dependency-reuse
  case runs once in its dedicated step; the remaining provider cases use the
  complementary name pattern. Installed-evidence runs complete packed CLI
  composition, operational and hostile baselines on a separate proof host,
  plus standalone display consumers against the frozen archives. Supply an
  absolute `FLOW_NODE` for the model/browser consumers' independent Node checks.
  Pass the runner's absolute Node and npm executables to the packed smoke test
  because the acquisition host uses a fixed path that excludes runner tool-cache
  binaries. The trusted npm installation step uses the selected Node directory
  for its interpreter; contained package execution keeps its ordinary policy.
- Native Agent API Qualification consumes the exact host archives from the
  successful `Linux host conformance` run, then tests one native client per
  disposable rootless host. It records resolved client versions and keeps API
  credentials out of setup, build, and archive steps. Its Codex case also
  exercises immediate follow-up interruption through the frozen Jig CLI archive
  in an ordinary temporary consumer with published conversation dependencies.
  Pass `JIG_PACKAGE_ARCHIVE` through delegation; qualifying an older registry CLI
  would prevent source fixes from satisfying the prepublication gate.
- Each host shard builds the linked workspace packages used by source tests;
  generated `dist` output is runner-local and is not created by a filtered
  dependency install. Frozen archives remain the inputs to installed gates.
- Failed operational-baseline command transcripts are retained for seven days.
  Upload only the explicit transcript files, not consumer trees, admission
  databases, credentials, or retained native state.
- Build the current FLOW SDK before host fixtures that exercise SDK-authored
  Flows; a Jig-only installation does not produce the SDK's generated output.
- Host conformance includes Agent method and contract-authoring source changes.
  Consume the built SDK, HTTP Agent, ACP Agent, user-updates, display model/web/TUI
  and Jig archives from the canonical producer. Pass `AGENT_METHOD_PACKAGE_ARCHIVE`
  and `AGENT_ACP_PACKAGE_ARCHIVE` to lifecycle tests and the Jig/SDK
  archives to installed Markdown tests across the provisioned host boundary;
  verify the same archive hashes afterward. Jig's packer supplies the complete
  private authoring closure. Agent source rebuilds use ordinary declared
  dependencies; frozen archives are test inputs, never embedded dependencies.

- `workflows/macos-host-conformance.yml` qualifies the rootless candidate only
  on a self-hosted Intel runner labeled `jig-macos-23E224`. Keep manual dispatch
  restricted to this repository's main or mac-support branch and the protected
  `macos-host-conformance` environment. Never run arbitrary PR code on this
  runner. Configure absolute native executable paths through the environment's
  `JIG_CODEX_STARTUP_PATH`, `JIG_CLAUDE_STARTUP_PATH`, and `JIG_PI_STARTUP_PATH`
  variables. This candidate workflow does not replace Linux publication gates
  or claim live model/API qualification.
- `workflows/macos-hosted-candidates.yml` qualifies disposable GitHub-hosted
  Intel (`macos-15-intel`) and Apple Silicon (`macos-15`) runners. Three Intel
  and two Apple Silicon shards fit the observed five-slot capacity, with
  `max-parallel: 5`; actual runner availability still determines start times.
  Each isolated shard checks the exact kernel/build, native Bun,
  process prerequisites, ordinary build, frozen archive identity and ownership
  residue. The deterministic test plan covers every discovered Jig and display test file;
  it partitions the long root Agent lifecycle and package-provider files by
  disjoint, exhaustive name groups and balances them with all other files.
  Tests run in fresh, sequential per-group Bun processes inside each host.
  One shard per architecture additionally checks genuine pinned clients offline,
  requiring Codex preference-profile refusal on 24G830 while Claude and Pi start,
  ordinary npm installation and packed
  consumer execution. Native containment/recovery and descriptor-handoff probes
  run once in a dedicated step on shard zero. Per-architecture aggregate checks
  require exact-revision success markers, matching retained test plans and
  complete successful JUnit reports from every selected shard; prerequisite
  success alone is insufficient. Their retained summaries separate executed
  cases from filtered/platform/opt-in skips, and runner wait from job execution.
  Read-only acquisition and aggregate jobs receive `actions: read` to verify
  provenance or retrieve current-attempt timing; unavailable timing cannot
  qualify or reject proof.
  Hosted setup installs no privileged helper
  and uses no model credentials. Each shard retains per-test timing evidence;
  optional manual dispatch profiles installed startup on both architectures
  with the same fixed conversation used by Linux. The profile is non-gating,
  bounded, and leaves archive identity and zero-residue checks mandatory.
  The final shard on each architecture owns installed-consumer checks and their
  startup reports. Declare Intel shards first, with installed-consumer work
  first; declaration order is not runner priority. Fail fast
  after a shard fails; cancelled shards cannot qualify.
  Plan every PR and run every main push and weekly full audit. Conservative
  exclusions allocate fewer runners only after shadow validation. Manual dispatch remains available
  for diagnostics. Cancel superseded PR/feature runs, but retain main-push
  qualification. PR results do not qualify a different merged revision.
- Release completion events from CI, Linux, hosted Mac and native Agent workflows
  each run a short read-only readiness check. Duplicate and out-of-order events
  converge; manual reconciliation accepts a full main-push source revision.
  FLOW uses complete CI evidence independently of host readiness. Agent/Jig also
  require all current-attempt Linux shards, both Mac architectures and all three
  native clients against the same canonical candidate and verified Linux lineage.
  Native descendant workflow SHA is metadata, not the tested source revision.
  Missing, expired, stale, failed or cancelled evidence cannot authorize release.
  Full reruns regenerate every required current-attempt proof; partial reruns
  cannot inherit old shards or rebuilt candidates. Publication revalidates
  readiness after approvals and queueing and before registry mutations. FLOW
  and host mutation queues are independent; waiting for host qualification holds
  no runner or registry mutation lock.

## Verification

- Validate the called script locally where possible and inspect the complete
  workflow permission and artifact flow after any automation change.
- `just test-tooling` runs the host coverage checks to catch omitted
  host-only cases and incomplete Mac shard assignment before host qualification.
- `bun test scripts/npm-publish.test.ts` exercises the publisher's actual shell
  with controlled registry responses, including reverse completion and retries.
- `node --test scripts/ci/python-readiness.test.mjs scripts/ci/python-publish.test.mjs`
  exercises current-attempt Python authorization and the actual protected
  publisher's inert validation code without registry mutations.

## Child DOX Index

- None.
