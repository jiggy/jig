# Automatic npm prereleases

Changesets record release intent in ordinary pull requests. Automation calculates
versions, updates dependency pins, and maintains one release pull request.
Publication uses the exact archives qualified from its merged source.

The release flow has three stages:

1. A feature PR declares affected packages and release notes in `.changeset/`.
2. `Release versions` maintains `changeset-release/main` with generated versions,
   changelogs, dependency pins, and release metadata.
3. After that PR merges, all publication gates qualify its exact revision.
   The protected publisher then publishes the retained archives in dependency order.

Feature commits with pending changesets remain development candidates. They
cannot authorize publication under the previous package versions.

## Recording release intent

Install repository dependencies with `bun i`, then run:

```sh
git fetch origin main
just changeset
just release-plan
just release-check "$(git merge-base origin/main HEAD)"
```

The fetch updates `origin/main`. The merge base is the latest shared ancestor
of your branch and `origin/main`. It remains a valid local comparison when
`main` advances after your branch diverges.

Select each package directly affected by the change. Write a short description
of the behavior users receive. Use `patch` for fixes, `minor` for added features,
and `major` for breaking changes.

For example, an ACP fix can add `.changeset/finite-agent-cleanup.md`:

```md
---
"@jigging/agent-acp": patch
---

Finish interrupted native conversations before returning their result.
```

Do not edit numeric package versions, generated changelogs, or release metadata
in a feature PR. The generator owns those values and their derived dependency
pins. Package metadata must retain public access and must not become private.

The required `test` check includes release validation in `Quick development
checks`. Validation compares the exact PR base with its tested source. Main
pushes use the preceding revision, and manual checks use the source parent.
Missing baselines fail.

Each directly affected package needs a new changeset. A changeset for another
package does not satisfy that requirement. Shared build inputs, copied
contracts, notices, and shipped documentation count as release inputs.
Shipped Agent tests also count. Unshipped tests and ordinary site or documentation
changes need no release note unless they affect package output.
There is no label-based bypass.

The generator uses independent package versions. Dependency changes propagate
through the package graph, including bundled dependencies that are absent from
published runtime dependency lists.

| Changed component | Release responsibility |
| --- | --- |
| HTTP Agent | Version HTTP Agent, ACP Agent, and Jig when their output changes |
| ACP Agent | Version ACP Agent and its Jig consumer |
| Jig | Version Jig |
| Reporting or display packages | Version their qualification artifacts and affected Jig output |
| Python reporting | Keep qualification-only status, while shared descriptor changes affect their npm consumers |
| FLOW SDKs and authoring | Adopt already published versions from `jiggy/flow` |

Reporting and display archives remain qualification inputs. Changesets do not
add them to the protected publisher's package selection. Python reporting
remains outside npm version generation and automatic publication.

FLOW specifications, SDKs, conformance, and independent authoring release from
`jiggy/flow`. Jig consumes exact public versions without a FLOW checkout.
Publish an adopted FLOW dependency before qualifying the dependent Jig release.
Jig Pages deploys independently from this repository.

## Generating the release pull request

Every `main` push runs `Release versions`. The workflow serializes version
updates and skips superseded revisions. It generates a PR only when new
changesets are pending. Maintainers can rerun it through manual dispatch on
`main`.

The generator invokes `just release-version`. That command updates package
versions, changelogs, dependent pins, and
`.changeset/release.json` together. The metadata binds the generated release
plan to its source inputs. The check replays generation to validate release PRs.
A branch name or bot identity never exempts a PR from validation.

Release dependency installation and Changesets execution run in a job with
only repository read permission. It has no release App credentials.
It retains the prepared version changes as an immutable workflow artifact.

On a fresh runner, the writer downloads the exact artifact and validates its
source and permitted changes. The writer installs no dependencies and executes
no code from the artifact. The pinned Changesets version action applies the
validated output and maintains the release PR. Only this job receives GitHub
write authority and the optional release App token.

