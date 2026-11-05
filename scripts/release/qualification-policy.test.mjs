import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  collectPage,
  nativeCreationBoundary,
  newerNative,
  validateArtifact,
  validateJobs,
  validateLatestPush,
  validateNativeArtifacts,
  validateRun,
  validateSnapshot,
} from './qualification-policy.mjs'

const source = 'a'.repeat(40),
  repository = 'fixture/jig'
const expected = {
  runId: 4,
  runAttempt: 2,
  workflowPath: '.github/workflows/native-agent-api-qualification.yml',
  event: 'workflow_run',
  headSha: 'b'.repeat(40),
  headBranch: 'main',
  headRepository: repository,
  jobs: [{ runId: 4, runAttempt: 2, name: 'codex', jobId: 41 }],
}
const run = {
  id: 4,
  run_attempt: 2,
  path: expected.workflowPath,
  event: expected.event,
  head_sha: expected.headSha,
  head_branch: 'main',
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-01-01T00:00:04Z',
}
const snapshot = {
  schemaVersion: 1,
  repository,
  group: 'host',
  sourceRevision: source,
  candidate: { receiptSha256: 'c'.repeat(64) },
  runs: Array(4).fill(expected),
  artifacts: Array(6).fill({}),
}
const job = { id: 41, name: 'codex', run_attempt: 2, status: 'completed', conclusion: 'success' }

test('current attempts, job identities and complete snapshots remain required', () => {
  const context = { repository, group: 'host', source, receipt: 'c'.repeat(64) }
  validateSnapshot(snapshot, context)
  for (const changes of [
    { source: 'b'.repeat(40) },
    { receipt: '0'.repeat(64) },
    { group: 'flow' },
  ])
    assert.throws(() => validateSnapshot(snapshot, { ...context, ...changes }))
  validateRun(expected, run, repository)
  for (const changes of [
    { run_attempt: 3 },
    { conclusion: 'failure' },
    { status: 'waiting' },
    { head_sha: source },
    { head_branch: 'foreign' },
    { path: 'ci.yml' },
  ])
    assert.throws(() => validateRun(expected, { ...run, ...changes }, repository))
  validateJobs(expected, [job])
  for (const jobs of [
    [],
    [job, job],
    [{ ...job, conclusion: 'failure' }],
    [{ ...job, id: 42 }],
    [{ ...job, run_attempt: 1 }],
  ])
    assert.throws(() => validateJobs(expected, jobs))
})

test('newer same-source pushes supersede queue authorization', () => {
  const push = { ...expected, event: 'push', headSha: source }
  const current = { ...run, event: 'push', head_sha: source }
  validateLatestPush(snapshot, push, [current])
  assert.throws(() => validateLatestPush(snapshot, push, [current, { ...current, id: 9 }]))
  assert.throws(() => validateLatestPush(snapshot, push, [{ ...current, run_attempt: 3 }]))
})

test('native history uses an inclusive validated creation boundary and retains pending supersession', () => {
  assert.equal(nativeCreationBoundary(run), run.created_at)
  for (const created_at of [
    undefined,
    null,
    '',
    'invalid',
    '2026-02-30T00:00:00Z',
    '2099-01-01T00:00:00Z',
  ])
    assert.throws(() => nativeCreationBoundary({ ...run, created_at }))
  const newer = {
    ...run,
    id: 5000,
    created_at: run.created_at,
    status: 'waiting',
    conclusion: null,
  }
  assert.ok(newerNative(snapshot, expected, newer))
  for (const prefix of ['inputs', 'qualification']) {
    assert.throws(() =>
      validateNativeArtifacts(snapshot, newer, [
        { name: `native-${prefix}-codex-${source}-r5000-a1` },
      ]),
    )
    validateNativeArtifacts(snapshot, newer, [
      { name: `native-${prefix}-codex-${'f'.repeat(40)}-r5000-a1` },
    ])
  }
  assert.throws(() =>
    validateNativeArtifacts(
      snapshot,
      { ...newer, event: 'workflow_dispatch', head_sha: source },
      [],
    ),
  )
  assert.equal(newerNative(snapshot, expected, { ...newer, head_branch: 'feature' }), false)
  assert.equal(newerNative(snapshot, expected, { ...newer, id: 3 }), false)
  const query = new URLSearchParams({ created: `>=${nativeCreationBoundary(run)}` })
  assert.equal(query.get('created'), '>=2026-01-01T00:00:04Z')
})

test('artifact expiry, replacement and incomplete pagination refuse publication', () => {
  const proof = { artifactId: 1, name: 'proof', digest: 'sha256:digest', runId: 4, headSha: source }
  const artifact = {
    id: 1,
    name: 'proof',
    digest: proof.digest,
    expired: false,
    expires_at: '2099-01-01T00:00:00Z',
    workflow_run: { id: 4, head_sha: source },
  }
  validateArtifact(proof, artifact)
  for (const changes of [
    { expired: true },
    { expires_at: '2000-01-01T00:00:00Z' },
    { digest: 'changed' },
    { workflow_run: { id: 5, head_sha: source } },
  ])
    assert.throws(() => validateArtifact(proof, { ...artifact, ...changes }))
  const values = []
  assert.equal(
    collectPage({ workflow_runs: Array(100).fill(run) }, 'workflow_runs', values, 1),
    false,
  )
  assert.equal(collectPage({ workflow_runs: [] }, 'workflow_runs', values, 2), true)
  assert.throws(
    () => collectPage({ workflow_runs: Array(100).fill(run) }, 'workflow_runs', [], 10),
    /pagination/,
  )
  assert.throws(() => collectPage({}, 'workflow_runs', [], 1), /Malformed/)
})
