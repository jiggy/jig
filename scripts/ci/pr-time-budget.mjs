import { spawn } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { constants as osConstants } from 'node:os'
import { pathToFileURL } from 'node:url'
import {
  MAC_COHORT_ALLOCATOR_NAME,
  MAC_COHORT_GUARD_JOB_NAME,
  MAC_COHORT_READY_JOB_NAME,
  MAC_PR_COHORT,
  macHostCohortWorkerName,
} from './macos-host-cohort.mjs'

export const PR_BUDGET_SECONDS = 25 * 60
export const PR_SETTLEMENT_RESERVE_SECONDS = 120
export const PR_QUEUE_BUDGET_SECONDS = 60 * 60
export const PR_COORDINATION_BUDGET_SECONDS = 90 * 60
export const PR_PREPARATION_BUDGET_SECONDS = 45 * 60
export const PR_EVIDENCE_BUDGET_SECONDS = 5 * 60
const budgetSeconds = Object.freeze({
  worker: PR_BUDGET_SECONDS,
  coordination: PR_COORDINATION_BUDGET_SECONDS,
  preparation: PR_PREPARATION_BUDGET_SECONDS,
  evidence: PR_EVIDENCE_BUDGET_SECONDS,
})
const commandTerminationGraceMs = 5000
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const shaPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const githubApiOrigin = 'https://api.github.com'
const maxMetadataBytes = 4 * 1024 * 1024
const pendingJobStatuses = ['queued', 'in_progress', 'requested', 'waiting', 'pending']
const macPrGuardExplanation =
  'This Ubuntu monitor watches all five Mac workers: at most 60 minutes queued and 25 minutes executing per assigned worker.\n' +
  'Native setup and test steps are intentionally skipped on this matrix row.\n' +
  'Mac workers execute their assigned test roles or record a surplus assignment.\n' +
  'The native qualification aggregate validates complete current-attempt test evidence.\n' +
  'Queue and coordination time are separate from execution. This monitor does not establish a 25-minute end-to-end result.'
const macPrGuardSuccess =
  'Monitor succeeded: all five current-attempt Mac worker jobs completed within their individual 25-minute execution allowances, and the allocator and preparation gate succeeded.\n' +
  'This monitor grants no native test credit. The subsequent native qualification aggregate owns qualification.'

