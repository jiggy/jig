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
  createMacHostCohortAnnouncement,
  createMacHostCohortAssignment,
  createMacHostCohortLedger,
  createMacHostCohortReady,
  createMacHostCohortWorkerReceipt,
  downloadMacHostCohortRecord,
  loadMacHostCohortArtifacts,
  MAC_COHORT_ALLOCATOR_NAME,
  MAC_COHORT_READY_JOB_NAME,
  MAC_PR_COHORT,
  macHostCohortArtifactName,
  macHostCohortWorkerName,
  readMacHostCohortRecord,
  requireMacHostCohortProfiles,
  validateMacHostCohort,
  validateMacHostCohortRecords,
} from './macos-host-cohort.mjs'
import { readMacHostPrerequisites } from './macos-host-profiles.mjs'
import { macHostShardCount } from './macos-host-test-shards.mjs'
import { readMacRoleReport } from './test-reports.mjs'

export function macHostWorkerMatrix(event) {
  if (!['pull_request', 'push', 'workflow_dispatch'].includes(event))
    throw new Error('Unknown hosted Mac workflow event')
  if (event === 'pull_request') requireMacHostCohortProfiles()
  return {
    include: [
      ...(event === 'pull_request'
        ? [{ arch: 'guard', worker: 'guard', runner: 'ubuntu-24.04', guard: true }]
        : []),
      ...Array.from(
        { length: event === 'pull_request' ? MAC_PR_COHORT.workers : 1 },
        (_, worker) => ({ arch: 'arm64', worker, runner: 'macos-15', guard: false }),
      ),
    ],
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

function observeAllocatorJob(jobs, identity) {
  if (!Array.isArray(jobs)) throw new Error('Missing Mac allocator job inventory')
  const matches = jobs.filter((job) => job.name === MAC_COHORT_ALLOCATOR_NAME)
  if (matches.length > 1) throw new Error('Mac cohort has ambiguous allocator jobs')
  if (!matches.length) return null
  const job = matches[0]
  if (
    !Number.isSafeInteger(job.id) || job.id <= 0 ||
    job.run_id !== identity.runId || job.run_attempt !== identity.runAttempt ||
    !['queued', 'in_progress', 'completed'].includes(job.status) ||
    (job.status !== 'completed' && job.conclusion !== null)
  )
    throw new Error('Mac cohort allocator is not an exact current-attempt job')
  if (job.status === 'completed' && job.conclusion !== 'success')
    throw new Error('Mac cohort allocator did not succeed')
  return job
}

export function selectMacHostAllocatorJob(jobs, identity) {
  const job = observeAllocatorJob(jobs, identity)
  if (job?.status !== 'in_progress')
    throw new Error('Mac cohort requires its unique active current-attempt allocator job')
  return job.id
}

function requireDeadline(deadlineMs, now) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= now())
    throw new Error('Mac cohort coordination deadline expired or invalid')
}

export function macHostCohortCoordinationDeadline(mode, workDeadlineMs, now = Date.now()) {
  const limits = { start: 60_000, ready: Infinity, 'ready-active': 180_000, claim: 120_000, allocate: Infinity }
  if (!Object.hasOwn(limits, mode) || !Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(workDeadlineMs))
    throw new Error('Invalid Mac cohort coordination mode or time')
  const deadline = Math.min(workDeadlineMs, now + limits[mode])
  requireDeadline(deadline, () => now)
  return deadline
}

function recordFor(records, type, identity, worker) {
  const name = macHostCohortArtifactName(type, identity, worker)
  return records.find((entry) => entry.artifact.name === name)
}

