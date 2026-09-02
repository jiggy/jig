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
package, enter its exact manifest version, and select `alpha` or `next`. For the
first paired alpha, publish `flow` first and wait for its refetch gate to pass;
then dispatch `jig` with Jig's own manifest version. Package versions are
independent even when a paired release happens to use matching versions.

The build job checks out source without persisted credentials, installs the
exact build tools, builds and tests once, and uploads the complete candidate
directory for seven days. It has neither an environment nor OIDC authority.
For a Jig candidate only, it uses the existing provisioner to prepare the
disposable runner, while Jig and Flow code remain unprivileged. The protected
publish job has no checkout and executes no project or build code. It downloads
that candidate, checks its manifest, commit, and digest, then uses the npm
bundled with Node 24 after requiring npm 11.5.1 or newer.

If npm reports the exact version absent, the publish job submits it. If the
version already exists—or npm accepted it but its response was lost—the job
downloads it and succeeds only when its bytes and exact dist-tag match the
persisted candidate. Use GitHub's **Re-run failed jobs** action to retry that
publish job against the same retained candidate. A fresh workflow dispatch
always builds a new candidate and is not an uncertainty retry. Never republish
or replace an accepted npm version.

Only after the registry archive and dist-tag converge, create one annotated,
package-specific source tag on the exact candidate commit: `flow-v<version>` or
`jig-v<version>`. Push that tag separately. The workflow intentionally has no
Git write authority and never tags an unverified publication.

## One-time package bootstrap

npm can attach a trusted publisher only to a package which already exists.
Create each identity once with an inert `0.0.0` package. Publish it only under
the `bootstrap` tag, never `latest` or `alpha`:

```console
identity_root=$(mktemp -d .tmp/npm-identities.XXXXXX)
mkdir "$identity_root/flow" "$identity_root/jig"
printf '%s\n' '{"name":"@jigging/flow","version":"0.0.0","description":"Identity placeholder for official FLOW releases.","license":"Apache-2.0","files":[],"publishConfig":{"access":"public"}}' > "$identity_root/flow/package.json"
printf '%s\n' '{"name":"@jigging/jig","version":"0.0.0","description":"Identity placeholder for official Jig releases.","license":"MPL-2.0","files":[],"publishConfig":{"access":"public"}}' > "$identity_root/jig/package.json"
npm login --auth-type=web
bun publish "$identity_root/flow" --access public --tag bootstrap
bun publish "$identity_root/jig" --access public --tag bootstrap
test "$(npm view @jigging/flow dist-tags.bootstrap)" = "0.0.0"
test "$(npm view @jigging/jig dist-tags.bootstrap)" = "0.0.0"
npm dist-tag rm @jigging/flow latest
npm dist-tag rm @jigging/jig latest
npm deprecate '@jigging/flow@0.0.0' 'Identity bootstrap only; install @jigging/flow@alpha.'
npm deprecate '@jigging/jig@0.0.0' 'Identity bootstrap only; install @jigging/jig@alpha.'
```

These two inert identity versions are the only publications without OIDC
provenance. They contain no implementation and are not selected by an install
tag used by Jig or FLOW. Immediately configure the same trusted publisher on
both npm package settings:

```text
Provider:       GitHub Actions
Organization:   jigmd
Repository:     jig
Workflow file:  npm-publish.yml
Environment:    npm
Allowed actions: npm publish
```

In the GitHub repository, create the `npm` environment, require the
desired maintainers as reviewers, and restrict its deployment branch to
`main`. Then publish `@jigging/flow@0.1.0-alpha.1` and
`@jigging/jig@0.1.0-alpha.1`, in that order, through the ordinary GitHub
workflow above. Every functional release is built, proved, published,
refetched, and compared there. Do not put an npm token in this repository or
in GitHub Actions.

The official npm setup is documented at
<https://docs.npmjs.com/trusted-publishers/>.
