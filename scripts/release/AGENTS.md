# Release planning

## Purpose

Turn reviewed package changesets into independent alpha versions before canonical candidate construction.

## Ownership

- `catalog.mjs` owns package roles and bundled or copied artifact inputs.
- `cli.mjs` owns per-PR coverage, Changesets invocation, version generation, and deterministic pin synchronization.
- `state.mjs` owns source digests and release eligibility. It uses only Node standard libraries and Git.
- `.changeset/` stores pending intent, consumed alpha notes, configuration, and generated release metadata.

## Local Contracts

- Require new changesets for every directly affected package. Existing notes cannot cover another PR.
- Infer dependent releases from declared artifact edges. Preserve independent versions and external FLOW adoption pins.
- Qualification packages remain outside the protected publication set.
- Let the installed Changesets CLI calculate versions. Do not duplicate prerelease arithmetic.
- Generate all version-derived pins before candidate construction.
- Validate generated release PRs by replaying the real version command from their exact base.
- Bind release metadata to the complete versioned source, excluding only the metadata file itself.
- Pending intent, stale source, or malformed metadata cannot authorize publication.
- Keep privileged publication and host qualification with their existing owners.

## Work Guidance

- Update the artifact graph when builds gain bundled dependencies or copied shared inputs.
- Keep no-release decisions based on changed inputs. Do not add label or branch-name bypasses.
- Preserve consumed alpha notes until an explicitly authorized channel transition.

## Verification

- `node --test scripts/ci/release-plan.test.mjs` uses real Git repositories and the installed Changesets CLI.
- Verify generated versions, exact pins, repeated alpha releases, stale plans, and rejected manual edits.

## Child DOX Index

- None.
