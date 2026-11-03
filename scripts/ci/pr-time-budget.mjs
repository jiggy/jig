import { spawn } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { constants as osConstants } from 'node:os'
import { pathToFileURL } from 'node:url'

export const PR_BUDGET_SECONDS = 25 * 60
export const PR_SETTLEMENT_RESERVE_SECONDS = 120
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const shaPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/

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

/** One bounded, read-only API request; no runner allocation or GitHub mutation. */
export async function fetchPrTimeBudget(expected, { token } = {}) {
  const selected = identity(expected)
  if (typeof token !== 'string' || !token) throw new Error('GH_TOKEN is required to verify the PR deadline')
  let response
  let run
  try {
    response = await fetch(
      `https://api.github.com/repos/${selected.repository}/actions/runs/${selected.runId}`,
      {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    )
    if (response.ok) run = await response.json()
  } catch {
    throw new Error('Unable to read PR workflow metadata')
  }
  if (!response.ok) throw new Error(`PR workflow metadata request failed (HTTP ${response.status})`)
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
  return {
    deadline_epoch_ms: budget.deadlineEpochMs,
    remaining_seconds: remainingSeconds,
    reserve_seconds: reserveSeconds,
    work_seconds: workSeconds,
    work_minutes: Math.floor(workSeconds / 60),
  }
}

/** Own the command's POSIX process group through deadline cancellation. */
export async function runCommandBeforeDeadline(
  command,
  args,
  { deadlineEpochMs, terminationGraceMs = 5000 } = {},
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
  if (terminationGraceMs > 5000) throw new Error('Command termination grace exceeds five seconds')

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
      terminationGraceMs: deadlineEpochMs === null ? 5000 : Math.min(5000, reserveSeconds * 1000),
    })
  }
  if (!['start', 'remaining', 'check'].includes(mode))
    throw new Error('usage: pr-time-budget.mjs start|remaining|check|run [options]')
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
