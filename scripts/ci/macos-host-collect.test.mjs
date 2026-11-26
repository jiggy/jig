import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { digest } from './candidate-provenance.mjs'
import { githubClient } from './candidate-transfer.mjs'
import {
  MACOS_WORKFLOW,
  macExecutionTiming,
  macJobName,
  requireMacInputBinding,
  selectMacShardArtifacts,
  stageMacShardEvidence,
  waitForMacWorkers,
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

test('staged Mac evidence overlaps four real ZIP transfers and joins them before use', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-mac-evidence-downloads-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const archive = join(directory, 'evidence.zip')
  const downloads = join(directory, 'downloads')
  await mkdir(downloads)
  execFileSync('python3', [
    '-c',
    'from zipfile import ZipFile; import sys; z = ZipFile(sys.argv[1], "w"); z.writestr("report", "proof"); z.close()',
    archive,
  ])
  const archiveDigest = `sha256:${digest(await readFile(archive))}`
  await writeFile(
    join(directory, 'gh'),
    `#!/bin/sh
set -eu
root="$(dirname "$0")"
id="$(basename "$(dirname "$2")")"
printf 'start %s\\n' "$id" >> "$root/events"
if [ "$id" -le 4 ]; then
  touch "$root/started-$id"
  count=0
  until [ -f "$root/started-1" ] && [ -f "$root/started-2" ] && [ -f "$root/started-3" ] && [ -f "$root/started-4" ]; do
    count=$((count + 1))
    [ "$count" -le 50 ] || exit 5
    sleep 0.05
  done
fi
cat "$root/evidence.zip"
printf 'finish %s\\n' "$id" >> "$root/events"
`,
    { mode: 0o700 },
  )
  const originalPath = process.env.PATH
  process.env.PATH = `${directory}${delimiter}${originalPath}`
  try {
    const stage = stageMacShardEvidence({
      client: githubClient('jiggy/jig'),
      directory: downloads,
    })
    const first = stage.download({ id: 1, digest: archiveDigest })
    assert.equal(stage.download({ id: 1, digest: archiveDigest }), first)
    const staged = [first]
    for (let id = 2; id <= 6; id++) staged.push(stage.download({ id, digest: archiveDigest }))
    const paths = await Promise.all(staged)
    assert.throws(
      () => stage.download({ id: 1, digest: `sha256:${'a'.repeat(64)}` }),
      /digest changed/,
    )
    await assert.rejects(
      stage.download({ id: 7, digest: `sha256:${'a'.repeat(64)}` }),
      /transport digest mismatch/,
    )
    await stage.drain()
    for (const path of paths) assert.equal(await readFile(join(path, 'report'), 'utf8'), 'proof')
    const events = (await readFile(join(directory, 'events'), 'utf8')).trim().split('\n')
    assert.deepEqual(events.slice(0, 4).sort(), ['start 1', 'start 2', 'start 3', 'start 4'])
    let active = 0
    for (const event of events) {
      active += event.startsWith('start ') ? 1 : -1
      assert.ok(active >= 0 && active <= 4)
    }
    assert.equal(active, 0)
  } finally {
    process.env.PATH = originalPath
  }
})

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
  name: macJobName(shard === 0 ? 15 : 26, shard),
  run_id: 42,
  run_attempt: attempt,
  head_sha: source,
  status: 'completed',
  conclusion: 'success',
  runner_id: 200,
  runner_name: 'disposable-ARM',
  labels: [shard === 0 ? 'macos-15' : 'macos-26'],
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
  name: `macos-prerequisites-${shard === 0 ? 15 : 26}-${shard}-${source}-r42-a${attempt}`,
  expired: false,
  expires_at: '2026-11-24T00:00:00Z',
  digest: `sha256:${'b'.repeat(64)}`,
  workflow_run: { id: 42, head_sha: source },
})
const prMatrix = {
  include: [
    { major: 15, shard: 0 },
    { major: 26, shard: 1 },
  ],
}
const selection = (overrides = {}) =>
  selectMacShardArtifacts({
    run,
    jobs: [job(0), job(1, 2)],
    artifacts: [artifact(0), artifact(1, 2)],
    source,
    minimumAttempt: 1,
    matrix: prMatrix,
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
    { jobs: [{ ...job(0), labels: ['macos-26'] }, job(1, 2)] },
  ])
    assert.throws(() => selection(overrides))
})

test('main qualification never retains earlier attempts and retries expire after 24 hours', () => {
  assert.throws(() => selection({ run: { ...run, event: 'push' }, minimumAttempt: 2 }), /fresh execution/)
  assert.throws(() => selection({ now: now + 24 * 60 * 60 * 1000 }), /24-hour/)
  assert.throws(() => selection({ run: { ...run, created_at: 'invalid' } }), /24-hour/)
})

test('queue and execution timings require an actual assigned host and ordered timestamps', () => {
  assert.deepEqual(macExecutionTiming(job(0), 15), { waitSeconds: 60, executionSeconds: 1140 })
  for (const changes of [
    { started_at: 'invalid' },
    { completed_at: '2026-11-17T00:00:00Z' },
    { created_at: '2026-11-17T00:25:00Z' },
    { steps: [] },
    { steps: [{ status: 'completed', conclusion: 'failure' }] },
  ])
    assert.throws(() => macExecutionTiming({ ...job(0), ...changes }, 15))
})

