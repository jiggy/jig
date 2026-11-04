import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { appendFile, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  fetchPrTimeBudget,
  formatPrTimeBudget,
  formatPrTurnaround,
  guardMacPrMatrix,
  macPrMatrixStatus,
  PR_BUDGET_SECONDS,
  PR_COORDINATION_BUDGET_SECONDS,
  PR_EVIDENCE_BUDGET_SECONDS,
  PR_PREPARATION_BUDGET_SECONDS,
  prTimeBudgetFromJob,
  remainingPrTimeBudget,
  runCommandBeforeDeadline,
  writeMacPrGuardSummary,
} from './pr-time-budget.mjs'
import {
  MAC_COHORT_ALLOCATOR_NAME,
  MAC_COHORT_GUARD_JOB_NAME,
  MAC_COHORT_READY_JOB_NAME,
  MAC_PR_COHORT,
  macHostCohortWorkerName,
} from './macos-host-cohort.mjs'

const created = Date.parse('2026-11-03T12:00:00Z')
const expected = {
  repository: 'jiggy/jig',
  runId: 41,
  attempt: 1,
  headSha: 'a'.repeat(40),
  kind: 'worker',
  jobName: macHostCohortWorkerName(0),
}
const metadata = {
  id: expected.runId,
  run_attempt: expected.attempt,
  repository: { full_name: expected.repository },
  head_sha: expected.headSha,
  event: 'pull_request',
  created_at: '2026-11-03T12:00:00Z',
  run_started_at: '2026-11-03T12:00:00Z',
}

const iso = (value) => new Date(value).toISOString()
function jobMetadata({
  name = expected.jobName,
  start = created,
  queued = start,
  id = 1003,
  ...patch
} = {}) {
  return {
    id,
    name,
    run_id: expected.runId,
    run_attempt: expected.attempt,
    head_sha: expected.headSha,
    run_url: `https://api.github.com/repos/${expected.repository}/actions/runs/${expected.runId}`,
    status: 'in_progress',
    conclusion: null,
    created_at: iso(queued),
    started_at: iso(start),
    completed_at: null,
    runner_id: 10001,
    runner_name: 'GitHub Actions 10001',
    labels: [name.startsWith('Native host worker — ') ? 'macos-15' : 'ubuntu-24.04'],
    steps: [
      {
        name: 'Set up job',
        number: 1,
        status: 'in_progress',
        conclusion: null,
        started_at: iso(start),
        completed_at: null,
      },
    ],
    ...patch,
  }
}
const workerBudget = () => prTimeBudgetFromJob(metadata, jobMetadata(), expected, created)

test('runner queuing preserves execution time and a fresh full attempt gets a distinct job allowance', () => {
  const first = prTimeBudgetFromJob(
    metadata,
    jobMetadata({ start: created + 35 * 60_000, queued: created }),
    expected,
    created + 40 * 60_000,
  )
  assert.equal(first.deadlineEpochMs, created + 60 * 60_000)
  assert.deepEqual(remainingPrTimeBudget(first, { now: created + 40 * 60_000 }), {
    deadline_epoch_ms: created + 60 * 60_000,
    remaining_seconds: 1200,
    reserve_seconds: 120,
    work_seconds: 1080,
    work_minutes: 18,
    step_timeout_minutes: 19,
  })
  const old = workerBudget()
  const retried = prTimeBudgetFromJob(
    { ...metadata, run_attempt: 2, run_started_at: '2026-11-03T13:00:00Z' },
    jobMetadata({
      id: 2003,
      run_attempt: 2,
      start: created + 95 * 60_000,
      queued: created + 60 * 60_000,
    }),
    { ...expected, attempt: 2 },
    created + 100 * 60_000,
  )
  assert.equal(retried.createdEpochMs, old.createdEpochMs)
  assert.equal(retried.deadlineEpochMs, created + 120 * 60_000)
  assert.equal(
    remainingPrTimeBudget(retried, { now: created + 100 * 60_000 }).remaining_seconds,
    1200,
  )
  assert.throws(
    () => remainingPrTimeBudget(old, { now: created + 100 * 60_000 }),
    /25-minute PR worker allowance has elapsed/,
  )
})

test('only current-attempt PR metadata for the exact repository and event head sets a deadline', () => {
  for (const patch of [
    { id: 42 },
    { run_attempt: 2 },
    { repository: { full_name: 'foreign/jig' } },
    { head_sha: 'b'.repeat(40) },
    { event: 'push' },
    { event: 'workflow_dispatch' },
    { event: 'pull_request_target' },
  ])
    assert.throws(
      () => prTimeBudgetFromJob({ ...metadata, ...patch }, jobMetadata(), expected, created),
      /Foreign, stale or non-PR/,
    )
  for (const created_at of ['2026-02-31T12:00:00Z', 'bad', '2026-11-03T12:00:01Z'])
    assert.throws(() =>
      prTimeBudgetFromJob({ ...metadata, created_at }, jobMetadata(), expected, created),
    )
  for (const patch of [
    { repository: '../jig' },
    { headSha: 'merge-ref' },
    { runId: NaN },
    { attempt: 0 },
  ])
    assert.throws(() =>
      prTimeBudgetFromJob(metadata, jobMetadata(), { ...expected, ...patch }, created),
    )
})

