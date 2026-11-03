# Reference documentation

## Purpose

Help readers locate settings, terms, limits, diagnostic steps, and exact contracts.

## Ownership

`index.md` routes exact lookup. `configuration.md` owns operator settings.
`glossary.md` defines introductory terms.
`limits.md` contains tables derived by `scripts/limit-reference.ts`.
`troubleshooting.md` owns operational diagnosis and recovery across setup, review, execution, conversations, results, and cleanup.

## Local Contracts

Keep current support qualified.
Edit generated limit values at their implementation owner.
Keep task walkthroughs in `../start/` and `../build/`.
Group troubleshooting by the failed task, with contextual links from those walkthroughs.
Keep settings definitions and generated numeric limits with their respective owners.
Do not create a separate page for one exceptional diagnostic.

## Work Guidance

Apply the parent documentation and technical English rules.

## Verification

Run `bun scripts/check-docs.ts` and a fresh Jig site build.

## Child DOX Index

- None.
