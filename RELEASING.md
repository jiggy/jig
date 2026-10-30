# Releasing

**Release PR creation uses GitHub's built-in token by default.**
No App secrets are required for this path.
An administrator must enable GitHub's PR-creation setting once.
Changesets then generate package versions and maintain one release PR.

## One-time setup

1. Open [Settings → Actions → General](https://github.com/jiggy/jig/settings/actions).
   Under **Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**.
   If organization policy disables this setting, ask an organization administrator to enable it.
2. Keep `test`, `affected-linux`, and `affected-macos` required in the merge policy.
3. Configure npm trusted publishing for `@jigging/agent-method`, `@jigging/agent-acp`, and `@jigging/jig`.
   Use repository `jiggy/jig`, workflow `npm-publish.yml`, and protected environment `npm`.
   No npm token is required.
4. Keep `OPENROUTER_API_KEY` in the protected `native-agent-api` environment for native Agent qualification.

### Optional: automatic PR checks and merge

To start release PR checks without manual approval, install a GitHub App on this repository.
Grant only `Contents: write` and `Pull requests: write`.
In [repository Actions settings](https://github.com/jiggy/jig/settings/secrets/actions), add:

| Type | Name | Value |
| --- | --- | --- |
| Variable | `RELEASE_APP_ID` | The App ID |
| Secret | `RELEASE_APP_PRIVATE_KEY` | The App's private key |

For automatic merge requests, also enable repository auto-merge and set variable `RELEASE_AUTO_MERGE=true`.
Required checks and reviews still apply.

## Everyday changes

After installing repository dependencies, run:

```sh
just changeset
```

Select every directly affected package and describe the user-visible change.
Choose `patch` for fixes, `minor` for features, or `major` for breaking changes.
Commit the generated note with your PR. CI rejects missing package coverage.
Do not edit package versions, generated changelogs, or release metadata manually.
Unshipped tests and documentation need no note unless they change package output.

After the feature PR merges:

1. **Release versions** creates or updates **Release Jig packages**.
2. Open that PR. If GitHub shows **Approve workflows to run**, click it.
3. Review the generated changes and merge after required checks pass.
   With the default token, a maintainer must merge so the main-push workflows start.

The merged release must pass CI, complete Linux and Apple Silicon qualification,
and native Agent qualification. Intel Mac compatibility runs nightly and on
manual request. An Intel regression can reach a release before the next nightly
check. It does not block publication.

The publisher then publishes the exact tested archives, followed by source tags and GitHub prereleases.
Current releases use `alpha`. Installation uses `@alpha`, not `@latest`.
Reporting, display, and Python artifacts remain qualification inputs.
FLOW releases independently from [jiggy/flow](https://github.com/jiggy/flow).

To preview and check your committed changes locally:

```sh
git fetch origin main
just release-plan
just release-check "$(git merge-base origin/main HEAD)"
```

## Intel Mac compatibility

**Intel Mac compatibility** runs daily at 02:23 UTC from `main`. It selects the
current public Jig `alpha` version first, then the workflow's exact
`main` source if different. Each source retains all four Intel shards, native
containment and recovery, installed consumers, genuine offline clients and
zero-residue checks. At most two Intel runners execute concurrently.

Published checks require the exact public npm archive, verified against its
registry integrity, and its source-bound canonical bundle. The workflow retains
verified input mirrors for 14 days and refreshes them after acquisition. It never
rebuilds a release to claim published-byte compatibility. A release without
retained canonical evidence, including a version from before this qualification
pipeline, reports incomplete compatibility until
exact retained inputs become available or a newer release is published.

The run summary separates each tested version and source from the last recorded
passing published version. Failures make this workflow red but cannot qualify or
block a release. Missing evidence is a failure, not an Intel pass. Use the
workflow's manual `pull_request` input to check an open PR's exact merge source.
Leave it empty to check the published version and `main`.

The self-hosted Intel 23E224 workflow remains manual and protected. Hosted Intel
results do not qualify that distinct native profile. Performance profiling stays
manual and outside release readiness.

## If a release stops

- **Release versions fails:** Read its run summary and failed step.
  After fixing the cause, choose **Re-run all jobs**, or run the workflow again on current `main`.
  **Re-run failed jobs** cannot reuse prepared version changes from an earlier attempt.
- **Qualification fails:** Fix the failing check before publishing.
  A transient failure requires a complete workflow rerun. Partial runs cannot qualify a release.
- **Publication fails:** Choose **Re-run failed jobs** while the original archives remain available for seven days.
  The publisher verifies already-published bytes before continuing. Never rebuild archives during a publication retry.
  Expired artifacts require fresh complete qualification.

Release generation and publication details belong to the
[workflow contracts](.github/AGENTS.md) and [release scripts](scripts/release/AGENTS.md).

## Build a source release

Download the matching GitHub release's **Source code (tar.gz)** or zip and extract it.
On Linux x64/glibc, use Bun 1.3.3 and Just 1.43.1.
The Bun revision is `274e01c737e85f8142070a9745b43a2ba09fce4c`.
From the extracted repository root:

```sh
bun install --filter @jigging/jig --filter @jigging/display-model --filter @jigging/display-web --filter @jigging/display-tui --ignore-scripts --config=/dev/null
just --justfile packages/jig/justfile build
```

Edit `packages/jig/src` and repeat the build. The launcher is `packages/jig/bin/jig`.
To package your build:

```sh
just --justfile packages/jig/justfile pack --destination /absolute/output/directory
```

Installation needs registry access and resolves transitive dependencies.
This does not promise offline or byte-identical reproduction.
Running Jig also requires the supported host configuration in its [README](packages/jig/README.md).
The npm archive retains the license, pricing, and applicable notices.
Its matching GitHub release supplies source and links these build instructions.