function sameArtifact(left, right) {
  return ['id', 'name', 'digest'].every((field) => left?.[field] === right?.[field])
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const skippedWorkerMatrixName =
  "matrix.guard && 'Enforce Mac PR deadline' || (github.event_name == 'pull_request' && format('Native host worker — {0} / {1}', matrix.arch, matrix.worker) || format('Native host shard — {0} / 0', matrix.arch))"

export function macHostCohortPollDelay(lastArrival, now = Date.now()) {
  if (!Number.isSafeInteger(lastArrival) || !Number.isSafeInteger(now) || lastArrival > now)
    throw new Error('Invalid Mac cohort polling time')
  return now - lastArrival >= 60_000 ? 60_000 : 5000
}

export function requireMacHostAllocationProgress(jobs, identity, allocatorJobId) {
  if (selectMacHostAllocatorJob(jobs, identity) !== allocatorJobId)
    throw new Error('Mac cohort allocator job changed')
  for (const job of jobs.filter((job) =>
    job.name?.startsWith('Native host worker — arm64 / ') ||
    [
      MAC_COHORT_READY_JOB_NAME,
      'Enforce Mac PR deadline', 'prerequisites', skippedWorkerMatrixName,
    ].includes(job.name),
  ))
    if (job.status === 'completed' && job.conclusion !== 'success')
      throw new Error('Mac cohort prerequisite or worker did not succeed before allocation completed')
}

async function pollPause(deadlineMs, now, sleep, milliseconds = 5000) {
  requireDeadline(deadlineMs, now)
  await sleep(Math.min(milliseconds, deadlineMs - now()))
  requireDeadline(deadlineMs, now)
}

function jobReader(readJobs, now, refreshMs = 60_000) {
  let checked = -Infinity
  let cached
  return async (force = false, deadlineMs) => {
    if (force || now() - checked >= refreshMs) {
      cached = await readJobs(deadlineMs)
      checked = now()
    }
    return cached
  }
}

/** Job metadata can lag the running process; no readiness is published while waiting. */
export async function waitForMacHostAllocatorStart({
  identity, readJobs, deadlineMs, pollIntervalMs = 5000,
}) {
  const deadline = macHostCohortCoordinationDeadline('start', deadlineMs)
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0 || pollIntervalMs > 5000)
    throw new Error('Invalid Mac allocator startup polling interval')
  let jobId
  let status = 'missing'
  let previous
  const requireTime = () => {
    if (Date.now() >= deadline)
      throw new Error(`Mac allocator startup deadline expired (status=${status}, job=${jobId ?? 'missing'})`)
  }
  for (;;) {
    requireTime()
    const job = observeAllocatorJob(await readJobs(deadline), identity)
    status = job?.status ?? 'missing'
    if (job) {
      if (jobId !== undefined && jobId !== job.id)
        throw new Error('Mac cohort allocator identity changed before startup')
      jobId = job.id
    }
    requireTime()
    if (status === 'completed') throw new Error('Mac cohort allocator completed before startup')
    if (status === 'in_progress') return jobId
    const observed = `status=${status}, job=${jobId ?? 'missing'}`
    if (observed !== previous) {
      console.error(`Waiting for Mac allocator metadata (${observed})`)
      previous = observed
    }
    await pause(Math.min(pollIntervalMs, deadline - Date.now()))
  }
}

async function publishRecord(artifacts, name, record, deadlineMs, now) {
  requireDeadline(deadlineMs, now)
  // A failed or ambiguous upload ends this command. Never retry ownership or
  // issue a different role after an upload might have reached the backend.
  const artifact = await artifacts.upload(name, record)
  requireDeadline(deadlineMs, now)
  return { artifact, record }
}

/** Cache immutable payloads, but revalidate the complete current listing. */
export function macHostCohortRecordReader({ identity, listArtifacts, download }) {
  const suffix = `-${identity.sourceRevision}-r${identity.runId}-a${identity.runAttempt}`
  const cached = new Map()
  return async () => {
    const listing = await listArtifacts()
    if (!Array.isArray(listing)) throw new Error('Missing Mac cohort artifact inventory')
    const selected = listing.filter((artifact) =>
      /^macos-cohort-(?:ready|announcement|assignment|ledger)-/.test(artifact.name ?? '') &&
      artifact.name.endsWith(suffix),
    )
    if (
      new Set(selected.map(({ id }) => id)).size !== selected.length ||
      new Set(selected.map(({ name }) => name)).size !== selected.length
    )
      throw new Error('Mac cohort has duplicate record artifacts')
    const records = []
    for (const artifact of selected) {
      const signature = JSON.stringify([
        artifact.id, artifact.name, artifact.digest, artifact.size_in_bytes, artifact.expired,
      ])
      let stored = cached.get(artifact.id)
      if (stored && stored.signature !== signature)
        throw new Error('Mac cohort immutable artifact metadata changed')
      if (!stored) {
        stored = { signature, record: await download(artifact) }
        cached.set(artifact.id, stored)
      }
      records.push({ artifact, record: stored.record })
    }
    return records
  }
}