test('an assigned job clock refuses placeholder starts, copied execution and foreign identities', () => {
  for (const patch of [
    { id: 0 },
    { name: 'other job' },
    { run_id: 42 },
    { run_attempt: 2 },
    { head_sha: 'b'.repeat(40) },
    { run_url: 'https://api.github.com/repos/foreign/jig/actions/runs/41' },
    { status: 'queued', runner_id: 0, runner_name: '', steps: [] },
    { runner_id: 0 },
    { runner_name: '' },
    { steps: [] },
    { steps: [{ status: 'completed', conclusion: 'skipped', started_at: metadata.created_at }] },
    { labels: ['ubuntu-24.04'] },
    { status: 'completed', conclusion: 'success' },
    { started_at: '2026-11-03T11:59:59Z' },
    { started_at: '2026-11-03T12:00:01Z' },
  ])
    assert.throws(() => prTimeBudgetFromJob(metadata, jobMetadata(patch), expected, created))
  assert.throws(
    () =>
      prTimeBudgetFromJob(
        { ...metadata, run_attempt: 2, run_started_at: '2026-11-03T13:00:00Z' },
        jobMetadata({ run_attempt: 2, queued: created + 60 * 60_000, start: created }),
        { ...expected, attempt: 2 },
        created + 65 * 60_000,
      ),
    /stale, copied/,
  )
  assert.throws(
    () =>
      prTimeBudgetFromJob(
        metadata,
        jobMetadata({ start: created + 60 * 60_000, queued: created }),
        expected,
        created + 60 * 60_000,
      ),
    /60-minute queue/,
  )
})

test('budget summaries distinguish execution from queued and total-turnaround time', () => {
  const first = prTimeBudgetFromJob(
    metadata,
    jobMetadata({ start: created + 35 * 60_000, queued: created }),
    expected,
    created + 40 * 60_000,
  )
  const description = formatPrTimeBudget(first)
  assert.match(description, /Workflow created: 2026-11-03T12:00:00\.000Z/)
  assert.match(description, /Assigned job started: 2026-11-03T12:35:00\.000Z/)
  assert.match(description, /Job queue: 2100 seconds/)
  assert.match(description, /Work cutoff: 2026-11-03T12:58:00\.000Z/)
  assert.match(
    description,
    /Final job deadline: 2026-11-03T13:00:00\.000Z \(25 minutes after this job started\)/,
  )
  assert.match(description, /does not establish the 25-minute end-to-end turnaround target/)
  const summary = formatPrTurnaround(first, created + 40 * 60_000)
  assert.match(summary, /turnaround so far: 2400 seconds/)
  assert.match(summary, /25-minute end-to-end turnaround target exceeded/)
  assert.match(summary, /successful execution check does not satisfy that target/)
})

test('queue coordination, preparation and evidence have explicit separate owning budgets', () => {
  for (const [kind, jobName, seconds] of [
    ['worker', expected.jobName, PR_BUDGET_SECONDS],
    ['coordination', MAC_COHORT_GUARD_JOB_NAME, PR_COORDINATION_BUDGET_SECONDS],
    ['coordination', MAC_COHORT_ALLOCATOR_NAME, PR_COORDINATION_BUDGET_SECONDS],
    ['preparation', MAC_COHORT_READY_JOB_NAME, PR_PREPARATION_BUDGET_SECONDS],
    ['evidence', 'affected-macos', PR_EVIDENCE_BUDGET_SECONDS],
  ]) {
    const budget = prTimeBudgetFromJob(
      metadata,
      jobMetadata({ name: jobName }),
      { ...expected, kind, jobName },
      created,
    )
    assert.equal(budget.deadlineEpochMs, created + seconds * 1000)
    assert.equal(remainingPrTimeBudget(budget, { now: created }).remaining_seconds, seconds)
  }
  assert.throws(
    () =>
      prTimeBudgetFromJob(metadata, jobMetadata(), { ...expected, kind: 'coordination' }, created),
    /owning job name/,
  )
})

test('phase time rounds down and reserves settlement without extending the absolute deadline', () => {
  const budget = workerBudget()
  const phase = remainingPrTimeBudget(budget, { now: created + 1234 })
  assert.equal(phase.work_seconds, 1378)
  assert.equal(phase.work_minutes, 22)
  assert.ok(created + 1234 + phase.work_minutes * 60_000 + 120_000 < budget.deadlineEpochMs)
  assert.equal(
    remainingPrTimeBudget(budget, { now: budget.deadlineEpochMs - 119_999 }).work_seconds,
    0,
  )
  assert.equal(
    remainingPrTimeBudget(budget, { now: budget.deadlineEpochMs - 1, reserveSeconds: 0 }).remaining_seconds,
    0,
  )
  assert.throws(() => remainingPrTimeBudget(budget, { now: budget.deadlineEpochMs }), /elapsed/)
  assert.throws(
    () => remainingPrTimeBudget({ ...budget, deadlineEpochMs: budget.deadlineEpochMs + 1 }, { now: created }),
    /assigned job allowance/,
  )
  for (const reserveSeconds of [-1, 1.5, Infinity, PR_BUDGET_SECONDS])
    assert.throws(() => remainingPrTimeBudget(budget, { now: created, reserveSeconds }))
})

test('GitHub step backstops cover the exact work deadline and bounded termination grace', () => {
  const budget = workerBudget()
  for (const [reserveSeconds, workMilliseconds, workMinutes, stepMinutes] of [
    // The observed failed phase had 857 seconds left but received only 14 minutes.
    [120, 857_889, 14, 15],
    [120, 60_000, 1, 2],
    [120, 115_000, 1, 2],
    // Flooring milliseconds before rounding up would race the last millisecond of grace.
    [120, 115_001, 1, 3],
    [2, 118_000, 1, 2],
    [0, 60_000, 1, 1],
  ]) {
    const workDeadline = budget.deadlineEpochMs - reserveSeconds * 1000
    const now = workDeadline - workMilliseconds
    const phase = remainingPrTimeBudget(budget, { now, reserveSeconds })
    assert.equal(phase.work_minutes, workMinutes)
    assert.equal(phase.step_timeout_minutes, stepMinutes)
    assert.equal(phase.deadline_epoch_ms, budget.deadlineEpochMs)
    const terminationDeadline = workDeadline + Math.min(5000, reserveSeconds * 1000)
    const stepDeadline = now + phase.step_timeout_minutes * 60_000
    assert.ok(stepDeadline >= terminationDeadline)
    assert.ok(stepDeadline < terminationDeadline + 60_000)
  }
})

