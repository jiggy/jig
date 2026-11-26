import { execFileSync } from 'node:child_process'
import { constants, readFileSync } from 'node:fs'
import { appendFile, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { digest, githubContext, verifyCandidateBundle } from './candidate-provenance.mjs'
import {
  acquireCandidate,
  acquisitionExpectation,
  downloadArtifactDirectory,
  githubClient,
  paginated,
  validateWorkflowRun,
  verifyArtifactMetadata,
} from './candidate-transfer.mjs'
import { readGitHubApiJson, retryGitHubRead } from './github-read.mjs'
import {
  MACOS_JOB_POLL_MS,
  MACOS_PR_ALLOCATION_MINUTES,
  macPrWorkerObservationDeadline,
  readMacDecisionArtifact,
  selectMacPrDecisions,
} from './macos-pr-race.mjs'
import {
  MACOS_COMPATIBILITY_MAJORS,
  macJobName,
  macPrShardMajors,
  validateMacCoverage,
} from './macos-qualification.mjs'
import { verifyMacPython } from './macos-python-evidence.mjs'
import { allRunJobs, latestJob } from './merge-attempts.mjs'
import { MAC_PYTHON_SHARD } from './python-ci-profiles.mjs'
import { readMacReports } from './test-reports.mjs'

export { MACOS_COMPATIBILITY_MAJORS, macJobName } from './macos-qualification.mjs'

export const MACOS_WORKFLOW = '.github/workflows/macos-hosted-candidates.yml'
const maximumRunAgeMs = 24 * 60 * 60 * 1000
const fullObservationInterval = 60_000
const evidenceDownloadConcurrency = 4

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
export function macMatrix(planFile, { pullRequest = false } = {}) {
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
  const shards = planned.include.map(({ shard }, index) => {
    if (shard !== index) throw new Error('Mac plan shard identities are not contiguous')
    return { arch: 'arm64', shard, installed: shard === planned.include.length - 1 }
  })
  const worker = (shard, major) => ({
    ...shard,
    major,
    runner: `macos-${major}`,
    pythonInstalled: pullRequest && shard.shard === MAC_PYTHON_SHARD,
  })
  const majors = MACOS_COMPATIBILITY_MAJORS
  return {
    include: pullRequest
      ? majors.flatMap((_, wave) =>
          shards
            .map((shard, index) => worker(shard, majors[(index + wave) % majors.length]))
            .filter(({ major, shard }) => macPrShardMajors(shard).includes(major)),
        )
      : majors.flatMap((major) => shards.map((shard) => worker(shard, major))),
  }
}

function findMacShardArtifact({ run, artifacts, source, major, shard, job, now, awaiting = false }) {
  const name = `macos-prerequisites-${major}-${shard}-${source}-r${run.id}-a${job.run_attempt}`
  const matches = artifacts.filter((artifact) => artifact.name === name)
  if (awaiting && matches.length !== 1) return
  if (matches.length !== 1) throw new Error('Missing or ambiguous Mac shard artifact')
  return verifyArtifactMetadata(matches[0], { name, runId: run.id, headSha: run.head_sha, now })
}

export function stageMacShardEvidence({ client, directory, extract }) {
  const lanes = Array.from({ length: evidenceDownloadConcurrency }, () => Promise.resolve())
  const downloads = new Map()
  let next = 0
  return {
    download(artifact) {
      const previous = downloads.get(artifact.id)
      if (previous) {
        if (previous.digest !== artifact.digest)
          throw new Error('Immutable Mac shard artifact digest changed')
        return previous.promise
      }
      const destination = join(directory, String(artifact.id))
      const lane = next++ % lanes.length
      const promise = lanes[lane]
        .then(() => {
          console.log(`Downloading Mac shard evidence artifact ${artifact.id}`)
          return downloadArtifactDirectory(client, artifact, destination, { extract })
        })
        .then(() => destination)
      lanes[lane] = promise.catch(() => {})
      downloads.set(artifact.id, { digest: artifact.digest, promise })
      return promise
    },
    drain: () => Promise.all(lanes),
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
      const artifact = findMacShardArtifact({ run, artifacts, source, major, shard, job, now })
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
  readJobs,
  onProgress,
  context,
  shards,
  deadline = Date.now() + MACOS_PR_ALLOCATION_MINUTES * 60_000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  report = console.log,
}) {
  const cache = new Map()
  let state
  let refreshAt = 0
  let decisionsKnown = false
  for (;;) {
    const fullObservation = !readJobs || !decisionsKnown || now() >= refreshAt
    if (fullObservation) {
      state = await observe()
      refreshAt = now() + 2 * fullObservationInterval
    } else {
      state = { ...state, jobs: await readJobs(state.run) }
    }
    let observationDeadline = deadline
    try {
      const decisions = []
      for (const artifact of latestMacDecisionArtifacts(state.artifacts, context, shards)) {
        verifyArtifactMetadata(artifact, {
          name: artifact.name,
          runId: context.runId,
          headSha: context.headSha,
          now: now(),
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
      // Once all roles have timely, verified decisions, observe each original
      // worker against its assigned execution clock rather than its queue.
      if (
        decisions.length === shards.length &&
        decisions.every(({ artifact }) => Date.parse(artifact.created_at) <= deadline)
      )
        observationDeadline = Math.max(
          deadline,
          ...decisions.map(({ job }) => macPrWorkerObservationDeadline(job, deadline)),
        )
      if (now() >= observationDeadline)
        throw new Error('Mac PR winner observation deadline expired')
      decisionsKnown = decisions.length === shards.length
      if (fullObservation) onProgress?.(state, decisions)
      const selected = selectMacPrDecisions({ decisions, jobs: state.jobs, context, shards })
      if (!fullObservation) {
        refreshAt = 0
        continue
      }
      return { ...state, decisions, selected }
    } catch (error) {
      if (!fullObservation && error.code !== 'MAC_RACE_PENDING') {
        refreshAt = 0
        continue
      }
      if (error.code !== 'MAC_RACE_PENDING') throw error
      report('Awaiting fixed Mac shard winners; unselected queued candidates are not required.')
    }
    if (now() >= observationDeadline) throw new Error('Mac PR winner observation deadline expired')
    const interval = readJobs && decisionsKnown ? MACOS_JOB_POLL_MS : fullObservationInterval
    await sleep(Math.min(interval, observationDeadline - now()))
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

export function requireMacInputBinding(binding, { source, inputArtifactId, planBytes }) {
  if (
    JSON.stringify(binding) !==
    JSON.stringify({
      sourceRevision: source,
      inputArtifactId,
      planSha256: digest(planBytes),
    })
  )
    throw new Error('Mac shard used changed source, plan or immutable inputs')
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
  client = githubClient(env.GITHUB_REPOSITORY, {
    readApiJson: readGitHubApiJson,
    readArchive: retryGitHubRead,
  }),
  extract,
} = {}) {
  let state = await snapshot(env, client)
  const { context, run } = state
  let { jobs, artifacts } = state
  const source = env.GITHUB_SHA
  const scratch = env.RUNNER_TEMP
  const pr = run.event === 'pull_request'
  const minutes = Number(env.MACOS_COLLECTION_MINUTES ?? (pr ? MACOS_PR_ALLOCATION_MINUTES : 80))
  if (pr ? minutes !== MACOS_PR_ALLOCATION_MINUTES : ![80, 170].includes(minutes))
    throw new Error('Invalid Mac collection allowance')
  const collectionStarted = Date.now()
  const preparation = latestJob(jobs, run, 'Prepare Mac inputs')
  if (!pr && preparation.run_attempt !== run.run_attempt)
    throw new Error('Mac main inputs must be prepared in the current attempt')
  const inputKind = pr ? 'macos-plan' : 'macos-host-artifacts'
  const inputName = `${inputKind}-${source}-r${run.id}-a${preparation.run_attempt}`
  const matching = artifacts.filter((artifact) => artifact.name === inputName)
  if (matching.length !== 1) throw new Error('Missing or ambiguous prepared Mac inputs')
  const preparedArtifact = verifyArtifactMetadata(matching[0], {
    name: inputName,
    runId: run.id,
    headSha: run.head_sha,
  })
  const bundle = join(scratch, 'macos-host-artifacts')
  const planFile = join(bundle, 'PLAN.json')
  let inputArtifactId = preparedArtifact.id
  if (pr) {
    const planDirectory = join(scratch, 'macos-collection-plan')
    await downloadArtifactDirectory(client, preparedArtifact, planDirectory, { extract })
    const acquisition = await acquireCandidate({
      destination: bundle,
      sourceRevision: source,
      expected: await acquisitionExpectation(source, env),
      client,
      producerTimeoutSeconds: 1800,
      timeoutSeconds: 300,
      extract,
    })
    inputArtifactId = acquisition.artifactId
    await copyFile(join(planDirectory, 'PLAN.json'), planFile, constants.COPYFILE_EXCL)
  } else {
    await downloadArtifactDirectory(client, preparedArtifact, bundle, { extract })
  }
  const candidate = await verifyCandidateBundle(bundle, { sourceRevision: source })
  const planBytes = await readFile(planFile)
  const matrix = macMatrix(planFile, { pullRequest: pr })
  const decisionContext = {
    repository: context.repository,
    source,
    headSha: run.head_sha,
    runId: run.id,
    attempt: run.run_attempt,
    planArtifactId: preparedArtifact.id,
    minimumDecisionAttempt: preparation.run_attempt,
    planSha256: digest(planBytes),
  }
  const observe = async () => {
    const current = await snapshot(env, client)
    if (latestJob(current.jobs, current.run, preparation.name).id !== preparation.id)
      throw new Error('Mac preparation changed while waiting for workers')
    return current
  }
  const deadline = (pr ? collectionStarted : Date.now()) + minutes * 60_000
  const stagingDirectory = join(scratch, 'macos-evidence-downloads')
  await mkdir(stagingDirectory)
  const staged = stageMacShardEvidence({ client, directory: stagingDirectory, extract })
  let selected, downloaded
  try {
    if (pr) {
      state = await waitForMacPrWinners({
        context: decisionContext,
        shards: [...new Set(matrix.include.map(({ shard }) => shard))],
        observe,
        deadline,
        readJobs: (currentRun) => allRunJobs(client, context.repository, currentRun),
        readDecision: (artifact, jobs) =>
          readMacDecisionArtifact(client, artifact, decisionContext, { jobs }),
        onProgress: (observed, decisions) => {
          for (const { decision, job } of decisions) {
            if (
              job?.status !== 'completed' ||
              job.conclusion !== 'success' ||
              job.run_attempt !== run.run_attempt
            )
              continue
            const artifact = findMacShardArtifact({
              run,
              artifacts: observed.artifacts,
              source,
              major: decision.major,
              shard: decision.shard,
              job,
              awaiting: true,
            })
            if (artifact) staged.download(artifact)
          }
        },
      })
    } else state = await waitForMacReleaseWorkers({ observe, matrix, deadline })
    selected = selectMacShardArtifacts({
      run,
      jobs: state.jobs,
      artifacts: state.artifacts,
      source,
      matrix,
      ...(pr ? { decisions: state.decisions, decisionContext } : {}),
    })
    downloaded = await Promise.all(selected.map(({ artifact }) => staged.download(artifact)))
  } finally {
    await staged.drain()
  }
  const majors = [...new Set(selected.map((row) => row.major))].sort((a, b) => a - b)
  const evidence = join(scratch, 'macos-evidence')
  await mkdir(evidence)
  const reports = []
  let installedPython
  if (!pr) for (const major of majors) await mkdir(join(evidence, String(major)))
  for (const [index, row] of selected.entries()) {
    const directory = join(
      evidence,
      ...(pr ? [] : [String(row.major)]),
      `macos-prerequisites-arm64-${row.shard}-${source}`,
    )
    await rename(downloaded[index], directory)
    requireMacInputBinding(JSON.parse(await readFile(join(directory, 'INPUT.json'), 'utf8')), {
      source,
      inputArtifactId,
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
    if (pr && row.shard === MAC_PYTHON_SHARD)
      installedPython = await verifyMacPython({
        row,
        directory,
        candidateDirectory: bundle,
        candidate,
        env,
        client,
      })
  }
  if (pr && !installedPython) throw new Error('The required macOS installed Python proof is missing')
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
    !isDeepStrictEqual(
      checked.map((row) => [row.job.id, row.artifact.id, row.artifact.digest, row.selectorJob?.id]),
      selected.map((row) => [row.job.id, row.artifact.id, row.artifact.digest, row.selectorJob?.id]),
    )
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
    ...(installedPython ? { installedPython } : {}),
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
      ? 'Complete whole-file PR coverage and the installed macOS Python profile passed.'
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
      const pullRequest = process.env.GITHUB_EVENT_NAME === 'pull_request'
      const matrix = macMatrix(file, { pullRequest })
      const shardCount = new Set(matrix.include.map(({ shard }) => shard)).size
      const selectors = { include: Array.from({ length: shardCount }, (_, shard) => ({ shard })) }
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `workers=${JSON.stringify(matrix)}\nselectors=${JSON.stringify(selectors)}\nshard_count=${shardCount}\nmax_parallel=${JSON.parse(readFileSync(file, 'utf8')).policy.maxShards * (pullRequest ? 2 : 1)}\n`,
      )
    } else if (mode === 'collect' && !file) await collectMacHost()
    else throw new Error('usage: macos-host-collect.mjs matrix PLAN.json|collect')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
