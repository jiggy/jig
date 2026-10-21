# Jig public site

## Purpose

Own this repository's Rspress configuration, assets, assembly, and direct GitHub Pages deployment.

## Ownership

- `../docs/jig/` owns public prose, specifications, and source diagrams.
- `jig/` owns product navigation, public roots, origins, and assets.
- `theme/` and `landing.css` own independently copied presentation.
- `package.json` and `bun.lock` pin site dependencies.
- `../scripts/build-site.sh` owns fresh assembly, schema inventory, and Markdown publication checks.
- Jig's client and evaluator references use `/spec/execution-client` and
  `/spec/project-evaluation`. Assembly publishes the exact evaluator invocation
  and recipe schema beside its human identity page. Downloads grant no authority.

## Local Contracts

Never maintain copied prose or normative machine schemas here.
Exclude AGENTS.md work contracts from public routes.
Preserve human pages, exact machine resources, indexed Markdown, font notices, and complete local anchors.
Keep shared presentation changes coherent with the sibling product through deliberate review.
A neighboring checkout is never a build input.

## Verification

Run `scripts/build-site.sh jig .tmp/jig-site` with a fresh destination.
Use `scripts/check-site.sh` for a deployed endpoint.

## Child DOX Index

- [theme/AGENTS.md](theme/AGENTS.md) — Site presentation and accessibility.
