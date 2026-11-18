import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { digest } from './candidate-provenance.mjs'
import {
  latestMacDecisionArtifacts,
  MACOS_WORKFLOW,
  macExecutionTiming,
  macJobName,
  requireMacDecisionBinding,
  requireMacInputBinding,
  selectMacShardArtifacts,
  waitForMacPrWinners,
  waitForMacReleaseWorkers,
} from './macos-host-collect.mjs'
import {
  createFrozenMacPlan,
  INSTALLED_STARTUP_TEST,
  NATIVE_PREREQUISITE_TESTS,
} from './macos-host-test-shards.mjs'
import { selectorJobName } from './macos-pr-race.mjs'
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

test('release collector retries transient jobs API errors before validating the metadata', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-mac-collector-api-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const repository = 'jiggy/jig'
  const fixture = JSON.stringify({
    ...run,
    event: 'push',
    path: MACOS_WORKFLOW,
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    head_branch: 'main',
  })
  const requests = join(directory, 'requests')
  await writeFile(
    join(directory, 'gh'),
    `#!/bin/sh
case "$2" in
  */runs/42) printf '%s\\n' '${fixture}' ;;
  */runs/42/jobs*)
    if [ ! -e "$MOCK_REQUESTS" ]; then
      printf '%s\\n' unavailable > "$MOCK_REQUESTS"
      printf '%s\\n' 'gh: Server Error (HTTP 502)' >&2
      exit 1
    fi
    if [ ! -e "$MOCK_REQUESTS.cancelled" ]; then
      printf '%s\\n' interrupted >> "$MOCK_REQUESTS"
      : > "$MOCK_REQUESTS.cancelled"
      printf '%s\\n' 'stream error: stream ID 1; CANCEL; received from peer' >&2
      exit 1
    fi
    printf '%s\\n' recovered >> "$MOCK_REQUESTS"
    printf '%s\\n' '{"jobs":[]}' ;;
  */runs/42/artifacts*) printf '%s\\n' '{"artifacts":[]}' ;;
  *) exit 2 ;;
esac
`,
    { mode: 0o700 },
  )
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./macos-host-collect.mjs', import.meta.url)), 'collect'],
    {
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        GITHUB_REPOSITORY: repository,
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF: 'refs/heads/main',
        GITHUB_SHA: source,
        GITHUB_WORKFLOW_REF: `${repository}/${MACOS_WORKFLOW}@refs/heads/main`,
        GITHUB_RUN_ID: String(run.id),
        GITHUB_RUN_ATTEMPT: String(run.run_attempt),
        MOCK_REQUESTS: requests,
      },
    },
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Missing merge job: Prepare Mac inputs/)
  assert.equal(await readFile(requests, 'utf8'), 'unavailable\ninterrupted\nrecovered\n')
})

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

test('PR collector waits for a queued retry of a failed winner and uses its new decision', async () => {
  const original = decisionRow(0)
  const replacement = decisionRow(0, 2)
  replacement.job = job(0, 2, 200)
  replacement.selectorJob = { ...selector(0, 2), id: 601 }
  replacement.decision.jobId = replacement.job.id
  replacement.decision.selectorJobId = replacement.selectorJob.id
  replacement.artifact.id = 401
  const failed = { ...original.job, conclusion: 'failure' }
  const queued = {
    ...replacement.job,
    status: 'queued',
    conclusion: null,
    started_at: null,
    completed_at: null,
    runner_id: 0,
    runner_name: '',
    steps: [],
  }
  let observations = 0
  let clock = 0
  const result = await waitForMacPrWinners({
    context: decisionContext,
    shards: [0],
    deadline: 1000,
    now: () => clock,
    observe: async () => {
      const waiting = observations++ === 0
      return {
        artifacts: waiting ? [original.artifact] : [original.artifact, replacement.artifact],
        jobs: [
          failed,
          original.selectorJob,
          waiting ? queued : replacement.job,
          replacement.selectorJob,
        ],
      }
    },
    readDecision: async (selected) =>
      selected.id === original.artifact.id ? original : replacement,
    sleep: async () => {
      clock += 100
    },
    report: () => {},
  })
  assert.equal(observations, 2)
  assert.equal(result.selected[0].job.id, replacement.job.id)
  assert.equal(result.selected[0].decision.attempt, 2)
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
