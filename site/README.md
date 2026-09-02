# Public sites

Jig and FLOW are developed in one repository for the first release, but they
have separate public documentation surfaces:

```text
docs/flow + site/flow  -> https://flow.jig.md
docs/jig  + site/jig   -> https://jig.md
```

The root `site/package.json` and lock are shared build tooling. Public content,
navigation, machine files, origins, and deployment artifacts are not shared.

Build either site from the repository root:

```console
scripts/build-site.sh flow .tmp/flow-site
scripts/build-site.sh jig .tmp/jig-site
```

The main repository's `pages.yml` deploys only FLOW. GitHub Pages allows one
Pages site per repository, so Jig uses a small deployment-only repository:

1. Create the public repository `jigmd/jig-site`.
2. Copy `site/jig/pages-workflow.yml` there as
   `.github/workflows/pages.yml`.
3. In that repository, set **Pages → Source** to **GitHub Actions**.
4. Set its Pages custom domain to `jig.md` and enforce HTTPS after the
   certificate is ready.
5. Configure the `jig.md` apex DNS record using GitHub Pages' documented
   `ALIAS`, `ANAME`, or `A`/`AAAA` values.
6. Once `jigmd/jig` is public, manually run **Jig Pages** with the exact source
   commit SHA to deploy.

The deployment repository contains no authoritative documentation or product
code. A later FLOW repository split can move `docs/flow`, `site/flow`, FLOW
SDKs, and conformance together without changing `flow.jig.md` URLs.