function integer(value, label, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${label}`)
  return value
}

function identity({ repository, runId, attempt, headSha }) {
  if (
    typeof repository !== 'string' ||
    !repositoryPattern.test(repository) ||
    repository.split('/').some((part) => part === '.' || part === '..') ||
    !shaPattern.test(headSha ?? '')
  )
    throw new Error('Invalid PR workflow identity')
  integer(runId, 'workflow run ID')
  integer(attempt, 'workflow attempt')
  return { repository, runId, attempt, headSha }
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value))
    throw new Error('Invalid PR execution timestamp')
  const milliseconds = Date.parse(value)
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z')
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== canonical)
    throw new Error('Invalid PR execution timestamp')
  return milliseconds
}

function jobBudgetIdentity(expected) {
  const selected = identity(expected)
  const { kind, jobName } = expected
  const worker = Array.from({ length: MAC_PR_COHORT.workers }, (_, index) =>
    macHostCohortWorkerName(index),
  ).includes(jobName)
  const names = {
    worker,
    coordination: [MAC_COHORT_ALLOCATOR_NAME, MAC_COHORT_GUARD_JOB_NAME].includes(jobName),
    preparation: jobName === MAC_COHORT_READY_JOB_NAME,
    evidence: ['Native host qualification — arm64', 'affected-macos'].includes(jobName),
  }
  if (!Object.hasOwn(budgetSeconds, kind) || names[kind] !== true)
    throw new Error('Invalid PR job budget kind or owning job name')
  return { ...selected, kind, jobName }
}

function runTiming(run, expected, now) {
  const selected = identity(expected)
  integer(now, 'current time', 0)
  if (
    run?.id !== selected.runId ||
    run.run_attempt !== selected.attempt ||
    run.repository?.full_name !== selected.repository ||
    run.head_sha !== selected.headSha ||
    run.event !== 'pull_request'
  )
    throw new Error('Foreign, stale or non-PR workflow metadata')
  const createdEpochMs = timestamp(run.created_at)
  const attemptStartedEpochMs = timestamp(run.run_started_at)
  if (createdEpochMs > attemptStartedEpochMs || attemptStartedEpochMs > now)
    throw new Error('Invalid workflow creation or current-attempt start time')
  return { ...selected, createdEpochMs, attemptStartedEpochMs }
}

function currentJob(job, expected) {
  integer(job?.id, 'observed job ID')
  if (
    job.run_id !== expected.runId ||
    job.run_attempt !== expected.attempt ||
    job.head_sha !== expected.headSha ||
    job.run_url !==
      `${githubApiOrigin}/repos/${expected.repository}/actions/runs/${expected.runId}` ||
    ![...pendingJobStatuses, 'completed'].includes(job.status) ||
    (job.status !== 'completed' && job.conclusion !== null)
  )
    throw new Error('Foreign, stale or invalid current-attempt job metadata')
}

function hasObservedAssignment(job) {
  return (
    Number.isSafeInteger(job.runner_id) &&
    job.runner_id > 0 &&
    typeof job.runner_name === 'string' &&
    !!job.runner_name.trim() &&
    Array.isArray(job.steps) &&
    job.steps.some(
      (step) =>
        ['in_progress', 'completed'].includes(step.status) &&
        step.conclusion !== 'skipped' &&
        typeof step.started_at === 'string',
    )
  )
}

function assignedJobTiming(job, expected, now) {
  currentJob(job, expected)
  const jobCreatedEpochMs = timestamp(job.created_at)
  if (jobCreatedEpochMs < expected.attemptStartedEpochMs || jobCreatedEpochMs > now)
    throw new Error('Job creation belongs to another attempt or is in the future')
  // GitHub can populate started_at for a job which never received a runner.
  // It is not an execution anchor without an assigned runner and observed steps.
  if (!hasObservedAssignment(job))
    throw new Error('PR job has no verified runner assignment and executed step')
  const jobStartedEpochMs = timestamp(job.started_at)
  if (jobStartedEpochMs < jobCreatedEpochMs || jobStartedEpochMs > now)
    throw new Error('Job execution is stale, copied from an earlier attempt or in the future')
  for (const step of job.steps.filter(
    (step) => ['in_progress', 'completed'].includes(step.status) && step.conclusion !== 'skipped',
  )) {
    const started = timestamp(step.started_at)
    if (started < jobStartedEpochMs || started > now)
      throw new Error('Job steps do not belong to its observed execution')
  }
  const runnerLabel = job.name?.startsWith('Native host worker — ') ? 'macos-15' : 'ubuntu-24.04'
  if (!Array.isArray(job.labels) || !job.labels.includes(runnerLabel))
    throw new Error('PR job has an unexpected assigned runner label')
  return {
    jobId: job.id,
    jobCreatedEpochMs,
    jobStartedEpochMs,
    runnerId: job.runner_id,
    runnerName: job.runner_name,
  }
}

/** Execution starts at this assigned job, never at a placeholder queued timestamp. */
export function prTimeBudgetFromJob(run, job, expected, now = Date.now()) {
  const selected = jobBudgetIdentity(expected)
  const timing = runTiming(run, selected, now)
  if (job?.name !== selected.jobName || job.status !== 'in_progress' || job.conclusion !== null)
    throw new Error('PR budget requires its unique active owning job')
  const assigned = assignedJobTiming(job, timing, now)
  if (
    selected.kind === 'worker' &&
    assigned.jobStartedEpochMs - assigned.jobCreatedEpochMs >= PR_QUEUE_BUDGET_SECONDS * 1000
  )
    throw new Error('Mac worker started after its 60-minute queue allowance')
  return {
    ...selected,
    ...timing,
    ...assigned,
    deadlineEpochMs: assigned.jobStartedEpochMs + budgetSeconds[selected.kind] * 1000,
  }
}

async function readPrMetadata(
  expected,
  path,
  { token, apiOrigin = githubApiOrigin, deadlineEpochMs } = {},
) {
  const selected = identity(expected)
  if (typeof token !== 'string' || !token) throw new Error('GH_TOKEN is required to verify the PR deadline')
  const origin = new URL(apiOrigin)
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    (origin.protocol !== 'https:' &&
      !(origin.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(origin.hostname)))
  )
    throw new Error('Invalid PR metadata API origin')
  const deadline = Math.min(deadlineEpochMs ?? Infinity, Date.now() + 60_000)
  for (let attempt = 0; ; attempt++) {
    const timeout = Math.min(10_000, deadline - Date.now())
    if (!Number.isSafeInteger(timeout) || timeout <= 0)
      throw new Error('The PR metadata deadline has elapsed')
    let response
    let failure
    let retryDelayMs = 1000 * (attempt + 1)
    try {
      response = await fetch(`${origin.origin}/repos/${selected.repository}/${path}`, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })
    } catch {
      failure = new Error('Unable to read PR workflow metadata')
    }
    if (response?.ok) {
      const chunks = []
      let bytes = 0
      try {
        for await (const chunk of response.body) {
          bytes += chunk.byteLength
          if (bytes > maxMetadataBytes) throw new Error('Oversized PR metadata')
          chunks.push(chunk)
        }
      } catch {
        throw new Error('Unable to read bounded PR metadata body')
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    }
    if (response) {
      await response.body?.cancel()
      failure = new Error(`PR workflow metadata request failed (HTTP ${response.status})`)
      if (response.status !== 429 && response.status < 500) throw failure
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after')
        const reset = response.headers.get('x-ratelimit-reset')
        let retryAfterDelayMs
        let resetDelayMs
        if (retryAfter !== null) {
          if (/^\d+$/.test(retryAfter)) retryAfterDelayMs = Number(retryAfter) * 1000
          else retryAfterDelayMs = Date.parse(retryAfter) - Date.now()
          if (!Number.isSafeInteger(retryAfterDelayMs))
            throw new Error('PR metadata rate limit has an invalid Retry-After value')
        }
        if (response.headers.get('x-ratelimit-remaining') === '0' && reset !== null) {
          if (!/^\d+$/.test(reset) || !Number.isSafeInteger(Number(reset) * 1000))
            throw new Error('PR metadata rate limit has an invalid reset timestamp')
          resetDelayMs = Number(reset) * 1000 - Date.now()
        }
        retryDelayMs = Math.max(
          1000,
          retryAfterDelayMs ?? resetDelayMs ?? 60_000,
          resetDelayMs ?? 0,
        )
        failure = new Error(
          `PR workflow metadata rate limited (HTTP 429; retry wait ${Math.ceil(retryDelayMs / 1000)} seconds)`,
        )
        if (Date.now() + retryDelayMs >= deadline)
          throw new Error(
            `${failure.message}; the required wait does not fit within the metadata allowance`,
          )
      }
    }
    if (attempt >= 2 || Date.now() >= deadline) throw failure
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(retryDelayMs, deadline - Date.now())),
    )
  }
}

function completeJobs(snapshot) {
  if (
    !Number.isSafeInteger(snapshot?.total_count) ||
    snapshot.total_count < 0 ||
    snapshot.total_count > 100 ||
    !Array.isArray(snapshot.jobs) ||
    snapshot.jobs.length !== snapshot.total_count
  )
    throw new Error('PR timing refuses an incomplete job inventory')
  return snapshot.jobs
}

/** Bounded read-only metadata; source/attempt/assignment changes never reset a clock. */
export async function fetchPrTimeBudget(expected, options = {}) {
  const selected = jobBudgetIdentity(expected)
  const deadlineEpochMs = Math.min(options.deadlineEpochMs ?? Infinity, Date.now() + 60_000)
  const bounded = { ...options, deadlineEpochMs }
  const run = await readPrMetadata(selected, `actions/runs/${selected.runId}`, bounded)
  const timing = runTiming(run, selected, Date.now())
  let jobId
  for (;;) {
    const jobs = completeJobs(
      await readPrMetadata(
        selected,
        `actions/runs/${selected.runId}/attempts/${selected.attempt}/jobs?per_page=100`,
        bounded,
      ),
    )
    const matches = jobs.filter((job) => job.name === selected.jobName)
    if (matches.length > 1)
      throw new Error('PR budget requires one exact current-attempt owning job')
    const job = matches[0]
    if (job) {
      currentJob(job, selected)
      if (jobId !== undefined && jobId !== job.id)
        throw new Error('PR budget owning job changed while verifying its runner assignment')
      jobId = job.id
      const created = timestamp(job.created_at)
      if (created < timing.attemptStartedEpochMs || created > Date.now())
        throw new Error('PR budget owning job has a stale or future creation time')
      if (job.status === 'completed')
        throw new Error('PR budget requires its active job, not retained execution')
      if (job.status === 'in_progress' && hasObservedAssignment(job))
        return prTimeBudgetFromJob(run, job, selected)
    }
    if (Date.now() >= deadlineEpochMs)
      throw new Error(
        'PR job runner assignment was not observable within the bounded metadata wait',
      )
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(5000, deadlineEpochMs - Date.now())),
    )
  }
}

/** Compute a phase allowance; callers retain ownership of cancellation and settlement. */
export function remainingPrTimeBudget(
  budget,
  { now = Date.now(), reserveSeconds = PR_SETTLEMENT_RESERVE_SECONDS } = {},
) {
  jobBudgetIdentity(budget)
  integer(budget.createdEpochMs, 'workflow creation time', 0)
  integer(budget.attemptStartedEpochMs, 'attempt start time', 0)
  integer(budget.jobCreatedEpochMs, 'job creation time', 0)
  integer(budget.jobStartedEpochMs, 'assigned job start time', 0)
  integer(budget.jobId, 'assigned job ID')
  integer(budget.deadlineEpochMs, 'PR deadline')
  integer(now, 'current time', 0)
  integer(reserveSeconds, 'settlement reserve', 0)
  if (reserveSeconds >= budgetSeconds[budget.kind])
    throw new Error('Settlement reserve exceeds the PR budget')
  if (budget.deadlineEpochMs !== budget.jobStartedEpochMs + budgetSeconds[budget.kind] * 1000)
    throw new Error('PR deadline differs from the assigned job allowance')
  if (
    budget.createdEpochMs > budget.attemptStartedEpochMs ||
    budget.attemptStartedEpochMs > budget.jobCreatedEpochMs ||
    budget.jobCreatedEpochMs > budget.jobStartedEpochMs ||
    budget.jobStartedEpochMs > now
  )
    throw new Error('Invalid retained workflow, attempt or assigned job timing')
  if (now >= budget.deadlineEpochMs)
    throw new Error(
      `The ${budgetSeconds[budget.kind] / 60}-minute PR ${budget.kind} allowance has elapsed`,
    )
  const remainingSeconds = Math.floor((budget.deadlineEpochMs - now) / 1000)
  const workSeconds = Math.max(0, remainingSeconds - reserveSeconds)
  const workMilliseconds = Math.max(0, budget.deadlineEpochMs - now - reserveSeconds * 1000)
  const terminationGraceMs = Math.min(commandTerminationGraceMs, reserveSeconds * 1000)
  return {
    deadline_epoch_ms: budget.deadlineEpochMs,
    remaining_seconds: remainingSeconds,
    reserve_seconds: reserveSeconds,
    work_seconds: workSeconds,
    work_minutes: Math.floor(workSeconds / 60),
    // GitHub's whole-minute limit is a backstop. Let the absolute Node deadline
    // and its bounded process-group termination finish before that limit fires.
    step_timeout_minutes: Math.ceil((workMilliseconds + terminationGraceMs) / 60_000),
  }
}

/** Describe an already validated assigned-job budget without moving its deadline. */
export function formatPrTimeBudget(budget) {
  return [
    `PR ${budget.kind} allowance (UTC)`,
    `Workflow created: ${new Date(budget.createdEpochMs).toISOString()}`,
    `Current attempt started: ${new Date(budget.attemptStartedEpochMs).toISOString()} (attempt ${budget.attempt})`,
    `Assigned job started: ${new Date(budget.jobStartedEpochMs).toISOString()} (job ${budget.jobId})`,
    `Job queue: ${(budget.jobStartedEpochMs - budget.jobCreatedEpochMs) / 1000} seconds`,
    `Work cutoff: ${new Date(budget.deadlineEpochMs - PR_SETTLEMENT_RESERVE_SECONDS * 1000).toISOString()}`,
    `Final job deadline: ${new Date(budget.deadlineEpochMs).toISOString()} (${budgetSeconds[budget.kind] / 60} minutes after this job started)`,
    'Native workers have 25 minutes of execution, including a two-minute cleanup and evidence reserve.',
    'Queues and coordination are separate. A fresh full attempt requires fresh native jobs and complete proof.',
    'This allowance does not establish the 25-minute end-to-end turnaround target.',
  ].join('\n')
}

export function formatPrTurnaround(budget, now = Date.now()) {
  integer(now, 'summary time', 0)
  if (now < budget.jobStartedEpochMs) throw new Error('Invalid PR summary time')
  const originalSeconds = Math.ceil((now - budget.createdEpochMs) / 1000)
  const attemptSeconds = Math.ceil((now - budget.attemptStartedEpochMs) / 1000)
  return [
    `Original workflow turnaround so far: ${originalSeconds} seconds.`,
    `Current attempt turnaround so far: ${attemptSeconds} seconds.`,
    originalSeconds > PR_BUDGET_SECONDS
      ? '**25-minute end-to-end turnaround target exceeded.** A successful execution check does not satisfy that target.'
      : 'The 25-minute end-to-end turnaround target has not yet been exceeded; this is not a final latency claim.',
  ].join('\n')
}

async function writePrTimingSummary(budget, destination) {
  if (!destination) return
  try {
    await appendFile(
      destination,
      `## PR timing\n\n\`\`\`text\n${formatPrTimeBudget(budget)}\n\`\`\`\n\n${formatPrTurnaround(budget)}\n\n`,
    )
  } catch {
    console.error('The optional PR timing summary could not be written.')
  }
}

