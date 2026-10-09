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
- CI freezes npm and Python candidates while source gates run. The protected
  publication workflows download those exact successful push-run artifacts;
  they do not rebuild or accept artifacts from a different CI run.
- CI reports quick development/release checks and site builds independently
  of the longer source suite. Candidate jobs retain their archives, then check
  exact public registry bytes read-only so a reused version fails before merge.
  This does not replace publication's complete group preflight and rechecks.
  Preserve the existing `test` check as a fail-closed aggregate of quick, site
  and source jobs; skipped or cancelled inputs cannot produce a successful check.
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
- Keep path filters synchronized with every real workflow input.
- Model and web/TUI display packages enter the Jig host filters, source-test
  inventories and frozen standalone artifact gates. Their JavaScript/assets are
  bundled into Jig; the protected publisher's package selection is unchanged.
- Jig's Linux conformance PR filter includes root license, pricing, mapping,
  and retained license texts. Jig GitHub release notes link the matching tagged
  source archive and build instructions; npm remains the runnable distribution.
- Python publication qualifies the exact retained wheel/sdist on its supported
  interpreter/OS matrix. Read-only jobs prepare and verify registry bytes; the
  isolated OIDC publisher executes no repository code. Duplicate-upload skipping
  never substitutes for digest verification.
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
- Build Linux host archives once, then run the complete suite in independent
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
  Freeze the built SDK, user-updates, HTTP Agent, ACP Agent, display model/web/TUI
  and Jig archives once through their owning
  packers. Pass `AGENT_METHOD_PACKAGE_ARCHIVE` and `AGENT_ACP_PACKAGE_ARCHIVE` to lifecycle tests and the Jig/SDK
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
  Only these read-only aggregate jobs receive `actions: read` to retrieve timing
  for the current run attempt; unavailable timing cannot qualify or reject proof.
  Hosted setup installs no privileged helper
  and uses no model credentials. Each shard retains per-test timing evidence;
  optional manual dispatch profiles installed startup on both architectures
  with the same fixed conversation used by Linux. The profile is non-gating,
  bounded, and leaves archive identity and zero-residue checks mandatory.
  The final shard on each architecture owns installed-consumer checks and their
  startup reports. Declare Intel shards first, with installed-consumer work
  first; declaration order is not runner priority. Fail fast
  after a shard fails; cancelled shards cannot qualify.
  Run automatically for PRs changing host/build/test inputs and every main push;
  public-guide-only PRs do not allocate the Mac matrix. Manual dispatch remains available
  for diagnostics. Cancel superseded PR/feature runs, but retain main-push
  qualification. PR results do not qualify a different merged revision.

## Verification

- Validate the called script locally where possible and inspect the complete
  workflow permission and artifact flow after any automation change.
- `just test-tooling` runs the host coverage checks to catch omitted
  host-only cases and incomplete Mac shard assignment before host qualification.
- `bun test scripts/npm-publish.test.ts` exercises the publisher's actual shell
  with controlled registry responses, including reverse completion and retries.

## Child DOX Index

- None.