test('metadata acquisition refuses missing credentials and invalid identity before requesting GitHub', async () => {
  await assert.rejects(fetchPrTimeBudget(expected), /GH_TOKEN is required/)
  await assert.rejects(fetchPrTimeBudget(expected, { token: '' }), /GH_TOKEN is required/)
  await assert.rejects(
    fetchPrTimeBudget({ ...expected, repository: '../jig' }, { token: 'unused' }),
    /Invalid PR workflow identity/,
  )
})

function matrixJobs(epoch = created, guardStart = epoch) {
  return [
    MAC_COHORT_ALLOCATOR_NAME,
    MAC_COHORT_READY_JOB_NAME,
    MAC_COHORT_GUARD_JOB_NAME,
    ...Array.from({ length: MAC_PR_COHORT.workers }, (_, worker) =>
      macHostCohortWorkerName(worker),
    ),
  ].map((name, index) =>
    jobMetadata({
      id: 1000 + index,
      name,
      start: name === MAC_COHORT_GUARD_JOB_NAME ? guardStart : epoch,
      status: name === MAC_COHORT_GUARD_JOB_NAME ? 'in_progress' : 'completed',
      conclusion: name === MAC_COHORT_GUARD_JOB_NAME ? null : 'success',
      completed_at: name === MAC_COHORT_GUARD_JOB_NAME ? null : iso(epoch + 60_000),
    }),
  )
}

const matrixSnapshot = (jobs = matrixJobs()) => ({ total_count: jobs.length, jobs })
const monitorIdentity = { ...expected, kind: 'coordination', jobName: MAC_COHORT_GUARD_JOB_NAME }
const monitorBudget = () =>
  prTimeBudgetFromJob(metadata, matrixJobs()[2], monitorIdentity, created + 5 * 60_000)
const matrixStatus = (snapshot, previous = {}, now = created + 5 * 60_000) =>
  macPrMatrixStatus(snapshot, monitorBudget(), previous, now)

async function replaceMatrixMetadata(path, value) {
  await writeFile(`${path}.next`, JSON.stringify(value), { flag: 'wx' })
  await rename(`${path}.next`, path)
}

test('matrix job states require every exact worker and distinguish registration from success', () => {
  const complete = matrixSnapshot()
  const state = matrixStatus(complete)
  assert.equal(state.complete, true)
  assert.deepEqual(state.pending, [])
  for (const status of ['queued', 'in_progress', 'requested', 'waiting', 'pending']) {
    const jobs = matrixJobs()
    Object.assign(jobs.at(-1), { status, conclusion: null, runner_id: null, steps: [] })
    const pending = matrixStatus(matrixSnapshot(jobs))
    assert.equal(pending.complete, false)
    assert.deepEqual(pending.pending, [{ name: macHostCohortWorkerName(4), status }])
  }
  const missing = matrixSnapshot(matrixJobs().slice(0, -1))
  assert.deepEqual(matrixStatus(missing).pending, [
    { name: macHostCohortWorkerName(4), status: 'missing' },
  ])
  assert.throws(() => matrixStatus(missing, state), /unique current-attempt/)
  const changed = matrixJobs()
  changed.at(-1).id++
  assert.throws(() => matrixStatus(matrixSnapshot(changed), state), /foreign, stale or invalid/)
})

test('matrix guard refuses ambiguous, foreign, incomplete and failed job observations', () => {
  for (const change of [
    { run_id: 42 },
    { run_attempt: 2 },
    { head_sha: 'b'.repeat(40) },
    { run_url: 'https://api.github.com/repos/foreign/jig/actions/runs/41' },
    { status: 'unknown' },
    { status: 'queued', conclusion: 'success' },
    { status: 'completed', conclusion: null },
    { status: 'completed', conclusion: 'cancelled' },
    { status: 'completed', conclusion: 'failure' },
    { status: 'completed', conclusion: 'skipped' },
  ]) {
    const jobs = matrixJobs()
    Object.assign(jobs.at(-1), change)
    assert.throws(() => matrixStatus(matrixSnapshot(jobs)))
  }
  const jobs = matrixJobs()
  assert.throws(() => matrixStatus(matrixSnapshot([...jobs, jobs.at(-1)])), /duplicate/)
  assert.throws(
    () => matrixStatus(matrixSnapshot([...jobs, { ...jobs.at(-1), id: 9999 }])),
    /unique current-attempt/,
  )
  for (const snapshot of [
    { total_count: 101, jobs },
    { total_count: jobs.length + 1, jobs },
    { jobs },
  ])
    assert.throws(() => matrixStatus(snapshot), /incomplete job inventory/)
  for (const name of [MAC_COHORT_ALLOCATOR_NAME, MAC_COHORT_READY_JOB_NAME]) {
    const failed = matrixJobs().map((job) =>
      job.name === name ? { ...job, conclusion: 'failure' } : job,
    )
    assert.throws(() => matrixStatus(matrixSnapshot(failed)), /did not succeed/)
  }
})

test('queued placeholders do not spend execution allowance but neither late nor copied success qualifies', () => {
  const queued = matrixJobs()
  Object.assign(queued.at(-1), {
    status: 'queued',
    conclusion: null,
    runner_id: 0,
    runner_name: '',
    steps: [],
  })
  assert.equal(matrixStatus(matrixSnapshot(queued), {}, created + 30 * 60_000).complete, false)
  assert.throws(
    () => matrixStatus(matrixSnapshot(queued), {}, created + 60 * 60_000),
    /60-minute infrastructure/,
  )
  const late = matrixJobs()
  late.at(-1).completed_at = iso(created + 25 * 60_000)
  assert.throws(
    () => matrixStatus(matrixSnapshot(late), {}, created + 26 * 60_000),
    /25-minute execution allowance/,
  )
  const copied = matrixJobs()
  copied.at(-1).created_at = iso(created + 2 * 60_000)
  assert.throws(() => matrixStatus(matrixSnapshot(copied)), /stale, copied/)
  const state = matrixStatus(matrixSnapshot())
  const changed = matrixJobs()
  changed.at(-1).runner_id++
  assert.throws(
    () => matrixStatus(matrixSnapshot(changed), state),
    /assignment or start time changed/,
  )
})

