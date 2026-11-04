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
  guardMacPrMatrix,
  macPrMatrixStatus,
  PR_BUDGET_SECONDS,
  prTimeBudgetFromRun,
  remainingPrTimeBudget,
  runCommandBeforeDeadline,
} from './pr-time-budget.mjs'
import {
  MAC_COHORT_ALLOCATOR_NAME,
  MAC_COHORT_GUARD_JOB_NAME,
  MAC_COHORT_READY_JOB_NAME,
  MAC_PR_COHORT,
  macHostCohortWorkerName,
} from './macos-host-cohort.mjs'

const created = Date.parse('2026-11-03T12:00:00Z')
const expected = { repository: 'jiggy/jig', runId: 41, attempt: 1, headSha: 'a'.repeat(40) }
const metadata = {
  id: expected.runId,
  run_attempt: expected.attempt,
  repository: { full_name: expected.repository },
  head_sha: expected.headSha,
  event: 'pull_request',
  created_at: '2026-11-03T12:00:00Z',
  run_started_at: '2026-11-03T12:00:00Z',
}

test('queue delay consumes the allowance and a rerun cannot restart its clock', () => {
  const first = prTimeBudgetFromRun(metadata, expected, created + 5 * 60_000)
  assert.equal(first.deadlineEpochMs, created + 25 * 60_000)
  assert.deepEqual(remainingPrTimeBudget(first, { now: created + 5 * 60_000 }), {
    deadline_epoch_ms: created + 25 * 60_000,
    remaining_seconds: 1200,
    reserve_seconds: 120,
    work_seconds: 1080,
    work_minutes: 18,
    step_timeout_minutes: 19,
  })
  const retried = prTimeBudgetFromRun(
    { ...metadata, run_attempt: 2, run_started_at: '2026-11-03T12:30:00Z' },
    { ...expected, attempt: 2 },
    created + 30 * 60_000,
  )
  assert.equal(retried.deadlineEpochMs, first.deadlineEpochMs)
  assert.throws(
    () => remainingPrTimeBudget(retried, { now: created + 30 * 60_000 }),
    /25-minute PR deadline has elapsed/,
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
      () => prTimeBudgetFromRun({ ...metadata, ...patch }, expected, created),
      /Foreign, stale or non-PR/,
    )
  for (const created_at of ['2026-02-31T12:00:00Z', 'bad', '2026-11-03T12:00:01Z'])
    assert.throws(() => prTimeBudgetFromRun({ ...metadata, created_at }, expected, created))
  for (const patch of [{ repository: '../jig' }, { headSha: 'merge-ref' }, { runId: NaN }, { attempt: 0 }])
    assert.throws(() => prTimeBudgetFromRun(metadata, { ...expected, ...patch }, created))
})

test('phase time rounds down and reserves settlement without extending the absolute deadline', () => {
  const budget = prTimeBudgetFromRun(metadata, expected, created)
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
    /original 25-minute/,
  )
  for (const reserveSeconds of [-1, 1.5, Infinity, PR_BUDGET_SECONDS])
    assert.throws(() => remainingPrTimeBudget(budget, { now: created, reserveSeconds }))
})

