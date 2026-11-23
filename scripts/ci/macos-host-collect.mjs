import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { digest, githubContext, verifyCandidateBundle } from './candidate-provenance.mjs'
import {
  downloadArtifactDirectory,
  githubClient,
  paginated,
  validateWorkflowRun,
  verifyArtifactMetadata,
} from './candidate-transfer.mjs'
import { readGitHubApiJson } from './github-read.mjs'
import { readMacDecisionArtifact, selectMacPrDecisions } from './macos-pr-race.mjs'
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
export function macMatrix(planFile) {
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
  const majors = [...MACOS_COMPATIBILITY_MAJORS]
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
  decisions,
  decisionContext,
  now = Date.now(),
}) {
  const created = Date.parse(run.created_at)
  if (!Number.isFinite(created) || created > now || now - created > maximumRunAgeMs)
    throw new Error('Mac workflow evidence exceeded its 24-hour qualification window')
  const required =
    run.event === 'pull_request'
      ? selectMacPrDecisions({
          decisions,
          jobs,
          context: decisionContext,
          shards: [...new Set(matrix.include.map(({ shard }) => shard))],
        })
      : matrix.include
  return required.map(
    ({ major, shard, job: winner, decision, artifact: decisionArtifact, selectorJob }) => {
      const job = winner ?? latestJob(jobs, run, macJobName(major, shard))
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
      return {
        major,
        shard,
        job,
        artifact,
        ...(decision ? { decision, decisionArtifact, selectorJob } : {}),
      }
    },
  )
}

// PR collection waits only for authoritative decisions and their fixed winners.
// Queued candidates that never won cannot hold the required PR check open.
export function latestMacDecisionArtifacts(artifacts, context, shards) {
  const roles = new Map()
  for (const artifact of artifacts.filter(({ name }) => name.startsWith('macos-pr-decision-'))) {
    const match = /^macos-pr-decision-([0-7])-([a-f0-9]{40})-r([1-9][0-9]*)-a([1-9][0-9]*)$/.exec(
      artifact.name,
    )
    if (
      !match ||
      match[2] !== context.source ||
      Number(match[3]) !== context.runId ||
      !Number.isSafeInteger(Number(match[4])) ||
      Number(match[4]) > context.attempt ||
      !shards.includes(Number(match[1]))
    )
      throw new Error('Foreign or malformed Mac allocation decision')
    const shard = Number(match[1]),
      attempt = Number(match[4])
    if (attempt < (context.minimumDecisionAttempt ?? 1)) continue
    const previous = roles.get(shard)
    if (!previous || previous.attempt < attempt) roles.set(shard, { attempt, rows: [artifact] })
    else if (previous.attempt === attempt) previous.rows.push(artifact)
  }
  return [...roles.values()].map(({ rows }) => {
    if (rows.length !== 1) throw new Error('Ambiguous latest Mac allocation decision')
    return rows[0]
  })
}

export async function waitForMacPrWinners({
  observe,
  readDecision,
  context,
  shards,
  deadline = Date.now() + 40 * 60_000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  report = console.log,
}) {
  const cache = new Map()
  for (;;) {
    if (now() >= deadline) throw new Error('Mac PR winner observation deadline expired')
    const state = await observe()
    try {
      const decisions = []
      for (const artifact of latestMacDecisionArtifacts(state.artifacts, context, shards)) {
        verifyArtifactMetadata(artifact, {
          name: artifact.name,
          runId: context.runId,
          headSha: context.headSha,
        })
        let row = cache.get(artifact.id)
        if (
          row &&
          ['digest', 'name', 'created_at', 'size_in_bytes'].some(
            (key) => row.artifact[key] !== artifact[key],
          )
        )
          throw new Error('Immutable Mac decision metadata changed')
        if (!row) {
          row = await readDecision(artifact, state.jobs)
          cache.set(artifact.id, row)
        }
        decisions.push({
          ...row,
          artifact,
          job: state.jobs.find(({ id }) => id === row.decision.jobId),
        })
      }
      const selected = selectMacPrDecisions({ decisions, jobs: state.jobs, context, shards })
      return { ...state, decisions, selected }
    } catch (error) {
      if (error.code !== 'MAC_RACE_PENDING') throw error
      report('Awaiting fixed Mac shard winners; unselected queued candidates are not required.')
    }
    await sleep(Math.min(60_000, Math.max(1, deadline - now())))
  }
}

