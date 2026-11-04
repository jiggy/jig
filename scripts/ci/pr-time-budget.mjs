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
const commandTerminationGraceMs = 5000
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const shaPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const githubApiOrigin = 'https://api.github.com'
const maxMetadataBytes = 4 * 1024 * 1024
const pendingJobStatuses = ['queued', 'in_progress', 'requested', 'waiting', 'pending']
const macPrGuardExplanation =
  'This Ubuntu deadline monitor watches all five Mac worker jobs.\n' +
  'Native setup and test steps are intentionally skipped on this matrix row.\n' +
  'Mac workers execute their assigned test roles or record a surplus assignment.\n' +
  'The native qualification aggregate validates complete test evidence.'
const macPrGuardSuccess =
  'Monitor succeeded: all five current-attempt Mac worker jobs, the allocator and its readiness gate succeeded before the work cutoff.\n' +
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
    throw new Error('Invalid workflow creation time')
  const milliseconds = Date.parse(value)
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z')
  if (!Number.isSafeInteger(milliseconds) || new Date(milliseconds).toISOString() !== canonical)
    throw new Error('Invalid workflow creation time')
  return milliseconds
}

/** Workflow creation is the available push-time proxy. Reruns retain its original deadline. */
export function prTimeBudgetFromRun(run, expected, now = Date.now()) {
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
  if (createdEpochMs > now) throw new Error('Workflow creation is in the future')
  return {
    ...selected,
    createdEpochMs,
    deadlineEpochMs: createdEpochMs + PR_BUDGET_SECONDS * 1000,
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
  const timeout = deadlineEpochMs === undefined ? 10_000 : Math.min(10_000, deadlineEpochMs - Date.now())
  if (!Number.isSafeInteger(timeout) || timeout <= 0)
    throw new Error('The PR matrix work deadline has elapsed')
  let response
  let metadata
  try {
    response = await fetch(
      `${origin.origin}/repos/${selected.repository}/${path}`,
      {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    )
    if (response.ok) {
      const chunks = []
      let bytes = 0
      for await (const chunk of response.body) {
        bytes += chunk.byteLength
        if (bytes > maxMetadataBytes) throw new Error('Oversized PR metadata')
        chunks.push(chunk)
      }
      metadata = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } else {
      await response.body?.cancel()
    }
  } catch {
    throw new Error('Unable to read PR workflow metadata')
  }
  if (!response.ok) throw new Error(`PR workflow metadata request failed (HTTP ${response.status})`)
  return metadata
}

/** One bounded, read-only API request; no runner allocation or GitHub mutation. */
export async function fetchPrTimeBudget(expected, options = {}) {
  const selected = identity(expected)
  const run = await readPrMetadata(selected, `actions/runs/${selected.runId}`, options)
  return prTimeBudgetFromRun(run, selected)
}

/** Compute a phase allowance; callers retain ownership of cancellation and settlement. */
export function remainingPrTimeBudget(
  budget,
  { now = Date.now(), reserveSeconds = PR_SETTLEMENT_RESERVE_SECONDS } = {},
) {
  integer(budget?.createdEpochMs, 'workflow creation time', 0)
  integer(budget.deadlineEpochMs, 'PR deadline')
  integer(now, 'current time', 0)
  integer(reserveSeconds, 'settlement reserve', 0)
  if (reserveSeconds >= PR_BUDGET_SECONDS) throw new Error('Settlement reserve exceeds the PR budget')
  if (budget.deadlineEpochMs !== budget.createdEpochMs + PR_BUDGET_SECONDS * 1000)
    throw new Error('PR deadline differs from the original 25-minute allowance')
  if (now < budget.createdEpochMs) throw new Error('Workflow creation is in the future')
  if (now >= budget.deadlineEpochMs) throw new Error('The 25-minute PR deadline has elapsed')
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

/** Describe an already validated original budget without selecting a new deadline. */
export function formatPrTimeBudget(budget) {
  return [
    'PR workflow budget (UTC)',
    `Workflow created: ${new Date(budget.createdEpochMs).toISOString()}`,
    `Work cutoff: ${new Date(budget.deadlineEpochMs - PR_SETTLEMENT_RESERVE_SECONDS * 1000).toISOString()} (23 minutes after creation)`,
    `Final deadline: ${new Date(budget.deadlineEpochMs).toISOString()} (25 minutes after creation)`,
    'Queue time and retries consume this original allowance.',
    'The final two minutes are reserved for cleanup and evidence.',
  ].join('\n')
}

/** Optional presentation after guard success; never called while propagating failure. */
export async function writeMacPrGuardSummary(budget, destination) {
  if (!destination) return
  try {
    await appendFile(
      destination,
      `## Mac PR deadline monitor\n\n${macPrGuardExplanation}\n\n` +
        `\`\`\`text\n${formatPrTimeBudget(budget)}\n\`\`\`\n\n${macPrGuardSuccess}\n\n`,
    )
  } catch {
    console.error('The optional Mac PR deadline summary could not be written. The successful monitor result is unchanged.')
  }
}

/** Job states only: complete test and archive proof remains owned by the aggregate. */
export function macPrMatrixStatus(snapshot, expected, previousIds = {}) {
  const selected = identity(expected)
  if (
    !Number.isSafeInteger(snapshot?.total_count) ||
    snapshot.total_count < 0 ||
    snapshot.total_count > 100 ||
    !Array.isArray(snapshot.jobs) ||
    snapshot.jobs.length !== snapshot.total_count
  )
    throw new Error('PR matrix guard refuses an incomplete job inventory')
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
  for (const job of snapshot.jobs) {
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
  const pending = []
  for (const name of requiredNames) {
    const matches = snapshot.jobs.filter((job) => job.name === name)
    if (!matches.length && !Object.hasOwn(previousIds, name)) {
      pending.push({ name, status: 'missing' })
      continue
    }
    if (matches.length !== 1) throw new Error('PR matrix guard requires unique current-attempt jobs')
    const job = matches[0]
    if (
      job.run_id !== selected.runId ||
      job.run_attempt !== selected.attempt ||
      job.head_sha !== selected.headSha ||
      job.run_url !== `${githubApiOrigin}/repos/${selected.repository}/actions/runs/${selected.runId}` ||
      (Object.hasOwn(previousIds, name) && previousIds[name] !== job.id) ||
      ![...pendingJobStatuses, 'completed'].includes(job.status) ||
      (job.status !== 'completed' && job.conclusion !== null)
    )
      throw new Error('PR matrix guard found foreign, stale or invalid job metadata')
    if (job.status === 'completed' && job.conclusion !== 'success')
      throw new Error(`PR matrix prerequisite did not succeed: ${name}`)
    if (name === MAC_COHORT_GUARD_JOB_NAME && job.status === 'completed')
      throw new Error('PR matrix guard must be its active current-attempt job')
    jobs.set(name, job)
    if (name === MAC_COHORT_GUARD_JOB_NAME ? job.status !== 'in_progress' : job.status !== 'completed')
      pending.push({ name, status: job.status })
  }
  return {
    complete: pending.length === 0,
    pending,
    jobIds: Object.fromEntries([...jobs].map(([name, job]) => [name, job.id])),
  }
}

/** A failing member of the PR worker matrix triggers GitHub's queued-sibling cancellation. */
export async function guardMacPrMatrix(
  budget,
  { token, apiOrigin = githubApiOrigin, pollIntervalMs = 15_000 } = {},
) {
  identity(budget)
  remainingPrTimeBudget(budget)
  integer(pollIntervalMs, 'matrix polling interval')
  if (pollIntervalMs > 15_000) throw new Error('PR matrix polling interval exceeds fifteen seconds')
  const deadlineEpochMs = budget.deadlineEpochMs - PR_SETTLEMENT_RESERVE_SECONDS * 1000
  const options = { token, apiOrigin, deadlineEpochMs }
  const verifyBudget = async () => {
    const observed = await fetchPrTimeBudget(budget, options)
    if (
      observed.createdEpochMs !== budget.createdEpochMs ||
      observed.deadlineEpochMs !== budget.deadlineEpochMs
    )
      throw new Error('PR matrix guard deadline changed from the original workflow creation')
  }
  await verifyBudget()
  let state = { jobIds: {}, pending: [] }
  const requireWorkTime = () => {
    if (Date.now() >= deadlineEpochMs) {
      const pending = state.pending.map(({ name, status }) => `${name} (${status})`).join(', ')
      throw new Error(
        `The PR matrix work deadline has elapsed; unfinished jobs: ${pending || 'unverified'}`,
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
    state = macPrMatrixStatus(snapshot, budget, state.jobIds)
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
    ...identity({
      repository: environment.JIG_PR_BUDGET_REPOSITORY,
      runId: numeric(environment.JIG_PR_BUDGET_RUN_ID, 'retained run ID'),
      attempt: numeric(environment.JIG_PR_BUDGET_ATTEMPT, 'retained run attempt'),
      headSha: environment.JIG_PR_BUDGET_HEAD_SHA,
    }),
    createdEpochMs: numeric(environment.JIG_PR_RUN_CREATED_EPOCH_MS, 'retained creation time', 0),
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
      ? ['repository', 'run-id', 'attempt', 'head-sha', 'github-env', 'github-output']
      : mode === 'run'
        ? ['reserve-seconds']
        : ['github-output', 'reserve-seconds'],
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
      // fresh grace interval beyond the original absolute workflow deadline.
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
      JIG_PR_RUN_CREATED_EPOCH_MS: budget.createdEpochMs,
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