/** Optional presentation after guard success; never called while propagating failure. */
export async function writeMacPrGuardSummary(budget, destination) {
  if (!destination) return
  try {
    await appendFile(
      destination,
      `## Mac PR deadline monitor\n\n${macPrGuardExplanation}\n\n` +
        `\`\`\`text\n${formatPrTimeBudget(budget)}\n\`\`\`\n\n${macPrGuardSuccess}\n\n${formatPrTurnaround(budget)}\n\n`,
    )
  } catch {
    console.error('The optional Mac PR deadline summary could not be written. The successful monitor result is unchanged.')
  }
}

/** Observed allocation and execution bounds; complete test proof belongs to the aggregate. */
export function macPrMatrixStatus(snapshot, expected, previous = {}, now = Date.now()) {
  const selected = identity(expected)
  integer(expected.attemptStartedEpochMs, 'current attempt start', 0)
  integer(expected.jobStartedEpochMs, 'monitor start', 0)
  integer(now, 'observation time', 0)
  const observed = completeJobs(snapshot)
  const previousIds = previous.jobIds ?? {}
  const previousStarts = previous.jobStarts ?? {}
  const workerNames = Array.from({ length: MAC_PR_COHORT.workers }, (_, worker) =>
    macHostCohortWorkerName(worker),
  )
  const requiredNames = [
    ...workerNames,
    MAC_COHORT_ALLOCATOR_NAME,
    MAC_COHORT_READY_JOB_NAME,
    MAC_COHORT_GUARD_JOB_NAME,
  ]
  const ids = new Set()
  for (const job of observed) {
    integer(job?.id, 'matrix job ID')
    if (
      ids.has(job.id) ||
      typeof job.name !== 'string' ||
      (job.name.startsWith('Native host worker — ') && !workerNames.includes(job.name))
    )
      throw new Error('PR matrix guard found duplicate or unexpected jobs')
    ids.add(job.id)
  }
  const jobs = new Map()
  const jobStarts = { ...previousStarts }
  const pending = []
  for (const name of requiredNames) {
    const matches = observed.filter((job) => job.name === name)
    if (!matches.length && !Object.hasOwn(previousIds, name)) {
      if (now >= expected.jobStartedEpochMs + PR_QUEUE_BUDGET_SECONDS * 1000)
        throw new Error(`Mac queue allowance elapsed before job registration: ${name}`)
      pending.push({ name, status: 'missing' })
      continue
    }
    if (matches.length !== 1) throw new Error('PR matrix guard requires unique current-attempt jobs')
    const job = matches[0]
    currentJob(job, selected)
    if (Object.hasOwn(previousIds, name) && previousIds[name] !== job.id)
      throw new Error('PR matrix guard found foreign, stale or invalid job metadata')
    if (job.status === 'completed' && job.conclusion !== 'success')
      throw new Error(`PR matrix prerequisite did not succeed: ${name}`)
    if (name === MAC_COHORT_GUARD_JOB_NAME && job.status === 'completed')
      throw new Error('PR matrix guard must be its active current-attempt job')
    const jobCreatedEpochMs = timestamp(job.created_at)
    if (jobCreatedEpochMs < expected.attemptStartedEpochMs || jobCreatedEpochMs > now)
      throw new Error('PR matrix job creation belongs to another attempt or is in the future')
    const assigned = hasObservedAssignment(job)
    if (!assigned) {
      if (job.status === 'completed' || Object.hasOwn(previousStarts, name))
        throw new Error(
          'A completed or previously assigned Mac prerequisite has no execution observation',
        )
      if (now >= jobCreatedEpochMs + PR_QUEUE_BUDGET_SECONDS * 1000)
        throw new Error(`Mac runner queue exceeded its 60-minute infrastructure allowance: ${name}`)
    } else {
      const timing = assignedJobTiming(job, expected, now)
      const recorded = previousStarts[name]
      if (recorded && Object.keys(timing).some((key) => timing[key] !== recorded[key]))
        throw new Error('PR matrix runner assignment or start time changed')
      jobStarts[name] = timing
      if (workerNames.includes(name)) {
        if (timing.jobStartedEpochMs - jobCreatedEpochMs >= PR_QUEUE_BUDGET_SECONDS * 1000)
          throw new Error(`Mac worker started after its 60-minute queue allowance: ${name}`)
        const end = job.status === 'completed' ? timestamp(job.completed_at) : now
        if (end < timing.jobStartedEpochMs || end > now)
          throw new Error('Invalid Mac worker completion time')
        if (end >= timing.jobStartedEpochMs + PR_BUDGET_SECONDS * 1000)
          throw new Error(`Mac worker exceeded its 25-minute execution allowance: ${name}`)
      }
      if (name === MAC_COHORT_GUARD_JOB_NAME && job.id !== expected.jobId)
        throw new Error('PR matrix monitor is not its retained assigned job')
    }
    jobs.set(name, job)
    if (
      !assigned ||
      (name === MAC_COHORT_GUARD_JOB_NAME
        ? job.status !== 'in_progress'
        : job.status !== 'completed')
    )
      pending.push({ name, status: job.status })
  }
  return {
    complete: pending.length === 0,
    pending,
    jobIds: Object.fromEntries([...jobs].map(([name, job]) => [name, job.id])),
    jobStarts,
  }
}