/** A short Linux gate releases Mac workers only after their allocator is active. */
export async function waitForMacHostAllocator({
  identity, readJobs, readRecords, deadlineMs, pollIntervalMs = 5000, metadataRefreshMs = 60_000,
}) {
  const now = Date.now
  const deadline = macHostCohortCoordinationDeadline('ready', deadlineMs, now())
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0 || pollIntervalMs > 60_000)
    throw new Error('Invalid Mac readiness polling interval')
  if (!Number.isSafeInteger(metadataRefreshMs) || metadataRefreshMs <= 0 || metadataRefreshMs > 60_000)
    throw new Error('Invalid Mac readiness metadata refresh interval')
  const jobs = jobReader(readJobs, now, metadataRefreshMs)
  let allocatorJobId
  let activeDeadline
  for (;;) {
    const currentDeadline = activeDeadline ?? deadline
    requireDeadline(currentDeadline, now)
    const allocator = observeAllocatorJob(await jobs(false, currentDeadline), identity)
    if (allocator) {
      if (allocatorJobId !== undefined && allocatorJobId !== allocator.id)
        throw new Error('Mac cohort allocator changed during readiness')
      allocatorJobId = allocator.id
    }
    if (allocator?.status === 'completed')
      throw new Error('Mac cohort allocator completed before worker readiness')
    if (allocator?.status === 'in_progress') {
      activeDeadline ??= macHostCohortCoordinationDeadline('ready-active', deadline, now())
      const records = validateMacHostCohortRecords({
        identity, allocatorJobId: allocator.id, records: await readRecords(),
      })
      const ready = recordFor(records, 'ready', identity)
      if (ready) {
        // Recheck immediately before granting readiness; cached liveness alone
        // cannot release the workers after the allocator has stopped.
        if (selectMacHostAllocatorJob(await jobs(true, activeDeadline), identity) !== allocator.id)
          throw new Error('Mac cohort allocator changed during readiness')
        requireDeadline(activeDeadline, now)
        return ready
      }
    }
    await pollPause(activeDeadline ?? deadline, now, pause, pollIntervalMs)
  }
}

