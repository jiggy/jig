import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// End-to-end response target, independent of per-job execution timeouts.
const PR_BUDGET_SECONDS = 25 * 60

export const PERFORMANCE_WORKFLOWS = Object.freeze([
  '.github/workflows/ci.yml',
  '.github/workflows/linux-host-conformance.yml',
  '.github/workflows/macos-hosted-candidates.yml',
])
const PR_GATE_JOBS = {
  [PERFORMANCE_WORKFLOWS[0]]: { gate: 'test' },
  [PERFORMANCE_WORKFLOWS[1]]: {
    gate: 'affected-linux',
    scope: 'Determine linux host scope',
    inputs: 'Acquire canonical linux host artifacts',
  },
  [PERFORMANCE_WORKFLOWS[2]]: {
    gate: 'affected-macos',
    scope: 'Determine macos host scope',
    inputs: 'Prepare Mac inputs',
  },
}
const MAX_RUNS = 1000
const MAX_ATTEMPTS = 10
const MAX_REQUESTS = 200
const QUALIFICATION_REQUEST_RESERVE = 500
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const MAX_WINDOW_MS = 31 * DAY_MS
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
function window(repository, since, until, scheduled = false) {
  if (!repositoryPattern.test(repository ?? '')) throw new Error('Invalid GitHub repository')
  const start = time(since, 'window start')
  const end = time(until, 'window end')
  if (end <= start || end - start > MAX_WINDOW_MS)
    throw new Error('Use a positive window of at most 31 days')
  if (scheduled && (end - start !== DAY_MS || end % DAY_MS !== 0))
    throw new Error('Scheduled performance collection requires one complete UTC day')
  return { start, end }
}
function runnerUnassigned(job) {
  return (job.runner_name === '' || job.runner_name === null) && job.steps?.length === 0
}
function classification(job) {
  if (job.conclusion === 'cancelled' && runnerUnassigned(job)) return 'runner-not-assigned'
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
  if (!values.length)
    return { count: 0, medianSeconds: null, p90Seconds: null, p95Seconds: null, maxSeconds: null }
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return {
    count: sorted.length,
    medianSeconds: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p90Seconds: sorted[Math.ceil(sorted.length * 0.9) - 1],
    p95Seconds: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxSeconds: sorted.at(-1),
  }
}

function summarizePrEnvelopes(envelopes, elapsedField = 'threeWorkflowEnvelopeSeconds') {
  const selected = envelopes.filter((envelope) => envelope.event === 'pull_request')
  const outcomes = { success: 0, failed: 0, cancelled: 0, incomplete: 0, ambiguous: 0 }
  for (const envelope of selected) outcomes[envelope.outcome]++
  const successful = selected.filter((envelope) => envelope.outcome === 'success')
  const durations = (rows) => ({
    ...summarize(rows.map((row) => row[elapsedField])),
    overBudgetCount: rows.filter((row) => row[elapsedField] > PR_BUDGET_SECONDS).length,
  })
  return {
    budgetSeconds: PR_BUDGET_SECONDS,
    groupCount: selected.length,
    outcomes,
    successful: durations(successful),
    successfulFirstAttempts: durations(successful.filter((row) => !row.hasRetries)),
    successfulWithRetries: durations(successful.filter((row) => row.hasRetries)),
  }
}

function combinedPreparationScope(job) {
  const scope = job.steps?.find(
    ({ name }) => name === 'Determine whether complete host qualification is required',
  )
  const acquisition = job.steps?.find(
    ({ name }) => name === 'Acquire the exact canonical CI candidates',
  )
  if (scope?.conclusion !== 'success' || !acquisition) return 'unverified'
  if (acquisition.conclusion === 'skipped') {
    const freeze = job.steps.find(
      ({ name }) => name === 'Freeze the complete source-bound useful-shard plan',
    )
    if (freeze?.conclusion === 'success') return 'full'
    if (freeze && freeze.conclusion !== 'skipped') return 'unverified'
    return job.conclusion === 'success' ? 'omitted' : 'unverified'
  }
  return acquisition.started_at ? 'full' : 'unverified'
}