export async function waitForMacReleaseWorkers({
  observe,
  matrix,
  deadline = Date.now() + 80 * 60_000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  report = console.log,
}) {
  for (;;) {
    if (now() >= deadline) throw new Error('Mac complete-major observation deadline expired')
    const state = await observe()
    let pending = false
    for (const { major, shard } of matrix.include) {
      const name = macJobName(major, shard)
      if (!state.jobs.some((job) => job.name === name)) {
        pending = true
        continue
      }
      const job = latestJob(state.jobs, state.run, name, { completed: false })
      if (job.status !== 'completed') {
        pending = true
        continue
      }
      if (job.conclusion !== 'success')
        throw new Error('Required Mac major worker did not succeed: ' + name)
      if (job.run_attempt !== state.run.run_attempt)
        throw new Error('Mac release requires fresh current-attempt workers')
    }
    if (!pending) return state
    report('Awaiting complete independent coverage for every required macOS major.')
    await sleep(Math.min(60_000, Math.max(1, deadline - now())))
  }
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

export function requireMacDecisionBinding(binding, { decision, decisionArtifact }) {
  if (
    !isDeepStrictEqual(binding, {
      decision,
      artifact: {
        id: decisionArtifact.id,
        digest: decisionArtifact.digest,
      },
    })
  )
    throw new Error('Mac shard evidence used a different allocation decision')
}

export async function collectMacHost({
  env = process.env,
  client = githubClient(env.GITHUB_REPOSITORY, { readApiJson: readGitHubApiJson }),
  extract,
} = {}) {
  let state = await snapshot(env, client)
  const { context, run } = state
  let { jobs, artifacts } = state
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
  const matrix = macMatrix(planFile)
  const pr = run.event === 'pull_request'
  const decisionContext = {
    repository: context.repository,
    source,
    headSha: run.head_sha,
    runId: run.id,
    attempt: run.run_attempt,
    preparedArtifactId: inputArtifact.id,
    minimumDecisionAttempt: preparation.run_attempt,
    planSha256: digest(planBytes),
  }
  const observe = async () => {
    const current = await snapshot(env, client)
    if (latestJob(current.jobs, current.run, preparation.name).id !== preparation.id)
      throw new Error('Mac preparation changed while waiting for workers')
    return current
  }
  const minutes = Number(env.MACOS_COLLECTION_MINUTES ?? (pr ? 40 : 80))
  if (pr ? minutes !== 40 : ![80, 170].includes(minutes))
    throw new Error('Invalid Mac collection allowance')
  const deadline = Date.now() + minutes * 60_000
  if (pr) {
    state = await waitForMacPrWinners({
      context: decisionContext,
      shards: [...new Set(matrix.include.map(({ shard }) => shard))],
      observe,
      deadline,
      readDecision: (artifact, jobs) =>
        readMacDecisionArtifact(client, artifact, decisionContext, { jobs }),
    })
    ;({ jobs, artifacts } = state)
  } else state = await waitForMacReleaseWorkers({ observe, matrix, deadline })
  ;({ jobs, artifacts } = state)
  const selected = selectMacShardArtifacts({
    run,
    jobs,
    artifacts,
    source,
    matrix,
    ...(pr ? { decisions: state.decisions, decisionContext } : {}),
  })
  const majors = [...new Set(selected.map((row) => row.major))].sort((a, b) => a - b)
  const evidence = join(scratch, 'macos-evidence')
  await mkdir(evidence)
  const reports = []
  if (!pr) for (const major of majors) await mkdir(join(evidence, String(major)))
  for (const row of selected) {
    const directory = join(
      evidence,
      ...(pr ? [] : [String(row.major)]),
      `macos-prerequisites-arm64-${row.shard}-${source}`,
    )
    await downloadArtifactDirectory(client, row.artifact, directory, { extract })
    requireMacInputBinding(JSON.parse(await readFile(join(directory, 'INPUT.json'), 'utf8')), {
      source,
      inputArtifact,
      planBytes,
    })
    if (pr)
      requireMacDecisionBinding(
        JSON.parse(await readFile(join(directory, 'DECISION.json'), 'utf8')),
        row,
      )
    for (const name of ['CANDIDATE.json', 'ARTIFACT.json'])
      if (!(await readFile(join(directory, name))).equals(await readFile(join(bundle, name))))
        throw new Error('Mac shard candidate provenance changed')
  }
  for (const major of pr ? [null] : majors) {
    const report = readMacReports({
      repository: process.cwd(),
      source,
      targetId: 'macos-arm64',
      evidenceDirectory: pr ? evidence : join(evidence, String(major)),
      planFile,
      ...(pr ? { selectedMajorsByShard: selected.map((row) => row.major) } : { macosMajor: major }),
      detailed: true,
    })
    if (!report.qualified) throw new Error('Incomplete Mac native coverage')
    reports.push({ ...(pr ? {} : { major }), ...report })
  }
  // Recheck authoritative metadata after all immutable downloads and validation.
  const current = await snapshot(env, client)
  if (latestJob(current.jobs, current.run, preparation.name).id !== preparation.id)
    throw new Error('Mac preparation changed during collection')
  const checked = selectMacShardArtifacts({
    run: current.run,
    jobs: current.jobs,
    artifacts: current.artifacts,
    source,
    matrix,
    ...(pr
      ? {
          decisions: state.decisions.map((row) => ({
            ...row,
            job: current.jobs.find(({ id }) => id === row.decision.jobId),
          })),
          decisionContext,
        }
      : {}),
  })
  if (
    JSON.stringify(checked.map((row) => [row.job.id, row.artifact.id, row.selectorJob?.id])) !==
    JSON.stringify(selected.map((row) => [row.job.id, row.artifact.id, row.selectorJob?.id]))
  )
    throw new Error('Mac execution changed during collection')
  const decisionIdentities = (rows) =>
    JSON.stringify(rows.map((row) => [row.id, row.digest]).sort((a, b) => a[0] - b[0]))
  if (
    pr &&
    decisionIdentities(
      latestMacDecisionArtifacts(current.artifacts, decisionContext, [
        ...new Set(matrix.include.map(({ shard }) => shard)),
      ]),
    ) !== decisionIdentities(state.decisions.map((row) => row.artifact))
  )
    throw new Error('Mac race decision changed during collection')
  const summary = {
    scope: pr ? 'pull_request' : 'release',
    architecture: 'arm64',
    revision: source,
    qualified: true,
    files: reports[0].files,
    planned_files: reports[0].planned_files,
    executed: reports.reduce((total, report) => total + report.executed, 0),
    failures: 0,
    skipped_reports: 0,
    errors: [],
    shards: reports.flatMap((report) => report.shards.map((row) => ({ ...row }))),
    hostProfiles: reports.flatMap((report) => report.hostProfiles),
    majors,
    reports,
    planSha256: digest(planBytes),
    executions: selected.map(({ major, shard, job, artifact, decisionArtifact, selectorJob }) => ({
      major,
      shard,
      jobId: job.id,
      runAttempt: job.run_attempt,
      artifactId: artifact.id,
      artifactDigest: artifact.digest,
      ...(decisionArtifact
        ? {
            decisionArtifactId: decisionArtifact.id,
            decisionArtifactDigest: decisionArtifact.digest,
            selectorJobId: selectorJob.id,
            selectorRunAttempt: selectorJob.run_attempt,
          }
        : {}),
      name: job.name,
      ...macExecutionTiming(job, major),
    })),
  }
  summary.coverage = validateMacCoverage(
    {
      scope: pr ? 'pull_request' : 'release',
      plan: JSON.parse(planBytes),
      majors,
      executions: summary.executions,
    },
    { source, ...(pr ? { scope: 'pull_request' } : {}) },
  )
  await writeFile(join(scratch, 'mac-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, {
    flag: 'wx',
  })
  const lines = [
    '## Mac host qualification',
    '',
    pr
      ? 'Complete whole-file PR coverage passed across the selected native ARM workers.'
      : `Complete whole-file coverage passed independently for macOS ${majors.join(' and ')} on native ARM.`,
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
        `workers=${JSON.stringify(matrix)}\nselectors=${JSON.stringify({ include: matrix.include.filter((row) => row.major === 26).map(({ shard }) => ({ shard })) })}\nshard_count=${matrix.include.filter((row) => row.major === 26).length}\nmax_parallel=${JSON.parse(readFileSync(file, 'utf8')).policy.maxShards * (process.env.GITHUB_EVENT_NAME === 'pull_request' ? 2 : 1)}\n`,
      )
    } else if (mode === 'collect' && !file) await collectMacHost()
    else throw new Error('usage: macos-host-collect.mjs matrix PLAN.json|collect')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