/** One Ubuntu process assigns roles; workers never wait for queued Mac peers. */
export async function allocateMacHostRoles({
  identity, artifacts, readJobs, readRecords, deadlineMs,
}) {
  const now = Date.now
  requireDeadline(deadlineMs, now)
  const jobs = jobReader(readJobs, now)
  const allocatorJobId = await waitForMacHostAllocatorStart({
    identity, readJobs: (deadline) => jobs(true, deadline), deadlineMs,
  })
  const ready = await publishRecord(
    artifacts,
    macHostCohortArtifactName('ready', identity),
    createMacHostCohortReady({ identity, allocatorJobId }),
    deadlineMs,
    now,
  )
  const assignments = []
  const announced = new Map()
  let lastArrival = now()
  for (;;) {
    requireDeadline(deadlineMs, now)
    const observedJobs = await jobs()
    requireMacHostAllocationProgress(observedJobs, identity, allocatorJobId)
    const records = validateMacHostCohortRecords({
      identity, allocatorJobId, records: await readRecords(),
    })
    for (const entry of [ready, ...assignments]) {
      const listed = records.find((record) => record.artifact.name === entry.artifact.name)
      if (listed && !sameArtifact(listed.artifact, entry.artifact))
        throw new Error('Mac cohort has a foreign allocator record')
    }
    for (const entry of records)
      if (
        (entry.artifact.name.startsWith('macos-cohort-assignment-') &&
          !assignments.some((assigned) => sameArtifact(assigned.artifact, entry.artifact))) ||
        entry.artifact.name === macHostCohortArtifactName('ledger', identity)
      )
        throw new Error('Mac cohort has an unexpected assignment or ledger')
    const pending = Array.from({ length: MAC_PR_COHORT.workers }, (_, worker) =>
      recordFor(records, 'announcement', identity, worker),
    ).filter((entry) => entry && !announced.has(entry.record.worker))
    if (pending.length) {
      const activeJobs = await jobs(true)
      requireMacHostAllocationProgress(activeJobs, identity, allocatorJobId)
      for (const announcement of pending) {
        const worker = announcement.record.worker
        if (selectMacHostWorkerJob(activeJobs, { ...identity, worker }) !== announcement.record.jobId)
          throw new Error('Mac cohort announcement belongs to another worker job')
        const record = createMacHostCohortAssignment({
          identity, allocatorJobId, announcement, assignments,
        })
        const assigned = await publishRecord(
          artifacts, macHostCohortArtifactName('assignment', identity, worker),
          record, deadlineMs, now,
        )
        assignments.push(assigned)
        announced.set(worker, announcement)
      }
      lastArrival = now()
    }
    for (const [worker, previous] of announced) {
      const current = recordFor(records, 'announcement', identity, worker)
      if (current && !sameArtifact(current.artifact, previous.artifact))
        throw new Error('Mac cohort worker announcement changed')
    }
    if (assignments.length === MAC_PR_COHORT.workers) {
      const ledger = await publishRecord(
        artifacts,
        macHostCohortArtifactName('ledger', identity),
        createMacHostCohortLedger({ identity, allocatorJobId, ready, assignments }),
        deadlineMs,
        now,
      )
      return { allocatorJobId, ready, assignments, ledger }
    }
    await pollPause(deadlineMs, now, pause, macHostCohortPollDelay(lastArrival, now()))
  }
}

/** Publish one announcement and await only this worker's allocator decision. */
export async function awaitMacHostRole({
  identity, prerequisites, artifacts, readJobs, readRecords, deadlineMs,
}) {
  const now = Date.now
  const run = Object.fromEntries(
    ['sourceRevision', 'runId', 'runAttempt'].map((field) => [field, identity[field]]),
  )
  const deadline = macHostCohortCoordinationDeadline('claim', deadlineMs, now())
  requireDeadline(deadline, now)
  const jobs = jobReader(readJobs, now)
  const initialJobs = await jobs()
  if (selectMacHostWorkerJob(initialJobs, identity) !== identity.jobId)
    throw new Error('Mac cohort worker job changed')
  const allocatorJobId = selectMacHostAllocatorJob(initialJobs, identity)
  const records = validateMacHostCohortRecords({
    identity: run, allocatorJobId, records: await readRecords(),
  })
  const ready = recordFor(records, 'ready', run)
  if (!ready) throw new Error('Mac cohort worker has no verified allocator readiness')
  if (recordFor(records, 'announcement', run, identity.worker) ||
      recordFor(records, 'assignment', run, identity.worker))
    throw new Error('Mac cohort worker already announced or received an assignment')
  const announcement = await publishRecord(
    artifacts,
    macHostCohortArtifactName('announcement', run, identity.worker),
    createMacHostCohortAnnouncement({ identity, allocatorJobId, prerequisites }),
    deadline,
    now,
  )
  for (;;) {
    requireDeadline(deadline, now)
    const allocator = observeAllocatorJob(await jobs(), identity)
    if (!allocator || allocator.id !== allocatorJobId || allocator.status === 'queued')
      throw new Error('Mac cohort active allocator disappeared or changed')
    const current = validateMacHostCohortRecords({
      identity: run, allocatorJobId, records: await readRecords(),
    })
    for (const entry of [ready, announcement]) {
      const listed = current.find((record) => record.artifact.name === entry.artifact.name)
      if (listed && !sameArtifact(listed.artifact, entry.artifact))
        throw new Error('Mac cohort worker record changed')
    }
    const assignment = recordFor(current, 'assignment', run, identity.worker)
    if (assignment) {
      const receipt = createMacHostCohortWorkerReceipt({
        identity, allocatorJobId, ready, announcement, assignment, prerequisites,
      })
      requireDeadline(deadline, now)
      return receipt
    }
    await pollPause(deadline, now, pause)
  }
}

