import { execFileSync } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const capacityNotice =
  'Due to capacity constraints, jobs targeting macOS arm64 runners may experience longer queue times.'
const allocationFailure =
  'The job was not acquired by Runner of type hosted even after multiple attempts'
const capacityReason = 'GitHub macOS ARM runner capacity unavailable. No test steps started.'

export function runnerNotAssigned(job) {
  return (
    job.status === 'completed' &&
    job.conclusion === 'cancelled' &&
    (job.runner_id === 0 || job.runner_id === null) &&
    (job.runner_name === '' || job.runner_name === null) &&
    Array.isArray(job.steps) &&
    job.steps.length === 0
  )
}

// Only a known GitHub annotation establishes capacity loss. Cancellation alone
// cannot identify its cause, and arbitrary annotation text is never published.
export function hostJobReason(job, annotations = []) {
  if (runnerNotAssigned(job))
    return annotations.some(
      (entry) => entry?.annotation_level === 'failure' && entry.message === allocationFailure,
    ) &&
      annotations.some(
        (entry) => entry?.annotation_level === 'notice' && entry.message === capacityNotice,
      )
      ? capacityReason
      : 'Runner was not assigned. No test steps started. Cause unavailable.'
  return 'Job did not succeed. Inspect its steps for the original failure.'
}

function requireIdentity({ repository, runId, attempt }) {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') ||
    repository.split('/').some((part) => part === '.' || part === '..') ||
    !Number.isSafeInteger(runId) ||
    runId < 1 ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1
  )
    throw new Error('Invalid diagnostic identity')
}

export function hostJobSummary(identity, jobs, annotations = {}) {
  requireIdentity(identity)
  if (
    !Array.isArray(jobs) ||
    jobs.length > 100 ||
    new Set(jobs.map((job) => job.id)).size !== jobs.length ||
    jobs.some(
      (job) =>
        !Number.isSafeInteger(job.id) ||
        job.id < 1 ||
        job.run_id !== identity.runId ||
        job.run_attempt !== identity.attempt,
    )
  )
    throw new Error('Invalid current-attempt job observations')
  const failures = jobs
    .filter((job) => job.status === 'completed' && !['success', 'skipped'].includes(job.conclusion))
    .sort((a, b) => Number(runnerNotAssigned(b)) - Number(runnerNotAssigned(a)))
  if (!failures.length) return ''
  const lines = ['## Host job failure diagnostics', '']
  const capacityFailure = failures.some(
    (job) => hostJobReason(job, annotations[job.id]) === capacityReason,
  )
  if (capacityFailure) lines.push(`**Infrastructure allocation failure: ${capacityReason}**`, '')
  lines.push(
    'These observations do not change qualification or establish execution or cleanup.',
    '',
    '| Job | Observation |',
    '| --- | --- |',
  )
  for (const job of failures) {
    const name = String(job.name ?? 'Unnamed job')
      .slice(0, 160)
      .replace(/[\r\n|`<>[\]\\]/g, '_')
    const url = `https://github.com/${identity.repository}/actions/runs/${identity.runId}/job/${job.id}`
    lines.push(`| [${name}](${url}) | ${hostJobReason(job, annotations[job.id])} |`)
  }
  if (capacityFailure)
    lines.push(
      '',
      'For PR capacity failures, re-run failed jobs within this unchanged workflow run when runners are available. Completed successful shards may be retained for up to 24 hours. Main and release qualification require a complete fresh attempt. Actual executed failures still block qualification.',
    )
  return `${lines.join('\n')}\n`
}

// At most one jobs read and five annotation reads share a twenty-second bound.
// This optional observer never retries work or changes a required job result.
export function collectHostJobSummary(environment = process.env) {
  const identity = {
    repository: environment.GITHUB_REPOSITORY,
    runId: Number(environment.GITHUB_RUN_ID),
    attempt: Number(environment.GITHUB_RUN_ATTEMPT),
  }
  requireIdentity(identity)
  const deadline = Date.now() + 20_000
  const read = (path) => {
    if (Date.now() >= deadline) throw new Error('Diagnostic work allowance expired')
    return JSON.parse(
      execFileSync(
        'gh',
        ['api', '--hostname', 'github.com', `repos/${identity.repository}/${path}`],
        {
          encoding: 'utf8',
          timeout: Math.max(1, Math.min(5000, deadline - Date.now())),
          maxBuffer: 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: environment,
        },
      ),
    )
  }
  const snapshot = read(
    `actions/runs/${identity.runId}/attempts/${identity.attempt}/jobs?per_page=100`,
  )
  if (!Array.isArray(snapshot.jobs) || snapshot.total_count !== snapshot.jobs.length)
    throw new Error('Incomplete diagnostic job inventory')
  // Validate the entire inventory before using any job to select an API read.
  hostJobSummary(identity, snapshot.jobs)
  const annotations = {}
  for (const job of snapshot.jobs.filter(runnerNotAssigned).slice(0, 5)) {
    try {
      if (Date.now() >= deadline) break
      const prefix = `https://api.github.com/repos/${identity.repository}/check-runs/`
      if (typeof job.check_run_url !== 'string' || !job.check_run_url.startsWith(prefix)) continue
      const id = job.check_run_url.slice(prefix.length)
      if (!/^[1-9][0-9]*$/.test(id)) continue
      const entries = read(`check-runs/${id}/annotations?per_page=100`)
      if (Array.isArray(entries) && entries.length <= 100) annotations[job.id] = entries
    } catch {
      // Missing annotation reads retain the observed unassigned state, not a guessed cause.
    }
  }
  return hostJobSummary(identity, snapshot.jobs, annotations)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let summary
  try {
    summary = collectHostJobSummary()
  } catch {
    summary =
      '## Host job failure diagnostics\n\nGitHub job diagnostics unavailable. Inspect failed jobs and their annotations. Qualification requirements remain unchanged.\n'
  }
  if (summary) {
    console.log(summary)
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY, summary).catch(() => {})
  }
}