/** A failing member of the PR worker matrix triggers GitHub's queued-sibling cancellation. */
export async function guardMacPrMatrix(
  budget,
  { token, apiOrigin = githubApiOrigin, pollIntervalMs = 60_000 } = {},
) {
  if (budget.kind !== 'coordination' || budget.jobName !== MAC_COHORT_GUARD_JOB_NAME)
    throw new Error('PR matrix monitor requires its own coordination allowance')
  remainingPrTimeBudget(budget)
  integer(pollIntervalMs, 'matrix polling interval')
  if (pollIntervalMs > 60_000) throw new Error('PR matrix polling interval exceeds sixty seconds')
  const deadlineEpochMs = budget.deadlineEpochMs - PR_SETTLEMENT_RESERVE_SECONDS * 1000
  const options = { token, apiOrigin, deadlineEpochMs }
  const verifyBudget = async () => {
    const observed = await fetchPrTimeBudget(budget, options)
    if (
      observed.createdEpochMs !== budget.createdEpochMs ||
      observed.attemptStartedEpochMs !== budget.attemptStartedEpochMs ||
      observed.jobCreatedEpochMs !== budget.jobCreatedEpochMs ||
      observed.jobStartedEpochMs !== budget.jobStartedEpochMs ||
      observed.jobId !== budget.jobId ||
      observed.deadlineEpochMs !== budget.deadlineEpochMs
    )
      throw new Error('PR matrix monitor identity or assigned-job deadline changed')
  }
  await verifyBudget()
  let state = { jobIds: {}, jobStarts: {}, pending: [] }
  const requireWorkTime = () => {
    if (Date.now() >= deadlineEpochMs) {
      const pending = state.pending.map(({ name, status }) => `${name} (${status})`).join(', ')
      throw new Error(
        `The Mac coordination allowance has elapsed; unfinished jobs: ${pending || 'unverified'}`,
      )
    }
  }
  for (;;) {
    requireWorkTime()
    let snapshot
    try {
      snapshot = await readPrMetadata(
        budget,
        `actions/runs/${budget.runId}/attempts/${budget.attempt}/jobs?per_page=100`,
        options,
      )
    } catch (error) {
      requireWorkTime()
      throw error
    }
    requireWorkTime()
    state = macPrMatrixStatus(snapshot, budget, state)
    if (state.complete) {
      await verifyBudget()
      requireWorkTime()
      return { complete: true, workerJobs: MAC_PR_COHORT.workers }
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(pollIntervalMs, deadlineEpochMs - Date.now())),
    )
  }
}

