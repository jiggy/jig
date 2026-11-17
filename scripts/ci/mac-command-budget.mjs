import { execFileSync, spawn } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { githubContext } from './candidate-provenance.mjs'

const commandTerminationGraceMs = 5000
const reserveMs = 120000
function integer(value, label, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Invalid ${label}`)
  return value
}

export function macJobBudget(jobs, expected, now = Date.now()) {
  if (
    !Array.isArray(jobs) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(expected.repository ?? '') ||
    !/^Native host shard — macos-(15|26) \/ [0-7]$/.test(expected.name ?? '') ||
    !/^[a-f0-9]{40}$/.test(expected.source ?? '') ||
    !/^[a-f0-9]{40}$/.test(expected.headSha ?? '') ||
    ![25, 65].includes(expected.minutes)
  )
    throw new Error('Invalid Mac budget identity')
  integer(expected.runId, 'run identity')
  integer(expected.attempt, 'attempt identity')
  const matches = jobs.filter((job) => job.name === expected.name)
  if (matches.length !== 1) throw new Error('Missing or ambiguous active Mac job')
  const job = matches[0]
  const started = Date.parse(job.started_at)
  const created = Date.parse(job.created_at)
  const major = expected.name.match(/macos-(15|26)/)[1]
  if (
    job.run_id !== expected.runId ||
    job.run_attempt !== expected.attempt ||
    job.head_sha !== expected.headSha ||
    job.status !== 'in_progress' ||
    !Number.isSafeInteger(job.id) ||
    job.id < 1 ||
    !Number.isSafeInteger(job.runner_id) ||
    job.runner_id < 1 ||
    typeof job.runner_name !== 'string' ||
    !job.runner_name ||
    !Array.isArray(job.labels) ||
    !job.labels.includes(`macos-${major}`) ||
    !Array.isArray(job.steps) ||
    !job.steps.some((step) => Number.isFinite(Date.parse(step.started_at))) ||
    !Number.isFinite(started) ||
    !Number.isFinite(created) ||
    created > started ||
    started > now
  )
    throw new Error('Mac budget requires this exact active assigned job')
  const budget = {
    source: expected.source,
    runId: expected.runId,
    attempt: expected.attempt,
    jobId: job.id,
    started,
    finalDeadline: started + expected.minutes * 60000,
    workDeadline: started + expected.minutes * 60000 - reserveMs,
  }
  if (now >= budget.workDeadline) throw new Error('Mac work allowance already expired')
  return budget
}

export function retainedMacBudget(environment, now = Date.now()) {
  const budget = JSON.parse(environment.JIG_MACOS_BUDGET ?? 'null')
  if (
    !budget ||
    !/^[a-f0-9]{40}$/.test(budget.source ?? '') ||
    !Number.isSafeInteger(budget.runId) ||
    budget.runId < 1 ||
    !Number.isSafeInteger(budget.attempt) ||
    budget.attempt < 1 ||
    budget.source !== environment.GITHUB_SHA ||
    budget.runId !== Number(environment.GITHUB_RUN_ID) ||
    budget.attempt !== Number(environment.GITHUB_RUN_ATTEMPT)
  )
    throw new Error('Mac command budget identity changed')
  for (const key of ['started', 'finalDeadline', 'workDeadline', 'jobId']) integer(budget[key], key)
  if (
    ![25, 65].some((minutes) => budget.finalDeadline === budget.started + minutes * 60000) ||
    budget.workDeadline !== budget.finalDeadline - reserveMs ||
    budget.started > now
  )
    throw new Error('Invalid retained Mac deadline')
  return budget
}

export async function runCommandBeforeDeadline(
  command,
  args,
  { deadlineEpochMs, terminationGraceMs = commandTerminationGraceMs } = {},
) {
  if (!['linux', 'darwin'].includes(process.platform))
    throw new Error('Mac command deadlines require POSIX process groups')
  if (
    typeof command !== 'string' ||
    !command ||
    command.includes('\0') ||
    !Array.isArray(args) ||
    args.some((argument) => typeof argument !== 'string' || argument.includes('\0'))
  )
    throw new Error('Invalid Mac deadline command')
  integer(deadlineEpochMs, 'command deadline')
  if (Date.now() >= deadlineEpochMs) throw new Error('The Mac command work deadline has elapsed')
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
  const deadlineReached = () => Date.now() >= deadlineEpochMs
  const inspectDeadline = () => {
    if (deadlineReached()) {
      deadlineExceeded = true
      stop('SIGTERM')
    } else {
      deadlineTimer = setTimeout(
        inspectDeadline,
        Math.min(deadlineEpochMs - Date.now(), 2_147_483_647),
      )
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
  inspectDeadline()
  try {
    const result = await completion
    // The timer and exit callback can both be delayed. Check the absolute clock
    // before accepting the exit, including a child's successful late exit.
    if (deadlineReached()) {
      deadlineExceeded = true
      stop('SIGTERM')
    }
    // A completed leader can leave descendants holding a pipeline open. Command
    // ownership ends only after its remaining process group has settled.
    if (!termination && signalGroup(0)) stop('SIGTERM')
    if (termination) {
      // A leader can exit on TERM while descendants ignore it. Retain the KILL
      // timer until the group disappears or escalation has actually run.
      if (!signalGroup(0)) finishTermination()
      await termination
    }
    if (terminationError) throw new Error('Unable to terminate the Mac command process group')
    deadlineExceeded ||= deadlineReached()
    return {
      code: result.code === 0 && deadlineExceeded ? 124 : result.code,
      signal: result.signal ?? (result.code === 0 ? (externalSignal ?? null) : null),
      deadlineExceeded,
    }
  } finally {
    clearTimeout(deadlineTimer)
    clearTimeout(terminationTimer)
    for (const [signal, handler] of forwardedSignals) process.off(signal, handler)
  }
}

async function cli() {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === 'start' && args.length === 0) {
    if (process.env.JIG_MACOS_BUDGET) throw new Error('Mac budget is already anchored')
    if (
      execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000 }).trim() !==
      process.env.GITHUB_SHA
    )
      throw new Error('Mac budget checkout source changed')
    const context = await githubContext({ sourceRevision: process.env.GITHUB_SHA })
    const expected = {
      ...context,
      source: process.env.GITHUB_SHA,
      name: process.env.MACOS_JOB_NAME,
      attempt: context.runAttempt,
      minutes: Number(process.env.MACOS_JOB_MINUTES ?? 25),
    }
    if (context.workflowPath !== '.github/workflows/macos-hosted-candidates.yml')
      throw new Error('Wrong Mac budget workflow')
    if (
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(context.repository) ||
      context.repository.split('/').some((part) => part === '.' || part === '..')
    )
      throw new Error('Invalid Mac repository')
    integer(context.runId, 'run identity')
    integer(context.runAttempt, 'attempt identity')
    // One bounded read. Queued timestamps and copied previous checks never anchor work.
    const response = JSON.parse(
      execFileSync(
        'gh',
        [
          'api',
          `repos/${context.repository}/actions/runs/${context.runId}/attempts/${context.runAttempt}/jobs?per_page=100`,
        ],
        {
          encoding: 'utf8',
          timeout: 15000,
          maxBuffer: 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ),
    )
    if (!Array.isArray(response.jobs) || response.total_count !== response.jobs.length)
      throw new Error('Incomplete current Mac job inventory')
    const budget = macJobBudget(response.jobs, expected)
    if (!process.env.GITHUB_ENV) throw new Error('Missing GitHub job environment')
    await appendFile(process.env.GITHUB_ENV, `JIG_MACOS_BUDGET=${JSON.stringify(budget)}\n`)
    console.log(JSON.stringify(budget))
    return
  }
  const budget = retainedMacBudget(process.env)
  if (mode === 'check' && args.length === 0) {
    if (Date.now() >= budget.finalDeadline) throw new Error('Mac final job deadline expired')
    return
  }
  if (mode !== 'run' || !args.length)
    throw new Error('usage: mac-command-budget.mjs start|check|run COMMAND [ARG...]')
  const result = await runCommandBeforeDeadline(args[0], args.slice(1), {
    deadlineEpochMs: budget.workDeadline,
    terminationGraceMs: Math.max(
      0,
      Math.min(commandTerminationGraceMs, budget.finalDeadline - Date.now()),
    ),
  })
  if (result.deadlineExceeded)
    console.error(
      'Mac command exceeded the absolute work cutoff; cleanup and evidence time remains reserved',
    )
  process.exitCode = result.signal
    ? 128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1, SIGKILL: 9 }[result.signal] ?? 1)
    : (result.code ?? 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await cli()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
