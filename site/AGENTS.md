# Public sites

## Purpose

Owns the Rspress configuration and static root files for the separate FLOW and
Jig public sites.

## Ownership

- `docs/flow/` and `docs/jig/` own published prose and specifications.
- `flow/` and `jig/` own their site-specific navigation and public-root files.
- `package.json` and `bun.lock` own shared pinned site tooling.

## Local Contracts

- Never maintain copied prose or machine schemas here.
- Exclude repository `AGENTS.md` work contracts from public documentation
  routes.
- Keep origins, navigation, public roots, schemas, contracts, and deployment
  artifacts separate between FLOW and Jig.
- `scripts/build-site.sh` owns fresh staging, exact artifact copying,
  inventory enforcement, and cross-site exclusion.
- Reconcile navigation, `llms.txt`, workflow path filters, and build mappings
  whenever public routes or artifacts change.
- Generated dependency trees, site builds, and deployment artifacts are not
  source.

## Work Guidance

- Change the authoritative document first, then only the navigation or static
  publication metadata required here.

## Verification

- Build each affected site into a fresh output directory with
  `scripts/build-site.sh`.
- Use `scripts/check-site.sh` only to check an already deployed endpoint.

## Child DOX Index

- None.
