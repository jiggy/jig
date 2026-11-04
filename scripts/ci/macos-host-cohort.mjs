import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { MAC_HOST_PROFILES, requireMacHostPrerequisites } from './macos-host-profiles.mjs'

// One already-running Linux allocator owns every role decision. Artifact names
// are identities, never locks: the service can accept duplicates across jobs.
export const MAC_PR_COHORT = Object.freeze({ workers: 5, shards: 3 })
// Give the installed tail the first ready matching host. Logical role ownership
// and the complete source-pinned file plans remain unchanged.
export const MAC_PR_COHORT_ROLE_ORDER = Object.freeze([2, 0, 1])
export const MAC_COHORT_ARTIFACT_CLIENT_VERSION = '2.3.2'
export const MAC_COHORT_ALLOCATOR_NAME = 'Allocate exact-profile Mac roles'
export const MAC_COHORT_READY_JOB_NAME = 'Prepare Mac inputs and confirm allocator readiness'
export const MAC_COHORT_GUARD_JOB_NAME = 'Enforce Mac PR deadline'
const PROFILE_FIELDS = ['arch', 'kernel', 'build', 'bun', 'revision']
const RUN_FIELDS = ['sourceRevision', 'runId', 'runAttempt']
const WORKER_FIELDS = [...RUN_FIELDS, 'worker', 'jobId']
const OWNER_FIELDS = [...WORKER_FIELDS, 'allocatorJobId']
const ARTIFACT_FIELDS = ['id', 'name', 'digest']
const KINDS = Object.freeze({
  ready: 'macos-host-cohort-ready/1',
  announcement: 'macos-host-cohort-announcement/1',
  assignment: 'macos-host-cohort-assignment/1',
  ledger: 'macos-host-cohort-ledger/1',
})
const WORKER_KIND = 'macos-host-cohort-worker/2'
const MAX_RECORD_BYTES = 8192
const MAX_RECORD_ARCHIVE_BYTES = 16_384

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Invalid Mac cohort ${label}`)
  return value
}

function requireFields(value, fields, label) {
  requireObject(value, label)
  if (Object.keys(value).sort().join('\n') !== [...fields].sort().join('\n'))
    throw new Error(`Unexpected Mac cohort ${label} fields`)
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`Invalid Mac cohort ${label}`)
}

function requireRun(identity) {
  requireObject(identity, 'run identity')
  if (!/^[0-9a-f]{40}$/.test(identity.sourceRevision ?? ''))
    throw new Error('Invalid Mac cohort source revision')
  requirePositiveInteger(identity.runId, 'run ID')
  requirePositiveInteger(identity.runAttempt, 'run attempt')
}

function requireWorker(identity) {
  requireRun(identity)
  macHostCohortWorkerName(identity.worker)
  requirePositiveInteger(identity.jobId, 'job ID')
}

function requireAllocatorIdentity(identity, allocatorJobId) {
  requireFields(identity, RUN_FIELDS, 'run identity')
  requireRun(identity)
  requirePositiveInteger(allocatorJobId, 'allocator job ID')
}

function sameFields(left, right, fields) {
  return fields.every((field) => left[field] === right[field])
}

export function requireMacHostCohortProfiles(profiles = MAC_HOST_PROFILES.arm64) {
  if (
    !Array.isArray(profiles) ||
    profiles.length !== 2 ||
    new Set(
      profiles.map((profile) =>
        JSON.stringify(['kernel', 'build', 'bun', 'revision'].map((field) => profile?.[field])),
      ),
    ).size !== 2
  )
    throw new Error('The five-worker Mac cohort requires exactly two distinct ARM profiles')
  return profiles
}

function requireProfile(profile) {
  requireFields(profile, PROFILE_FIELDS, 'profile')
  if (
    profile.arch !== 'arm64' ||
    !requireMacHostCohortProfiles().some((expected) =>
      ['kernel', 'build', 'bun', 'revision'].every((field) => profile[field] === expected[field]),
    )
  )
    throw new Error('Mac cohort profile is not an exact admitted ARM host')
  return profile
}

export function macHostCohortProfile(prerequisites) {
  requireMacHostCohortProfiles()
  requireMacHostPrerequisites(prerequisites, 'arm64')
  return Object.fromEntries(PROFILE_FIELDS.map((field) => [field, prerequisites[field]]))
}

export function macHostProfileKey(profile) {
  requireProfile(profile)
  return createHash('sha256')
    .update(JSON.stringify(PROFILE_FIELDS.map((field) => profile[field])))
    .digest('hex')
}

export function macHostCohortWorkerName(worker) {
  if (!Number.isInteger(worker) || worker < 0 || worker >= MAC_PR_COHORT.workers)
    throw new Error('Invalid Mac cohort worker index')
  return `Native host worker — arm64 / ${worker}`
}

export function macHostCohortArtifactName(type, identity, worker) {
  requireRun(identity)
  if (!Object.hasOwn(KINDS, type)) throw new Error('Unknown Mac cohort record type')
  const ownsWorker = type === 'announcement' || type === 'assignment'
  if (ownsWorker) macHostCohortWorkerName(worker)
  else if (worker !== undefined) throw new Error('Mac coordinator record cannot name a worker')
  return `macos-cohort-${type}${ownsWorker ? `-${worker}` : ''}-${identity.sourceRevision}-r${identity.runId}-a${identity.runAttempt}`
}

function artifactDigest(value) {
  if (typeof value !== 'string' || !/^(?:sha256:)?[0-9a-f]{64}$/.test(value))
    throw new Error('Invalid Mac cohort artifact digest')
  return value.startsWith('sha256:') ? value : `sha256:${value}`
}

function requireArtifact(artifact, name) {
  requireObject(artifact, 'artifact')
  requirePositiveInteger(artifact.id, 'artifact ID')
  if (artifact.name !== name || artifact.expired === true)
    throw new Error('Mac cohort artifact name or expiry does not match')
  return { id: artifact.id, name, digest: artifactDigest(artifact.digest) }
}

function artifactReference(artifact, name) {
  requireFields(artifact, ARTIFACT_FIELDS, 'artifact reference')
  return requireArtifact(artifact, name)
}

function sameArtifact(left, right) {
  return sameFields(left, right, ARTIFACT_FIELDS)
}

function recordType(record) {
  requireObject(record, 'record')
  const type = Object.keys(KINDS).find((name) => KINDS[name] === record.kind)
  if (!type) throw new Error('Unknown Mac cohort record kind')
  return type
}

function requireRecord(record, identity, allocatorJobId) {
  const type = recordType(record)
  const fields = ['kind', ...RUN_FIELDS, 'allocatorJobId']
  if (type === 'announcement' || type === 'assignment') fields.push('worker', 'jobId', 'profile')
  if (type === 'assignment') fields.push('role', 'announcementArtifact')
  if (type === 'ledger') fields.push('readyArtifact', 'assignmentArtifacts')
  requireFields(record, fields, 'record')
  requireRun(record)
  requirePositiveInteger(record.allocatorJobId, 'allocator job ID')
  if (!sameFields(record, identity, RUN_FIELDS) || record.allocatorJobId !== allocatorJobId)
    throw new Error('Mac cohort record has a foreign source, run, attempt or allocator')
  if (type === 'announcement' || type === 'assignment') {
    requireWorker(record)
    requireProfile(record.profile)
    if (record.jobId === allocatorJobId) throw new Error('Allocator cannot own a Mac worker')
  }
  if (type === 'assignment') {
    if (
      record.role !== null &&
      (!Number.isInteger(record.role) || record.role < 0 || record.role >= MAC_PR_COHORT.shards)
    )
      throw new Error('Invalid Mac cohort role')
    artifactReference(
      record.announcementArtifact,
      macHostCohortArtifactName('announcement', identity, record.worker),
    )
  }
  if (type === 'ledger') {
    artifactReference(record.readyArtifact, macHostCohortArtifactName('ready', identity))
    if (
      !Array.isArray(record.assignmentArtifacts) ||
      record.assignmentArtifacts.length !== MAC_PR_COHORT.workers
    )
      throw new Error('Mac cohort ledger requires five assignments')
    const names = new Set(
      Array.from({ length: MAC_PR_COHORT.workers }, (_, worker) =>
        macHostCohortArtifactName('assignment', identity, worker),
      ),
    )
    const ids = new Set()
    for (const artifact of record.assignmentArtifacts) {
      artifactReference(artifact, artifact.name)
      if (!names.delete(artifact.name) || ids.has(artifact.id))
        throw new Error('Mac cohort ledger repeats or invents an assignment')
      ids.add(artifact.id)
    }
  }
  return type
}

/** Validate partial listings without requiring referenced records to be visible yet. */
export function validateMacHostCohortRecords({ identity, allocatorJobId, records }) {
  requireAllocatorIdentity(identity, allocatorJobId)
  if (!Array.isArray(records)) throw new Error('Missing Mac cohort record inventory')
  const names = new Set()
  const ids = new Set()
  return records.map((entry) => {
    const type = requireRecord(entry?.record, identity, allocatorJobId)
    const name = macHostCohortArtifactName(
      type,
      identity,
      type === 'announcement' || type === 'assignment' ? entry.record.worker : undefined,
    )
    const artifact = requireArtifact(entry.artifact, name)
    if (names.has(name) || ids.has(artifact.id))
      throw new Error('Mac cohort repeats a published record name or artifact ID')
    names.add(name)
    ids.add(artifact.id)
    return { artifact, record: entry.record }
  })
}

function typedEnvelope(type, entry, identity, allocatorJobId) {
  const [normalized] = validateMacHostCohortRecords({ identity, allocatorJobId, records: [entry] })
  if (normalized.record.kind !== KINDS[type]) throw new Error(`Expected Mac cohort ${type} record`)
  return normalized
}

function assignmentSequence(assignments, identity, allocatorJobId) {
  const entries = validateMacHostCohortRecords({ identity, allocatorJobId, records: assignments })
  const workers = new Set()
  const jobIds = new Set()
  const counts = new Map()
  for (const { record } of entries) {
    if (record.kind !== KINDS.assignment || workers.has(record.worker) || jobIds.has(record.jobId))
      throw new Error('Mac cohort assignment sequence repeats or changes a worker')
    const profile = macHostProfileKey(record.profile)
    const count = counts.get(profile) ?? 0
    if (record.role !== (MAC_PR_COHORT_ROLE_ORDER[count] ?? null))
      throw new Error('Mac cohort assignment sequence changes an owned role or invents surplus')
    counts.set(profile, count + 1)
    workers.add(record.worker)
    jobIds.add(record.jobId)
  }
  return entries
}

export function createMacHostCohortReady({ identity, allocatorJobId }) {
  requireAllocatorIdentity(identity, allocatorJobId)
  requireMacHostCohortProfiles()
  return { kind: KINDS.ready, ...identity, allocatorJobId }
}

export function createMacHostCohortAnnouncement({ identity, allocatorJobId, prerequisites }) {
  requireFields(identity, WORKER_FIELDS, 'worker identity')
  requireWorker(identity)
  requirePositiveInteger(allocatorJobId, 'allocator job ID')
  if (identity.jobId === allocatorJobId) throw new Error('Allocator cannot own a Mac worker')
  return {
    kind: KINDS.announcement,
    ...identity,
    allocatorJobId,
    profile: macHostCohortProfile(prerequisites),
  }
}

/** Only the singleton allocator calls this, after each earlier upload succeeds. */
export function createMacHostCohortAssignment({
  identity,
  allocatorJobId,
  announcement,
  assignments,
}) {
  const owner = typedEnvelope('announcement', announcement, identity, allocatorJobId)
  const previous = assignmentSequence(assignments, identity, allocatorJobId)
  if (
    previous.some(
      ({ record }) => record.worker === owner.record.worker || record.jobId === owner.record.jobId,
    )
  )
    throw new Error('Mac cohort worker already has an immutable assignment')
  const count = previous.filter(({ record }) =>
    sameFields(record.profile, owner.record.profile, PROFILE_FIELDS),
  ).length
  const record = owner.record
  return {
    kind: KINDS.assignment,
    ...identity,
    allocatorJobId,
    worker: record.worker,
    jobId: record.jobId,
    profile: { ...record.profile },
    role: MAC_PR_COHORT_ROLE_ORDER[count] ?? null,
    announcementArtifact: owner.artifact,
  }
}

export function createMacHostCohortLedger({ identity, allocatorJobId, ready, assignments }) {
  const start = typedEnvelope('ready', ready, identity, allocatorJobId)
  const entries = assignmentSequence(assignments, identity, allocatorJobId)
  if (entries.length !== MAC_PR_COHORT.workers)
    throw new Error('Mac cohort ledger requires all five assigned workers')
  validateMacHostCohortRecords({ identity, allocatorJobId, records: [start, ...entries] })
  return {
    kind: KINDS.ledger,
    ...identity,
    allocatorJobId,
    readyArtifact: start.artifact,
    assignmentArtifacts: entries.map(({ artifact }) => artifact),
  }
}

export function createMacHostCohortWorkerReceipt({
  identity,
  allocatorJobId,
  ready,
  announcement,
  assignment,
  prerequisites,
}) {
  requireFields(identity, WORKER_FIELDS, 'worker identity')
  requireWorker(identity)
  const run = Object.fromEntries(RUN_FIELDS.map((field) => [field, identity[field]]))
  const start = typedEnvelope('ready', ready, run, allocatorJobId)
  const observed = typedEnvelope('announcement', announcement, run, allocatorJobId)
  const assigned = typedEnvelope('assignment', assignment, run, allocatorJobId)
  validateMacHostCohortRecords({ identity: run, allocatorJobId, records: [start, observed, assigned] })
  const profile = macHostCohortProfile(prerequisites)
  if (
    !sameFields(observed.record, identity, WORKER_FIELDS) ||
    !sameFields(assigned.record, identity, WORKER_FIELDS) ||
    !sameFields(observed.record.profile, profile, PROFILE_FIELDS) ||
    !sameFields(assigned.record.profile, profile, PROFILE_FIELDS) ||
    !sameArtifact(observed.artifact, assigned.record.announcementArtifact)
  )
    throw new Error('Mac cohort assignment differs from its announced worker and profile')
  return {
    kind: WORKER_KIND,
    ...identity,
    allocatorJobId,
    profile,
    role: assigned.record.role,
    readyArtifact: start.artifact,
    announcementArtifact: observed.artifact,
    assignmentArtifact: assigned.artifact,
  }
}

function successfulJob(jobs, identity, name, expectedId) {
  const matches = jobs.filter((job) => job?.name === name)
  if (matches.length !== 1) throw new Error('Mac cohort requires one exact current-attempt job')
  const job = matches[0]
  requirePositiveInteger(job.id, 'observed job ID')
  if (
    (expectedId !== undefined && job.id !== expectedId) ||
    job.run_id !== identity.runId ||
    job.run_attempt !== identity.runAttempt ||
    job.status !== 'completed' ||
    job.conclusion !== 'success'
  )
    throw new Error('Mac cohort requires each exact current-attempt job to succeed')
  return job
}

/** Assignment evidence only: callers independently verify every executed suite. */
export function validateMacHostCohort({ identity, workers, records, jobs }) {
  requireFields(identity, RUN_FIELDS, 'run identity')
  requireRun(identity)
  requireMacHostCohortProfiles()
  if (!Array.isArray(workers) || workers.length !== MAC_PR_COHORT.workers || !Array.isArray(jobs))
    throw new Error('Mac cohort requires all five worker receipts and observed jobs')
  const allocatorJobId = successfulJob(jobs, identity, MAC_COHORT_ALLOCATOR_NAME).id
  const readyJobId = successfulJob(jobs, identity, MAC_COHORT_READY_JOB_NAME).id
  const guardJobId = successfulJob(jobs, identity, MAC_COHORT_GUARD_JOB_NAME).id
  if (
    jobs.filter((job) => job?.name?.startsWith('Native host worker — arm64 / ')).length !==
    MAC_PR_COHORT.workers
  )
    throw new Error('Mac cohort observed job inventory differs from its five workers')
  const entries = validateMacHostCohortRecords({ identity, allocatorJobId, records })
  if (entries.length !== 2 + 2 * MAC_PR_COHORT.workers)
    throw new Error('Mac cohort requires its complete ready, announcement, assignment and ledger inventory')
  const byName = new Map(entries.map((entry) => [entry.artifact.name, entry]))
  const ready = byName.get(macHostCohortArtifactName('ready', identity))
  const ledger = byName.get(macHostCohortArtifactName('ledger', identity))
  if (!ready || !ledger || !sameArtifact(ready.artifact, ledger.record.readyArtifact))
    throw new Error('Mac cohort ledger is missing or differs from allocator readiness')
  const ordered = ledger.record.assignmentArtifacts.map((reference) => {
    const entry = byName.get(reference.name)
    if (!entry || !sameArtifact(entry.artifact, reference))
      throw new Error('Mac cohort ledger differs from its published assignments')
    return entry
  })
  assignmentSequence(ordered, identity, allocatorJobId)
  const receipts = workers.map(({ receipt, prerequisites }) => {
    requireFields(
      receipt,
      ['kind', ...OWNER_FIELDS, 'profile', 'role',
        'readyArtifact', 'announcementArtifact', 'assignmentArtifact'],
      'worker receipt',
    )
    requireWorker(receipt)
    const announcement = byName.get(macHostCohortArtifactName('announcement', identity, receipt.worker))
    const assignment = byName.get(macHostCohortArtifactName('assignment', identity, receipt.worker))
    const workerIdentity = Object.fromEntries(WORKER_FIELDS.map((field) => [field, receipt[field]]))
    const expected = createMacHostCohortWorkerReceipt({
      identity: workerIdentity,
      allocatorJobId,
      ready,
      announcement,
      assignment,
      prerequisites,
    })
    requireProfile(receipt.profile)
    if (
      !sameFields(receipt, expected, ['kind', ...OWNER_FIELDS, 'role']) ||
      !sameFields(receipt, identity, RUN_FIELDS) ||
      !sameFields(receipt.profile, expected.profile, PROFILE_FIELDS) ||
      ['readyArtifact', 'announcementArtifact', 'assignmentArtifact'].some((field) =>
        !sameArtifact(artifactReference(receipt[field], expected[field].name), expected[field]),
      )
    )
      throw new Error('Mac cohort worker receipt differs from its immutable assignment')
    successfulJob(jobs, identity, macHostCohortWorkerName(receipt.worker), receipt.jobId)
    return receipt
  })
  if (
    new Set(receipts.map(({ worker }) => worker)).size !== MAC_PR_COHORT.workers ||
    new Set([allocatorJobId, readyJobId, guardJobId, ...receipts.map(({ jobId }) => jobId)]).size !==
      MAC_PR_COHORT.workers + 3
  )
    throw new Error('Mac cohort repeats a worker or job')
  const complete = requireMacHostCohortProfiles()
    .map((profile) => ({ arch: 'arm64', ...profile }))
    .map((profile) => ({
      profile,
      roles: receipts
        .filter((owner) => owner.role !== null && sameFields(owner.profile, profile, PROFILE_FIELDS))
        .sort((left, right) => left.role - right.role),
    }))
    .filter(({ roles }) =>
      roles.length === MAC_PR_COHORT.shards && roles.every((owner, role) => owner.role === role),
    )
  if (complete.length !== 1) throw new Error('Mac cohort has no unique complete exact-profile role set')
  return {
    ...identity,
    allocatorJobId,
    ledgerArtifact: ledger.artifact,
    profile: complete[0].profile,
    roles: complete[0].roles,
    workers: [...receipts].sort((left, right) => left.worker - right.worker),
  }
}

export function readMacHostCohortRecord(path) {
  if (!constants.O_NOFOLLOW || !constants.O_NONBLOCK)
    throw new Error('Mac cohort record reads require no-follow and nonblocking support')
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const metadata = fstatSync(descriptor)
    if (!metadata.isFile() || metadata.size > MAX_RECORD_BYTES)
      throw new Error('Mac cohort records require bounded regular files')
    const bytes = Buffer.alloc(MAX_RECORD_BYTES + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null)
      if (count === 0) break
      length += count
    }
    if (length > MAX_RECORD_BYTES) throw new Error('Mac cohort record exceeds its byte limit')
    return JSON.parse(bytes.subarray(0, length).toString('utf8'))
  } finally {
    closeSync(descriptor)
  }
}

function requireRecordArchiveMetadata(artifact) {
  const name = artifact?.name
  if (
    typeof name !== 'string' ||
    !/^macos-cohort-(?:ready|ledger|(?:announcement|assignment)-[0-4])-[0-9a-f]{40}-r[1-9][0-9]*-a[1-9][0-9]*$/.test(
      name,
    ) ||
    artifact.expired !== false ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    artifact.size_in_bytes <= 0 ||
    artifact.size_in_bytes > MAX_RECORD_ARCHIVE_BYTES
  )
    throw new Error('Mac cohort record archive metadata has invalid name, size or expiry')
  return requireArtifact(artifact, name)
}

const READ_RECORD_ARCHIVE = `import io, json, stat, sys, zipfile
archive = sys.stdin.buffer.read(${MAX_RECORD_ARCHIVE_BYTES + 1})
if len(archive) > ${MAX_RECORD_ARCHIVE_BYTES}:
    raise ValueError('oversized record archive')