Review the generated changes as one release. Further feature merges update the
same release PR. Generated metadata must match the complete versioned source.
Editing source after generation invalidates that release claim.

The generator stays in `alpha` prerelease mode. An alpha number identifies
immutable package bytes without promising compatibility for provisional
interfaces. Stable promotion or a different generation channel requires a
separately reviewed policy change.

### GitHub configuration

Keep `test`, `affected-linux`, and `affected-macos` required in the merge policy.
Release PRs must satisfy the same checks and review rules as feature PRs.
Enable GitHub Actions to create pull requests in the repository settings.

For automatic workflow events, configure a GitHub App installed only on this
repository. Grant it `Contents: write` and `Pull requests: write`.
Set repository variable `RELEASE_APP_ID` and secret `RELEASE_APP_PRIVATE_KEY`.
The workflow requests only those permissions for this repository.

Without that App configuration, the workflow uses `GITHUB_TOKEN`. Its generated
PR can require a maintainer to approve or trigger the required workflows.
Merge that PR as a maintainer so the resulting main push starts qualification.
Do not bypass required checks or substitute a manual workflow for main-push
release evidence.

Optional repository variable `RELEASE_AUTO_MERGE=true` enables automatic merge
requests when the App is configured. Enable repository auto-merge first.
This uses normal squash merge policy and the exact PR head. It does not bypass
checks or required reviews. The built-in token fallback never requests
automatic merge.

These settings require repository-owner configuration. Committing the workflow
does not create an App, store secrets, or change branch protection.

## Qualifying and publishing a release

CI builds the canonical npm bundle for every revision. Feature candidates with
pending changesets can contain changed bytes under their previous version.
Release validation requires their declared intent and keeps them ineligible
for publication. Registry collision checks apply to versioned release
candidates and unchanged packages that already claim published identity.

After the generated release PR merges, publication requires complete
same-revision evidence:

1. CI, including the release check and installed package qualification.
2. Complete Linux Host Conformance.
3. Complete hosted Intel and Apple Silicon Mac conformance.
4. Native Agent API Qualification.

PR qualification cannot authorize a different merged revision. The publisher
revalidates the generated release state and all required evidence after
queueing and environment approvals.

The publisher downloads the original CI artifact by immutable artifact ID.
It has no source checkout and executes no repository code. It never builds or
repackages a release. Candidate builds have no OIDC or Git write authority.

Publication uses npm trusted publishing in the protected `npm` environment.
HTTP Agent, ACP Agent, and Jig publish in that dependency order. Each package
needs a trusted publisher for `jiggy/jig`, `npm-publish.yml`, and environment
`npm`. Verify package ownership and that configuration before first publication.
There is no npm token or manually entered release version.

Before any registry mutation, the publisher inspects every selected archive,
exact registry version, and channel tag. It rechecks registry state before each
ordered action. Existing versions require byte-for-byte archive identity.
Changed bytes cannot replace an immutable published version.

A missing version older than its channel is superseded without publication,
source tagging, or a GitHub release. Prerelease precedence follows SemVer:
`alpha.10` is newer than `alpha.9`. Delayed runs and retries cannot intentionally
move a channel backward.

The publisher supports `alpha` and `next` tags and never moves `latest`.
If an existing exact version has a missing or older channel tag, it verifies
the bytes and reports the condition. npm trusted-publisher OIDC permits
publication, not `npm dist-tag add`. Channel repair remains a separate
registry-owner action.

After registry verification, the publisher creates missing package source tags:
`agent-method-v<version>`, `agent-acp-v<version>`, and `jig-v<version>`.
New versions tag the exact candidate commit. Existing tags never move.
An unchanged package can retain its earlier release commit.

The publisher then creates missing package-specific GitHub prereleases.
Each entry links the exact npm version, installation command, and public guide.
Retries preserve existing release notes. GitHub source archives remain source
and are not installable npm packages.