/** Own the command's POSIX process group through deadline cancellation. */
export async function runCommandBeforeDeadline(
  command,
  args,
  { deadlineEpochMs, terminationGraceMs = commandTerminationGraceMs } = {},
) {
  if (!['linux', 'darwin'].includes(process.platform))
    throw new Error('PR command deadlines require POSIX process groups')
  if (
    typeof command !== 'string' ||
    !command ||
    command.includes('\0') ||
    !Array.isArray(args) ||
    args.some((argument) => typeof argument !== 'string' || argument.includes('\0'))
  )
    throw new Error('Invalid PR deadline command')
  if (deadlineEpochMs !== null) {
    integer(deadlineEpochMs, 'command deadline')
    if (Date.now() >= deadlineEpochMs) throw new Error('The PR command work deadline has elapsed')
  }
  integer(terminationGraceMs, 'command termination grace', 0)
  if (terminationGraceMs > commandTerminationGraceMs)
    throw new Error('Command termination grace exceeds five seconds')

  const child = spawn(command, args, { detached: true, stdio: 'inherit' })
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  let deadlineTimer
  let terminationTimer
  let termination
  let finishTermination
  let terminationError
  let deadlineExceeded = false
  let externalSignal
  const signalGroup = (signal) => {
    if (!child.pid) return false
    try {
      process.kill(-child.pid, signal)
      return true
    } catch (error) {
      if (error.code === 'ESRCH') return false
      terminationError = error
      return true
    }
  }
  const stop = (signal) => {
    if (termination) return
    termination = new Promise((resolve) => {
      finishTermination = () => {
        clearTimeout(terminationTimer)
        resolve()
      }
    })
    signalGroup(signal)
    terminationTimer = setTimeout(() => {
      signalGroup('SIGKILL')
      finishTermination()
    }, terminationGraceMs)
  }
  const deadlineReached = () => deadlineEpochMs !== null && Date.now() >= deadlineEpochMs
  const inspectDeadline = () => {
    if (deadlineReached()) {
      deadlineExceeded = true
      stop('SIGTERM')
    } else {
      deadlineTimer = setTimeout(inspectDeadline, Math.min(deadlineEpochMs - Date.now(), 2_147_483_647))
    }
  }
  const forwardedSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => {
    const handler = () => {
      externalSignal ??= signal
      stop(signal)
    }
    process.on(signal, handler)
    return [signal, handler]
  })
  if (deadlineEpochMs !== null) inspectDeadline()
  try {
    const result = await completion
    // The timer and exit callback can both be delayed. Check the absolute clock
    // before accepting the exit, including a child's successful late exit.
    if (deadlineReached()) {
      deadlineExceeded = true
      stop('SIGTERM')
    }
    // A completed leader can leave descendants holding a pipeline open. PR
    // ownership ends only after its remaining process group has settled.
    if (deadlineEpochMs !== null && !termination && signalGroup(0)) stop('SIGTERM')
    if (termination) {
      // A leader can exit on TERM while descendants ignore it. Retain the KILL
      // timer until the group disappears or escalation has actually run.
      if (!signalGroup(0)) finishTermination()
      await termination
    }
    if (terminationError) throw new Error('Unable to terminate the PR command process group')
    deadlineExceeded ||= deadlineReached()
    return {
      code: result.code === 0 && deadlineExceeded ? 124 : result.code,
      signal: result.signal ?? (result.code === 0 ? externalSignal ?? null : null),
      deadlineExceeded,
    }
  } finally {
    clearTimeout(deadlineTimer)
    clearTimeout(terminationTimer)
    for (const [signal, handler] of forwardedSignals) process.off(signal, handler)
  }
}