// This real HTTP service reads ordinary job records from a temporary store.
// It exercises the guard's observation/deadline boundary, not GitHub cancellation or native proof.
async function matrixMetadataService(t, workMilliseconds = 5000) {
  const directory = await mkdtemp(join(tmpdir(), 'jig-matrix-metadata-'))
  const runPath = join(directory, 'run.json')
  const jobsPath = join(directory, 'jobs.json')
  const requestsPath = join(directory, 'requests.txt')
  const guardStart = Date.now() - (PR_COORDINATION_BUDGET_SECONDS - 120) * 1000 + workMilliseconds
  const run = {
    ...metadata,
    created_at: iso(guardStart - 120_000),
    run_started_at: iso(guardStart - 60_000),
  }
  const records = matrixJobs(Date.now() - 120_000, guardStart)
  await writeFile(runPath, JSON.stringify(run))
  await writeFile(jobsPath, JSON.stringify(matrixSnapshot(records)))
  await writeFile(requestsPath, '')
  const resource = `/repos/${expected.repository}/actions/runs/${expected.runId}`
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' || request.headers.authorization !== 'Bearer local-metadata') {
        response.writeHead(403).end()
        return
      }
      response.setHeader('content-type', 'application/json')
      if (request.url === resource) {
        await appendFile(requestsPath, 'run\n')
        response.end(await readFile(runPath))
      } else if (request.url === `${resource}/attempts/${expected.attempt}/jobs?per_page=100`) {
        const contents = await readFile(jobsPath)
        const configuration = JSON.parse(contents)
        if (configuration.hold_body) response.write('{"total_count":')
        else if (configuration.http_status)
          response.writeHead(configuration.http_status, configuration.http_headers ?? {}).end()
        else response.end(contents)
        await appendFile(requestsPath, 'jobs\n')
      } else {
        response.writeHead(404).end()
      }
    } catch {
      response.writeHead(500).end()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const budget = prTimeBudgetFromJob(run, records[2], monitorIdentity)
  t.after(async () => {
    const stopped = once(server, 'close')
    server.closeAllConnections()
    server.close()
    await stopped
    await rm(directory, { recursive: true, force: true })
  })
  const options = {
    token: 'local-metadata',
    apiOrigin: `http://127.0.0.1:${server.address().port}`,
    pollIntervalMs: 50,
  }
  return {
    directory,
    run,
    budget,
    options,
    runPath,
    jobsPath,
    jobs: () => structuredClone(records),
    requests: () => readFile(requestsPath, 'utf8'),
  }
}

test('real matrix polling observes queued work becoming successful without fabricating proof', async (t) => {
  const f = await matrixMetadataService(t)
  const queued = f.jobs()
  Object.assign(queued.at(-1), { status: 'queued', conclusion: null, runner_id: 0, steps: [] })
  await replaceMatrixMetadata(f.jobsPath, matrixSnapshot(queued))
  const running = guardMacPrMatrix(f.budget, f.options)
  const observationDeadline = Date.now() + 2000
  while (!(await f.requests()).includes('jobs\n') && Date.now() < observationDeadline)
    await new Promise((resolve) => setTimeout(resolve, 10))
  assert.match(await f.requests(), /jobs\n/)
  await replaceMatrixMetadata(f.jobsPath, matrixSnapshot(f.jobs()))
  assert.deepEqual(await running, { complete: true, workerJobs: 5 })
  const summaryPath = join(f.directory, 'summary.md')
  await writeFile(summaryPath, 'Existing job summary.\n\n')
  await writeMacPrGuardSummary(f.budget, summaryPath)
  const summary = await readFile(summaryPath, 'utf8')
  assert.ok(summary.startsWith('Existing job summary.\n\n'))
  assert.ok(summary.includes(formatPrTimeBudget(f.budget)))
  assert.match(summary, /Native setup and test steps are intentionally skipped on this matrix row/)
  assert.match(summary, /assigned test roles or record a surplus assignment/)
  assert.match(summary, /Monitor succeeded: all five current-attempt Mac worker jobs/)
  assert.match(summary, /subsequent native qualification aggregate owns qualification/)
  assert.equal((await f.requests()).split('run\n').length - 1, 2)
  assert.deepEqual((await readdir(f.directory)).sort(), ['jobs.json', 'requests.txt', 'run.json', 'summary.md'])
})

