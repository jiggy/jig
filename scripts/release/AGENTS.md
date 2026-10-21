# Release planning

## Purpose

Turn reviewed package changesets into independent alpha versions before canonical candidate construction.

## Ownership

- `catalog.mjs` owns package roles and bundled or copied artifact inputs.
- `cli.mjs` owns per-PR coverage, Changesets invocation, version generation, and deterministic pin synchronization.
- `state.mjs` owns source digests, dependency notes, and release eligibility. It uses only Node standard libraries and Git.
- `prepared.mjs` transfers generated release data from the read-only generator to the fresh release writer.
  It validates exact source, run identity, permitted mutations, and the complete resulting source digest before writing files.
- `.changeset/` stores pending intent, consumed alpha notes, configuration, and generated release metadata.

## Local Contracts

- Require new changesets for every directly affected package. Existing notes cannot cover another PR.
- Infer dependent releases from declared artifact edges. Preserve independent versions and external FLOW adoption pins.
- Qualification packages remain outside the protected publication set.
- Let the installed Changesets CLI calculate versions. Do not duplicate prerelease arithmetic.
- Reject top-level `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` in `.changeset/`, regardless of case. Keep their instructions outside that directory.
- Generate all version-derived pins before candidate construction.
- Validate generated release PRs by replaying the real version command from their exact base.
- Bind release metadata to the complete versioned source, excluding only the metadata file itself.
- Pending intent, stale source, or malformed metadata cannot authorize publication.
- Keep privileged publication and host qualification with their existing owners.
- Install and execute Changesets only in the read-only generation job.
  The release writer uses standard libraries, Git, and the pinned action's bundled dependencies.
  Transfer no executable code, installed dependencies, or Git configuration between these jobs.
- Prepared output permits only release versions, existing internal pins, changelogs, consumed notes, and generated release metadata.
  Validate the complete artifact before restoring its ignored workspace lock or obtaining the release App token.

## Work Guidance

- Update the artifact graph when builds gain bundled dependencies or copied shared inputs.
- Keep no-release decisions based on changed inputs. Do not add label or branch-name bypasses.
- Preserve consumed alpha notes until an explicitly authorized channel transition.

## Verification

- `node --test scripts/ci/release-plan.test.mjs` uses real Git repositories and the installed Changesets CLI.
- Verify generated versions, exact pins, repeated alpha releases, stale plans, and rejected manual edits.
- `node --test scripts/ci/prepared-release.test.mjs` verifies transfer through real Git checkouts without installed writer dependencies.
  Reject unrelated source edits, malformed artifacts, stale identity, and unsafe destinations before mutation.

## Child DOX Index

- None.