const maxMetadataBytes = 4 * 1024 * 1024

async function githubMetadataPage(
  environment, suffix, key, deadlineMs,
  { apiOrigin = 'https://api.github.com', maxBytes = maxMetadataBytes } = {},
) {
  const repository = environment.GITHUB_REPOSITORY
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') ||
      repository.split('/').some((part) => part === '.' || part === '..') || !environment.GH_TOKEN)
    throw new Error('Mac cohort requires repository-scoped Actions read access')
  const origin = new URL(apiOrigin)
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
      (origin.protocol !== 'https:' && !(origin.protocol === 'http:' &&
        ['127.0.0.1', '[::1]'].includes(origin.hostname))))
    throw new Error('Invalid Mac cohort metadata API origin')
  const remaining = deadlineMs - Date.now()
  if (!Number.isSafeInteger(remaining) || remaining <= 0)
    throw new Error('Mac cohort metadata deadline expired or invalid')
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > maxMetadataBytes)
    throw new Error('Mac cohort metadata byte allowance expired or invalid')
  let response
  try {
    response = await fetch(`${origin.origin}/repos/${repository}/${suffix}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(Math.min(10_000, remaining)),
      headers: {
        Authorization: `Bearer ${environment.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  } catch {
    throw new Error(`Mac cohort ${key} metadata request failed (network or timeout)`)
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    const details = { status: response.status }
    for (const name of ['x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after']) {
      const value = response.headers.get(name)
      if (/^[0-9]{1,15}$/.test(value ?? '')) details[name] = Number(value)
    }
    throw new Error(`Mac cohort ${key} metadata request failed: ${JSON.stringify(details)}`)
  }
  const chunks = []
  let bytes = 0
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength
      if (bytes > maxBytes) throw new Error('Oversized metadata')
      chunks.push(chunk)
    }
  } catch {
    throw new Error(`Mac cohort ${key} metadata body exceeded its byte or time allowance`)
  }
  let result
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new Error(`Mac cohort ${key} metadata response was not valid JSON`) }
  if (
    !Number.isSafeInteger(result?.total_count) ||
    result.total_count < 0 ||
    !Array.isArray(result[key]) ||
    result[key].length > 100
  )
    throw new Error('Mac cohort refuses an incomplete metadata inventory')
  return { result, bytes }
}

async function githubMetadata(environment, suffix, key, deadlineMs) {
  const { result } = await githubMetadataPage(environment, suffix, key, deadlineMs)
  if (result.total_count > 100 || result[key].length !== result.total_count)
    throw new Error('Mac cohort refuses an incomplete metadata inventory')
  return result[key]
}

/** Retained earlier attempts may span pages; current-attempt selection follows a complete read. */
export async function listMacHostCohortArtifacts(environment, identity, deadlineMs, { apiOrigin } = {}) {
  const runId = positiveInteger(identity?.runId, 'artifact run ID')
  requireDeadline(deadlineMs, Date.now)
  const deadline = Math.min(deadlineMs, Date.now() + 30_000)
  let remainingBytes = maxMetadataBytes
  for (let pass = 0; pass < 3; pass++) {
    const artifacts = []
    const ids = new Set()
    let total
    let changed = false
    for (let page = 1; page <= 10; page++) {
      const { result, bytes } = await githubMetadataPage(
        environment, `actions/runs/${runId}/artifacts?per_page=100&page=${page}`,
        'artifacts', deadline, { apiOrigin, maxBytes: remainingBytes },
      )
      remainingBytes -= bytes
      requireDeadline(deadline, Date.now)
      if (result.total_count > 1000)
        throw new Error('Mac cohort artifact inventory exceeds its 1000-artifact bound')
      const expected = Math.min(100, Math.max(0, result.total_count - (page - 1) * 100))
      if (result.artifacts.length !== expected)
        throw new Error('Mac cohort refuses an incomplete artifact inventory page')
      const pageIds = new Set()
      for (const artifact of result.artifacts) {
        if (!Number.isSafeInteger(artifact?.id) || artifact.id <= 0 ||
            typeof artifact.name !== 'string' || !artifact.name || pageIds.has(artifact.id))
          throw new Error('Mac cohort artifact inventory has malformed or duplicate identities')
        pageIds.add(artifact.id)
      }
      if (total !== undefined && result.total_count !== total) {
        changed = true
        break
      }
      total = result.total_count
      for (const artifact of result.artifacts) {
        if (ids.has(artifact.id))
          throw new Error('Mac cohort artifact inventory repeats an artifact across pages')
        ids.add(artifact.id)
        artifacts.push(artifact)
      }
      if (artifacts.length === total) return artifacts
    }
    if (!changed || pass === 2)
      throw new Error('Mac cohort artifact inventory did not stabilize within its bounded pagination passes')
    await pollPause(deadline, Date.now, pause, 1000 * (pass + 1))
  }
}

