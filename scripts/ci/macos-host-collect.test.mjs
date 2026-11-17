import assert from 'node:assert/strict'
import { test } from 'node:test'
import { digest } from './candidate-provenance.mjs'
import {
  macExecutionTiming,
  macJobName,
  requireMacInputBinding,
  selectMacShardArtifacts,
} from './macos-host-collect.mjs'
import {
  createFrozenMacPlan,
  INSTALLED_STARTUP_TEST,
  NATIVE_PREREQUISITE_TESTS,
} from './macos-host-test-shards.mjs'
import { macQualificationJobNames, validateMacCoverage } from './macos-qualification.mjs'

const source = 'a'.repeat(40)
const now = Date.parse('2026-11-17T00:30:00Z')
const run = {
  id: 42,
  run_attempt: 2,
  head_sha: source,
  event: 'pull_request',
  created_at: '2026-11-17T00:00:00Z',
}
const job = (shard, attempt = 1, id = shard + 100) => ({
  id,
  name: macJobName(26, shard),
  run_id: 42,
  run_attempt: attempt,
  head_sha: source,
  status: 'completed',
  conclusion: 'success',
  runner_id: 200,
  runner_name: 'disposable-ARM',
  labels: ['macos-26'],
  created_at: '2026-11-17T00:00:00Z',
  started_at: '2026-11-17T00:01:00Z',
  completed_at: '2026-11-17T00:20:00Z',
  steps: [
    {
      number: 1,
      name: 'Native proof',
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-11-17T00:01:00Z',
      completed_at: '2026-11-17T00:20:00Z',
    },
  ],
})
const artifact = (shard, attempt = 1) => ({
  id: shard + 300,
  name: `macos-prerequisites-26-${shard}-${source}-r42-a${attempt}`,
  expired: false,
  expires_at: '2026-11-24T00:00:00Z',
  digest: `sha256:${'b'.repeat(64)}`,
  workflow_run: { id: 42, head_sha: source },
})
const selection = (overrides = {}) =>
  selectMacShardArtifacts({
    run,
    jobs: [job(0), job(1, 2)],
    artifacts: [artifact(0), artifact(1, 2)],
    source,
    matrix: {
      include: [
        { major: 26, shard: 0 },
        { major: 26, shard: 1 },
      ],
    },
    now,
    ...overrides,
  })

test('failed-job retry retains immutable successful original execution, including GitHub carried rows', () => {
  const original = job(0)
  const carried = { ...original, id: 999, run_attempt: 2, created_at: '2026-11-17T00:25:00Z' }
  const rows = selection({ jobs: [original, carried, job(1, 2)] })
  assert.deepEqual(
    rows.map((row) => [row.job.id, row.job.run_attempt, row.artifact.id]),
    [
      [100, 1, 300],
      [101, 2, 301],
    ],
  )
})

test('latest actual failure, missing evidence, ambiguous artifacts and foreign jobs cannot fall back to green', () => {
  for (const overrides of [
    { jobs: [job(0), { ...job(0, 2, 500), conclusion: 'failure' }, job(1, 2)] },
    { artifacts: [artifact(0)] },
    { artifacts: [artifact(0), artifact(0), artifact(1, 2)] },
    { jobs: [{ ...job(0), head_sha: 'c'.repeat(40) }, job(1, 2)] },
    { jobs: [{ ...job(0), runner_id: 0, runner_name: '', steps: [] }, job(1, 2)] },
    { jobs: [{ ...job(0), labels: ['macos-15'] }, job(1, 2)] },
  ])
    assert.throws(() => selection(overrides))
})

test('main qualification never retains earlier attempts and retries expire after 24 hours', () => {
  assert.throws(() => selection({ run: { ...run, event: 'push' } }), /fresh current-attempt/)
  assert.throws(() => selection({ now: now + 24 * 60 * 60 * 1000 }), /24-hour/)
  assert.throws(() => selection({ run: { ...run, created_at: 'invalid' } }), /24-hour/)
})

test('queue and execution timings require an actual assigned host and ordered timestamps', () => {
  assert.deepEqual(macExecutionTiming(job(0), 26), { waitSeconds: 60, executionSeconds: 1140 })
  for (const changes of [
    { started_at: 'invalid' },
    { completed_at: '2026-11-17T00:00:00Z' },
    { created_at: '2026-11-17T00:25:00Z' },
    { steps: [] },
    { steps: [{ status: 'completed', conclusion: 'failure' }] },
  ])
    assert.throws(() => macExecutionTiming({ ...job(0), ...changes }, 26))
})

test('each retained shard binds the immutable prepared artifact and exact frozen plan bytes', () => {
  const planBytes = Buffer.from('{"frozen":"plan"}\n')
  const inputArtifact = { id: 40 }
  const binding = { sourceRevision: source, inputArtifactId: 40, planSha256: digest(planBytes) }
  assert.doesNotThrow(() => requireMacInputBinding(binding, { source, inputArtifact, planBytes }))
  for (const changes of [
    { sourceRevision: 'c'.repeat(40) },
    { inputArtifactId: 41 },
    { planSha256: '0'.repeat(64) },
  ])
    assert.throws(() =>
      requireMacInputBinding({ ...binding, ...changes }, { source, inputArtifact, planBytes }),
    )
})

function coverageFixture() {
  const plan = createFrozenMacPlan(
    [
      ...NATIVE_PREREQUISITE_TESTS,
      INSTALLED_STARTUP_TEST,
      'packages/jig/test/host/a.test.ts',
      'packages/jig/test/host/b.test.ts',
      'packages/jig/test/host/c.test.ts',
    ],
    'arm64',
    { source, policy: { targetSeconds: 1200, minShards: 2, maxShards: 2 } },
  )
  const majors = [15, 26]
  const executions = majors.flatMap((major) =>
    plan.shards.map(({ index: shard }) => ({
      major,
      shard,
      jobId: major * 100 + shard,
      name: macJobName(major, shard),
      runAttempt: 2,
      artifactId: major * 200 + shard,
      artifactDigest: `sha256:${'b'.repeat(64)}`,
    })),
  )
  return { plan, majors, executions }
}

test('release coverage derives every required job from the frozen plan for both compatibility majors', () => {
  const coverage = coverageFixture()
  assert.equal(validateMacCoverage(coverage, { source, attempt: 2 }), coverage)
  assert.deepEqual(macQualificationJobNames(coverage), [
    macJobName(15, 0),
    macJobName(15, 1),
    macJobName(26, 0),
    macJobName(26, 1),
  ])
  for (const change of [
    (value) => {
      value.majors = [26]
    },
    (value) => {
      value.executions.pop()
    },
    (value) => {
      value.executions[0].runAttempt = 1
    },
    (value) => {
      value.executions[0].jobId = value.executions[1].jobId
    },
    (value) => {
      value.plan.policy.maxShards = 3
    },
    (value) => {
      value.plan.source = 'c'.repeat(40)
    },
  ]) {
    const modified = structuredClone(coverage)
    change(modified)
    assert.throws(() => validateMacCoverage(modified, { source, attempt: 2 }))
  }
})
