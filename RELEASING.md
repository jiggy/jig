# npm prerelease publishing

Jig publishes npm prereleases from one manual GitHub Actions workflow. The
workflow builds each candidate once, checks its manifest and recorded digest,
publishes those exact archives with npm trusted publishing, then downloads the
registry archives and requires their bytes and selected dist-tag to match.

The workflow never chooses or changes a version, writes to Git, creates a tag,
or publishes from a rebuilt archive. `alpha` and `next` are the only permitted
dist-tags; `latest` is untouched.

## Ordinary release

Prepare one reviewed commit on `main` which:

1. sets the same exact prerelease version in `packages/flow-sdk/package.json`
   and `packages/jig/package.json`;
2. removes each package's `private` guard;
3. updates the packed-package assertions to that final manifest;
4. contains every source, lock, notice, and manifest change for that release;
   and
5. passes the source, packed-package, Operational Baseline/1, and applicable
   Linux hostile gates.

Do not remove the private guards before that final release change. The publish
workflow deliberately stops with a specific error while either guard remains.

From GitHub Actions, run **Publish npm prerelease** on `main`. Enter the exact
manifest version and select `alpha` or `next`. The `npm-alpha` environment
should require maintainer approval and permit deployment only from `main`.

The workflow uses a GitHub-hosted Ubuntu runner, Node 24, npm 11.6.2, Bun
1.3.3, least repository permissions, and npm OIDC. It first proves that neither
immutable npm version exists. Both archives are built and verified before the
first publish. npm cannot publish two packages transactionally, so the Flow
SDK is published first; a later Jig failure must be repaired with the same
unchanged version only if npm reports that Jig was never accepted. Never
republish or replace an accepted npm version.

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
authentication, then publish the exact archives under the prerelease tag:

```console
npm login --auth-type=web
npm publish .tmp/npm-bootstrap/flow/*.tgz --access public --tag alpha --ignore-scripts
npm publish .tmp/npm-bootstrap/jig/*.tgz --access public --tag alpha --ignore-scripts
```

This is the sole non-OIDC bootstrap. Do not put an npm token in this repository
or in GitHub Actions.

Immediately configure the trusted publisher on both npm package settings:

```text
Provider:       GitHub Actions
Organization:   jigmd
Repository:     jig
Workflow file:  npm-publish.yml
Environment:    npm-alpha
```

In the GitHub repository, create the `npm-alpha` environment, require the
desired maintainers as reviewers, and restrict its deployment branch to
`main`. Subsequent prereleases use only the workflow and OIDC. The repository
must be public for the intended provenance and public-release posture.

The official npm setup is documented at
<https://docs.npmjs.com/trusted-publishers/>.
