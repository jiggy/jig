# Visual Flow experiments

## Purpose

Test whether existing declarations and runtime descriptions support useful read-only diagrams.

## Ownership

This directory owns isolated research scripts, their focused tests, and the recorded Sley example.
It owns no Jig runtime behavior, public command, FLOW contract, or admission decision.

## Local Contracts

- Treat every configured edge as a possible invocation, never execution order.
- Keep Binding identities separate from package identities.
- Preserve explicit unknowns and evidence provenance.
- Read source as data and reject unsupported syntax without evaluation.
- Keep source selection consistent with the public project authoring contract.
- Do not export settings, resource policies, attachment source paths, or entrypoint arguments.
- Consume runtime-owned topology without reconstructing its scheduler.
- Record actual handler observations separately from declared edges.
- Preserve source-qualified and installed-artifact evidence as different claims.
- Keep generated explorers and transient receipts in `.tmp/`.

## Work Guidance

Prefer the existing resolved graph for future product integration.
The source parser is a bounded research comparison, not another project evaluator.
Do not expand this experiment into a public framework without a demonstrated consumer.

## Verification

Run `node --test scripts/experiments/visual-flows/*.test.mjs` from the repository root.
Run the source explorer against the unchanged examples.
Run the optional Sley probe against its pinned source before updating recorded evidence.
State missing browser or host qualification explicitly.

## Child DOX Index

- None.