function numeric(value, label, minimum = 1) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value))
    throw new Error(`Invalid ${label}`)
  return integer(Number(value), label, minimum)
}

function retainedBudget(environment) {
  const budget = {
    ...jobBudgetIdentity({
      repository: environment.JIG_PR_BUDGET_REPOSITORY,
      runId: numeric(environment.JIG_PR_BUDGET_RUN_ID, 'retained run ID'),
      attempt: numeric(environment.JIG_PR_BUDGET_ATTEMPT, 'retained run attempt'),
      headSha: environment.JIG_PR_BUDGET_HEAD_SHA,
      kind: environment.JIG_PR_BUDGET_KIND,
      jobName: environment.JIG_PR_BUDGET_JOB_NAME,
    }),
    createdEpochMs: numeric(environment.JIG_PR_RUN_CREATED_EPOCH_MS, 'retained creation time', 0),
    attemptStartedEpochMs: numeric(
      environment.JIG_PR_ATTEMPT_STARTED_EPOCH_MS,
      'retained attempt start',
      0,
    ),
    jobId: numeric(environment.JIG_PR_BUDGET_JOB_ID, 'retained assigned job ID'),
    jobCreatedEpochMs: numeric(environment.JIG_PR_JOB_CREATED_EPOCH_MS, 'retained job creation', 0),
    jobStartedEpochMs: numeric(
      environment.JIG_PR_JOB_STARTED_EPOCH_MS,
      'retained assigned job start',
      0,
    ),
    deadlineEpochMs: numeric(environment.JIG_PR_DEADLINE_EPOCH_MS, 'retained deadline'),
  }
  if (
    (environment.GITHUB_REPOSITORY && environment.GITHUB_REPOSITORY !== budget.repository) ||
    (environment.GITHUB_RUN_ID && environment.GITHUB_RUN_ID !== String(budget.runId)) ||
    (environment.GITHUB_RUN_ATTEMPT && environment.GITHUB_RUN_ATTEMPT !== String(budget.attempt)) ||
    (environment.GITHUB_EVENT_NAME && environment.GITHUB_EVENT_NAME !== 'pull_request')
  )
    throw new Error('Retained PR budget belongs to another workflow execution')
  return budget
}