with zipfile.ZipFile(io.BytesIO(archive)) as archive_file:
    entries = archive_file.infolist()
    if len(entries) != 1:
        raise ValueError('record archive requires exactly one entry')
    entry = entries[0]
    mode = entry.external_attr >> 16
    if (entry.filename != 'record.json' or entry.orig_filename != 'record.json'
            or entry.is_dir() or entry.external_attr & 0x10
            or stat.S_IFMT(mode) not in (0, stat.S_IFREG)
            or entry.flag_bits & (1 | 64)
            or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
            or entry.file_size < 0 or entry.file_size > ${MAX_RECORD_BYTES}):
        raise ValueError('unsafe record archive entry')
    with archive_file.open(entry) as source:
        record = source.read(${MAX_RECORD_BYTES + 1})
    if len(record) > ${MAX_RECORD_BYTES} or len(record) != entry.file_size:
        raise ValueError('oversized or incomplete record')
    json.loads(record.decode('utf-8'))
    sys.stdout.buffer.write(record)
`

/** Verify the raw transport before reading one inert ZIP member without extraction. */
export function decodeMacHostCohortRecord(bytes, artifact) {
  const metadata = requireRecordArchiveMetadata(artifact)
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > MAX_RECORD_ARCHIVE_BYTES ||
    bytes.byteLength !== artifact.size_in_bytes
  )
    throw new Error('Mac cohort record archive transport size does not match')
  const archive = Buffer.from(bytes)
  if (`sha256:${createHash('sha256').update(archive).digest('hex')}` !== metadata.digest)
    throw new Error('Mac cohort record archive transport digest does not match')
  try {
    const record = execFileSync('python3', ['-I', '-c', READ_RECORD_ARCHIVE], {
      input: archive,
      timeout: 5000,
      maxBuffer: MAX_RECORD_BYTES + 1,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return JSON.parse(record.toString('utf8'))
  } catch {
    throw new Error('Mac cohort record archive is malformed or unsafe')
  }
}

class MacRecordTransportError extends Error {
  constructor(kind, details = {}) {
    super(`Mac cohort record transport ${kind}`)
    this.kind = kind
    Object.assign(this, details)
  }
}

function recordRetryHeaders(headers) {
  const integer = (name) => {
    const value = headers.get(name)
    return /^[0-9]{1,15}$/.test(value ?? '') && Number.isSafeInteger(Number(value))
      ? Number(value) : undefined
  }
  const remaining = integer('x-ratelimit-remaining')
  const reset = integer('x-ratelimit-reset')
  const value = headers.get('retry-after')
  const date = typeof value === 'string' && value.length <= 128 ? Date.parse(value) : NaN
  const seconds = integer('retry-after')
  let retryAfterMs = seconds !== undefined ? seconds * 1000
    : Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
  if (remaining === 0 && reset !== undefined)
    retryAfterMs = Math.max(retryAfterMs ?? 0, reset * 1000 - Date.now(), 0)
  return { remaining, reset, retryAfterMs }
}

async function readMacRecordArchive(url, token, artifact, { signal, localHttp }) {
  let phase = 'api'
  for (let redirects = 0; ; redirects++) {
    let response
    try {
      response = await fetch(url, {
        redirect: 'manual', signal,
        headers: redirects === 0 ? {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        } : {},
      })
    } catch {
      throw new MacRecordTransportError(signal.aborted ? 'timeout' : 'network', { phase, retryable: true })
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel().catch(() => {})
      let next
      try {
        const location = response.headers.get('location')
        if (!location) throw new Error('Missing location')
        next = new URL(location, url)
      } catch {
        throw new MacRecordTransportError('invalid-redirect', { phase })
      }
      if (redirects >= 3 || next.username || next.password || next.hash ||
          (next.protocol !== 'https:' && !(localHttp && next.protocol === 'http:' &&
            ['127.0.0.1', '[::1]'].includes(next.hostname))))
        throw new MacRecordTransportError('invalid-redirect', { phase })
      // The API alone receives GH_TOKEN. Signed storage redirects receive no credentials.
      url = next
      phase = 'archive'
      continue
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {})
      const status = response.status
      const headers = recordRetryHeaders(response.headers)
      const rateLimited = status === 429 || (status === 403 &&
        (headers.remaining === 0 || headers.retryAfterMs !== undefined))
      const created = Date.parse(artifact.created_at)
      const fresh = Number.isFinite(created) && created <= Date.now() && Date.now() - created <= 60_000
      throw new MacRecordTransportError('http', {
        phase, status, ...headers,
        retryAfterMs: rateLimited ? headers.retryAfterMs ?? 60_000 : headers.retryAfterMs,
        retryable: rateLimited || status === 408 || (status >= 500 && status <= 599) ||
          (status === 404 && fresh),
      })
    }
    const chunks = []
    let length = 0
    try {
      if (!response.body) throw new MacRecordTransportError('missing-body', { phase })
      for await (const chunk of response.body) {
        length += chunk.byteLength
        if (length > MAX_RECORD_ARCHIVE_BYTES)
          throw new MacRecordTransportError('oversized-body', { phase })
        chunks.push(chunk)
      }
    } catch (error) {
      if (error instanceof MacRecordTransportError) throw error
      throw new MacRecordTransportError(signal.aborted ? 'timeout' : 'network', { phase, retryable: true })
    }
    return Buffer.concat(chunks)
  }
}

/** Retry only reads of one immutable artifact, within the caller's existing deadline. */
export async function downloadMacHostCohortRecord(
  repository, artifact, { token = process.env.GH_TOKEN, deadlineMs, apiOrigin = 'https://api.github.com' } = {},
) {
  if (
    typeof repository !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    repository.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error('Invalid Mac cohort record repository')
  const selected = { ...artifact }
  const metadata = requireRecordArchiveMetadata(selected)
  if (typeof token !== 'string' || !token) throw new Error('Mac cohort record download requires GH_TOKEN')
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= Date.now())
    throw new Error('Mac cohort record download deadline expired or invalid')
  const origin = new URL(apiOrigin)
  const localHttp = origin.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(origin.hostname)
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
      (origin.protocol !== 'https:' && !localHttp))
    throw new Error('Invalid Mac cohort record API origin')
  const url = new URL(`/repos/${repository}/actions/artifacts/${metadata.id}/zip`, origin)
  const deadline = Math.min(deadlineMs, Date.now() + 30_000)
  for (let attempt = 1; attempt <= 4; attempt++) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error(`Mac cohort record download deadline expired (artifact=${metadata.id})`)
    try {
      const bytes = await readMacRecordArchive(url, token, selected, {
        signal: AbortSignal.timeout(Math.min(20_000, remaining)), localHttp,
      })
      const record = decodeMacHostCohortRecord(bytes, selected)
      if (Date.now() >= deadline)
        throw new Error(`Mac cohort record download deadline expired (artifact=${metadata.id})`)
      return record
    } catch (error) {
      if (!(error instanceof MacRecordTransportError)) throw error
      const delay = Math.max(1000 * 2 ** (attempt - 1), error.retryAfterMs ?? 0)
      const retry = error.retryable === true && attempt < 4 && delay < deadline - Date.now()
      const diagnostic = {
        artifact: metadata.id, attempt, phase: error.phase, kind: error.kind,
        ...(error.status === undefined ? {} : { status: error.status }),
        ...(error.remaining === undefined ? {} : { remaining: error.remaining }),
        ...(error.reset === undefined ? {} : { reset: error.reset }),
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
        retry,
      }
      console.error(`Mac cohort record download: ${JSON.stringify(diagnostic)}`)
      if (!retry)
        throw new Error(`Unable to download the bounded Mac cohort record archive: ${JSON.stringify(diagnostic)}`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

/** The caller supplies an isolated, exact-version official artifact client. */
export function createMacHostCohortArtifacts(client, directory = tmpdir()) {
  if (!isAbsolute(directory)) throw new Error('Mac cohort artifact scratch must be absolute')
  return {
    async upload(name, record) {
      const bytes = Buffer.from(`${JSON.stringify(record)}\n`)
      if (bytes.length > MAX_RECORD_BYTES)
        throw new Error('Mac cohort record exceeds its byte limit')
      const temporary = await mkdtemp(join(directory, 'jig-mac-record-'))
      try {
        const path = join(temporary, 'record.json')
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
        const artifact = await client.uploadArtifact(name, [path], temporary, { retentionDays: 7 })
        return requireArtifact({ ...artifact, name }, name)
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    },
  }
}

export async function loadMacHostCohortArtifacts(packageDirectory, scratch = tmpdir()) {
  if (!isAbsolute(packageDirectory)) throw new Error('Mac cohort artifact client path must be absolute')
  const require = createRequire(join(packageDirectory, 'package.json'))
  const manifest = require('@actions/artifact/package.json')
  if (manifest.name !== '@actions/artifact' || manifest.version !== MAC_COHORT_ARTIFACT_CLIENT_VERSION)
    throw new Error('Mac cohort requires the pinned official artifact client')
  const { DefaultArtifactClient } = require('@actions/artifact')
  return createMacHostCohortArtifacts(new DefaultArtifactClient(), scratch)
}
