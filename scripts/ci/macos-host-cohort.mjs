import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { MAC_HOST_PROFILES, requireMacHostPrerequisites } from './macos-host-profiles.mjs'

// With two admitted profiles, five workers contain three of one exact profile.
// Workers claim immediately available roles; they never hold a runner waiting
// for another worker to be scheduled. Claims are not qualification evidence.
export const MAC_PR_COHORT = Object.freeze({ workers: 5, shards: 3 })
export const MAC_COHORT_ARTIFACT_CLIENT_VERSION = '2.3.2'
const PROFILE_FIELDS = ['arch', 'kernel', 'build', 'bun', 'revision']
const RUN_FIELDS = ['sourceRevision', 'runId', 'runAttempt']
const WORKER_FIELDS = [...RUN_FIELDS, 'worker', 'jobId']
const CLAIM_KIND = 'macos-host-cohort-claim/1'
const WORKER_KIND = 'macos-host-cohort-worker/1'
const MAX_CLAIM_BYTES = 8192
const MAX_CLAIM_ARCHIVE_BYTES = 16_384

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
  if (
    !Number.isInteger(identity.worker) ||
    identity.worker < 0 ||
    identity.worker >= MAC_PR_COHORT.workers
  )
    throw new Error('Invalid Mac cohort worker index')
  requirePositiveInteger(identity.jobId, 'job ID')
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

export function macHostCohortClaimName(identity, profile, role) {
  requireRun(identity)
  if (!Number.isInteger(role) || role < 0 || role >= MAC_PR_COHORT.shards)
    throw new Error('Invalid Mac cohort role')
  return `macos-cohort-claim-${identity.sourceRevision}-r${identity.runId}-a${identity.runAttempt}-${macHostProfileKey(profile)}-${role}`
}

// The pinned official client exposes this server conflict as an Error message.
// Never interpret a failed upload/finalization, a generic 409 or an ambiguous
// network failure as an occupied role and proceed with different work.
export function isMacHostRoleConflict(error) {
  return (
    error instanceof Error &&
    /^Failed to CreateArtifact: Received non-retryable error: Failed request: \(409\) Conflict: an artifact with this name already exists on the workflow run\.?$/.test(
      error.message,
    )
  )
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

function deadlineValue(deadlineMs) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= Date.now())
    throw new Error('Mac cohort claim deadline expired or invalid')
  return deadlineMs
}

async function beforeDeadline(operation, deadlineMs) {
  const remaining = deadlineValue(deadlineMs) - Date.now()
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Mac cohort claim deadline expired')), remaining)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function claimMacHostRole({
  identity,
  prerequisites,
  artifacts,
  deadlineMs = Date.now() + 60_000,
}) {
  requireFields(identity, WORKER_FIELDS, 'worker identity')
  requireWorker(identity)
  const profile = macHostCohortProfile(prerequisites)
  deadlineValue(deadlineMs)
  if (typeof artifacts?.upload !== 'function') throw new Error('Missing Mac cohort artifact uploader')
  const conflicts = []
  for (let role = 0; role < MAC_PR_COHORT.shards; role++) {
    const name = macHostCohortClaimName(identity, profile, role)
    const claim = { kind: CLAIM_KIND, ...identity, profile, role }
    let artifact
    try {
      artifact = await beforeDeadline(() => artifacts.upload(name, claim), deadlineMs)
    } catch (error) {
      if (!isMacHostRoleConflict(error)) throw error
      conflicts.push(name)
      continue
    }
    return {
      kind: WORKER_KIND,
      ...identity,
      profile,
      role,
      claimArtifact: requireArtifact(artifact, name),
      conflicts,
    }
  }
  // Three explicit server conflicts permit this worker to release its runner.
  // They do not establish finalized claims or passing tests. The final aggregate
  // must independently find and validate all three owners before accepting this
  // surplus receipt, including owners on a non-selected profile.
  return { kind: WORKER_KIND, ...identity, profile, role: null, claimArtifact: null, conflicts }
}

function requireClaim(claim, identity) {
  requireFields(claim, ['kind', ...WORKER_FIELDS, 'profile', 'role'], 'claim')
  requireWorker(claim)
  requireProfile(claim.profile)
  if (claim.kind !== CLAIM_KIND || !sameFields(claim, identity, RUN_FIELDS))
    throw new Error('Mac cohort claim has a foreign source, run or attempt')
  macHostCohortClaimName(claim, claim.profile, claim.role)
  return claim
}