async function currentJobs(environment, identity, deadlineMs) {
  return githubMetadata(
    environment,
    `actions/runs/${identity.runId}/attempts/${identity.runAttempt}/jobs?per_page=100`,
    'jobs',
    deadlineMs,
  )
}

/** Retain only validated optional timing fields, never the remote job payload. */
export function macHostCohortJobTimings({ identity, workers, jobs }) {
  return workers.flatMap(({ worker, jobId }) => {
    const name = macHostCohortWorkerName(worker)
    const matches = jobs.filter((job) => job?.id === jobId || job?.name === name)
    if (matches.length !== 1) return []
    const job = matches[0]
    if (
      job.id !== jobId ||
      job.name !== name ||
      job.run_id !== identity.runId ||
      job.run_attempt !== identity.runAttempt ||
      job.status !== 'completed' ||
      job.conclusion !== 'success'
    )
      return []
    const timestamps = ['created_at', 'started_at', 'completed_at'].map((field) => {
      const value = job[field]
      if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
      )
        return null
      const epoch = Date.parse(value)
      if (!Number.isFinite(epoch)) return null
      const normalized = new Date(epoch).toISOString()
      return normalized === value || normalized.replace('.000Z', 'Z') === value
        ? normalized
        : null
    })
    if (
      timestamps.some((value) => value === null) ||
      timestamps[0] > timestamps[1] ||
      timestamps[1] > timestamps[2]
    )
      return []
    return [
      {
        id: jobId,
        name,
        run_id: identity.runId,
        run_attempt: identity.runAttempt,
        status: 'completed',
        conclusion: 'success',
        created_at: timestamps[0],
        started_at: timestamps[1],
        completed_at: timestamps[2],
      },
    ]
  })
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
  records,
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
    const receipt = readMacHostCohortRecord(join(directory, 'worker.json'))
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
  const assignment = validateMacHostCohort({ identity, workers, records, jobs })
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

/** Retain an already validated allocator decision before explaining its pending work. */
export async function retainMacHostWorkerAssignment(receipt, environment) {
  await writeFile(
    join(environment.RUNNER_TEMP, 'mac-evidence/worker.json'),
    `${JSON.stringify(receipt)}\n`,
    { flag: 'wx' },
  )
  await outputs(environment, {
    execute: receipt.role !== null,
    role: receipt.role ?? 'surplus',
    installed: receipt.role === MAC_PR_COHORT.shards - 1,
  })
  const duties =
    receipt.role === 0
      ? 'source tests plus native prerequisites'
      : receipt.role === MAC_PR_COHORT.shards - 1
        ? 'source tests plus installed consumers and native client startup'
        : 'source tests'
  const assignment =
    receipt.role === null
      ? 'Status: **surplus**. No test role is assigned.\n' +
        'Test steps are inapplicable on this worker and provide no execution credit.\n' +
        'Full coverage is checked later from the required role reports.'
      : `Assigned role: **${receipt.role}**. Assigned work: ${duties}.\n` +
        'Execution is pending. This assignment provides no execution credit.'
  const { arch, kernel, build, bun, revision } = receipt.profile
  const summary =
    `### Mac worker ${receipt.worker} assignment\n\n` +
    'Physical worker numbers identify runner jobs. Logical role numbers identify assigned test partitions.\n\n' +
    `${assignment}\n\n` +
    `Observed host: \`${arch}\` Darwin \`${kernel}\` build \`${build}\`, Bun \`${bun}\` (\`${revision}\`).\n\n`
  console.log(
    JSON.stringify({ worker: receipt.worker, role: receipt.role, profile: receipt.profile }),
  )
  console.error(summary)
  if (environment.GITHUB_STEP_SUMMARY)
    await appendFile(environment.GITHUB_STEP_SUMMARY, summary).catch(() => {
      console.error('Mac worker assignment summary is unavailable.')
    })
}

