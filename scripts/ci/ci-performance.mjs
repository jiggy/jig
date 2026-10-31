import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PERFORMANCE_WORKFLOWS = Object.freeze([
  '.github/workflows/ci.yml',
  '.github/workflows/linux-host-conformance.yml',
  '.github/workflows/macos-hosted-candidates.yml',
])
const MAX_RUNS = 1000
const MAX_ATTEMPTS = 10
const MAX_REQUESTS = 4000
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

function time(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/.test(value))
    throw new Error(`Missing or invalid ${label}`)
  const result = Date.parse(value)
  if (!Number.isFinite(result)) throw new Error(`Invalid ${label}`)
  return result
}
function seconds(start, end, label) {
  const result = (time(end, label) - time(start, label)) / 1000
  if (result < 0) throw new Error(`Reversed ${label}`)
  return result
}
const timeOrder = (a, b) => Date.parse(a) - Date.parse(b)
function identity(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${label}`)
  return value
}
function window(repository, since, until) {
  if (!repositoryPattern.test(repository ?? '')) throw new Error('Invalid GitHub repository')
  const start = time(since, 'window start')
  const end = time(until, 'window end')
  if (end <= start || end - start > MAX_WINDOW_MS)
    throw new Error('Use a positive window of at most 31 days')
  return { start, end }
}
function classification(job) {
  if (job.conclusion === 'cancelled' && job.runner_name === '' && job.steps?.length === 0)
    return 'runner-not-assigned'
  return (
    {
      success: 'success',
      failure: 'job-failed',
      cancelled: 'job-cancelled',
      timed_out: 'job-timed-out',
      skipped: 'job-skipped',
      action_required: 'approval-required',
    }[job.conclusion] ?? 'incomplete'
  )
}

// A later attempt can receive a new successful check row for an earlier
// execution. Its creation follows completion. Match only the observed execution
// coordinates; these diagnostics do not authenticate a qualification receipt.
function executionKey(job) {
  if (
    !job.started_at ||
    !job.completed_at ||
    !Number.isFinite(Date.parse(job.started_at)) ||
    !Number.isFinite(Date.parse(job.completed_at)) ||
    !Number.isSafeInteger(job.runner_id) ||
    job.runner_id <= 0 ||
    typeof job.runner_name !== 'string' ||
    !job.runner_name ||
    !Array.isArray(job.labels) ||
    !job.labels.length ||
    !Array.isArray(job.steps) ||
    !job.steps.length
  )
    return null
  return JSON.stringify([
    job.started_at,
    job.completed_at,
    job.runner_id,
    job.runner_name,
    job.labels,
    job.steps.map(({ number, name, status, conclusion, started_at, completed_at }) => [
      number,
      name,
      status,
      conclusion,
      started_at,
      completed_at,
    ]),
  ])
}
function summarize(values) {
  if (!values.length) return { count: 0, medianSeconds: null, p90Seconds: null }
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return {
    count: sorted.length,
    medianSeconds: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p90Seconds: sorted[Math.ceil(sorted.length * 0.9) - 1],
  }
}

// GitHub timestamps describe observed intervals. They cannot establish why a
// workflow waited, which dependency delayed a job, or whether a test was flaky.
export function analyzeCiPerformance(snapshot) {
  const { repository, since, until, runs } = snapshot ?? {}
  const bounds = window(repository, since, until)
  if (!Array.isArray(runs) || runs.length > MAX_RUNS) throw new Error('Invalid run inventory')
  const runIds = new Set()
  const jobIds = new Set()
  const attempts = []
  const latestRuns = []
  for (const entry of runs) {
    const { run, attempts: history } = entry
    identity(run?.id, 'run ID')
    const count = identity(run.run_attempt, 'run attempt')
    const created = time(run.created_at, 'run creation')
    if (
      runIds.has(run.id) ||
      count > MAX_ATTEMPTS ||
      !PERFORMANCE_WORKFLOWS.includes(run.path) ||
      run.repository?.full_name !== repository ||
      !/^[0-9a-f]{40}$/.test(run.head_sha ?? '') ||
      typeof run.event !== 'string' ||
      typeof run.head_branch !== 'string' ||
      created < bounds.start ||
      created >= bounds.end ||
      !Array.isArray(history) ||
      history.length !== count
    )
      throw new Error('Ambiguous, foreign or incomplete run inventory')
    runIds.add(run.id)
    const allJobs = []
    const executionOrigins = []
    let latest
    for (const [index, attempt] of history.entries()) {
      if (attempt.number !== index + 1 || !Array.isArray(attempt.jobs))
        throw new Error('Missing or reordered workflow attempt')
      time(attempt.startedAt, 'attempt start')
      if (time(attempt.startedAt, 'attempt start') < created)
        throw new Error('Attempt predates workflow creation')
      const names = new Set()
      const jobs = attempt.jobs.map((job) => {
        identity(job.id, 'job ID')
        if (
          jobIds.has(job.id) ||
          job.run_id !== run.id ||
          job.run_attempt !== attempt.number ||
          job.head_sha !== run.head_sha ||
          typeof job.name !== 'string' ||
          !job.name ||
          names.has(job.name)
        )
          throw new Error('Ambiguous or foreign job inventory')
        jobIds.add(job.id)
        names.add(job.name)
        const carried =
          attempt.number > 1 &&
          job.status === 'completed' &&
          job.conclusion === 'success' &&
          job.completed_at &&
          time(job.created_at, 'check creation') > time(job.completed_at, 'check completion')
        const key = carried ? executionKey(job) : null
        const originals =
          carried && key !== null
            ? executionOrigins.filter(
                ({ raw }) =>
                  raw.name === job.name &&
                  raw.run_attempt < job.run_attempt &&
                  executionKey(raw) === key,
              )
            : []
        const carriedExecution = carried
          ? {
              origin:
                originals.length === 1
                  ? 'matched'
                  : originals.length > 1
                    ? 'ambiguous'
                    : 'unobserved',
              originJobId: originals.length === 1 ? originals[0].observation.id : null,
              originAttempt: originals.length === 1 ? originals[0].observation.attempt : null,
            }
          : null
        const releasedAfterSeconds = carried
          ? null
          : seconds(attempt.startedAt, job.created_at, 'job release')
        const skipped = job.conclusion === 'skipped'
        const unassigned = job.runner_name === '' && job.steps?.length === 0
        const jobQueueSeconds =
          !carried && !skipped && !unassigned && job.started_at
            ? seconds(job.created_at, job.started_at, 'job queue')
            : null
        const executionSeconds =
          !carried && !skipped && !unassigned && job.started_at && job.completed_at
            ? seconds(job.started_at, job.completed_at, 'job execution')
            : null
        const unassignedSeconds =
          !carried && unassigned && job.completed_at
            ? seconds(job.created_at, job.completed_at, 'unassigned job wait')
            : null
        if (!carried && job.completed_at)
          seconds(job.created_at, job.completed_at, 'job completion')
        const observation = {
          id: job.id,
          name: job.name,
          attempt: attempt.number,
          classification: carried ? 'carried-success-check' : classification(job),
          conclusion: job.conclusion ?? null,
          createdAt: job.created_at,
          startedAt: job.started_at ?? null,
          completedAt: job.completed_at ?? null,
          releasedAfterSeconds,
          jobQueueSeconds,
          executionSeconds,
          unassignedSeconds,
          carriedExecution,
          failedSteps: Array.isArray(job.steps)
            ? job.steps.filter((step) => step.conclusion === 'failure').map((step) => step.name)
            : null,
        }
        if (!carried && job.conclusion === 'success' && executionSeconds !== null)
          executionOrigins.push({ raw: job, observation })
        return observation
      })
      allJobs.push(...jobs)
      const active = jobs.filter(
        (job) => !['job-skipped', 'carried-success-check'].includes(job.classification),
      )
      const firstCreatedAt = active
        .map((job) => job.createdAt)
        .sort(timeOrder)
        .at(0)
      const completedAt =
        active.length && active.every((job) => job.completedAt)
          ? active
              .map((job) => job.completedAt)
              .sort(timeOrder)
              .at(-1)
          : null
      latest = {
        runId: run.id,
        workflow: run.path,
        event: run.event,
        eventHeadSha: run.head_sha,
        branch: run.head_branch,
        attempt: attempt.number,
        conclusion: attempt.conclusion ?? null,
        startedAt: attempt.startedAt,
        completedAt,
        preJobSeconds: firstCreatedAt
          ? seconds(attempt.startedAt, firstCreatedAt, 'pre-job delay')
          : null,
        elapsedSeconds: completedAt
          ? seconds(attempt.startedAt, completedAt, 'attempt elapsed')
          : null,
        runnerSeconds: jobs.reduce((sum, job) => sum + (job.executionSeconds ?? 0), 0),
        jobs,
      }
      attempts.push(latest)
    }
    if (run.conclusion !== latest.conclusion)
      throw new Error('Latest workflow conclusion differs from its attempt')
    const newest = new Map()
    for (const job of allJobs) {
      if (
        job.carriedExecution?.origin === 'matched' &&
        newest.get(job.name)?.id === job.carriedExecution.originJobId
      )
        continue
      newest.set(job.name, job)
    }
    const retained = [...newest.values()].filter(
      (job) => job.attempt < count && job.conclusion === 'success',
    )
    latestRuns.push({
      ...latest,
      createdAt: run.created_at,
      timeToLatestAttemptSeconds: seconds(
        run.created_at,
        latest.startedAt,
        'time before latest attempt',
      ),
      totalElapsedSeconds: latest.completedAt
        ? seconds(run.created_at, latest.completedAt, 'total workflow elapsed')
        : null,
      observedRetainedSuccessfulJobs: retained.map(({ id, name, attempt, executionSeconds }) => ({
        id,
        name,
        attempt,
        executionSeconds,
      })),
      observedRetainedRunnerSeconds: retained.reduce(
        (sum, job) => sum + (job.executionSeconds ?? 0),
        0,
      ),
    })
  }
  const workflowSummaries = PERFORMANCE_WORKFLOWS.flatMap((workflow) =>
    [...new Set(latestRuns.filter((run) => run.workflow === workflow).map((run) => run.event))].map(
      (event) => {
        const selected = latestRuns.filter(
          (run) => run.workflow === workflow && run.event === event,
        )
        const conclusions = {}
        for (const run of selected)
          conclusions[run.conclusion ?? 'incomplete'] =
            (conclusions[run.conclusion ?? 'incomplete'] ?? 0) + 1
        return {
          workflow,
          event,
          conclusions,
          successfulFirstAttempts: summarize(
            selected
              .filter(
                (run) =>
                  run.attempt === 1 && run.conclusion === 'success' && run.elapsedSeconds !== null,
              )
              .map((run) => run.elapsedSeconds),
          ),
        }
      },
    ),
  )
  // Event head identity is a grouping coordinate, never tested PR merge proof.
  const groups = Map.groupBy(latestRuns, (run) =>
    JSON.stringify([run.event, run.branch, run.eventHeadSha]),
  )
  const envelopes = [...groups.values()].map((group) => {
    const complete =
      group.length === PERFORMANCE_WORKFLOWS.length &&
      new Set(group.map((run) => run.workflow)).size === PERFORMANCE_WORKFLOWS.length
    const successful =
      complete && group.every((run) => run.conclusion === 'success' && run.completedAt)
    const first = group[0]
    return {
      event: first.event,
      branch: first.branch,
      eventHeadSha: first.eventHeadSha,
      runIds: group.map((run) => run.runId),
      reason: !complete
        ? 'missing-or-duplicate-workflow'
        : !successful
          ? 'not-all-successful'
          : null,
      threeWorkflowEnvelopeSeconds: successful
        ? seconds(
            group.map((run) => run.createdAt).sort(timeOrder)[0],
            group
              .map((run) => run.completedAt)
              .sort(timeOrder)
              .at(-1),
            'three-workflow envelope',
          )
        : null,
    }
  })
  return {
    schemaVersion: 1,
    repository,
    since,
    until,
    workflowSummaries,
    envelopes,
    attempts,
    latestRuns,
    notes: [
      'Pre-job delay includes workflow concurrency and scheduling; its cause is not established.',
      'Job release offsets include dependency and scheduling delay; they are not job queue time.',
      'Job queues combine concurrency and runner allocation waits; metadata does not distinguish their causes.',
      'Observed retained runner time requires no new execution; receipt acceptance and wall-clock savings are not established.',
      'Carried successful checks add no execution time; missing or ambiguous execution origins remain explicit.',
      'Event head groups do not establish an exact tested PR merge source or branch-policy readiness.',
      'Conclusions and failed steps classify observations; no flake rate is inferred.',
      'Reports grant no qualification and never update scheduling weights.',
    ],
  }
}

export async function collectCiPerformance({ repository, since, until }) {
  window(repository, since, until)
  let requests = 0
  const deadline = Date.now() + 15 * 60_000
  const api = (path) => {
    if (++requests > MAX_REQUESTS || Date.now() >= deadline)
      throw new Error('Performance collection budget exceeded; use a narrower window')
    return JSON.parse(
      execFileSync('gh', ['api', path], {
        encoding: 'utf8',
        timeout: Math.min(15_000, deadline - Date.now()),
        maxBuffer: 16 * 1024 * 1024,
      }),
    )
  }
  const pages = (path, key) => {
    const rows = []
    let expected
    for (let page = 1; page <= 10; page++) {
      const response = api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
      if (
        !Array.isArray(response[key]) ||
        !Number.isSafeInteger(response.total_count) ||
        response.total_count < 0 ||
        (expected !== undefined && expected !== response.total_count)
      )
        throw new Error(`Missing or changing GitHub ${key} pagination`)
      expected = response.total_count
      if (expected > 1000)
        throw new Error('Performance pagination limit exceeded; use a narrower window')
      rows.push(...response[key])
      if (response[key].length < 100) {
        if (rows.length !== expected) throw new Error('Incomplete performance pagination')
        return rows
      }
    }
    throw new Error('Incomplete performance pagination; use a narrower window')
  }
  const runs = []
  for (const workflow of PERFORMANCE_WORKFLOWS) {
    const path = `repos/${repository}/actions/workflows/${workflow.split('/').at(-1)}/runs`
    for (const run of pages(
      `${path}?created=${encodeURIComponent(`${since}..${until}`)}`,
      'workflow_runs',
    )) {
      if (time(run.created_at, 'run creation') >= time(until, 'window end')) continue
      if (runs.length >= MAX_RUNS || run.run_attempt > MAX_ATTEMPTS)
        throw new Error('Performance run or attempt limit exceeded; use a narrower window')
      const jobs = pages(`repos/${repository}/actions/runs/${run.id}/jobs?filter=all`, 'jobs')
      const attempts = []
      for (let number = 1; number <= run.run_attempt; number++) {
        const metadata =
          number === run.run_attempt
            ? run
            : api(`repos/${repository}/actions/runs/${run.id}/attempts/${number}`)
        if (
          metadata.id !== run.id ||
          metadata.run_attempt !== number ||
          metadata.head_sha !== run.head_sha
        )
          throw new Error('Workflow attempt changed during performance collection')
        attempts.push({
          number,
          startedAt: metadata.run_started_at,
          conclusion: metadata.conclusion,
          jobs: jobs.filter((job) => job.run_attempt === number),
        })
      }
      const after = api(`repos/${repository}/actions/runs/${run.id}`)
      if (after.run_attempt !== run.run_attempt || after.updated_at !== run.updated_at)
        throw new Error('Workflow changed during performance collection; retry after it settles')
      runs.push({ run, attempts })
    }
  }
  return { repository, since, until, runs }
}

export function performanceMarkdown(report) {
  const cell = (value) =>
    String(value)
      .replaceAll('|', '\\|')
      .replace(/[\r\n]/g, ' ')
  const minutes = (value) => (value === null ? '—' : (value / 60).toFixed(1))
  return [
    '## CI performance observations',
    '',
    `Window: ${report.since} to ${report.until} (workflow creation, UTC).`,
    '',
    '| Workflow | Event | Successful first attempts | Median minutes | P90 minutes | Latest conclusions |',
    '| --- | --- | ---: | ---: | ---: | --- |',
    ...report.workflowSummaries.map(
      (row) =>
        `| ${cell(row.workflow.split('/').at(-1))} | ${cell(row.event)} | ${row.successfulFirstAttempts.count} | ` +
        `${minutes(row.successfulFirstAttempts.medianSeconds)} | ${minutes(row.successfulFirstAttempts.p90Seconds)} | ` +
        `${cell(
          Object.entries(row.conclusions)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', '),
        )} |`,
    ),
    '',
    `Measured ${report.latestRuns.length} runs and ${report.attempts.length} attempts.`,
    'JSON retains individual job queues, release offsets, pre-job delay and execution intervals.',
    'Cancelled jobs with explicitly unassigned runners contribute no runner execution time.',
    '',
    ...report.notes.map((note) => `- ${note}`),
    '',
  ].join('\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {}
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i]
      if (
        !['--repository', '--since', '--until', '--snapshot', '--report'].includes(key) ||
        options[key] ||
        !process.argv[i + 1]
      )
        throw new Error('Unknown, duplicate or missing performance option')
      options[key] = process.argv[i + 1]
    }
    if (options['--report'] && Object.keys(options).length !== 1)
      throw new Error('Use --report alone to render an existing JSON report')
    if (options['--report']) {
      const report = JSON.parse(await readFile(options['--report'], 'utf8'))
      if (
        report.schemaVersion !== 1 ||
        !Array.isArray(report.workflowSummaries) ||
        !Array.isArray(report.attempts) ||
        !Array.isArray(report.latestRuns) ||
        !Array.isArray(report.notes)
      )
        throw new Error('Malformed performance report')
      console.log(performanceMarkdown(report))
    } else {
      if (options['--snapshot'] && Object.keys(options).length !== 1)
        throw new Error('Use --snapshot alone, or --repository with --since and --until')
      const snapshot = options['--snapshot']
        ? JSON.parse(await readFile(options['--snapshot'], 'utf8'))
        : await collectCiPerformance({
            repository: options['--repository'],
            since: options['--since'],
            until: options['--until'],
          })
      console.log(JSON.stringify(analyzeCiPerformance(snapshot), null, 2))
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'CI performance collection failed')
    process.exitCode = 1
  }
}
