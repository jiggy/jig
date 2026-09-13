# Channel conversation fixture

## Purpose

Exercise installed host channel matching, correlated replies, peer failures,
and cancellation without depending on the public example portfolio.

## Ownership

- `flows/`, `bindings/`, and `input.json` are synthetic host-test inputs.
- `../../private-foreground.test.ts` owns fault injection, expected results,
  and runtime SDK preparation in disposable projects.

## Local Contracts

- Keep this fixture private to host tests; it is not an application tutorial.
- Preserve named meaning, separate child outcomes, rejected dispatch, and cleanup.
- Tests supply the built SDK; this fixture has no workspace dependency manifests.

## Work Guidance

- Add only cases needed by the host proof, not application features.

## Verification

- `bun test packages/jig/test/private-foreground.test.ts` checks construction.
- Actual installed execution requires the provisioned Linux host-conformance job.

## Child DOX Index

- None.
