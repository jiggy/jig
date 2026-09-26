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
  using one Mistral BYOK model through each client's native API protocol. Keep
  the OpenRouter key only in the dedicated test step of the protected
  `native-agent-api` environment; never expose it to PRs or artifact builds.
  Configure Mistral BYOK to never use shared capacity for that provider so
  exhausted BYOK quota fails instead of using billable OpenRouter capacity.
- Build, test, publish, and tag the exact triggering source and retained
  candidate bytes. Never rebuild a release during publication.
- CI freezes npm and Python candidates while source gates run. The protected
  publication workflows download those exact successful push-run artifacts;
  they do not rebuild or accept artifacts from a different CI run.
- npm candidates cover FLOW, HTTP Agent, ACP Agent and Jig. Publish in that
  dependency order; all retain the same-revision CI/host gates and isolated
  trusted publisher. First publication requires each package's npm setup.
- Before any npm mutation, inspect every retained archive, exact registry
  version, and channel tag. Existing versions require byte identity even if a
  newer tag exists; absent older versions are superseded without publication,
  tags, or releases. Recheck registry state before each ordered mutation.
- Publish npm only after CI, complete Linux Host Conformance, and Native Agent
  API Qualification have succeeded for the exact triggering source revision.
  The native qualification covers Jig's ACP clients and does not gate the
  independent FLOW/PyPI publication path.
- Keep path filters synchronized with every real workflow input.
- Jig's Linux conformance PR filter includes root license, pricing, mapping,
  and retained license texts. Jig GitHub release notes link the matching tagged
  source archive and build instructions; npm remains the runnable distribution.
- Python publication qualifies the exact retained wheel/sdist on its supported
  interpreter/OS matrix. Read-only jobs prepare and verify registry bytes; the
  isolated OIDC publisher executes no repository code. Duplicate-upload skipping
  never substitutes for digest verification.
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
  Freeze the built SDK, HTTP Agent, ACP Agent and Jig archives once through their owning
  packers. Pass `AGENT_METHOD_PACKAGE_ARCHIVE` and `AGENT_ACP_PACKAGE_ARCHIVE` to lifecycle tests and the Jig/SDK
  archives to installed Markdown tests across the provisioned host boundary;
  verify the same archive hashes afterward. Jig's packer supplies the complete
  private authoring closure. Agent source rebuilds use ordinary declared
  dependencies; frozen archives are test inputs, never embedded dependencies.

## Verification

- Validate the called script locally where possible and inspect the complete
  workflow permission and artifact flow after any automation change.
- `bun test scripts/npm-publish.test.ts` exercises the publisher's actual shell
  with controlled registry responses, including reverse completion and retries.

## Child DOX Index

- None.
