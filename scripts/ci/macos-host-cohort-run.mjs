import {
  appendFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { candidateBinding, verifyCandidateBundle } from './candidate-provenance.mjs'
import {
  claimMacHostRole,
  downloadMacHostCohortClaim,
  loadMacHostCohortArtifacts,
  MAC_PR_COHORT,
  macHostCohortWorkerName,
  readMacHostCohortClaim,
  requireMacHostCohortProfiles,
  validateMacHostCohort,
} from './macos-host-cohort.mjs'
import { readMacHostPrerequisites } from './macos-host-profiles.mjs'
import { macHostShardCount } from './macos-host-test-shards.mjs'
import { readMacRoleReport } from './test-reports.mjs'

export function macHostWorkerMatrix(event) {
  if (!['pull_request', 'push', 'workflow_dispatch'].includes(event))
    throw new Error('Unknown hosted Mac workflow event')
  if (event === 'pull_request') requireMacHostCohortProfiles()
  return {
    include: Array.from(
      { length: event === 'pull_request' ? MAC_PR_COHORT.workers : 1 },
      (_, worker) => ({ arch: 'arm64', worker }),
    ),
  }
}

function positiveInteger(value, label) {
  if (!/^[1-9][0-9]*$/.test(value ?? '') || !Number.isSafeInteger(Number(value)))
    throw new Error(`Invalid Mac cohort ${label}`)
  return Number(value)
}

function runIdentity(environment) {
  if (!/^[0-9a-f]{40}$/.test(environment.GITHUB_SHA ?? ''))
    throw new Error('Invalid Mac cohort source revision')
  return {
    sourceRevision: environment.GITHUB_SHA,
    runId: positiveInteger(environment.GITHUB_RUN_ID, 'run ID'),
    runAttempt: positiveInteger(environment.GITHUB_RUN_ATTEMPT, 'run attempt'),
  }
}

function workerIndex(value) {
  if (!/^[0-4]$/.test(value ?? '')) throw new Error('Invalid Mac cohort worker index')
  return Number(value)
}

export function selectMacHostWorkerJob(jobs, identity) {
  const matches = Array.isArray(jobs)
    ? jobs.filter((job) => job.name === macHostCohortWorkerName(identity.worker))
    : []
  if (
    matches.length !== 1 ||
    !Number.isSafeInteger(matches[0].id) ||
    matches[0].id <= 0 ||
    matches[0].run_id !== identity.runId ||
    matches[0].run_attempt !== identity.runAttempt ||
    matches[0].status !== 'in_progress' ||
    matches[0].conclusion !== null
  )
    throw new Error('Mac cohort requires its unique active current-attempt worker job')
  return matches[0].id
}

async function githubMetadata(environment, suffix, key) {
  const repository = environment.GITHUB_REPOSITORY
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || !environment.GH_TOKEN)
    throw new Error('Mac cohort requires repository-scoped Actions read access')
  const response = await fetch(`https://api.github.com/repos/${repository}/${suffix}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${environment.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) throw new Error(`Mac cohort metadata request failed (HTTP ${response.status})`)
  const result = await response.json()
  if (
    !Number.isSafeInteger(result.total_count) ||
    result.total_count < 0 ||
    result.total_count > 100 ||
    !Array.isArray(result[key]) ||
    result[key].length !== result.total_count
  )
    throw new Error('Mac cohort refuses an incomplete metadata inventory')
  return result[key]
}

async function currentJobs(environment, identity) {
  return githubMetadata(
    environment,
    `actions/runs/${identity.runId}/attempts/${identity.runAttempt}/jobs?per_page=100`,
    'jobs',
  )
}

function workerDirectory(identity, worker) {
  return `macos-cohort-worker-${worker}-${identity.sourceRevision}-r${identity.runId}-a${identity.runAttempt}`
}

async function regularDirectory(directory) {
  if (!(await lstat(directory)).isDirectory() || (await realpath(directory)) !== resolve(directory))
    throw new Error('Mac cohort evidence requires an unlinked directory')
  const entries = await readdir(directory, { withFileTypes: true })
  if (entries.some((entry) => !entry.isFile()))
    throw new Error('Mac cohort evidence must contain only regular files')
  return entries.map((entry) => entry.name)
}

/** Validate every executed worker before selecting one complete observed profile. */
export async function reconcileMacHostCohortReports({
  repository = process.cwd(),
  identity,
  evidenceDirectory,
  normalizedDirectory,
  bundleDirectory,
  claims,
  jobs,
}) {
  const names = Array.from({ length: MAC_PR_COHORT.workers }, (_, worker) =>
    workerDirectory(identity, worker),
  )
  if (
    !(await lstat(evidenceDirectory)).isDirectory() ||
    (await realpath(evidenceDirectory)) !== resolve(evidenceDirectory) ||
    JSON.stringify((await readdir(evidenceDirectory)).sort()) !== JSON.stringify([...names].sort())
  )
    throw new Error('Mac cohort requires exactly five current-attempt worker directories')
  const workers = []
  for (const [worker, name] of names.entries()) {
    const directory = join(evidenceDirectory, name)
    const files = await regularDirectory(directory)
    const receipt = readMacHostCohortClaim(join(directory, 'worker.json'))
    const prerequisites = readMacHostPrerequisites(join(directory, 'prerequisites.json'), 'arm64')
    if (
      receipt.worker !== worker ||
      (await readFile(join(directory, 'source.txt'), 'utf8')).trim() !== identity.sourceRevision
    )
      throw new Error('Mac cohort directory differs from its worker or source')
    if (
      receipt.role === null &&
      files.some((file) =>
        /(?:\.xml$|\.complete$|^test-plan\.json$|^(?:CANDIDATE|ARTIFACT)\.json$|^host-conformance\.txt$)/.test(file),
      )
    )
      throw new Error('Surplus Mac cohort worker cannot retain execution proof')
    workers.push({ receipt, prerequisites })
  }
  const assignment = validateMacHostCohort({ identity, workers, claims, jobs })
  const candidate = await verifyCandidateBundle(bundleDirectory, {
    sourceRevision: identity.sourceRevision,
  })
  candidateBinding(
    candidate,
    JSON.parse(await readFile(join(bundleDirectory, 'ARTIFACT.json'), 'utf8')),
  )
  const canonical = await Promise.all(
    ['CANDIDATE.json', 'ARTIFACT.json'].map(async (file) => [
      file,
      await readFile(join(bundleDirectory, file)),
    ]),
  )
  const reports = []
  for (const receipt of assignment.workers) {
    if (receipt.role === null) continue
    const directory = join(evidenceDirectory, workerDirectory(identity, receipt.worker))
    for (const [file, bytes] of canonical)
      if (!(await readFile(join(directory, file))).equals(bytes))
        throw new Error('Mac cohort worker used a different canonical candidate')
    const report = readMacRoleReport({
      repository,
      source: identity.sourceRevision,
      targetId: 'macos-arm64',
      evidenceDirectory: directory,
      role: receipt.role,
      plan: 'pull-request',
    })
    if (
      Object.keys(receipt.profile).some((field) => receipt.profile[field] !== report.hostProfile[field])
    )
      throw new Error('Mac cohort report differs from its claimed host profile')
    reports.push({ worker: receipt.worker, role: receipt.role, executed: report.executed })
  }
  // Exclusive creation prevents earlier attempts or partial normalization from contributing.
  await mkdir(normalizedDirectory)
  for (const receipt of assignment.roles)
    await cp(
      join(evidenceDirectory, workerDirectory(identity, receipt.worker)),
      join(normalizedDirectory, `macos-prerequisites-arm64-${receipt.role}-${identity.sourceRevision}`),
      { recursive: true, errorOnExist: true, force: false },
    )
  return { ...assignment, reports }
}

async function outputs(environment, values) {
  if (!environment.GITHUB_OUTPUT) throw new Error('Mac cohort requires the Actions output file')
  await appendFile(
    environment.GITHUB_OUTPUT,
    Object.entries(values).map(([name, value]) => `${name}=${value}\n`).join(''),
  )
}

async function main(mode, environment) {
  const event = environment.GITHUB_EVENT_NAME
  if (mode === 'plan') {
    await outputs(environment, {
      workers: JSON.stringify(macHostWorkerMatrix(event)),
      shard_count: macHostShardCount('arm64', event === 'pull_request' ? 'pull-request' : 'complete'),
    })
    return
  }
  if (mode === 'claim' && event !== 'pull_request') {
    macHostWorkerMatrix(event)
    if (workerIndex(environment.MAC_HOST_WORKER) !== 0)
      throw new Error('Complete Mac plan has one worker')
    await outputs(environment, { execute: true, role: 0, installed: true })
    return
  }
  if (event !== 'pull_request' || !['claim', 'reconcile'].includes(mode))
    throw new Error('usage: macos-host-cohort-run.mjs plan|claim|reconcile')
  const identity = runIdentity(environment)
  const scratch = environment.RUNNER_TEMP
  if (!isAbsolute(scratch ?? '')) throw new Error('Mac cohort requires absolute runner scratch')
  const jobs = await currentJobs(environment, identity)
  if (mode === 'claim') {
    const worker = workerIndex(environment.MAC_HOST_WORKER)
    const jobId = selectMacHostWorkerJob(jobs, { ...identity, worker })
    const prerequisites = readMacHostPrerequisites(
      join(scratch, 'mac-evidence/prerequisites.json'),
      'arm64',
    )
    const workDeadline = positiveInteger(environment.JIG_PR_WORK_DEADLINE_EPOCH_MS, 'work deadline')
    const artifacts = await loadMacHostCohortArtifacts(join(scratch, 'mac-cohort-client'), scratch)
    const receipt = await claimMacHostRole({
      identity: { ...identity, worker, jobId },
      prerequisites,
      artifacts,
      deadlineMs: Math.min(Date.now() + 60_000, workDeadline),
    })
    await writeFile(join(scratch, 'mac-evidence/worker.json'), `${JSON.stringify(receipt)}\n`, {
      flag: 'wx',
    })
    await outputs(environment, {
      execute: receipt.role !== null,
      role: receipt.role ?? 'surplus',
      installed: receipt.role === MAC_PR_COHORT.shards - 1,
    })
    console.log(JSON.stringify({ worker, role: receipt.role, profile: receipt.profile }))
    return
  }
  const artifacts = await githubMetadata(
    environment,
    `actions/runs/${identity.runId}/artifacts?per_page=100`,
    'artifacts',
  )
  const prefix = `macos-cohort-claim-${identity.sourceRevision}-r${identity.runId}-a${identity.runAttempt}-`
  const claims = []
  for (const artifact of artifacts.filter((entry) => entry.name?.startsWith(prefix)))
    claims.push({
      artifact,
      claim: downloadMacHostCohortClaim(environment.GITHUB_REPOSITORY, artifact),
    })
  const assignment = await reconcileMacHostCohortReports({
    identity,
    evidenceDirectory: join(scratch, 'macos-workers'),
    normalizedDirectory: join(scratch, 'macos-evidence'),
    bundleDirectory: join(scratch, 'macos-host-artifacts'),
    claims,
    jobs,
  })
  await writeFile(join(scratch, 'mac-cohort.json'), `${JSON.stringify(assignment, null, 2)}\n`)
  await writeFile(join(scratch, 'mac-job-timings.json'), `${JSON.stringify(jobs)}\n`)
  console.log(
    JSON.stringify({
      profile: assignment.profile,
      roles: assignment.roles.map(({ worker, role }) => ({ worker, role })),
    }),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Mac cohort requires one exact mode')
    await main(process.argv[2], process.env)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
