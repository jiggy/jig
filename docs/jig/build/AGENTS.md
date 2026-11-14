# Build documentation

## Purpose

Teach practical applications built from code and Agent methods.

## Ownership

Task guides own composition, Agent setup, dependencies, effects, files,
conversations, progress, project design, collaboration, and result interpretation.
`results.md` explains live application maps alongside observed calls, without implying sequence, branch evaluation, or saved invocation history.
It also owns the pre-run explorer guide, explicit input and launch steps,
supported interfaces, and separate Close meanings. It teaches explicit
two-packet comparison without inventing saved invocation history.
`../reference/troubleshooting.md` owns operational diagnosis and recovery procedures.

## Local Contracts

Start with prerequisites, complete setup, expected results, and a contextual troubleshooting link.
Introduce optional controls only when the task needs them.
Centralize Agent setup in `agents.md`.
Keep result semantics and required safety conditions beside their actions.
Link repair procedures to the shared troubleshooting guide instead of duplicating them.
Keep portable method semantics with FLOW and exact host requirements in `../spec/`.

## Work Guidance

Apply the parent documentation and technical English rules.

## Verification

Run `bun scripts/check-docs.ts` and a fresh Jig site build.

## Child DOX Index

- None.
