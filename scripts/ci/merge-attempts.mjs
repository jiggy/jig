// A retry may retain a job only inside the original pull-request workflow run.
// The latest execution wins, including failures: never search backwards for green.
function carriedCheck(job) {
  return job.status === 'completed' && job.conclusion === 'success' &&
    Number.isFinite(Date.parse(job.created_at)) && Number.isFinite(Date.parse(job.completed_at)) &&
    Date.parse(job.created_at) > Date.parse(job.completed_at)
}

function executionObservation(job) {
  if (!Number.isFinite(Date.parse(job.started_at)) ||
      Date.parse(job.started_at) > Date.parse(job.completed_at) ||
      !Number.isSafeInteger(job.runner_id) || job.runner_id <= 0 ||
      typeof job.runner_name !== 'string' || !job.runner_name ||
      !Array.isArray(job.labels) || !job.labels.length ||
      !Array.isArray(job.steps) || !job.steps.length) return undefined
  return JSON.stringify([job.started_at, job.completed_at, job.runner_id, job.runner_name, job.labels,
    job.steps.map((step) => [step.number, step.name, step.status, step.conclusion, step.started_at, step.completed_at])])
}

export function latestJob(jobs, run, name, { completed = true } = {}) {
  const matches = jobs.filter((job) => job.name === name)
  if (!matches.length) throw new Error('Missing merge job: ' + name)
  for (const job of matches) {
    if (
      !Number.isSafeInteger(job.id) || job.id <= 0 || job.run_id !== run.id ||
      job.head_sha !== run.head_sha || !Number.isSafeInteger(job.run_attempt) ||
      job.run_attempt < 1 || job.run_attempt > run.run_attempt
    ) throw new Error('Merge job identity mismatch: ' + name)
  }
  const executions = matches.filter((job) => {
    // GitHub copies unselected successful checks into a retry with new IDs and
    // attempt numbers. These rows were created after their execution had ended.
    // Retain only the uniquely matching original execution, never the copy's ID.
    if (!carriedCheck(job)) return true
    const observation = executionObservation(job)
    const originals = matches.filter((earlier) => earlier.id !== job.id && earlier.run_attempt < job.run_attempt &&
      earlier.status === 'completed' && earlier.conclusion === 'success' &&
      Number.isFinite(Date.parse(earlier.created_at)) &&
      Date.parse(earlier.created_at) <= Date.parse(earlier.started_at) &&
      observation !== undefined && executionObservation(earlier) === observation)
    if (originals.length !== 1) throw new Error('Unverifiable carried merge check: ' + name)
    return false
  })
  const attempt = Math.max(...executions.map((job) => job.run_attempt))
  const latest = executions.filter((job) => job.run_attempt === attempt)
  if (latest.length !== 1) throw new Error('Ambiguous merge job: ' + name)
  const job = latest[0]
  if (completed && (job.status !== 'completed' || job.conclusion !== 'success'))
    throw new Error('Latest merge job did not succeed: ' + name)
  return job
}

export async function allRunJobs(client, repository, run) {
  const jobs = []
  for (let page = 1; page <= 10; page++) {
    const response = await client.api(
      'repos/' + repository + '/actions/runs/' + run.id + '/jobs?filter=all&per_page=100&page=' + page,
    )
    if (!Array.isArray(response.jobs)) throw new Error('Missing merge job response')
    jobs.push(...response.jobs)
    if (response.jobs.length < 100) return jobs
  }
  throw new Error('Incomplete merge job pagination')
}
