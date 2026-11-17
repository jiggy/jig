import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { digest, githubContext, verifyCandidateBundle } from './candidate-provenance.mjs'
import {
  downloadArtifactDirectory,
  githubClient,
  paginated,
  validateWorkflowRun,
  verifyArtifactMetadata,
} from './candidate-transfer.mjs'
import {
  MACOS_COMPATIBILITY_MAJORS,
  macJobName,
  validateMacCoverage,
} from './macos-qualification.mjs'
import { allRunJobs, latestJob } from './merge-attempts.mjs'
import { readMacReports } from './test-reports.mjs'

export { MACOS_COMPATIBILITY_MAJORS, macJobName } from './macos-qualification.mjs'

export const MACOS_WORKFLOW = '.github/workflows/macos-hosted-candidates.yml'
const maximumRunAgeMs = 24 * 60 * 60 * 1000

export function macExecutionTiming(job, major) {
  const times = ['created_at', 'started_at', 'completed_at'].map((key) => Date.parse(job[key]))
  if (
    !Number.isSafeInteger(job.runner_id) ||
    job.runner_id <= 0 ||
    typeof job.runner_name !== 'string' ||
    !job.runner_name ||
    !Array.isArray(job.labels) ||
    !job.labels.includes(`macos-${major}`) ||
    !Array.isArray(job.steps) ||
    !job.steps.length ||
    job.steps.some(
      (step) => step.status !== 'completed' || !['success', 'skipped'].includes(step.conclusion),
    ) ||
    times.some((time) => !Number.isFinite(time)) ||
    times[0] > times[1] ||
    times[1] > times[2]
  )
    throw new Error('Mac shard lacks an original allocated runner execution')
  return {
    waitSeconds: (times[1] - times[0]) / 1000,
    executionSeconds: (times[2] - times[1]) / 1000,
  }
}

// Reconstruct membership through the planner rather than trusting supplied rows.
export function macMatrix(planFile, event = process.env.GITHUB_EVENT_NAME) {
  const planned = JSON.parse(
    execFileSync(
      process.execPath,
      [new URL('./macos-host-test-shards.mjs', import.meta.url).pathname, 'matrix', planFile],
      { encoding: 'utf8', timeout: 30_000 },
    ),
  )
  const frozen = JSON.parse(readFileSync(planFile, 'utf8'))
  if (
    !Array.isArray(planned.include) ||
    planned.include.length < frozen.policy.minShards ||
    planned.include.length > frozen.policy.maxShards
  )
    throw new Error('Mac plan shard count differs from its bounded policy')
  const majors = event === 'pull_request' ? [26] : [...MACOS_COMPATIBILITY_MAJORS]
  return {
    include: majors.flatMap((major) =>
      planned.include.map(({ shard }, index) => {
        if (shard !== index) throw new Error('Mac plan shard identities are not contiguous')
        return {
          arch: 'arm64',
          major,
          runner: `macos-${major}`,
          shard,
          installed: shard === planned.include.length - 1,
        }
      }),
    ),
  }
}

export function selectMacShardArtifacts({
  run,
  jobs,
  artifacts,
  source,
  matrix,
  now = Date.now(),
}) {
  const created = Date.parse(run.created_at)
  if (!Number.isFinite(created) || created > now || now - created > maximumRunAgeMs)
    throw new Error('Mac workflow evidence exceeded its 24-hour qualification window')
  return matrix.include.map(({ major, shard }) => {
    const job = latestJob(jobs, run, macJobName(major, shard))
    macExecutionTiming(job, major)
    if (run.event !== 'pull_request' && job.run_attempt !== run.run_attempt)
      throw new Error('Main and manual Mac qualification require fresh current-attempt execution')
    const name = `macos-prerequisites-${major}-${shard}-${source}-r${run.id}-a${job.run_attempt}`
    const matches = artifacts.filter((artifact) => artifact.name === name)
    if (matches.length !== 1) throw new Error('Missing or ambiguous Mac shard artifact')
    const artifact = verifyArtifactMetadata(matches[0], {
      name,
      runId: run.id,
      headSha: run.head_sha,
      now,
    })
    return { major, shard, job, artifact }
  })
}

async function snapshot(env, client) {
  const context = await githubContext({ env, sourceRevision: env.GITHUB_SHA })
  if (context.workflowPath !== MACOS_WORKFLOW) throw new Error('Wrong Mac workflow')
  const run = await client.api(`repos/${context.repository}/actions/runs/${context.runId}`)
  validateWorkflowRun(run, context)
  if (run.id !== context.runId || run.run_attempt !== context.runAttempt)
    throw new Error('Mac workflow attempt changed')
  const [jobs, artifacts] = await Promise.all([
    allRunJobs(client, context.repository, run),
    paginated(client, `repos/${context.repository}/actions/runs/${run.id}/artifacts`, 'artifacts'),
  ])
  return { context, run, jobs, artifacts }
}

export function requireMacInputBinding(binding, { source, inputArtifact, planBytes }) {
  if (
    JSON.stringify(binding) !==
    JSON.stringify({
      sourceRevision: source,
      inputArtifactId: inputArtifact.id,
      planSha256: digest(planBytes),
    })
  )
    throw new Error('Mac shard used changed source, plan or immutable prepared inputs')
}

