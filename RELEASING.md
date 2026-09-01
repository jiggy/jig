# npm prerelease publishing

Jig publishes one npm package per manual GitHub Actions dispatch. The workflow
builds that candidate once, checks its manifest and recorded digest, publishes
that exact archive with npm trusted publishing, then downloads the registry
archive and requires its bytes and selected dist-tag to match.

The workflow never chooses or changes a version, writes to Git, creates a tag,
or publishes from a rebuilt archive. `alpha` and `next` are the only permitted
dist-tags; `latest` is untouched.

## Ordinary release

Prepare one reviewed commit on `main` which:

1. sets the exact prerelease version in the package manifest;
2. removes that package's `private` guard;
3. updates its packed-package assertions to that final manifest;
4. contains every source, lock, notice, and manifest change for the release;
   and
5. passes the source, packed-package, Operational Baseline/1, and applicable
   Linux hostile gates.

Do not remove a private guard before that final release change. The publish
workflow deliberately stops with a specific error while the selected package's
guard remains.

From GitHub Actions, run **Publish npm prerelease** on `main`. Select one
package, enter its exact manifest version, and select `alpha` or `next`. Publish
`flow` first and wait for its refetch gate to pass; then dispatch `jig` with the
same version and tag. The Jig publish job enforces that order against npm.

The unprivileged build job checks out source without persisted credentials,
installs the exact build tools, builds and tests once, and uploads the complete
candidate directory for seven days. It has neither an environment nor OIDC
authority. The protected publish job has no checkout and executes no project
or build code. It downloads that candidate, checks its manifest, commit, and
digest, then uses the npm bundled with Node 24 after requiring npm 11.5.1 or
newer.

If npm reports the exact version absent, the publish job submits it. If the
version already exists—or npm accepted it but its response was lost—the job
downloads it and succeeds only when its bytes and exact dist-tag match the
persisted candidate. Use GitHub's **Re-run failed jobs** action to retry that
publish job against the same retained candidate. A fresh workflow dispatch
always builds a new candidate and is not an uncertainty retry. Never republish
or replace an accepted npm version.

## One-time package bootstrap

npm can attach a trusted publisher only to a package which already exists.
The first real prerelease of each package therefore needs one authenticated
publication. Do not publish a placeholder package.

From the exact reviewed release commit, with Node 24, npm 11.6.2 or newer, and
Bun 1.3.3 installed, build the two candidates once:

```console
export FLOW_NODE="$(command -v node)"
export FLOW_NPM="$(command -v npm)"
export JIG_NPM="$FLOW_NPM"
scripts/build-flow-sdk-candidate.sh .tmp/npm-bootstrap/flow
scripts/build-jig-candidate.sh .tmp/npm-bootstrap/jig
```

Check both `SUCCESS.json` records and archive digests. Authenticate
interactively with an npm owner account protected by two-factor
authentication, then publish Flow under the prerelease tag:

```console
npm login --auth-type=web
npm publish .tmp/npm-bootstrap/flow/*.tgz --access public --tag alpha --ignore-scripts
```

Refetch that exact version, compare its archive digest with the local candidate,
and confirm the tag before publishing Jig:

```console
FLOW_VERSION=$(node -p "require('./packages/flow-sdk/package.json').version")
mkdir -p .tmp/npm-bootstrap/refetched-flow
npm pack "@jigging/flow@$FLOW_VERSION" --pack-destination .tmp/npm-bootstrap/refetched-flow --ignore-scripts
test "$(sha256sum .tmp/npm-bootstrap/flow/*.tgz | cut -d' ' -f1)" = \
  "$(sha256sum .tmp/npm-bootstrap/refetched-flow/*.tgz | cut -d' ' -f1)"
test "$(npm view @jigging/flow dist-tags.alpha)" = "$FLOW_VERSION"
```

Before publishing Jig, install the still-local Jig candidate into a temporary
consumer and complete the root README quickstart on the supported rootless
host. The example Flow's `package.json` must name
the exact version printed by `$FLOW_VERSION` (for example,
`"@jigging/flow": "0.1.0-alpha.1"`). Generate `bun.lock` from the ordinary
default npm registry, then require `jig check`, `jig run`, and the expected
greeting terminal to succeed. A file archive, local registry, workspace link,
or unpublished SDK tree does not satisfy this author smoke.

Only after that gate passes, publish and refetch Jig:

```console
npm publish .tmp/npm-bootstrap/jig/*.tgz --access public --tag alpha --ignore-scripts
JIG_VERSION=$(node -p "require('./packages/jig/package.json').version")
mkdir -p .tmp/npm-bootstrap/refetched-jig
npm pack "@jigging/jig@$JIG_VERSION" --pack-destination .tmp/npm-bootstrap/refetched-jig --ignore-scripts
test "$(sha256sum .tmp/npm-bootstrap/jig/*.tgz | cut -d' ' -f1)" = \
  "$(sha256sum .tmp/npm-bootstrap/refetched-jig/*.tgz | cut -d' ' -f1)"
test "$(npm view @jigging/jig dist-tags.alpha)" = "$JIG_VERSION"
```

These two first publications are the only exception to OIDC provenance; the
absence of provenance is expected only for this bootstrap. Do not put an npm
token in this repository or in GitHub Actions.

Immediately configure the trusted publisher on both npm package settings:

```text
Provider:       GitHub Actions
Organization:   jigmd
Repository:     jig
Workflow file:  npm-publish.yml
Environment:    npm-alpha
Allowed actions: npm publish
```

In the GitHub repository, create the `npm-alpha` environment, require the
desired maintainers as reviewers, and restrict its deployment branch to
`main`. Subsequent prereleases use only the workflow and OIDC. The repository
must be public for the intended provenance and public-release posture.

The official npm setup is documented at
<https://docs.npmjs.com/trusted-publishers/>.
