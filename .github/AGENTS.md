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
- Build, test, publish, and tag the exact triggering source and retained
  candidate bytes. Never rebuild a release during publication.
- CI freezes npm and Python candidates while source gates run. The protected
  publication workflows download those exact successful push-run artifacts;
  they do not rebuild or accept artifacts from a different CI run.
- npm candidates cover FLOW, HTTP Agent, ACP Agent and Jig. Publish in that
  dependency order; all retain the same-revision CI/host gates and isolated
  trusted publisher. First publication requires each package's npm setup.
- Publish only after CI and the complete Linux Host Conformance workflow have
  both succeeded for the exact triggering source revision.
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

## Child DOX Index

- None.