function requireReceipt(receipt, identity) {
  requireFields(
    receipt,
    ['kind', ...WORKER_FIELDS, 'profile', 'role', 'claimArtifact', 'conflicts'],
    'worker receipt',
  )
  requireWorker(receipt)
  requireProfile(receipt.profile)
  if (receipt.kind !== WORKER_KIND || !sameFields(receipt, identity, RUN_FIELDS))
    throw new Error('Mac cohort worker has a foreign source, run or attempt')
  if (receipt.role !== null) macHostCohortClaimName(receipt, receipt.profile, receipt.role)
  const count = receipt.role === null ? MAC_PR_COHORT.shards : receipt.role
  const conflicts = Array.from({ length: count }, (_, role) =>
    macHostCohortClaimName(receipt, receipt.profile, role),
  )
  if (!Array.isArray(receipt.conflicts) || JSON.stringify(receipt.conflicts) !== JSON.stringify(conflicts))
    throw new Error('Mac cohort worker has incomplete role conflict evidence')
  if (receipt.role === null && receipt.claimArtifact !== null)
    throw new Error('Surplus Mac cohort worker cannot own an artifact')
  return receipt
}

/** Select assignment evidence only; callers still validate every executed suite and residue. */
export function validateMacHostCohort({ identity, workers, claims, jobs }) {
  requireFields(identity, RUN_FIELDS, 'run identity')
  requireRun(identity)
  requireMacHostCohortProfiles()
  if (!Array.isArray(workers) || workers.length !== MAC_PR_COHORT.workers)
    throw new Error('Mac cohort requires all five current-attempt worker receipts')
  if (!Array.isArray(claims) || !Array.isArray(jobs))
    throw new Error('Mac cohort requires finalized claims and observed jobs')
  if (
    jobs.filter((job) => job.name?.startsWith('Native host worker — arm64 / ')).length !==
    MAC_PR_COHORT.workers
  )
    throw new Error('Mac cohort observed job inventory differs from its five workers')
  const receipts = workers.map(({ receipt, prerequisites }) => {
    requireReceipt(receipt, identity)
    if (!sameFields(receipt.profile, macHostCohortProfile(prerequisites), PROFILE_FIELDS))
      throw new Error('Mac cohort worker profile differs from its native prerequisites')
    const matching = jobs.filter((job) => job.name === macHostCohortWorkerName(receipt.worker))
    if (
      matching.length !== 1 ||
      matching[0].id !== receipt.jobId ||
      matching[0].run_id !== identity.runId ||
      matching[0].run_attempt !== identity.runAttempt ||
      matching[0].status !== 'completed' ||
      matching[0].conclusion !== 'success'
    )
      throw new Error('Mac cohort requires each exact current-attempt worker job to succeed')
    return receipt
  })
  if (
    new Set(receipts.map((receipt) => receipt.worker)).size !== MAC_PR_COHORT.workers ||
    new Set(receipts.map((receipt) => receipt.jobId)).size !== MAC_PR_COHORT.workers
  )
    throw new Error('Mac cohort repeats a worker or job')
  const byName = new Map()
  const artifactIds = new Set()
  for (const entry of claims) {
    const claim = requireClaim(entry.claim, identity)
    const name = macHostCohortClaimName(claim, claim.profile, claim.role)
    const artifact = requireArtifact(entry.artifact, name)
    if (byName.has(name) || artifactIds.has(artifact.id))
      throw new Error('Mac cohort repeats a finalized claim or artifact')
    artifactIds.add(artifact.id)
    byName.set(name, { claim, artifact })
  }
  const owners = receipts.filter((receipt) => receipt.role !== null)
  if (byName.size !== owners.length)
    throw new Error('Mac cohort finalized claim inventory differs from its workers')
  for (const receipt of receipts) {
    if (receipt.role !== null) {
      const name = macHostCohortClaimName(receipt, receipt.profile, receipt.role)
      const entry = byName.get(name)
      const expectedArtifact = requireArtifact(receipt.claimArtifact, name)
      if (
        !entry ||
        !sameFields(entry.claim, receipt, WORKER_FIELDS) ||
        entry.artifact.id !== expectedArtifact.id ||
        entry.artifact.digest !== expectedArtifact.digest
      )
        throw new Error('Mac cohort finalized claim does not belong to its executing worker')
    }
    for (const conflict of receipt.conflicts) {
      const entry = byName.get(conflict)
      if (!entry || entry.claim.worker === receipt.worker || entry.claim.jobId === receipt.jobId)
        throw new Error('Mac cohort conflict lacks a different finalized current-attempt owner')
    }
  }
  const complete = requireMacHostCohortProfiles()
    .map((profile) => ({ arch: 'arm64', ...profile }))
    .map((profile) => ({
      profile,
      roles: owners
        .filter((owner) => sameFields(owner.profile, profile, PROFILE_FIELDS))
        .sort((left, right) => left.role - right.role),
    }))
    .filter(({ roles }) =>
      roles.length === MAC_PR_COHORT.shards && roles.every((owner, role) => owner.role === role),
    )
  if (complete.length !== 1)
    throw new Error('Mac cohort has no unique complete exact-profile role set')
  return {
    ...identity,
    profile: complete[0].profile,
    roles: complete[0].roles,
    workers: [...receipts].sort((left, right) => left.worker - right.worker),
  }
}

