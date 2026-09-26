# Public sites

## Purpose

Owns the Rspress configuration and static root files for the separate FLOW and
Jig public sites.

## Ownership

- `docs/flow/` and `docs/jig/` own published prose and specifications.
- `flow/` and `jig/` own their site-specific navigation, styles, and public-root
  files. Each site's `diagrams.css` fits guide SVGs to the reading column;
  source diagrams remain with their owning guide under `docs/`.
- FLOW publishes SDK guides at `/guide/python` and `/guide/typescript`, Markdown
  authoring at `/guide/markdown`, Skill compatibility at `/guide/skills`,
  language and runtime matrix at `/guide/runtimes`, and host/platform integration
  at `/guide/platforms`. Navigation, `llms.txt`, and site assembly keep these routes reachable. Jig introduces
  composition at `/guide/request-triage`; its navigation, generated index, and
  assembly gate keep that walkthrough reachable.
  The bounded factory walkthrough is published at `/guide/software-factory`.
- `theme/` owns the shared default-theme extension; `landing.css` owns shared
  landing and reading presentation. Both deployment triggers include these inputs.
- `package.json` and `bun.lock` own shared pinned site tooling; `justfile` owns
  the FLOW and Jig Rspress build and development server recipes.

## Local Contracts

- Never maintain copied prose or machine schemas here.
- Jig's pricing navigation links to `/pricing`, a site page at `docs/jig/pricing.md`
  that explains free and paid use in plain language. That page links to the canonical
  `PRICING.md` and `LICENSE.md` as the authoritative terms.
- Exclude repository `AGENTS.md` work contracts from public documentation
  routes.
- Keep origins, navigation, public roots, schemas, contracts, and deployment
  artifacts separate between FLOW and Jig.
- Apply `docs/AGENTS.md`'s human-facing identity-URL rule to both sites without
  replacing machine-resource responses with HTML. Jig contract routes serve
  Markdown from `docs/jig/contracts/`; sibling `<name>/contract.json` downloads
  preserve exact invocation bundles, including descriptor-relative channel files. Check both the human pages and machine
  downloads.
- `scripts/build-site.sh` owns fresh staging, exact artifact copying,
  inventory enforcement, and cross-site exclusion.
- Rspress generates `.md` companions, `llms.txt`, and `llms-full.txt` from the
  public pages. Do not maintain separate copies of agent-facing prose.
- Reconcile navigation, generated indexes, workflow path filters, and build mappings
  whenever public routes or artifacts change.
- Generated dependency trees, site builds, and deployment artifacts are not
  source.

## Work Guidance

- Change the authoritative document first, then only the navigation or static
  publication metadata required here.
- Make entrypoints inspiring and task-oriented for developers, agents, and
  teams. Use Rspress's navigation, search, code rendering, and Markdown export
  with focused extensions. Judge presentation against excellent product sites,
  documentation coverage against supported tasks, and simplicity by real paths
  to useful results; avoid unsupported competitive claims.
- Use Rspress’s native Shiki highlighting with One Dark Pro for dark-mode
  code blocks and One Light for light mode on both sites. Shared native color
  replacements preserve their hues while improving token contrast.
  `landing.css` must apply the emitted dark token variables under `html.rp-dark`;
  selecting two palettes in configuration alone does not switch their styles.
- Keep guide diagrams as static images with the existing image zoom. Preserve
  ordinary Markdown, theme inheritance, mobile containment, and image aspect
  ratios; no embedded diagram viewer is needed for the reading path.

## Verification

- Build each affected site into a fresh output directory with
  `scripts/build-site.sh`.
- Use `scripts/check-site.sh` only to check an already deployed endpoint.

## Child DOX Index

- [theme/AGENTS.md](theme/AGENTS.md) — Shared layout extension without product prose.