### Alpha installation channel

Public npm installation instructions use `@alpha`. Python instructions use
`--pre`. The npm `latest` tag can still name a bootstrap reservation.
Moving `latest` requires a separate registry-owner decision and a verified,
successfully qualified version. Never choose a nonexistent version or move a
tag backward.

### Build inputs and retained archives

Build jobs install Just 1.43.1 and invoke package justfiles. Package manifests
contain no task or lifecycle scripts. Local `just agent::pack`,
`just acp::pack`, and `just jig::pack` build before packing. Publication consumes
only archives already built and qualified by CI.

Bun generates the ignored, disposable root workspace lock, including during
release generation. Regenerate it when needed and
never edit it manually. Independently tracked lockfiles are not disposable.
After version generation, regenerate the root lock before rebuilding local
packages so packed manifests use the current workspace versions.

Clean candidate jobs resolve dependencies from manifests without a committed
root lock. Rebuilding the same source can therefore resolve different
transitive dependencies. The publication guarantee covers the tested, retained
archive, not reproducibility from a source commit alone. Recovery must reuse
that archive.

## Jig licensing and source delivery

Jig's npm archive retains the root license, pricing, and applicable notices.
Source is delivered through the matching `jig-v<version>` GitHub release's
repository source archive. The publication workflow links that archive and the
same tag's build instructions in its release notes. No nested source archive,
source inventory format, or separate source packager belongs in npm builds.
The existing candidate build already builds from a Git archive without Git
metadata; keep that proof rather than maintaining another source-build path.
Complete the adoption notice before issuing an effective grant.

### Build a source release

Download and extract the matching release's **Source code (tar.gz)** or zip.
On Linux x64/glibc, use Bun 1.3.3 (revision
`274e01c737e85f8142070a9745b43a2ba09fce4c`) and Just 1.43.1. From the
extracted repository root:

```sh
bun install --filter @jigging/jig --filter @jigging/display-model --filter @jigging/display-web --filter @jigging/display-tui --ignore-scripts --config=/dev/null
just --justfile packages/jig/justfile build
```

Edit `packages/jig/src` and repeat the build. The launcher is
`packages/jig/bin/jig`. To package your build:

```sh
just --justfile packages/jig/justfile pack --destination /absolute/output/directory
```

Installation needs registry access and resolves transitive dependencies;
this does not promise offline or byte-identical reproduction. Running Jig
also needs the supported host configuration described in its README.

## Failure recovery

For an ordinary Agent candidate, set absolute `FLOW_NODE` and `FLOW_NPM` paths,
then use `just agent-candidate agent-method <new-directory>` or substitute
`agent-acp`. This archives clean tracked source, installs declared development
dependencies, builds and tests the package, and installs its exact archive in
an external npm consumer. It records startup/import evidence, not native-client
qualification or model reliability. The complete Linux host gate remains separate.

If candidate construction fails, fix the source in a new reviewed commit. If
publication may have succeeded but its response or a later gate failed, use
GitHub's **Re-run failed jobs** action. CI's successful candidate jobs are not
rerun, and the publish job converges against their retained seven-day artifacts.
If Host Conformance failed because of a transient host fault, rerun that exact
workflow before rerunning the failed authorization and publication jobs. A
later push is a new candidate, not an uncertainty retry.

## Native Mac support provenance

`just jig::check-native-support` runs during ordinary Jig builds on either OS.
It verifies the checked-in source, build recipe, universal binaries and runtime
pins against `packages/jig/support/macos-native-build.json`. This detects stale
or independently modified inputs; it is not independent source attestation.
On a Mac with the recorded Apple compiler, linker and SDK, run
`just jig::verify-native-rebuild` for byte-for-byte source rebuild verification.
To intentionally change native assets, run `just jig::build-native-support`,
review the regenerated binaries, manifest and runtime pins together, then rerun
native host qualification on both architectures. Consumers never compile them.
