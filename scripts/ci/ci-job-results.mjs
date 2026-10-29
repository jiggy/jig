import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceTargets = ['source-portable', 'source-protocol', 'source-applications', 'source-python']
const conclusions = new Set(['success', 'failure', 'cancelled', 'skipped'])

// These observations explain failures. They are never execution or cleanup proof.
export function ciJobResults(jobs, observedJobs) {
  if (!jobs || Array.isArray(jobs) || typeof jobs !== 'object' || !Object.keys(jobs).length)
    throw new Error('Missing required CI job results')
  const results = {}
  for (const [id, job] of Object.entries(jobs)) {
    if (!/^[a-z][a-z0-9-]*$/.test(id) || !job || !conclusions.has(job.result))
      throw new Error('Malformed required CI job result')
    results[id] = job.result
  }
  if (!Object.hasOwn(results, 'source-tests')) throw new Error('Missing source job result')
  for (const target of sourceTargets) results[target] = results['source-tests']
  const failures = Object.entries(jobs)
    .filter(([, job]) => job.result !== 'success')
    .map(([id, job]) => ({ id, result: job.result }))
  const observations = Array.isArray(observedJobs)
    ? observedJobs
        .filter(
          (job) =>
            job &&
            typeof job.name === 'string' &&
            typeof job.conclusion === 'string' &&
            job.conclusion !== 'success',
        )
        .map((job) => {
          const steps = Array.isArray(job.steps) ? job.steps : undefined
          const unassigned = job.runner_name === '' && steps?.length === 0
          const classification =
            job.conclusion === 'cancelled' && unassigned
              ? 'runner-not-assigned'
              : job.conclusion === 'cancelled'
                ? 'job-cancelled'
                : job.conclusion === 'failure'
                  ? 'job-failed'
                  : job.conclusion === 'timed_out'
                    ? 'job-timed-out'
                    : job.conclusion === 'skipped'
                      ? 'job-skipped'
                      : 'job-incomplete'
          return {
            id: Number.isSafeInteger(job.id) ? job.id : null,
            name: job.name,
            classification,
            runnerAssigned: typeof job.runner_name === 'string' ? job.runner_name !== '' : null,
            failedSteps:
              steps
                ?.filter(
                  (step) => step && step.conclusion === 'failure' && typeof step.name === 'string',
                )
                .map((step) => step.name) ?? null,
          }
        })
    : null
  return { results, diagnostics: { schemaVersion: 1, failures, observations } }
}

export async function writeCiJobResults({ jobs, observedJobs, output, diagnostics }) {
  const report = ciJobResults(jobs, observedJobs)
  // Persist every result before the caller refuses qualification. Failed and
  // cancelled jobs must still leave an actionable aggregate artifact.
  await writeFile(output, `${JSON.stringify(report.results, null, 2)}\n`, { flag: 'wx' })
  await writeFile(diagnostics, `${JSON.stringify(report.diagnostics, null, 2)}\n`, { flag: 'wx' })
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {}
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = process.argv[index]
      const value = process.argv[index + 1]
      if (!['--output', '--diagnostics', '--jobs'].includes(key) || options[key] || !value)
        throw new Error('Unknown, repeated or missing CI result option')
      options[key] = value
    }
    if (!options['--output'] || !options['--diagnostics'])
      throw new Error('Provide CI result and diagnostic destinations')
    let observedJobs
    if (options['--jobs']) {
      try {
        observedJobs = JSON.parse(await readFile(options['--jobs'], 'utf8'))
      } catch {
        // GitHub API availability cannot change the required job outcomes.
      }
    }
    const report = await writeCiJobResults({
      jobs: JSON.parse(process.env.JOB_RESULTS ?? 'null'),
      observedJobs,
      output: options['--output'],
      diagnostics: options['--diagnostics'],
    })
    if (process.env.GITHUB_STEP_SUMMARY) {
      const lines = [
        '## CI job results',
        '',
        '| Required job | Result |',
        '| --- | --- |',
        ...Object.entries(report.results)
          .filter(([id]) => !sourceTargets.includes(id))
          .map(([id, result]) => `| ${id} | ${result} |`),
        '',
        'Job observations are diagnostic; complete execution evidence remains required.',
      ]
      for (const job of report.diagnostics.observations ?? []) {
        const name = job.name.replace(/[\r\n|`]/g, '_')
        lines.push(`- ${name}: ${job.classification}`)
      }
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`).catch(() => {
        console.error('CI job summary unavailable; job results remain in the retained files')
      })
    }
    if (report.diagnostics.failures.length)
      throw new Error(
        `Required CI jobs did not succeed: ${report.diagnostics.failures.map(({ id, result }) => `${id}=${result}`).join(', ')}`,
      )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