async function main(mode, environment) {
  const enteredAt = Date.now()
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
  if (event !== 'pull_request' || !['allocate', 'ready', 'claim', 'reconcile'].includes(mode))
    throw new Error('usage: macos-host-cohort-run.mjs plan|allocate|ready|claim|reconcile')
  const identity = runIdentity(environment)
  const scratch = environment.RUNNER_TEMP
  if (!isAbsolute(scratch ?? '')) throw new Error('Mac cohort requires absolute runner scratch')
  const deadlineMs = mode === 'reconcile'
    ? positiveInteger(environment.JIG_PR_DEADLINE_EPOCH_MS, 'final deadline')
    : macHostCohortCoordinationDeadline(
      mode, positiveInteger(environment.JIG_PR_WORK_DEADLINE_EPOCH_MS, 'work deadline'), enteredAt,
    )
  const readJobs = (deadline = deadlineMs) => currentJobs(environment, identity, Math.min(deadline, deadlineMs))
  const readRecords = macHostCohortRecordReader({
    identity,
    listArtifacts: () => listMacHostCohortArtifacts(environment, identity, deadlineMs),
    download: (artifact) => downloadMacHostCohortRecord(environment.GITHUB_REPOSITORY, artifact, {
      token: environment.GH_TOKEN, deadlineMs,
    }),
  })
  if (mode === 'ready' || mode === 'allocate') {
    if (mode === 'ready') {
      const ready = await waitForMacHostAllocator({
        identity, readJobs, readRecords, deadlineMs,
      })
      console.log(JSON.stringify({ allocatorJobId: ready.record.allocatorJobId, ready: true }))
    } else {
      const artifacts = await loadMacHostCohortArtifacts(join(scratch, 'mac-cohort-client'), scratch)
      const allocation = await allocateMacHostRoles({
        identity, artifacts, readJobs, readRecords, deadlineMs,
      })
      console.log(JSON.stringify({
        allocatorJobId: allocation.allocatorJobId,
        workers: allocation.assignments.map(({ record }) => ({ worker: record.worker, role: record.role })),
      }))
    }
    return
  }
  if (mode === 'claim') {
    const worker = workerIndex(environment.MAC_HOST_WORKER)
    const jobId = selectMacHostWorkerJob(await readJobs(), { ...identity, worker })
    const prerequisites = readMacHostPrerequisites(
      join(scratch, 'mac-evidence/prerequisites.json'),
      'arm64',
    )
    const artifacts = await loadMacHostCohortArtifacts(join(scratch, 'mac-cohort-client'), scratch)
    const receipt = await awaitMacHostRole({
      identity: { ...identity, worker, jobId },
      prerequisites,
      artifacts,
      readJobs,
      readRecords,
      deadlineMs,
    })
    await retainMacHostWorkerAssignment(receipt, environment)
    return
  }
  const jobs = await readJobs()
  const records = await readRecords()
  const assignment = await reconcileMacHostCohortReports({
    identity,
    evidenceDirectory: join(scratch, 'macos-workers'),
    normalizedDirectory: join(scratch, 'macos-evidence'),
    bundleDirectory: join(scratch, 'macos-host-artifacts'),
    records,
    jobs,
  })
  await writeFile(join(scratch, 'mac-cohort.json'), `${JSON.stringify(assignment, null, 2)}\n`)
  const timings = macHostCohortJobTimings({ identity, workers: assignment.workers, jobs })
  await writeFile(join(scratch, 'mac-job-timings.json'), `${JSON.stringify(timings)}\n`)
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
