# Public sites

Jig and FLOW are developed in one repository for the first release, but they
have separate public documentation surfaces:

```text
docs/flow + site/flow  -> https://flow.jig.md
docs/jig  + site/jig   -> https://jig.md
```

The `site/package.json`, lock, and justfile are shared build tooling. Public content,
navigation, machine files, origins, and deployment artifacts are not shared.

Build either site from the repository root with Bun and Just 1.43.1 or newer
(both are provided by `nix-shell`):

```console
scripts/build-site.sh flow .tmp/flow-site
scripts/build-site.sh jig .tmp/jig-site
```

Rspress supplies local search, grouped sidebars, page outlines, code copying,
language tabs, edit links, and page navigation. The shared theme adds the
product presentation and accessible interaction details without copying the
whole default theme. Product-specific walkthrough content lives in homepage
frontmatter under `docs/`.

Both builds generate a Markdown companion for every public page, `/llms.txt`
in sidebar order, and `/llms-full.txt`. Readers can copy the current page or
open its Markdown directly. Assembly checks coverage before promoting the
artifact and preserves each product's separate schemas and descriptors.

Fonts are self-hosted: Manrope and JetBrains Mono, from the respective
Fontsource variable packages at 5.3.0. Their SIL Open Font License notices are
published under `/font-licenses/`; no third-party font request is needed.

Verify visual changes in both themes, with keyboard navigation and reduced
motion, at desktop, tablet, and narrow mobile widths. Include the search
empty state, first-run path, language and walkthrough tabs, and actual Markdown
copy payload. Keep screenshots and browser reports in `.tmp/`. Target AAA text
contrast, while reporting automated accessibility evidence separately from
full conformance and perceptual review.

The main repository's `pages.yml` deploys only FLOW. GitHub Pages allows one
Pages site per repository, so Jig uses a small deployment-only repository:

1. Create the public repository `jiggy/jig-site`.
2. Copy `site/jig/pages-workflow.yml` there as `.github/workflows/pages.yml`.
   Keep that copy synchronized when its build-tool requirements change.
3. In that repository, set **Pages → Source** to **GitHub Actions**.
4. Set its Pages custom domain to `jig.md` and enforce HTTPS after the
   certificate is ready.
5. Configure the `jig.md` apex DNS record using GitHub Pages' documented
   `ALIAS`, `ANAME`, or `A`/`AAAA` values.
6. Create a fine-grained GitHub token with access only to `jiggy/jig-site` and
   **Actions: read and write**, then save it in `jiggy/jig` as the repository
   secret `JIG_SITE_DISPATCH_TOKEN`.
7. Manually run **Jig Pages** once to verify the deployment. It deploys the
   current `main` branch by default; an exact commit may be supplied when a
   historical deployment is intentional.

After that, changes to Jig documentation, site content, or shared site build
inputs on `jiggy/jig`'s `main` branch automatically dispatch the corresponding
source commit to `jiggy/jig-site`. The token can start that workflow but the
deployment continues to use `jig-site`'s own Pages authority.

The deployment repository contains no authoritative documentation or product
code. A later FLOW repository split can move `docs/flow`, `site/flow`, FLOW
SDKs, and conformance together without changing `flow.jig.md` URLs.