test('each retained shard binds the immutable input artifact and exact frozen plan bytes', () => {
  const planBytes = Buffer.from('{"frozen":"plan"}\n')
  const inputArtifactId = 40
  const binding = { sourceRevision: source, inputArtifactId: 40, planSha256: digest(planBytes) }
  assert.doesNotThrow(() => requireMacInputBinding(binding, { source, inputArtifactId, planBytes }))
  for (const changes of [
    { sourceRevision: 'c'.repeat(40) },
    { inputArtifactId: 41 },
    { planSha256: '0'.repeat(64) },
  ])
    assert.throws(() =>
      requireMacInputBinding({ ...binding, ...changes }, { source, inputArtifactId, planBytes }),
    )
  const prExpected = { source, inputArtifactId, planBytes, planArtifactId: 17 }
  assert.doesNotThrow(() => requireMacInputBinding({ ...binding, planArtifactId: 17 }, prExpected))
  assert.throws(() => requireMacInputBinding({ ...binding, planArtifactId: 18 }, prExpected))
  assert.throws(() => requireMacInputBinding(binding, prExpected))
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

test('PR workers assigned on time retain their bounded execution and evidence window', async () => {
  const minute = 60_000
  const deadline = now + 40 * minute
  const finished = deadline + 10 * minute
  const stamp = (time) => new Date(time).toISOString()
  for (const [started, finishes, expires] of [
    [deadline - 2 * minute, true, finished],
    [deadline - 2 * minute, false, deadline + 25 * minute],
    [deadline + minute, true, deadline],
  ]) {
    let clock = deadline - minute
    const result = waitForMacWorkers({
      matrix: { include: [{ major: 15, shard: 0 }] },
      deadline,
      now: () => clock,
      observe: async () => {
        const assigned = clock >= started
        const completed = finishes && clock >= finished
        return {
          run,
          jobs: [{
            ...job(0, 2),
            runner_id: assigned ? 200 : 0,
            started_at: assigned ? stamp(started) : null,
            completed_at: completed ? stamp(finished) : null,
            status: completed ? 'completed' : assigned ? 'in_progress' : 'queued',
            conclusion: completed ? 'success' : null,
          }],
        }
      },
      sleep: async (ms) => { clock += ms },
      report: () => {},
    })
    if (finishes && started < deadline) assert.equal((await result).jobs[0].id, job(0, 2).id)
    else await assert.rejects(result, /observation deadline expired/)
    assert.equal(clock, expires)
  }
})

test('Mac collection stages finished workers and refreshes artifacts after a jobs-only completion', async () => {
  const first = job(0, 2)
  const second = job(1, 2)
  let clock = now
  let snapshots = 0, jobsReads = 0
  const progress = []
  const completed = await waitForMacWorkers({
    matrix: prMatrix,
    deadline: now + 5 * 60_000,
    now: () => clock,
    observe: async () => {
      snapshots++
      return {
        run,
        jobs: snapshots === 1
          ? [first, { ...second, status: 'in_progress', conclusion: null }]
          : [first, second],
        snapshot: snapshots,
      }
    },
    readJobs: async () => {
      jobsReads++
      return [first, second]
    },
    onProgress: (_state, workers) => progress.push(workers.map(({ job }) => job.id)),
    sleep: async (ms) => { clock += ms },
    report: () => {},
  })
  assert.deepEqual(progress, [[first.id], [first.id, second.id]])
  assert.equal(jobsReads, 1)
  assert.equal(completed.snapshot, 2)
  assert.equal(clock, now + 30_000)
})

test('PR collection waits for a current assigned retry instead of a retained execution', async () => {
  const original = job(0)
  const replacement = job(0, 2, 200)
  const queued = {
    ...replacement,
    status: 'queued',
    conclusion: null,
    started_at: null,
    completed_at: null,
    runner_id: 0,
    runner_name: '',
    steps: [],
  }
  for (const [minimumAttempt, initial] of [[1, [original, queued]], [2, [original]]]) {
    let observations = 0
    let clock = now
    const result = await waitForMacWorkers({
      matrix: { include: [{ major: 15, shard: 0 }] },
      minimumAttempt,
      deadline: now + 1000,
      now: () => clock,
      observe: async () => ({
        run,
        jobs: observations++ === 0 ? initial : [original, replacement],
      }),
      sleep: async (ms) => { clock += Math.min(ms, 100) },
      report: () => {},
    })
    assert.equal(observations, 2)
    assert.equal(result.jobs.at(-1).id, replacement.id)
  }
})

test('an off-profile Mac job cannot replace the failed or missing required execution', async () => {
  const alternate = { ...job(0, 2, 300), name: macJobName(26, 0), labels: ['macos-26'] }
  const options = {
    matrix: { include: [{ major: 15, shard: 0 }] },
    report: () => {},
  }
  await assert.rejects(
    waitForMacWorkers({
      ...options,
      observe: async () => ({ run, jobs: [alternate, { ...job(0, 2), conclusion: 'failure' }] }),
    }),
    /Required Mac worker did not succeed/,
  )
  let clock = 0
  await assert.rejects(
    waitForMacWorkers({
      ...options,
      deadline: 2,
      now: () => clock,
      observe: async () => ({ run, jobs: [alternate] }),
      sleep: async (ms) => { clock += ms },
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
  const current = { ...job(0, 2, 260), name: macJobName(26, 0), labels: ['macos-26'] }
  let observations = 0,
    clock = 0
  const result = await waitForMacWorkers({
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
      waitForMacWorkers({
        matrix,
        observe: async () => ({
          run: { ...run, event: 'push' },
          jobs: [old, { ...current, ...changes }],
        }),
        report: () => {},
      }),
      /did not succeed|fresh execution/,
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