export async function collectMacHost({ env = process.env, client = githubClient(), extract } = {}) {
  const state = await snapshot(env, client)
  const { context, run, jobs, artifacts } = state
  const source = env.GITHUB_SHA
  const scratch = env.RUNNER_TEMP
  const preparation = latestJob(jobs, run, 'Prepare Mac inputs')
  if (run.event !== 'pull_request' && preparation.run_attempt !== run.run_attempt)
    throw new Error('Mac main inputs must be prepared in the current attempt')
  const inputName = `macos-host-artifacts-${source}-r${run.id}-a${preparation.run_attempt}`
  const matching = artifacts.filter((artifact) => artifact.name === inputName)
  if (matching.length !== 1) throw new Error('Missing or ambiguous prepared Mac inputs')
  const inputArtifact = verifyArtifactMetadata(matching[0], {
    name: inputName,
    runId: run.id,
    headSha: run.head_sha,
  })
  const bundle = join(scratch, 'macos-host-artifacts')
  await downloadArtifactDirectory(client, inputArtifact, bundle, { extract })
  await verifyCandidateBundle(bundle, { sourceRevision: source })
  const planFile = join(bundle, 'PLAN.json')
  const planBytes = await readFile(planFile)
  const matrix = macMatrix(planFile, run.event)
  const selected = selectMacShardArtifacts({ run, jobs, artifacts, source, matrix })
  const majors = [...new Set(matrix.include.map((row) => row.major))]
  const evidence = join(scratch, 'macos-evidence')
  await mkdir(evidence)
  const reports = []
  for (const major of majors) await mkdir(join(evidence, String(major)))
  for (const row of selected) {
    const directory = join(
      evidence,
      String(row.major),
      `macos-prerequisites-arm64-${row.shard}-${source}`,
    )
    await downloadArtifactDirectory(client, row.artifact, directory, { extract })
    requireMacInputBinding(JSON.parse(await readFile(join(directory, 'INPUT.json'), 'utf8')), {
      source,
      inputArtifact,
      planBytes,
    })
    for (const name of ['CANDIDATE.json', 'ARTIFACT.json'])
      if (!(await readFile(join(directory, name))).equals(await readFile(join(bundle, name))))
        throw new Error('Mac shard candidate provenance changed')
  }
  for (const major of majors) {
    const report = readMacReports({
      repository: process.cwd(),
      source,
      targetId: 'macos-arm64',
      evidenceDirectory: join(evidence, String(major)),
      planFile,
      macosMajor: major,
      detailed: true,
    })
    if (!report.qualified) throw new Error('Incomplete Mac native coverage')
    reports.push({ major, ...report })
  }
  // Recheck authoritative metadata after all immutable downloads and validation.
  const current = await snapshot(env, client)
  if (latestJob(current.jobs, current.run, preparation.name).id !== preparation.id)
    throw new Error('Mac preparation changed during collection')
  for (const row of selected)
    if (latestJob(current.jobs, current.run, row.job.name).id !== row.job.id)
      throw new Error('Mac execution changed during collection')
  const summary = {
    architecture: 'arm64',
    revision: source,
    qualified: true,
    files: reports[0].files,
    planned_files: reports[0].planned_files,
    executed: reports.reduce((total, report) => total + report.executed, 0),
    failures: 0,
    skipped_reports: 0,
    errors: [],
    shards: reports.flatMap((report) =>
      report.shards.map((row) => ({ major: report.major, ...row })),
    ),
    hostProfiles: reports.flatMap((report) => report.hostProfiles),
    majors: reports,
    planSha256: digest(planBytes),
    executions: selected.map(({ major, shard, job, artifact }) => ({
      major,
      shard,
      jobId: job.id,
      runAttempt: job.run_attempt,
      artifactId: artifact.id,
      artifactDigest: artifact.digest,
      name: job.name,
      ...macExecutionTiming(job, major),
    })),
  }
  summary.coverage = validateMacCoverage(
    { plan: JSON.parse(planBytes), majors, executions: summary.executions },
    { source, majors },
  )
  await writeFile(join(scratch, 'mac-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, {
    flag: 'wx',
  })
  const lines = [
    '## Mac host qualification',
    '',
    `Complete whole-file coverage passed for macOS ${majors.join(' and ')} on native ARM.`,
    '',
    '| macOS | Shard | Runner wait | Execution | Accepted job / attempt |',
    '| --- | --- | --- | --- | --- |',
    ...summary.executions.map(
      (row) =>
        `| ${row.major} | ${row.shard} | ${row.waitSeconds}s | ${row.executionSeconds}s | [${row.jobId}](https://github.com/${context.repository}/actions/runs/${run.id}/job/${row.jobId}) / ${row.runAttempt} |`,
    ),
    '',
    'Each worker passed its native baseline and cleanup checks. Runner queues are separate from execution time.',
  ]
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`)
  return summary
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, file] = process.argv.slice(2)
    if (mode === 'matrix' && file) {
      const matrix = macMatrix(file)
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `workers=${JSON.stringify(matrix)}\nshard_count=${matrix.include.filter((row) => row.major === 26).length}\nmax_parallel=${JSON.parse(readFileSync(file, 'utf8')).policy.maxShards}\n`,
      )
    } else if (mode === 'collect' && !file) await collectMacHost()
    else throw new Error('usage: macos-host-collect.mjs matrix PLAN.json|collect')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