function options(args, mode) {
  const allowed = new Set(
    mode === 'start'
      ? [
          'repository',
          'run-id',
          'attempt',
          'head-sha',
          'job-name',
          'kind',
          'github-env',
          'github-output',
        ]
      : mode === 'run'
        ? ['reserve-seconds']
        : ['github-output', 'github-summary', 'reserve-seconds'],
  )
  const selected = {}
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]?.replace(/^--/, '')
    const value = args[index + 1]
    if (!args[index]?.startsWith('--') || !allowed.has(name) || !value || Object.hasOwn(selected, name))
      throw new Error('Invalid PR time-budget arguments')
    selected[name] = value
  }
  return selected
}

async function runCli(args, environment) {
  const [mode, ...arguments_] = args
  if (mode === 'guard-matrix') {
    if (
      arguments_.length ||
      environment.GITHUB_EVENT_NAME !== 'pull_request' ||
      !environment.GITHUB_REPOSITORY ||
      !environment.GITHUB_RUN_ID ||
      !environment.GITHUB_RUN_ATTEMPT
    )
      throw new Error('PR matrix guard requires the current PR execution without options')
    const budget = retainedBudget(environment)
    console.error(macPrGuardExplanation)
    const result = await guardMacPrMatrix(budget, { token: environment.GH_TOKEN })
    console.log(JSON.stringify(result))
    console.error(macPrGuardSuccess)
    await writeMacPrGuardSummary(budget, environment.GITHUB_STEP_SUMMARY)
    return
  }
  if (mode === 'run') {
    const separator = arguments_.indexOf('--')
    if (separator < 0 || !arguments_[separator + 1])
      throw new Error('usage: pr-time-budget.mjs run [--reserve-seconds N] -- COMMAND [ARGS...]')
    const selected = options(arguments_.slice(0, separator), mode)
    const reserveSeconds = selected['reserve-seconds']
      ? numeric(selected['reserve-seconds'], 'settlement reserve', 0)
      : PR_SETTLEMENT_RESERVE_SECONDS
    if (reserveSeconds >= PR_BUDGET_SECONDS) throw new Error('Settlement reserve exceeds the PR budget')
    if (!['pull_request', 'push', 'workflow_dispatch'].includes(environment.GITHUB_EVENT_NAME))
      throw new Error('The PR deadline command requires a recognized GitHub event')
    let deadlineEpochMs = null
    if (environment.GITHUB_EVENT_NAME === 'pull_request') {
      if (!environment.GITHUB_REPOSITORY || !environment.GITHUB_RUN_ID || !environment.GITHUB_RUN_ATTEMPT)
        throw new Error('The PR deadline command requires the current workflow identity')
      const budget = retainedBudget(environment)
      remainingPrTimeBudget(budget, { reserveSeconds })
      deadlineEpochMs = budget.deadlineEpochMs - reserveSeconds * 1000
    }
    return runCommandBeforeDeadline(arguments_[separator + 1], arguments_.slice(separator + 2), {
      deadlineEpochMs,
      // Settlement may consume the reserve, but its escalation must not add a
      // fresh grace interval beyond this assigned job's absolute deadline.
      terminationGraceMs: deadlineEpochMs === null
        ? commandTerminationGraceMs
        : Math.min(commandTerminationGraceMs, reserveSeconds * 1000),
    })
  }
  if (!['start', 'remaining', 'check'].includes(mode))
    throw new Error('usage: pr-time-budget.mjs start|remaining|check|run|guard-matrix [options]')
  const selected = options(arguments_, mode)
  const budget =
    mode === 'start'
      ? await fetchPrTimeBudget(
          {
            repository: selected.repository,
            runId: numeric(selected['run-id'], 'workflow run ID'),
            attempt: numeric(selected.attempt, 'workflow attempt'),
            // GitHub's run metadata names the event head, not GITHUB_SHA's tested PR merge.
            headSha: selected['head-sha'],
            kind: selected.kind,
            jobName: selected['job-name'],
          },
          { token: environment.GH_TOKEN },
        )
      : retainedBudget(environment)
  const reserveSeconds = selected['reserve-seconds']
    ? numeric(selected['reserve-seconds'], 'settlement reserve', 0)
    : mode === 'check'
      ? 0
      : PR_SETTLEMENT_RESERVE_SECONDS
  const result = remainingPrTimeBudget(budget, { reserveSeconds })
  if (mode === 'remaining' && result.work_minutes < 1)
    throw new Error('Less than one work minute remains before the PR settlement reserve')
  if (mode === 'check' && reserveSeconds && !result.work_seconds)
    throw new Error('The PR settlement reserve has begun')
  if (mode === 'start' && selected['github-env']) {
    const assignments = {
      JIG_PR_BUDGET_REPOSITORY: budget.repository,
      JIG_PR_BUDGET_RUN_ID: budget.runId,
      JIG_PR_BUDGET_ATTEMPT: budget.attempt,
      JIG_PR_BUDGET_HEAD_SHA: budget.headSha,
      JIG_PR_BUDGET_KIND: budget.kind,
      JIG_PR_BUDGET_JOB_NAME: budget.jobName,
      JIG_PR_BUDGET_JOB_ID: budget.jobId,
      JIG_PR_RUN_CREATED_EPOCH_MS: budget.createdEpochMs,
      JIG_PR_ATTEMPT_STARTED_EPOCH_MS: budget.attemptStartedEpochMs,
      JIG_PR_JOB_CREATED_EPOCH_MS: budget.jobCreatedEpochMs,
      JIG_PR_JOB_STARTED_EPOCH_MS: budget.jobStartedEpochMs,
      JIG_PR_DEADLINE_EPOCH_MS: budget.deadlineEpochMs,
      JIG_PR_WORK_DEADLINE_EPOCH_MS: budget.deadlineEpochMs - PR_SETTLEMENT_RESERVE_SECONDS * 1000,
    }
    await appendFile(
      selected['github-env'],
      Object.entries(assignments).map(([key, value]) => `${key}=${value}\n`).join(''),
    )
  }
  if (selected['github-output'])
    await appendFile(
      selected['github-output'],
      Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''),
    )
  if (mode === 'start') console.error(formatPrTimeBudget(budget))
  if (mode === 'check' && selected['github-summary']) {
    console.error(formatPrTurnaround(budget))
    await writePrTimingSummary(budget, selected['github-summary'])
  }
  console.log(JSON.stringify(result))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runCli(process.argv.slice(2), process.env)
    if (result) {
      if (result.deadlineExceeded) console.error('The PR command exceeded its work deadline')
      if (result.signal) {
        process.exitCode = 128 + osConstants.signals[result.signal]
        process.kill(process.pid, result.signal)
      } else {
        process.exitCode = result.code
      }
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