test('GitHub step backstops cover the exact work deadline and bounded termination grace', () => {
  const budget = prTimeBudgetFromRun(metadata, expected, created)
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

function matrixJobs() {
  return [
    MAC_COHORT_ALLOCATOR_NAME,
    MAC_COHORT_READY_JOB_NAME,
    MAC_COHORT_GUARD_JOB_NAME,
    ...Array.from({ length: MAC_PR_COHORT.workers }, (_, worker) => macHostCohortWorkerName(worker)),
  ].map((name, index) => ({
    id: 1000 + index,
    name,
    run_id: expected.runId,
    run_attempt: expected.attempt,
    head_sha: expected.headSha,
    run_url: `https://api.github.com/repos/${expected.repository}/actions/runs/${expected.runId}`,
    status: name === MAC_COHORT_GUARD_JOB_NAME ? 'in_progress' : 'completed',
    conclusion: name === MAC_COHORT_GUARD_JOB_NAME ? null : 'success',
  }))
}

const matrixSnapshot = (jobs = matrixJobs()) => ({ total_count: jobs.length, jobs })

async function replaceMatrixMetadata(path, value) {
  await writeFile(`${path}.next`, JSON.stringify(value), { flag: 'wx' })
  await rename(`${path}.next`, path)
}

test('matrix job states require every exact worker and distinguish registration from success', () => {
  const complete = matrixSnapshot()
  const state = macPrMatrixStatus(complete, expected)
  assert.equal(state.complete, true)
  assert.deepEqual(state.pending, [])
  for (const status of ['queued', 'in_progress', 'requested', 'waiting', 'pending']) {
    const jobs = matrixJobs()
    Object.assign(jobs.at(-1), { status, conclusion: null, runner_id: null, steps: [] })
    const pending = macPrMatrixStatus(matrixSnapshot(jobs), expected)
    assert.equal(pending.complete, false)
    assert.deepEqual(pending.pending, [{ name: macHostCohortWorkerName(4), status }])
  }
  const missing = matrixSnapshot(matrixJobs().slice(0, -1))
  assert.deepEqual(macPrMatrixStatus(missing, expected).pending, [
    { name: macHostCohortWorkerName(4), status: 'missing' },
  ])
  assert.throws(() => macPrMatrixStatus(missing, expected, state.jobIds), /unique current-attempt/)
  const changed = matrixJobs()
  changed.at(-1).id++
  assert.throws(
    () => macPrMatrixStatus(matrixSnapshot(changed), expected, state.jobIds),
    /foreign, stale or invalid/,
  )
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
    assert.throws(() => macPrMatrixStatus(matrixSnapshot(jobs), expected))
  }
  const jobs = matrixJobs()
  assert.throws(() => macPrMatrixStatus(matrixSnapshot([...jobs, jobs.at(-1)]), expected), /duplicate/)
  assert.throws(
    () => macPrMatrixStatus(matrixSnapshot([...jobs, { ...jobs.at(-1), id: 9999 }]), expected),
    /unique current-attempt/,
  )
  for (const snapshot of [
    { total_count: 101, jobs },
    { total_count: jobs.length + 1, jobs },
    { jobs },
  ])
    assert.throws(() => macPrMatrixStatus(snapshot, expected), /incomplete job inventory/)
  for (const name of [MAC_COHORT_ALLOCATOR_NAME, MAC_COHORT_READY_JOB_NAME]) {
    const failed = matrixJobs().map((job) =>
      job.name === name ? { ...job, conclusion: 'failure' } : job,
    )
    assert.throws(() => macPrMatrixStatus(matrixSnapshot(failed), expected), /did not succeed/)
  }
})

// This real HTTP service reads ordinary job records from a temporary store.
// It exercises the guard's observation/deadline boundary, not GitHub cancellation or native proof.
async function matrixMetadataService(t, workMilliseconds = 5000) {
  const directory = await mkdtemp(join(tmpdir(), 'jig-matrix-metadata-'))
  const runPath = join(directory, 'run.json')
  const jobsPath = join(directory, 'jobs.json')
  const requestsPath = join(directory, 'requests.txt')
  const run = {
    ...metadata,
    created_at: new Date(Date.now() - 23 * 60_000 + workMilliseconds).toISOString(),
  }
  await writeFile(runPath, JSON.stringify(run))
  await writeFile(jobsPath, JSON.stringify(matrixSnapshot()))
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
        else if (configuration.http_status) response.writeHead(configuration.http_status).end()
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
  run.created_at = new Date(Date.now() - 23 * 60_000 + workMilliseconds).toISOString()
  await replaceMatrixMetadata(runPath, run)
  const budget = prTimeBudgetFromRun(run, expected)
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
    requests: () => readFile(requestsPath, 'utf8'),
  }
}