test('an optional summary write failure does not fail its caller or write to stdout', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-pr-summary-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { writeMacPrGuardSummary } from ${JSON.stringify(new URL('./pr-time-budget.mjs', import.meta.url).href)}
    await writeMacPrGuardSummary(JSON.parse(process.argv[1]), process.argv[2])
    console.log('summary reporting returned')
  `,
      JSON.stringify(monitorBudget()),
      directory,
    ],
    {
      encoding: 'utf8',
      timeout: 5000,
    },
  )
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'summary reporting returned\n')
  assert.match(result.stderr, /optional Mac PR deadline summary could not be written/)
  assert.deepEqual(await readdir(directory), [])
})

test('an actual deadline refuses four successes and one permanently unassigned current-attempt worker', async (t) => {
  const f = await matrixMetadataService(t, 3000)
  const queued = f.jobs()
  Object.assign(queued.at(-1), { status: 'queued', conclusion: null, runner_id: 0, steps: [] })
  Object.assign(queued[0], { status: 'in_progress', conclusion: null })
  await replaceMatrixMetadata(f.jobsPath, matrixSnapshot(queued))
  await assert.rejects(
    guardMacPrMatrix(f.budget, f.options),
    /coordination allowance has elapsed; unfinished jobs:.*Native host worker — arm64 \/ 4 \(queued\)/,
  )
  assert.match(await f.requests(), /jobs\n/)
  assert.deepEqual((await readdir(f.directory)).sort(), ['jobs.json', 'requests.txt', 'run.json'])
})

test('real metadata reads refuse failed allocation, stale worker attempts and HTTP errors', async (t) => {
  const f = await matrixMetadataService(t, 10_000)
  const failed = f.jobs()
  failed[0].conclusion = 'failure'
  await replaceMatrixMetadata(f.jobsPath, matrixSnapshot(failed))
  await assert.rejects(guardMacPrMatrix(f.budget, f.options), /did not succeed/)
  const stale = f.jobs()
  stale.at(-1).run_attempt++
  await replaceMatrixMetadata(f.jobsPath, matrixSnapshot(stale))
  await assert.rejects(guardMacPrMatrix(f.budget, f.options), /[Ff]oreign, stale or invalid/)
  await replaceMatrixMetadata(f.jobsPath, { http_status: 503 })
  await assert.rejects(guardMacPrMatrix(f.budget, f.options), /HTTP 503/)
})

test('a stalled real metadata body cannot extend the coordination allowance', async (t) => {
  const f = await matrixMetadataService(t, 2000)
  await replaceMatrixMetadata(f.jobsPath, { hold_body: true })
  await assert.rejects(
    guardMacPrMatrix(f.budget, f.options),
    /bounded PR metadata body|coordination allowance has elapsed/,
  )
  assert.match(await f.requests(), /jobs\n/)
})

test('real metadata assignment polling waits for runner visibility without using the queued start', async (t) => {
  const f = await matrixMetadataService(t, 20_000)
  const queued = f.jobs()
  Object.assign(queued[2], {
    status: 'queued',
    conclusion: null,
    runner_id: 0,
    runner_name: '',
    steps: [],
  })
  await replaceMatrixMetadata(f.jobsPath, matrixSnapshot(queued))
  const pending = fetchPrTimeBudget(monitorIdentity, f.options)
  const deadline = Date.now() + 2000
  while (!(await f.requests()).includes('jobs\n') && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10))
  assert.match(await f.requests(), /jobs\n/)
  const assignedButNotExecuting = f.jobs()
  assignedButNotExecuting[2].steps = [{ status: 'queued', conclusion: null, started_at: null }]
  await replaceMatrixMetadata(f.jobsPath, matrixSnapshot(assignedButNotExecuting))
  const executionObservationDeadline = Date.now() + 7000
  while (
    (await f.requests()).split('jobs\n').length - 1 < 2 &&
    Date.now() < executionObservationDeadline
  )
    await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal((await f.requests()).split('jobs\n').length - 1, 2)
  await replaceMatrixMetadata(f.jobsPath, matrixSnapshot(f.jobs()))
  const budget = await pending
  assert.equal(budget.jobId, f.budget.jobId)
  assert.equal(budget.jobStartedEpochMs, f.budget.jobStartedEpochMs)
  assert.equal(budget.deadlineEpochMs, f.budget.deadlineEpochMs)
})

test('real rate-limit responses honor Retry-After and refuse a wait outside the metadata bound', async (t) => {
  const f = await matrixMetadataService(t, 12_000)
  await replaceMatrixMetadata(f.jobsPath, {
    http_status: 429,
    http_headers: { 'retry-after': '60' },
  })
  await assert.rejects(
    fetchPrTimeBudget(monitorIdentity, {
      ...f.options,
      deadlineEpochMs: Date.now() + 2000,
    }),
    /rate limited.*required wait does not fit/,
  )
  assert.equal(
    (await f.requests()).split('jobs\n').length - 1,
    1,
    'no retry may precede the required server wait',
  )
  await replaceMatrixMetadata(f.jobsPath, {
    http_status: 429,
    http_headers: { 'retry-after': '1' },
  })
  const start = Date.now()
  const pending = fetchPrTimeBudget(monitorIdentity, f.options)
  while ((await f.requests()).split('jobs\n').length - 1 < 2 && Date.now() < start + 2000)
    await new Promise((resolve) => setTimeout(resolve, 10))
  await replaceMatrixMetadata(f.jobsPath, matrixSnapshot(f.jobs()))
  assert.equal((await pending).jobId, f.budget.jobId)
  assert.ok(Date.now() - start >= 1000, 'the actual HTTP retry must wait for Retry-After')
  const resetEpoch = Math.ceil(Date.now() / 1000) + 1
  await replaceMatrixMetadata(f.jobsPath, {
    http_status: 429,
    http_headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetEpoch) },
  })
  const previousRequests = (await f.requests()).split('jobs\n').length - 1
  const resetPending = fetchPrTimeBudget(monitorIdentity, f.options)
  const observationDeadline = Date.now() + 2000
  while (
    (await f.requests()).split('jobs\n').length - 1 === previousRequests &&
    Date.now() < observationDeadline
  )
    await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal((await f.requests()).split('jobs\n').length - 1, previousRequests + 1)
  await replaceMatrixMetadata(f.jobsPath, matrixSnapshot(f.jobs()))
  assert.equal((await resetPending).jobId, f.budget.jobId)
  assert.ok(
    Date.now() >= resetEpoch * 1000,
    'an exhausted primary limit waits for its reset without Retry-After',
  )
})

function environment(jobStartedEpochMs = Date.now() - 5 * 60_000, kind = 'worker') {
  return {
    ...process.env,
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REPOSITORY: expected.repository,
    GITHUB_RUN_ID: String(expected.runId),
    GITHUB_RUN_ATTEMPT: String(expected.attempt),
    JIG_PR_BUDGET_REPOSITORY: expected.repository,
    JIG_PR_BUDGET_RUN_ID: String(expected.runId),
    JIG_PR_BUDGET_ATTEMPT: String(expected.attempt),
    JIG_PR_BUDGET_HEAD_SHA: expected.headSha,
    JIG_PR_BUDGET_KIND: kind,
    JIG_PR_BUDGET_JOB_NAME: kind === 'coordination' ? MAC_COHORT_GUARD_JOB_NAME : expected.jobName,
    JIG_PR_BUDGET_JOB_ID: kind === 'coordination' ? '1002' : '1003',
    JIG_PR_RUN_CREATED_EPOCH_MS: String(jobStartedEpochMs - 60_000),
    JIG_PR_ATTEMPT_STARTED_EPOCH_MS: String(jobStartedEpochMs - 60_000),
    JIG_PR_JOB_CREATED_EPOCH_MS: String(jobStartedEpochMs),
    JIG_PR_JOB_STARTED_EPOCH_MS: String(jobStartedEpochMs),
    JIG_PR_DEADLINE_EPOCH_MS: String(
      jobStartedEpochMs + (kind === 'coordination' ? 90 : 25) * 60_000,
    ),
  }
}

function cli(args, env = environment()) {
  const result = spawnSync(process.execPath, [join(import.meta.dirname, 'pr-time-budget.mjs'), ...args], {
    encoding: 'utf8',
    env,
    timeout: 5000,
  })
  assert.ifError(result.error)
  return result
}

test('the guard CLI is PR-only, refuses options and cannot reset an expired coordination allowance', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-pr-guard-cli-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const summaryPath = join(directory, 'summary.md')
  await writeFile(summaryPath, 'Existing job summary.\n')
  for (const event of ['push', 'workflow_dispatch', 'pull_request_target', '']) {
    const result = cli(['guard-matrix'], { ...environment(), GITHUB_EVENT_NAME: event })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /current PR execution without options/)
  }
  assert.equal(cli(['guard-matrix', '--reserve-seconds', '0']).status, 1)
  const expired = cli(['guard-matrix'], {
    ...environment(Date.now() - 90 * 60_000 - 1000, 'coordination'),
    GH_TOKEN: 'unneeded-before-request',
    GITHUB_STEP_SUMMARY: summaryPath,
  })
  assert.equal(expired.status, 1)
  assert.match(expired.stderr, /90-minute PR coordination allowance has elapsed/)
  assert.match(expired.stderr, /This Ubuntu monitor watches all five Mac workers/)
  assert.doesNotMatch(expired.stderr, /Monitor succeeded/)
  assert.equal(expired.stdout, '')
  assert.equal(await readFile(summaryPath, 'utf8'), 'Existing job summary.\n')
})

test('actual CLI emits only numeric phase outputs and refuses a zero-minute step allowance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-pr-budget-'))
  try {
    const destination = join(directory, 'outputs')
    const result = cli(['remaining', '--github-output', destination, '--reserve-seconds', '120'])
    assert.equal(result.status, 0, result.stderr)
    const phase = JSON.parse(result.stdout)
    assert.ok(phase.work_minutes > 0 && phase.work_minutes <= 18)
    assert.equal(phase.work_minutes, Math.floor(phase.work_seconds / 60))
    assert.ok(Number.isSafeInteger(phase.step_timeout_minutes))
    assert.ok(phase.step_timeout_minutes > phase.work_minutes)
    assert.ok(phase.step_timeout_minutes <= phase.work_minutes + 2)
    assert.equal(phase.reserve_seconds, 120)
    const outputs = await readFile(destination, 'utf8')
    assert.match(outputs, /^deadline_epoch_ms=\d+\nremaining_seconds=\d+\nreserve_seconds=120\nwork_seconds=\d+\nwork_minutes=\d+\nstep_timeout_minutes=\d+\n$/)
    const short = cli(['remaining'], environment(Date.now() - 23 * 60_000))
    assert.equal(short.status, 1)
    assert.match(short.stderr, /Less than one work minute/)
    assert.equal(short.stdout, '')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('actual final check permits settlement time but refuses expired, moved or foreign budgets', () => {
  const settlement = environment(Date.now() - 24 * 60_000)
  assert.equal(cli(['check'], settlement).status, 0)
  assert.equal(cli(['check', '--reserve-seconds', '120'], settlement).status, 1)
  assert.equal(cli(['check'], environment(Date.now() - 26 * 60_000)).status, 1)
  for (const patch of [
    { GITHUB_RUN_ID: '42' },
    { GITHUB_RUN_ATTEMPT: '2' },
    { GITHUB_REPOSITORY: 'foreign/jig' },
    { GITHUB_EVENT_NAME: 'push' },
    { JIG_PR_DEADLINE_EPOCH_MS: String(Number(settlement.JIG_PR_DEADLINE_EPOCH_MS) + 60_000) },
  ])
    assert.equal(cli(['check'], { ...settlement, ...patch }).status, 1)
  for (const args of [
    ['remaining', '--reserve-seconds', '0', '--reserve-seconds', '120'],
    ['remaining', '--unknown', '1'],
    ['check', '--reserve-seconds', '1.5'],
  ])
    assert.equal(cli(args).status, 1)
})

test('a fresh bounded execution reports an exceeded end-to-end target without changing its result', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-pr-turnaround-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const summary = join(directory, 'summary.md')
  const env = {
    ...environment(Date.now() - 2 * 60_000),
    JIG_PR_RUN_CREATED_EPOCH_MS: String(Date.now() - 120 * 60_000),
    JIG_PR_ATTEMPT_STARTED_EPOCH_MS: String(Date.now() - 40 * 60_000),
    JIG_PR_JOB_CREATED_EPOCH_MS: String(Date.now() - 35 * 60_000),
  }
  const result = cli(['check', '--github-summary', summary], env)
  assert.equal(result.status, 0, result.stderr)
  assert.ok(JSON.parse(result.stdout).remaining_seconds > 0)
  assert.match(result.stderr, /25-minute end-to-end turnaround target exceeded/)
  const report = await readFile(summary, 'utf8')
  assert.match(report, /PR worker allowance/)
  assert.match(report, /Job queue: /)
  assert.match(report, /Current attempt turnaround so far:/)
  assert.match(report, /successful execution check does not satisfy that target/)
})

test('bounded subprocesses preserve literal arguments, actual nonzero exits and signals', async () => {
  const options = () => ({ deadlineEpochMs: Date.now() + 10_000 })
  assert.deepEqual(
    await runCommandBeforeDeadline(process.execPath, ['-e', 'process.exit(process.argv[1] === "literal;$(no-shell)" ? 0 : 9)', 'literal;$(no-shell)'], options()),
    { code: 0, signal: null, deadlineExceeded: false },
  )
  assert.deepEqual(await runCommandBeforeDeadline(process.execPath, ['-e', 'process.exit(37)'], options()), {
    code: 37, signal: null, deadlineExceeded: false,
  })
  assert.deepEqual(await runCommandBeforeDeadline(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")'], options()), {
    code: null, signal: 'SIGTERM', deadlineExceeded: false,
  })
})

test('a consumed or malformed subprocess deadline refuses before launching work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-pr-command-'))
  try {
    const launched = join(directory, 'launched')
    const args = ['-e', 'require("node:fs").writeFileSync(process.argv[1], "started")', launched]
    for (const options of [
      { deadlineEpochMs: Date.now() - 1 },
      { deadlineEpochMs: undefined },
      { deadlineEpochMs: '123' },
      { deadlineEpochMs: Date.now() + 5000, terminationGraceMs: 5001 },
      { deadlineEpochMs: Date.now() + 5000, terminationGraceMs: -1 },
    ])
      await assert.rejects(runCommandBeforeDeadline(process.execPath, args, options))
    assert.equal(existsSync(launched), false)
    await assert.rejects(runCommandBeforeDeadline(join(directory, 'absent-command'), [], { deadlineEpochMs: Date.now() + 5000 }), /ENOENT/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('deadline TERM cannot turn a late zero exit green or replace a genuine nonzero exit', async () => {
  for (const code of [0, 37]) {
    const result = await runCommandBeforeDeadline(process.execPath, ['-e', `
      process.on('SIGTERM', () => setTimeout(() => process.exit(Number(process.argv[1])), 20))
      setInterval(() => {}, 1000)
    `, String(code)], { deadlineEpochMs: Date.now() + 2000, terminationGraceMs: 200 })
    assert.deepEqual(result, { code: code === 0 ? 124 : code, signal: null, deadlineExceeded: true })
  }
  const killed = await runCommandBeforeDeadline(process.execPath, ['-e', `
    process.on('SIGTERM', () => {})
    setInterval(() => {}, 1000)
  `], { deadlineEpochMs: Date.now() + 2000, terminationGraceMs: 100 })
  assert.deepEqual(killed, { code: null, signal: 'SIGKILL', deadlineExceeded: true })
})

test('deadline escalation kills descendants even after their leader exits successfully on TERM', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-pr-process-group-'))
  let descendantPid
  try {
    const pidPath = join(directory, 'descendant.pid')
    const termPath = join(directory, 'descendant.term')
    const escapedPath = join(directory, 'descendant.escaped')
    const heartbeatPath = join(directory, 'descendant.heartbeat')
    const descendant = `
      const fs = require('node:fs')
      process.on('SIGTERM', () => fs.writeFileSync(process.argv[2], 'received'))
      fs.writeFileSync(process.argv[1], String(process.pid))
      setTimeout(() => fs.writeFileSync(process.argv[3], 'still running'), 5000)
      setInterval(() => fs.appendFileSync(process.argv[4], 'x'), 10)
    `
    const leader = `
      const { spawn } = require('node:child_process')
      spawn(process.execPath, ['-e', process.argv[1], ...process.argv.slice(2)], { stdio: 'ignore' })
      process.on('SIGTERM', () => process.exit(0))
      setInterval(() => {}, 1000)
    `
    const before = Date.now()
    const result = await runCommandBeforeDeadline(process.execPath, ['-e', leader, descendant, pidPath, termPath, escapedPath, heartbeatPath], {
      deadlineEpochMs: before + 3000,
      terminationGraceMs: 150,
    })
    descendantPid = Number(await readFile(pidPath, 'utf8'))
    assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0)
    assert.equal(await readFile(termPath, 'utf8'), 'received')
    assert.deepEqual(result, { code: 124, signal: null, deadlineExceeded: true })
    assert.ok(Date.now() - before >= 3150, 'the wrapper must retain its escalation timer after the leader exits')
    // Observe actual descendant execution without relying on a process-table
    // tool or mistaking an unreaped, terminated orphan for a running child.
    const heartbeat = await readFile(heartbeatPath, 'utf8')
    assert.ok(heartbeat.length > 0)
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(await readFile(heartbeatPath, 'utf8'), heartbeat)
    assert.equal(existsSync(escapedPath), false)
  } finally {
    if (descendantPid) {
      try { process.kill(descendantPid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
    }
    await rm(directory, { recursive: true, force: true })
  }
})

test('a normal exit settles PR descendants while preserving commands without deadlines', async () => {
  for (const bounded of [true, false]) {
    const directory = await mkdtemp(join(tmpdir(), 'jig-pr-normal-exit-'))
    let descendantPid
    try {
      const pidPath = join(directory, 'descendant.pid')
      const termPath = join(directory, 'descendant.term')
      const heartbeatPath = join(directory, 'descendant.heartbeat')
      const descendant = `
        const fs = require('node:fs')
        process.on('SIGTERM', () => fs.writeFileSync(process.argv[2], 'received'))
        fs.writeFileSync(process.argv[1], String(process.pid))
        fs.writeFileSync(process.argv[3], 'x')
        setInterval(() => fs.appendFileSync(process.argv[3], 'x'), 10)
        process.send('ready')
      `
      const leader = `
        const { spawn } = require('node:child_process')
        const child = spawn(process.execPath, ['-e', process.argv[1], ...process.argv.slice(2)], {
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        })
        child.once('message', () => {
          child.disconnect()
          process.exit(0)
        })
      `
      const result = await runCommandBeforeDeadline(
        process.execPath,
        ['-e', leader, descendant, pidPath, termPath, heartbeatPath],
        {
          deadlineEpochMs: bounded ? Date.now() + 10_000 : null,
          terminationGraceMs: 150,
        },
      )
      descendantPid = Number(await readFile(pidPath, 'utf8'))
      assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0)
      assert.deepEqual(result, { code: 0, signal: null, deadlineExceeded: false })
      const heartbeat = await readFile(heartbeatPath, 'utf8')
      await new Promise((resolve) => setTimeout(resolve, 200))
      if (bounded) {
        assert.equal(await readFile(termPath, 'utf8'), 'received')
        assert.equal(await readFile(heartbeatPath, 'utf8'), heartbeat)
      } else {
        await assert.rejects(readFile(termPath), { code: 'ENOENT' })
        assert.ok((await readFile(heartbeatPath, 'utf8')).length > heartbeat.length)
      }
    } finally {
      if (descendantPid) {
        try {
          process.kill(descendantPid, 'SIGKILL')
        } catch (error) {
          if (error.code !== 'ESRCH') throw error
        }
      }
      await rm(directory, { recursive: true, force: true })
    }
  }
})

test('a delayed timer callback cannot accept a zero exit beyond the absolute deadline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-pr-late-exit-'))
  try {
    const lateExit = join(directory, 'late-zero')
    const ready = join(directory, 'ready')
    const deadlineEpochMs = Date.now() + 3000
    const running = runCommandBeforeDeadline(process.execPath, ['-e', `
      require('node:fs').writeFileSync(process.argv[3], 'ready')
      setTimeout(() => {
        require('node:fs').writeFileSync(process.argv[1], 'zero')
        process.exit(0)
      }, Math.max(0, Number(process.argv[2]) - Date.now()))
    `, lateExit, String(deadlineEpochMs + 100), ready], { deadlineEpochMs, terminationGraceMs: 100 })
    while (!existsSync(ready) && Date.now() < deadlineEpochMs - 500)
      await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(existsSync(ready), true, 'the real child must start before timer starvation')
    const beforeStarvation = deadlineEpochMs - 500 - Date.now()
    if (beforeStarvation > 0)
      await new Promise((resolve) => setTimeout(resolve, beforeStarvation))
    // Real event-loop starvation, not a clock or timer substitution. The child
    // has its own event loop and exits after the deadline while this one waits.
    while (Date.now() < deadlineEpochMs + 250) {}
    assert.equal(await readFile(lateExit, 'utf8'), 'zero')
    assert.deepEqual(await running, { code: 124, signal: null, deadlineExceeded: true })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('actual run CLI preserves event boundaries, child outcomes and the settlement reserve', () => {
  const command = [process.execPath, '-e', 'process.stdout.write(process.argv[1])', 'literal;$(no-shell)']
  for (const event of ['push', 'workflow_dispatch']) {
    const result = cli(['run', '--', ...command], { ...process.env, GITHUB_EVENT_NAME: event })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, 'literal;$(no-shell)')
  }
  for (const event of ['', 'schedule', 'pull_request_target']) {
    const result = cli(['run', '--', ...command], { ...environment(), GITHUB_EVENT_NAME: event })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /recognized GitHub event/)
    assert.equal(result.stdout, '')
  }
  const missingEvent = { ...environment() }
  delete missingEvent.GITHUB_EVENT_NAME
  assert.equal(cli(['run', '--', ...command], missingEvent).status, 1)
  const missingIdentity = { ...environment(), GITHUB_RUN_ID: '' }
  assert.equal(cli(['run', '--', ...command], missingIdentity).status, 1)
  assert.equal(cli(['run', '--', process.execPath, '-e', 'process.exit(23)']).status, 23)
  assert.equal(cli(['run', '--', process.execPath, '-e', 'process.kill(process.pid, "SIGTERM")']).signal, 'SIGTERM')
  const overdue = cli(['run', '--', process.execPath, '-e', `
    process.on('SIGTERM', () => process.exit(0))
    setInterval(() => {}, 1000)
  `], environment(Date.now() - 23 * 60_000 + 2000))
  assert.equal(overdue.status, 124, overdue.stderr)
  assert.match(overdue.stderr, /exceeded its work deadline/)
  const settlement = environment(Date.now() - 24 * 60_000)
  assert.equal(cli(['run', '--', ...command], settlement).status, 1)
  assert.equal(cli(['run', '--reserve-seconds', '0', '--', ...command], settlement).status, 0)
  assert.equal(cli(['run', '--reserve-seconds', '0', '--', ...command], environment(Date.now() - 26 * 60_000)).status, 1)
  for (const args of [['run'], ['run', '--'], ['run', '--reserve-seconds', '1500', '--', ...command], ['run', '--github-output', 'ignored', '--', ...command]])
    assert.equal(cli(args).status, 1)
})

test('actual run CLI forwards external cancellation to its child group and preserves the signal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-pr-cancel-'))
  let wrapper
  try {
    const ready = join(directory, 'ready')
    const stopped = join(directory, 'stopped')
    wrapper = spawn(process.execPath, [join(import.meta.dirname, 'pr-time-budget.mjs'), 'run', '--', process.execPath, '-e', `
      const fs = require('node:fs')
      process.on('SIGTERM', () => {
        fs.writeFileSync(process.argv[2], 'terminated')
        process.exit(0)
      })
      fs.writeFileSync(process.argv[1], 'ready')
      setInterval(() => {}, 1000)
    `, ready, stopped], { env: { ...process.env, GITHUB_EVENT_NAME: 'push' }, stdio: 'ignore' })
    const completion = once(wrapper, 'exit')
    const readyDeadline = Date.now() + 3000
    while (!existsSync(ready) && Date.now() < readyDeadline)
      await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(existsSync(ready), true)
    wrapper.kill('SIGTERM')
    const [code, signal] = await completion
    assert.equal(code, null)
    assert.equal(signal, 'SIGTERM')
    assert.equal(await readFile(stopped, 'utf8'), 'terminated')
  } finally {
    if (wrapper && wrapper.exitCode === null && wrapper.signalCode === null) wrapper.kill('SIGKILL')
    await rm(directory, { recursive: true, force: true })
  }
})

test('zero-reserve settlement escalates at the original absolute deadline without another five-second allowance', () => {
  const result = cli(['run', '--reserve-seconds', '0', '--', process.execPath, '-e', `
    process.on('SIGTERM', () => {})
    setInterval(() => {}, 1000)
  `], environment(Date.now() - 25 * 60_000 + 2000))
  assert.equal(result.signal, 'SIGKILL')
  assert.match(result.stderr, /exceeded its work deadline/)
})
