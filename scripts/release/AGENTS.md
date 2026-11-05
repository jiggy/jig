# Release automation

## Purpose

Turn reviewed changes into independent alpha versions and publish exact qualified archives.
Exercise the same publication path before merging release changes.

## Ownership

- `catalog.mjs` owns package roles and bundled or copied artifact inputs.
- `cli.mjs` owns per-PR coverage, Changesets invocation, version generation, and deterministic pin synchronization.
- `state.mjs` owns source digests, dependency notes, and release eligibility. It uses only Node standard libraries and Git.
- `prepared.mjs` transfers generated release data from the read-only generator to the fresh release writer.
  It validates exact source, run identity, permitted mutations, and the complete resulting source digest before writing files.
- `publish.sh` owns group preflight, ordered npm publication, byte convergence and channel protection.
  `qualification.mjs` revalidates live GitHub evidence through `qualification-policy.mjs` before mutations.
- `registry.mjs` owns a genuine disposable Verdaccio registry and transport fault proxy.
  `rehearse.mjs` generates versions, builds canonical archives, publishes, retries and installs outside the source checkout.
- `npm-auth.mjs` checks package-specific OIDC exchange without retaining credentials or publishing versions.
- `.changeset/` stores pending intent, consumed alpha notes, configuration, and generated release metadata.

## Local Contracts

- Require new changesets for every directly affected package. Existing notes cannot cover another PR.
- Shared candidate-builder changes require notes for all seven owned npm packages.
  The standalone Agent builder requires notes for the three protected packages.
- Infer dependent releases from declared artifact edges. Preserve independent versions and external FLOW adoption pins.
- Qualification packages remain outside the protected publication set.
- Let the installed Changesets CLI calculate versions. Do not duplicate prerelease arithmetic.
- Reject top-level `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` in `.changeset/`, regardless of case. Keep their instructions outside that directory.
- Generate all version-derived pins before candidate construction.
- Synchronize existing `engines.jig` requirements while preserving every other engine declaration.
- Synchronize the exact Reporting version in `packages/display-model/THIRD_PARTY_NOTICES`. Preserve all other notice text.
- Validate generated release PRs by replaying the real version command from their exact base.
- Bind release metadata to the complete versioned source, excluding only the metadata file itself.
- Keep automatic Git maintenance in the foreground of each release invocation.
  Wait for its child processes before removing temporary repositories. Cleanup errors remain failures.
- Pending intent, stale source, or malformed metadata cannot authorize publication.
- Production loads publisher tooling from the workflow revision and reads candidate archives only as inert data.
  Never load executable tooling from the candidate revision or rebuild during publication.
- Production fixes the registry to `https://registry.npmjs.org` and always requests provenance.
  Rehearsal accepts only an explicit IPv4 loopback registry and refuses ambient credential variables.
  Its local authentication uses a disposable registry account with a random test-only password.
  The registry permits publication requests up to 64 MiB, including archive encoding overhead. It creates no qualification receipts.
- Host snapshots contain four workflow runs and six artifacts.
  Test the actual readiness collector output against the shared publisher guard.
- Every group preflights all existing bytes and channels before ordered publication.
  Revalidate authorization before mutations. Preserve exact-byte retry and prohibit channel downgrades.
- Rehearsal uses real Changesets, npm packing, Verdaccio publication, registry downloads and installation.
  Change transport responses to exercise faults. Never replace npm or GitHub executables.
- Keep native host qualification with its existing owners.
- Install and execute Changesets only in the read-only generation job.
  The release writer uses standard libraries, Git, and the pinned action's bundled dependencies.
  Transfer no executable code, installed dependencies, or Git configuration between these jobs.
- Prepared output permits only release versions, existing internal pins, the exact Reporting notice version, changelogs, consumed notes, and generated release metadata.
  Validate the complete artifact before restoring its ignored workspace lock or obtaining the release App token.
- Open prepared artifacts without following symbolic links at the final path.
  Validate regular-file type and size through that same handle. Bound the read to the allowed artifact size.
  The fresh writer remains responsible for trusted ancestor directories.

## Work Guidance

- Update the artifact graph when builds gain bundled dependencies or copied shared inputs.
- Keep no-release decisions based on changed inputs. Do not add label or branch-name bypasses.
- Preserve consumed alpha notes until an explicitly authorized channel transition.

## Verification

- `node --test scripts/ci/release-plan.test.mjs` uses real Git repositories and the installed Changesets CLI.
- Verify generated versions, exact pins and notices, repeated alpha releases, stale plans, and rejected manual edits.
  Force real automatic Git maintenance and verify its completion before temporary repository cleanup.
- `node --test scripts/ci/prepared-release.test.mjs` verifies transfer through real Git checkouts without installed writer dependencies.
  Reject unrelated source edits, malformed artifacts, stale identity, and unsafe destinations before mutation.
  Required notice updates must be present and preserve all unrelated source bytes.

- `node --test scripts/release/*.test.mjs` verifies real registry convergence, qualification metadata and OIDC protocol responses.
  These cases run in ordinary tooling checks without production credentials.
- `just test-release-rehearsal` also generates and builds the complete reviewed source in a disposable checkout.
  It proves local publication and installation, not production authentication, provenance or host qualification.

## Child DOX Index

- None.