test('real matrix polling observes queued work becoming successful without fabricating proof', async (t) => {
  const f = await matrixMetadataService(t)
  const queued = matrixJobs()
  Object.assign(queued.at(-1), { status: 'queued', conclusion: null, runner_id: 0, steps: [] })
  await replaceMatrixMetadata(f.jobsPath, matrixSnapshot(queued))
  const running = guardMacPrMatrix(f.budget, f.options)
  const observationDeadline = Date.now() + 2000
  while (!(await f.requests()).includes('jobs\n') && Date.now() < observationDeadline)
    await new Promise((resolve) => setTimeout(resolve, 10))
  assert.match(await f.requests(), /jobs\n/)
  await replaceMatrixMetadata(f.jobsPath, matrixSnapshot())
  assert.deepEqual(await running, { complete: true, workerJobs: 5 })
  assert.equal((await f.requests()).split('run\n').length - 1, 2)
  assert.deepEqual((await readdir(f.directory)).sort(), ['jobs.json', 'requests.txt', 'run.json'])
})

test('an actual deadline refuses four successes and one permanently unassigned current-attempt worker', async (t) => {
  const f = await matrixMetadataService(t, 3000)
  const queued = matrixJobs()
  Object.assign(queued.at(-1), { status: 'queued', conclusion: null, runner_id: 0, steps: [] })
  Object.assign(queued[0], { status: 'in_progress', conclusion: null })
  await replaceMatrixMetadata(f.jobsPath, matrixSnapshot(queued))
  await assert.rejects(
    guardMacPrMatrix(f.budget, f.options),
    /work deadline has elapsed; unfinished jobs:.*Native host worker — arm64 \/ 4 \(queued\)/,
  )
  assert.match(await f.requests(), /jobs\n/)
  assert.deepEqual((await readdir(f.directory)).sort(), ['jobs.json', 'requests.txt', 'run.json'])
})

test('real metadata reads refuse failed allocation, stale worker attempts and HTTP errors', async (t) => {
  const f = await matrixMetadataService(t)
  const failed = matrixJobs()
  failed[0].conclusion = 'failure'
  await replaceMatrixMetadata(f.jobsPath, matrixSnapshot(failed))
  await assert.rejects(guardMacPrMatrix(f.budget, f.options), /did not succeed/)
  const stale = matrixJobs()
  stale.at(-1).run_attempt++
  await replaceMatrixMetadata(f.jobsPath, matrixSnapshot(stale))
  await assert.rejects(guardMacPrMatrix(f.budget, f.options), /foreign, stale or invalid/)
  await replaceMatrixMetadata(f.jobsPath, { http_status: 503 })
  await assert.rejects(guardMacPrMatrix(f.budget, f.options), /HTTP 503/)
})

test('a stalled real metadata body cannot extend the original work deadline', async (t) => {
  const f = await matrixMetadataService(t, 2000)
  await replaceMatrixMetadata(f.jobsPath, { hold_body: true })
  await assert.rejects(guardMacPrMatrix(f.budget, f.options), /work deadline has elapsed/)
  assert.match(await f.requests(), /jobs\n/)
})

function environment(createdEpochMs = Date.now() - 5 * 60_000) {
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
    JIG_PR_RUN_CREATED_EPOCH_MS: String(createdEpochMs),
    JIG_PR_DEADLINE_EPOCH_MS: String(createdEpochMs + 25 * 60_000),
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

test('the guard CLI is PR-only, refuses options and cannot reset an expired original work allowance', () => {
  for (const event of ['push', 'workflow_dispatch', 'pull_request_target', '']) {
    const result = cli(['guard-matrix'], { ...environment(), GITHUB_EVENT_NAME: event })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /current PR execution without options/)
  }
  assert.equal(cli(['guard-matrix', '--reserve-seconds', '0']).status, 1)
  const expired = cli(['guard-matrix'], {
    ...environment(Date.now() - 23 * 60_000 - 1000),
    GH_TOKEN: 'unneeded-before-request',
  })
  assert.equal(expired.status, 1)
  assert.match(expired.stderr, /work deadline has elapsed/)
  assert.equal(expired.stdout, '')
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
