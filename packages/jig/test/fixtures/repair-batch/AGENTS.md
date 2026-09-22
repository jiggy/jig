# Batch repair host fixture

## Purpose

Preserve installed evidence for two contained repair workers and retained
checkpoint aggregates without adding batch behavior to the introductory example.

## Ownership

- The files here overlay the public tested-patch application in disposable
  host-test projects. They own only batch orchestration and timesheet inputs.
- `../../root-agent-run-lifecycle.test.ts` owns assembly, synthetic Agent
  responses, command execution, result assertions, and cleanup.
- Source capture, patch acceptance, and the repair leaf come from the current
  public example; do not maintain private copies of those implementations.

## Local Contracts

- `batch.ts` imports the public evidence/check helpers for source-level units.
  Assembly rewrites only that fixture import prefix to package-local paths;
  host execution uses the unchanged public helpers, never a private duplicate.
- The retained monitor and wiring have deterministic channel lifecycle tests
  in `test/repair-monitoring.test.ts`; batch cases live in
  `test/repair-batch.test.ts`. These are not live Agent evidence.
- Keep this fixture private to tests. It is not a recommended example or a
  second application distribution.
- Preserve separate worker identities, fixed acceptance cases, and checkpoints.
- Store deliberately failing sample checks as `project.test.ts.txt`; the host
  test assembles them as `project.test.ts` in its disposable project. Ordinary
  repository test discovery must not run these unrepaired sample checks.

## Work Guidance

- Add only host-proof inputs; no public application features.

## Verification

- `bun test packages/jig/test/root-agent-run-lifecycle.test.ts` checks assembly.
- Real execution requires the provisioned Linux host-conformance workflow.

## Child DOX Index

- None.