function observeHostScope(scopeJob, inputJob) {
  if (!inputJob || inputJob.carriedExecution) return 'unverified'
  if (!scopeJob) return inputJob.hostPreparationScope ?? 'unverified'
  // Historical samples retain separate scope and preparation jobs.
  if (scopeJob.conclusion !== 'success' || scopeJob.carriedExecution) return 'unverified'
  if (inputJob.conclusion === 'skipped') return 'omitted'
  return inputJob.jobQueueSeconds !== null ? 'full' : 'unverified'
}

function observePrGate(workflow, latestJobs) {
  const { gate, scope, inputs } = PR_GATE_JOBS[workflow]
  const required = latestJobs.get(gate)
  const scopeJob = latestJobs.get(scope)
  const inputJob = latestJobs.get(inputs)
  return {
    gate:
      required && !required.carriedExecution
        ? { id: required.id, conclusion: required.conclusion, completedAt: required.completedAt }
        : null,
    hostScope: observeHostScope(scopeJob, inputJob),
  }
}

function prGateEnvelope(group, { duplicate, complete }) {
  const hosts = group.filter((run) => run.workflow !== PERFORMANCE_WORKFLOWS[0])
  const hostScope =
    !duplicate && hosts.some((run) => run.prGate.hostScope === 'omitted')
      ? 'omitted'
      : !duplicate && hosts.length === 2 && hosts.every((run) => run.prGate.hostScope === 'full')
        ? 'full'
        : 'unverified'
  const gates = group.map((run) => run.prGate.gate)
  const successful =
    complete && gates.every((gate) => gate?.conclusion === 'success' && gate.completedAt)
  const conclusions = group.map((run, index) => gates[index]?.conclusion ?? run.conclusion)
  const failed = conclusions.some((conclusion) =>
    ['failure', 'timed_out', 'startup_failure'].includes(conclusion),
  )
  const outcome = duplicate
    ? 'ambiguous'
    : successful
      ? 'success'
      : failed
        ? 'failed'
        : conclusions.includes('cancelled')
          ? 'cancelled'
          : 'incomplete'
  return {
    hostScope,
    outcome,
    requiredGateElapsedSeconds: successful
      ? seconds(
          group.map((run) => run.createdAt).sort(timeOrder)[0],
          gates
            .map((gate) => gate.completedAt)
            .sort(timeOrder)
            .at(-1),
          'PR required check envelope',
        )
      : null,
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
        const category = carried ? 'carried-success-check' : classification(job)
        const unassigned = runnerUnassigned(job)
        const reversedUnassignedCompletion =
          category === 'runner-not-assigned' &&
          job.completed_at &&
          time(job.completed_at, 'job completion') < time(job.created_at, 'job release')
        const timed = !carried && category !== 'job-skipped' && !reversedUnassignedCompletion
        const releasedAfterSeconds = !timed
          ? null
          : seconds(attempt.startedAt, job.created_at, 'job release')
        const jobQueueSeconds =
          timed && !unassigned && job.started_at
            ? seconds(job.created_at, job.started_at, 'job queue')
            : null
        const executionSeconds =
          timed && !unassigned && job.started_at && job.completed_at
            ? seconds(job.started_at, job.completed_at, 'job execution')
            : null
        const unassignedSeconds =
          timed && unassigned && job.completed_at
            ? seconds(job.created_at, job.completed_at, 'unassigned job wait')
            : null
        if (timed && job.completed_at) seconds(job.created_at, job.completed_at, 'job completion')
        const observation = {
          id: job.id,
          name: job.name,
          attempt: attempt.number,
          classification: category,
          conclusion: job.conclusion ?? null,
          createdAt: job.created_at,
          startedAt: job.started_at ?? null,
          completedAt: job.completed_at ?? null,
          releasedAfterSeconds,
          jobQueueSeconds,
          executionSeconds,
          unassignedSeconds,
          carriedExecution,
          ...(job.name === PR_GATE_JOBS[run.path].inputs
            ? { hostPreparationScope: combinedPreparationScope(job) }
            : {}),
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
        .filter((job) => job.releasedAfterSeconds !== null)
        .map((job) => job.createdAt)
        .sort(timeOrder)
        .at(0)
      const completedAt =
        active.length && active.every((job) => job.releasedAfterSeconds !== null && job.completedAt)
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
      if (job.carriedExecution?.origin === 'matched') continue
      newest.set(job.name, job)
    }
    const retained = [...newest.values()].filter(
      (job) => job.attempt < count && job.conclusion === 'success' && !job.carriedExecution,
    )
    latestRuns.push({
      ...latest,
      prGate: run.event === 'pull_request' ? observePrGate(run.path, newest) : null,
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
    const duplicate = new Set(group.map((run) => run.workflow)).size !== group.length
    const complete = !duplicate && group.length === PERFORMANCE_WORKFLOWS.length
    const successful =
      complete && group.every((run) => run.conclusion === 'success' && run.completedAt)
    const outcome = duplicate
      ? 'ambiguous'
      : !complete
        ? 'incomplete'
        : successful
          ? 'success'
          : group.some((run) =>
                ['failure', 'timed_out', 'startup_failure'].includes(run.conclusion),
              )
            ? 'failed'
            : group.some((run) => run.conclusion === 'cancelled')
              ? 'cancelled'
              : 'incomplete'
    const first = group[0]
    return {
      event: first.event,
      branch: first.branch,
      eventHeadSha: first.eventHeadSha,
      runIds: group.map((run) => run.runId),
      outcome,
      hasRetries: group.some((run) => run.attempt > 1),
      requiredChecks:
        first.event === 'pull_request' ? prGateEnvelope(group, { duplicate, complete }) : null,
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
  const prGateEnvelopes = envelopes
    .filter((row) => row.requiredChecks)
    .map((row) => ({ event: row.event, hasRetries: row.hasRetries, ...row.requiredChecks }))
  return {
    schemaVersion: 1,
    repository,
    since,
    until,
    workflowSummaries,
    envelopes,
    prEnvelopeSummary: summarizePrEnvelopes(envelopes),
    prRequiredChecksSummary: {
      omittedHostScope: prGateEnvelopes.filter((row) => row.hostScope === 'omitted').length,
      unverifiedHostScope: prGateEnvelopes.filter((row) => row.hostScope === 'unverified').length,
      ...summarizePrEnvelopes(
        prGateEnvelopes.filter((row) => row.hostScope === 'full'),
        'requiredGateElapsedSeconds',
      ),
    },
    attempts,
    latestRuns,
    notes: [
      'Pre-job delay includes workflow concurrency and scheduling; its cause is not established.',
      'Job release offsets include dependency and scheduling delay; they are not job queue time.',
      'Job queues combine concurrency and runner allocation waits; metadata does not distinguish their causes.',
      'Skipped checks contribute no timing. Unassigned cancellations with reversed timestamps retain their outcome without timing.',
      'Observed retained runner time requires no new execution; receipt acceptance and wall-clock savings are not established.',
      'Carried successful checks add no execution time; missing or ambiguous execution origins remain explicit.',
      'Event head groups do not establish an exact tested PR merge source or branch-policy readiness.',
      'Workflow-creation envelopes do not measure the exact push time or identify distinct push events.',
      'Successful retry envelopes include waiting and earlier attempts from the original workflow creation.',
      'The 25-minute comparison is diagnostic; it neither cancels work nor changes qualification.',
      'Conclusions and failed steps classify observations; no flake rate is inferred.',
      'Reports grant no qualification and never update scheduling weights.',
    ],
  }
}

export function performanceRequestBudget(rateLimit) {
  const core = rateLimit?.resources?.core
  if (
    !Number.isSafeInteger(core?.remaining) ||
    core.remaining < 0 ||
    !Number.isSafeInteger(core.limit) ||
    core.limit <= 0 ||
    core.remaining > core.limit
  )
    throw new Error('Missing GitHub core rate budget; refusing performance collection')
  const budget = Math.min(MAX_REQUESTS, core.remaining - QUALIFICATION_REQUEST_RESERVE)
  if (budget < 1)
    throw new Error(
      'Preserve 500 GitHub core requests for qualification; retry after the budget resets',
    )
  return budget
}

class PerformanceRequestBudgetExceeded extends Error {}

export function requireCollectionBudget(runs, requests, budget) {
  const minimum = runs.reduce((sum, run) => {
    identity(run.id, 'run ID')
    const attempt = identity(run.run_attempt, 'run attempt')
    if (attempt > MAX_ATTEMPTS) throw new Error('Performance attempt limit exceeded')
    return sum + 1 + attempt
  }, 0)
  if (requests + minimum > budget)
    throw new PerformanceRequestBudgetExceeded(
      'Complete performance window exceeds the reserved API budget; use a narrower window',
    )
}

export async function collectCiPerformance({ repository, since, until, scheduled = false }) {
  const bounds = window(repository, since, until, scheduled)
  let requests = 0
  let requestLimit = 1
  const deadline = Date.now() + 15 * 60_000
  const api = (path) => {
    const timeLeft = deadline - Date.now()
    if (timeLeft <= 0)
      throw new Error('Performance collection deadline exceeded; use a narrower window')
    if (requests >= requestLimit)
      throw new PerformanceRequestBudgetExceeded(
        'Performance collection budget exceeded; use a narrower window',
      )
    requests++
    return JSON.parse(
      execFileSync('gh', ['api', path], {
        encoding: 'utf8',
        timeout: Math.min(15_000, timeLeft),
        maxBuffer: 16 * 1024 * 1024,
      }),
    )
  }
  requestLimit = performanceRequestBudget(api('rate_limit'))
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
  const selectedRuns = []
  for (const workflow of PERFORMANCE_WORKFLOWS) {
    const path = `repos/${repository}/actions/workflows/${workflow.split('/').at(-1)}/runs`
    for (const run of pages(
      `${path}?created=${encodeURIComponent(`${since}..${until}`)}`,
      'workflow_runs',
    )) {
      const created = time(run.created_at, 'run creation')
      if (created >= bounds.end) continue
      if (created < bounds.start) throw new Error('Performance run predates the requested window')
      if (selectedRuns.length >= MAX_RUNS || run.run_attempt > MAX_ATTEMPTS)
        throw new Error('Performance run or attempt limit exceeded; use a narrower window')
      selectedRuns.push(run)
    }
  }
  const collectRun = (run) => {
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
    return { run, attempts }
  }
  if (!scheduled) {
    requireCollectionBudget(selectedRuns, requests, requestLimit)
    return { repository, since, until, runs: selectedRuns.map(collectRun) }
  }

  const runs = []
  let completeSince = bounds.end
  for (let hourStart = bounds.end - HOUR_MS; hourStart >= bounds.start; hourStart -= HOUR_MS) {
    const hourRuns = selectedRuns.filter((run) => {
      const created = time(run.created_at, 'run creation')
      return created >= hourStart && created < completeSince
    })
    try {
      requireCollectionBudget(hourRuns, requests, requestLimit)
      const collectedHour = hourRuns.map(collectRun)
      runs.push(...collectedHour)
    } catch (error) {
      if (!(error instanceof PerformanceRequestBudgetExceeded)) throw error
      if (completeSince === bounds.end)
        throw new Error('The final complete UTC hour exceeds the reserved performance API budget')
      break
    }
    completeSince = hourStart
  }
  return { repository, since: new Date(completeSince).toISOString(), until, runs }
}

export function performanceMarkdown(report) {
  const cell = (value) =>
    String(value)
      .replaceAll('|', '\\|')
      .replace(/[\r\n]/g, ' ')
  const minutes = (value) => (value === null ? '—' : (value / 60).toFixed(1))
  const pr = report.prEnvelopeSummary
  const gates = report.prRequiredChecksSummary
  const retriedFullPrGroups = report.envelopes.filter(
    (row) => row.event === 'pull_request' && row.requiredChecks?.hostScope === 'full' && row.hasRetries,
  ).length
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
    '### PR three-workflow elapsed envelope',
    '',
    'Elapsed time runs from the earliest workflow creation to the latest observed job completion in the successful workflows.',
    'This diagnostic groups event heads, not distinct pushes or verified branch-policy readiness.',
    `Observed PR event-head groups: ${pr.groupCount}. Budget comparison: ${minutes(pr.budgetSeconds)} minutes.`,
    '',
    '| Success | Failed | Cancelled | Incomplete | Ambiguous |',
    '| ---: | ---: | ---: | ---: | ---: |',
    `| ${pr.outcomes.success} | ${pr.outcomes.failed} | ${pr.outcomes.cancelled} | ${pr.outcomes.incomplete} | ${pr.outcomes.ambiguous} |`,
    '',
    'Missing workflows are incomplete. Duplicate workflows are ambiguous. Failed outcomes take precedence over cancellation within complete groups.',
    'Other unfinished or non-success outcomes remain incomplete. These groups remain in the denominator and contribute no successful timing.',
    '',
    '| Successful PR groups | Count | Median minutes | P90 minutes | P95 minutes | Maximum minutes | Over 25 minutes |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...[
      ['All latest successes', pr.successful],
      ['Without reruns', pr.successfulFirstAttempts],
      ['After reruns', pr.successfulWithRetries],
    ].map(
      ([label, row]) =>
        `| ${label} | ${row.count} | ${minutes(row.medianSeconds)} | ${minutes(row.p90Seconds)} | ` +
        `${minutes(row.p95Seconds)} | ${minutes(row.maxSeconds)} | ${row.overBudgetCount} |`,
    ),
    '',
    'Rerun timing includes the earlier attempts and the wait before retry. A cancelled run is never a fast success.',
    'Breach counts use unrounded seconds. Exactly 25 minutes remains within budget.',
    '',
    '### Required checks on full-qualification PRs',
    '',
    'Elapsed time runs from the earliest workflow creation until the CI, Linux and macOS gates pass. It includes runner waits and retains the original start on retries.',
    'Full host scope requires observed Linux candidate acquisition and a frozen PR Mac plan or historical Mac acquisition. Event heads still require a separate check for tested merge identity.',
    `Observed full-qualification groups: ${gates.groupCount}. Omitted host scope: ${gates.omittedHostScope}. Unverified host scope: ${gates.unverifiedHostScope}.`,
    '',
    '| Gate outcomes | Passed | Failed | Cancelled | Incomplete | Retried groups | Retried passes |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| Full qualification | ${gates.outcomes.success} | ${gates.outcomes.failed} | ${gates.outcomes.cancelled} | ${gates.outcomes.incomplete} | ${retriedFullPrGroups} | ${gates.successfulWithRetries.count} |`,
    '',
    '| Passing full-qualification PRs | Median minutes | P90 minutes | Over 25 minutes |',
    '| ---: | ---: | ---: | ---: |',
    `| ${gates.successful.count} | ${minutes(gates.successful.medianSeconds)} | ${minutes(gates.successful.p90Seconds)} | ${gates.successful.overBudgetCount} |`,
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
    const args = process.argv.slice(2)
    const scheduled = args[0] === '--scheduled'
    if (scheduled) args.shift()
    const options = {}
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]
      if (
        !['--repository', '--since', '--until', '--snapshot', '--report'].includes(key) ||
        options[key] ||
        !args[i + 1]
      )
        throw new Error('Unknown, duplicate or missing performance option')
      options[key] = args[i + 1]
    }
    if (scheduled && (options['--snapshot'] || options['--report']))
      throw new Error('Use --scheduled with live collection of one complete UTC day')
    if (options['--report'] && Object.keys(options).length !== 1)
      throw new Error('Use --report alone to render an existing JSON report')
    if (options['--report']) {
      const report = JSON.parse(await readFile(options['--report'], 'utf8'))
      if (
        report.schemaVersion !== 1 ||
        !Array.isArray(report.workflowSummaries) ||
        !Array.isArray(report.attempts) ||
        !Array.isArray(report.latestRuns) ||
        !Array.isArray(report.envelopes) ||
        !report.prEnvelopeSummary ||
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
            scheduled,
          })
      const report = analyzeCiPerformance(snapshot)
      if (
        scheduled &&
        time(report.since, 'report start') > time(options['--since'], 'requested start')
      )
        report.notes.unshift(
          'The scheduled UTC day exceeded the read budget. This report covers the complete trailing interval shown above.',
        )
      console.log(JSON.stringify(report, null, 2))
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'CI performance collection failed')
    process.exitCode = 1
  }
}
