# Semantic selection package

## Purpose

Make bounded method selection reusable while leaving dispatch authority and acceptance with applications.

## Ownership

- `src/decision.ts` owns public input and complete result validation.
- `src/route.ts` owns one ordinary Agent call and its generic applicability prompt.
- `src/flow.ts` owns the ordinary Flow entrypoint and optional Selection view.
- `contracts/` retains complete Agent Run and reporting bundles.
- `justfile` builds declarations and the standalone runtime before ordinary packing.
- `test/` owns pure validation and failure policy, real Run/0 cancellation and decision boundaries, views, and installed archive checks.
- `examples/` owns application policy separately from the generic selector.

## Local Contracts

- The public root export contains validators and their types. Other modules remain internal.
- Accept task text and at most 16 distinct opaque candidate IDs with descriptions.
- Snapshot and validate input before Agent work. Validate exact result membership independently at the caller boundary.
- Empty sets abstain without Agent work. A single candidate still requires an applicability judgment.
- Preserve abstention, Agent refusal, exhaustion, cancellation, and operational failure as distinct results.
- Make one Agent call without automatic retry, fallback, discovery, or dispatch.
- Generic source contains no domain candidates, target paths, provider clients, credentials, filesystem discovery, or host imports.
- Prompt rules guide probabilistic judgment. Membership does not prove suitability, prompt-injection resistance, acceptance, or execution permission.
- Bundle runtime dependencies. Installed consumers require no build hook or development dependencies.
- Preserve copied descriptor-relative channel paths and third-party licenses.
- Scope Selection targets to supplied candidates. Derive their labels from the candidate count.

## Work Guidance

- Keep domain eligibility, evaluation, repair, adapters, and permission in application code.
- Use the ordinary replaceable Agent contract. Add no host-native semantic operation.
- Keep deterministic protocol evidence separate from live semantic quality.

## Verification

- `just router::build` and `just router::test` build and check the package.
- The package recipe runs Bun tests and all Node test files separately.
- The Node pack test installs a real archive into a fresh consumer and exercises Run/0.
- Selector tests launch the production bundled Flow. Controlled Agent replies cross the actual protocol boundary.
- `packages/jig/test/host/installed-semantic-recovery.test.ts` qualifies admitted recovery on supported native hosts.
- The canonical router candidate profile separately checks the exact frozen archive.

## Child DOX Index

- [examples/recover-draft/AGENTS.md](examples/recover-draft/AGENTS.md) — Application-owned checkpoint recovery, adaptation, and acceptance.
