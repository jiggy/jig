// A retry may retain a job only inside the original pull-request workflow run.
// The latest execution wins, including failures: never search backwards for green.
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
  const attempt = Math.max(...matches.map((job) => job.run_attempt))
  const latest = matches.filter((job) => job.run_attempt === attempt)
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