export function readMacHostCohortClaim(path) {
  if (!constants.O_NOFOLLOW || !constants.O_NONBLOCK)
    throw new Error('Mac cohort claim reads require no-follow and nonblocking support')
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const metadata = fstatSync(descriptor)
    if (!metadata.isFile() || metadata.size > MAX_CLAIM_BYTES)
      throw new Error('Mac cohort claims require bounded regular files')
    const bytes = Buffer.alloc(MAX_CLAIM_BYTES + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null)
      if (count === 0) break
      length += count
    }
    if (length > MAX_CLAIM_BYTES) throw new Error('Mac cohort claim exceeds its byte limit')
    return JSON.parse(bytes.subarray(0, length).toString('utf8'))
  } finally {
    closeSync(descriptor)
  }
}

function requireClaimArchiveMetadata(artifact) {
  const name = artifact?.name
  if (
    typeof name !== 'string' ||
    !/^macos-cohort-claim-[0-9a-f]{40}-r[1-9][0-9]*-a[1-9][0-9]*-[0-9a-f]{64}-[0-2]$/.test(name) ||
    artifact.expired !== false ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    artifact.size_in_bytes <= 0 ||
    artifact.size_in_bytes > MAX_CLAIM_ARCHIVE_BYTES
  )
    throw new Error('Mac cohort claim archive metadata has invalid name, size or expiry')
  return requireArtifact(artifact, name)
}

const READ_CLAIM_ARCHIVE = `import io, json, stat, sys, zipfile
archive = sys.stdin.buffer.read(${MAX_CLAIM_ARCHIVE_BYTES + 1})
if len(archive) > ${MAX_CLAIM_ARCHIVE_BYTES}:
    raise ValueError('oversized claim archive')
with zipfile.ZipFile(io.BytesIO(archive)) as archive_file:
    entries = archive_file.infolist()
    if len(entries) != 1:
        raise ValueError('claim archive requires exactly one entry')
    entry = entries[0]
    mode = entry.external_attr >> 16
    if (entry.filename != 'claim.json' or entry.orig_filename != 'claim.json'
            or entry.is_dir() or entry.external_attr & 0x10
            or stat.S_IFMT(mode) not in (0, stat.S_IFREG)
            or entry.flag_bits & (1 | 64)
            or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
            or entry.file_size < 0 or entry.file_size > ${MAX_CLAIM_BYTES}):
        raise ValueError('unsafe claim archive entry')
    with archive_file.open(entry) as source:
        claim = source.read(${MAX_CLAIM_BYTES + 1})
    if len(claim) > ${MAX_CLAIM_BYTES} or len(claim) != entry.file_size:
        raise ValueError('oversized or incomplete claim')
    json.loads(claim.decode('utf-8'))
    sys.stdout.buffer.write(claim)
`

/** Verify the raw transport before reading one inert ZIP member without extraction. */
export function decodeMacHostCohortClaim(bytes, artifact) {
  const metadata = requireClaimArchiveMetadata(artifact)
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > MAX_CLAIM_ARCHIVE_BYTES ||
    bytes.byteLength !== artifact.size_in_bytes
  )
    throw new Error('Mac cohort claim archive transport size does not match')
  const archive = Buffer.from(bytes)
  if (`sha256:${createHash('sha256').update(archive).digest('hex')}` !== metadata.digest)
    throw new Error('Mac cohort claim archive transport digest does not match')
  try {
    const claim = execFileSync('python3', ['-I', '-c', READ_CLAIM_ARCHIVE], {
      input: archive,
      timeout: 5000,
      maxBuffer: MAX_CLAIM_BYTES + 1,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return JSON.parse(claim.toString('utf8'))
  } catch {
    throw new Error('Mac cohort claim archive is malformed or unsafe')
  }
}

export function downloadMacHostCohortClaim(repository, artifact) {
  if (
    typeof repository !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    repository.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error('Invalid Mac cohort claim repository')
  const metadata = requireClaimArchiveMetadata(artifact)
  let bytes
  try {
    bytes = execFileSync(
      'gh',
      ['api', `repos/${repository}/actions/artifacts/${metadata.id}/zip`],
      { timeout: 20_000, maxBuffer: MAX_CLAIM_ARCHIVE_BYTES, stdio: ['pipe', 'pipe', 'pipe'] },
    )
  } catch {
    throw new Error('Unable to download the bounded Mac cohort claim archive')
  }
  return decodeMacHostCohortClaim(bytes, artifact)
}

/** The caller supplies an isolated, exact-version official artifact client. */
export function createMacHostCohortArtifacts(client, directory = tmpdir()) {
  if (!isAbsolute(directory)) throw new Error('Mac cohort artifact scratch must be absolute')
  return {
    async upload(name, claim) {
      const temporary = await mkdtemp(join(directory, 'jig-mac-claim-'))
      try {
        const path = join(temporary, 'claim.json')
        await writeFile(path, `${JSON.stringify(claim)}\n`, { flag: 'wx', mode: 0o600 })
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
