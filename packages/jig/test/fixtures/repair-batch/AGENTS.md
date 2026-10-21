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
  public example. Do not maintain private copies of those implementations.

## Local Contracts

- `batch.ts` imports the current read-project, check-repair and export-patch
  helpers for source-level units. Assembly copies those exact helper bytes
  into package-local subdirectories and rewrites only the fixture import
  prefix. Host execution uses the unchanged current helpers, never a
  maintained private implementation. The public single-project coordinator
  stays unchanged.
- `../../portable/repair-monitoring.test.ts` checks the actual progress formatter.
  It does not replace child dispatch or channel lifecycle.
  Batch execution requires the installed native suite.
- Keep this fixture private to tests. It is not a recommended example or a
  second application distribution.
- Preserve separate worker identities, fixed acceptance cases, and checkpoints.
- Store deliberately failing sample checks as `project.test.ts.txt`. The host
  test assembles them as `project.test.ts` in its disposable project. Ordinary
  repository test discovery must not run these unrepaired sample checks.

## Work Guidance

- Add only host-proof inputs. No public application features.

## Verification

- `bun test packages/jig/test/root-agent-run-lifecycle.test.ts` checks assembly.
- Real execution requires the provisioned Linux host-conformance workflow.

## Child DOX Index

- None.
