import assert from 'node:assert/strict'
import { test } from 'node:test'
import { digest } from './candidate-provenance.mjs'
import {
  macExecutionTiming,
  macJobName,
  requireMacInputBinding,
  requireMacDecisionBinding,
  selectMacShardArtifacts,
  waitForMacPrWinners,
  waitForMacReleaseWorkers,
  latestMacDecisionArtifacts,
} from './macos-host-collect.mjs'
import {
  createFrozenMacPlan,
  INSTALLED_STARTUP_TEST,
  NATIVE_PREREQUISITE_TESTS,
} from './macos-host-test-shards.mjs'
import { macQualificationJobNames, validateMacCoverage } from './macos-qualification.mjs'
import { selectorJobName } from './macos-pr-race.mjs'

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
const decisionContext = {
  repository: 'jiggy/jig',
  source,
  headSha: source,
  runId: 42,
  attempt: 2,
  preparedArtifactId: 40,
  planSha256: 'd'.repeat(64),
}
const decisionRow = (shard, attempt = 1) => ({
  decision: {
    version: 1,
    repository: 'jiggy/jig',
    source,
    runId: 42,
    attempt,
    shard,
    major: 26,
    jobId: shard + 100,
    selectorJobId: shard + 600,
    offerArtifactId: shard + 700,
    offerArtifactDigest: `sha256:${'c'.repeat(64)}`,
    preparedArtifactId: 40,
    planSha256: 'd'.repeat(64),
  },
  artifact: {
    ...artifact(shard, attempt),
    id: shard + 400,
    name: `macos-pr-decision-${shard}-${source}-r42-a${attempt}`,
  },
  job: job(shard, attempt),
  selectorJob: selector(shard, attempt),
})
function selector(shard, attempt = 1) {
  return {
    ...job(shard, attempt, shard + 600),
    name: selectorJobName(shard),
    labels: ['ubuntu-24.04'],
    steps: [
      'Select one ready PR worker',
      'Publish PR shard decision',
      'Watch selected PR worker',
    ].map((name, number) => ({ ...job(shard).steps[0], name, number: number + 1 })),
  }
}
const selection = (overrides = {}) =>
  selectMacShardArtifacts({
    run,
    artifacts: [artifact(0), artifact(1, 2)],
    source,
    decisions: [decisionRow(0), decisionRow(1, 2)],
    decisionContext,
    matrix: {
      include: [
        { major: 26, shard: 0 },
        { major: 26, shard: 1 },
      ],
    },
    now,
    ...overrides,
    jobs: [...(overrides.jobs ?? [job(0), job(1, 2)]), selector(0), selector(1, 2)],
  })

test('only latest decisions for the current prepared-input attempt are eligible', () => {
  const earlier = decisionRow(0)
  const current = decisionRow(0, 2)
  assert.deepEqual(
    latestMacDecisionArtifacts([earlier.artifact, current.artifact], decisionContext, [0]),
    [current.artifact],
  )
  assert.deepEqual(
    latestMacDecisionArtifacts(
      [earlier.artifact],
      { ...decisionContext, minimumDecisionAttempt: 2 },
      [0],
    ),
    [],
  )
  assert.throws(
    () =>
      latestMacDecisionArtifacts(
        [current.artifact, { ...current.artifact, id: 999 }],
        decisionContext,
        [0],
      ),
    /Ambiguous/,
  )
  assert.throws(
    () =>
      latestMacDecisionArtifacts(
        [{ ...current.artifact, name: current.artifact.name.replace(source, 'e'.repeat(40)) }],
        decisionContext,
        [0],
      ),
    /Foreign/,
  )
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
  return { scope: 'release', plan, majors, executions }
}

test('worker evidence must retain its exact pre-test winning decision', () => {
  const row = decisionRow(0)
  const selected = { decision: row.decision, decisionArtifact: row.artifact }
  const binding = {
    decision: row.decision,
    artifact: { id: row.artifact.id, digest: row.artifact.digest },
  }
  assert.doesNotThrow(() => requireMacDecisionBinding(binding, selected))
  for (const changed of [
    { ...binding, extra: true },
    { ...binding, decision: { ...row.decision, major: 15 } },
    { ...binding, artifact: { ...binding.artifact, id: 999 } },
  ])
    assert.throws(() => requireMacDecisionBinding(changed, selected))
})

test('PR collector finishes on fixed winners while the other OS is still queued', async () => {
  const winner = decisionRow(0)
  const loser = {
    ...job(0, 2, 999),
    name: macJobName(15, 0),
    labels: ['macos-15'],
    status: 'queued',
    conclusion: null,
    runner_id: 0,
    runner_name: '',
    steps: [],
  }
  let observations = 0,
    downloads = 0,
    clock = 0
  const result = await waitForMacPrWinners({
    context: decisionContext,
    shards: [0],
    deadline: 1000,
    now: () => clock,
    observe: async () => ({
      artifacts: [winner.artifact],
      jobs: [
        selector(0),
        loser,
        {
          ...winner.job,
          ...(observations++ === 0 ? { status: 'in_progress', conclusion: null } : {}),
        },
      ],
    }),
    readDecision: async () => {
      downloads++
      return winner
    },
    sleep: async () => {
      clock += 100
    },
    report: () => {},
  })
  assert.equal(observations, 2)
  assert.equal(downloads, 1)
  assert.equal(result.selected[0].job.id, winner.job.id)
  assert.equal(result.jobs.find(({ id }) => id === loser.id).status, 'queued')
})

test('PR collector refuses a failed fixed winner and bounds missing-decision observation', async () => {
  const winner = decisionRow(0)
  await assert.rejects(
    waitForMacPrWinners({
      context: decisionContext,
      shards: [0],
      observe: async () => ({
        artifacts: [winner.artifact],
        jobs: [selector(0), { ...winner.job, conclusion: 'failure' }],
      }),
      readDecision: async () => winner,
      report: () => {},
    }),
    /fixed Mac worker did not succeed/,
  )
  let clock = 0
  await assert.rejects(
    waitForMacPrWinners({
      context: decisionContext,
      shards: [0],
      deadline: 2,
      now: () => clock,
      observe: async () => ({ artifacts: [], jobs: [] }),
      readDecision: async () => {
        throw Error('unexpected decision download')
      },
      sleep: async () => {
        clock++
      },
      report: () => {},
    }),
    /observation deadline expired/,
  )
})

test('strict collector waits for both independent majors and rejects failed or retained workers', async () => {
  const matrix = {
    include: [
      { major: 15, shard: 0 },
      { major: 26, shard: 0 },
    ],
  }
  const old = { ...job(0, 2, 150), name: macJobName(15, 0), labels: ['macos-15'] }
  const current = job(0, 2, 260)
  let observations = 0,
    clock = 0
  const result = await waitForMacReleaseWorkers({
    matrix,
    deadline: 1000,
    now: () => clock,
    observe: async () => ({
      run: { ...run, event: 'push' },
      jobs: [
        old,
        { ...current, ...(observations++ === 0 ? { status: 'queued', conclusion: null } : {}) },
      ],
    }),
    sleep: async () => {
      clock += 100
    },
    report: () => {},
  })
  assert.equal(observations, 2)
  assert.equal(result.jobs.length, 2)
  for (const changes of [
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { conclusion: 'skipped' },
    { run_attempt: 1 },
  ])
    await assert.rejects(
      waitForMacReleaseWorkers({
        matrix,
        observe: async () => ({
          run: { ...run, event: 'push' },
          jobs: [old, { ...current, ...changes }],
        }),
        report: () => {},
      }),
      /did not succeed|fresh current-attempt/,
    )
})

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
