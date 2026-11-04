import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  MAC_PR_COHORT,
  MAC_COHORT_ALLOCATOR_NAME,
  MAC_COHORT_GUARD_JOB_NAME,
  MAC_COHORT_READY_JOB_NAME,
  createMacHostCohortReady,
  createMacHostCohortAnnouncement,
  createMacHostCohortAssignment,
  createMacHostCohortLedger,
  createMacHostCohortWorkerReceipt,
  decodeMacHostCohortRecord,
  downloadMacHostCohortRecord,
  macHostCohortArtifactName,
  macHostCohortProfile,
  macHostCohortWorkerName,
  macHostProfileKey,
  readMacHostCohortRecord,
  requireMacHostCohortProfiles,
  validateMacHostCohort,
  validateMacHostCohortRecords,
} from './macos-host-cohort.mjs'
import { MAC_HOST_PROFILES } from './macos-host-profiles.mjs'

const runIdentity = { sourceRevision: 'a'.repeat(40), runId: 41636509252, runAttempt: 2 }
const allocatorJobId = 900
const prerequisites = (build) => ({
  kind: 'macos-host-prerequisites/1',
  arch: 'arm64',
  ...MAC_HOST_PROFILES.arm64.find((profile) => profile.build === build),
  processIdentityBytes: 56,
  coalitionIdentityBytes: 40,
  coalitionUsageBytes: 296,
  pidVersion: 1,
  backendQualified: false,
})
const workerIdentity = (worker, identity = runIdentity) => ({
  ...identity, worker, jobId: 1000 + worker,
})

// Ordinary data fixtures exercise assignment validation, never native proof.
// ZIP transport checks below independently use actual archive bytes and hashes.
function envelope(record, id) {
  const type = record.kind.replace('macos-host-cohort-', '').replace('/1', '')
  return {
    record,
    artifact: {
      id,
      name: macHostCohortArtifactName(type, record,
        type === 'announcement' || type === 'assignment' ? record.worker : undefined),
      digest: `sha256:${createHash('sha256').update(JSON.stringify(record)).digest('hex')}`,
    },
  }
}

function fixture(builds = ['24H232', '24G830', '24H232', '24G830', '24H232'], order = [0, 1, 2, 3, 4]) {
  const identity = { ...runIdentity }
  const ready = envelope(createMacHostCohortReady({ identity, allocatorJobId }), 2000)
  const announcements = builds.map((build, worker) => envelope(createMacHostCohortAnnouncement({
    identity: workerIdentity(worker), allocatorJobId, prerequisites: prerequisites(build),
  }), 2100 + worker))
  const assignments = []
  for (const worker of order) {
    const record = createMacHostCohortAssignment({
      identity, allocatorJobId, announcement: announcements[worker], assignments,
    })
    assignments.push(envelope(record, 2200 + worker))
  }
  const ledger = envelope(createMacHostCohortLedger({ identity, allocatorJobId, ready, assignments }), 2300)
  const workers = builds.map((build, worker) => ({
    prerequisites: prerequisites(build),
    receipt: createMacHostCohortWorkerReceipt({
      identity: workerIdentity(worker), allocatorJobId, ready,
      announcement: announcements[worker],
      assignment: assignments.find(({ record }) => record.worker === worker),
      prerequisites: prerequisites(build),
    }),
  }))
  const job = (id, name) => ({ id, name, run_id: identity.runId, run_attempt: identity.runAttempt,
    status: 'completed', conclusion: 'success' })
  return {
    identity,
    workers,
    records: [ready, ...announcements, ...assignments, ledger],
    jobs: [job(allocatorJobId, MAC_COHORT_ALLOCATOR_NAME), job(901, MAC_COHORT_READY_JOB_NAME),
      ...workers.map(({ receipt }) => job(receipt.jobId, macHostCohortWorkerName(receipt.worker))),
      job(902, MAC_COHORT_GUARD_JOB_NAME)],
    ready,
    announcements,
    assignments,
    ledger,
  }
}

test('all pool distributions and independent arrival orders produce one complete exact profile', () => {
  for (let distribution = 0; distribution < 32; distribution++) {
    const builds = Array.from({ length: 5 }, (_, worker) =>
      distribution & (1 << worker) ? '24H232' : '24G830')
    for (const order of [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [3, 0, 4, 1, 2]]) {
      const input = fixture(builds, order)
      input.records.reverse() // REST response order cannot determine role ownership.
      const result = validateMacHostCohort(input)
      const expected = builds.filter((build) => build === '24H232').length >= 3 ? '24H232' : '24G830'
      assert.equal(result.profile.build, expected)
      assert.deepEqual(result.roles.map(({ role }) => role), [0, 1, 2])
      assert.ok(result.roles.every(({ profile }) => profile.build === expected))
      assert.equal(result.workers.length, 5)
      assert.equal(result.allocatorJobId, allocatorJobId)
      assert.equal(Object.hasOwn(result, 'qualified'), false)
    }
  }
})

test('the allocator can assign the first observed worker without waiting for lower indices', () => {
  const input = fixture(Array(5).fill('24H232'), [4, 1, 0, 3, 2])
  const first = createMacHostCohortAssignment({ identity: input.identity, allocatorJobId,
    announcement: input.announcements[4], assignments: [] })
  assert.equal(first.worker, 4)
  assert.equal(first.role, 0)
  const prior = [input.assignments[0]]
  assert.throws(() => createMacHostCohortAssignment({ identity: input.identity, allocatorJobId,
    announcement: input.announcements[4], assignments: prior }), /already has an immutable assignment/)
  assert.throws(() => createMacHostCohortLedger({ identity: input.identity, allocatorJobId,
    ready: input.ready, assignments: prior }), /all five/)
  assert.deepEqual(input.assignments.map(({ record }) => record.role), [0, 1, 2, null, null])
})

test('partial listings can validate references before their records become visible but cannot complete', () => {
  const input = fixture()
  for (const records of [[input.assignments[0]], [input.ledger], [input.ready], []]) {
    assert.equal(validateMacHostCohortRecords({ identity: input.identity, allocatorJobId, records }).length, records.length)
    assert.throws(() => validateMacHostCohort({ ...input, records }), /complete ready/)
  }
})

test('duplicate artifact names are fatal even when their record content is identical', () => {
  const input = fixture()
  for (const record of [input.ready, input.announcements[0], input.assignments[0], input.ledger]) {
    for (const duplicate of [record, { ...record, artifact: { ...record.artifact, id: 99999 } }]) {
      const records = [...input.records, duplicate]
      assert.throws(() => validateMacHostCohortRecords({ identity: input.identity, allocatorJobId, records }), /repeats a published record/)
      assert.throws(() => validateMacHostCohort({ ...input, records }), /repeats a published record/)
    }
  }
  const copy = structuredClone(input)
  copy.records[1].artifact.id = copy.records[0].artifact.id
  assert.throws(() => validateMacHostCohort(copy), /repeats a published record/)
})

test('announcements, immutable assignments, worker receipts and ledger bind every identity and reference', () => {
  const original = fixture()
  const changes = [
    (input) => { input.records[1].record.sourceRevision = 'b'.repeat(40) },
    (input) => { input.records[1].record.runId++ },
    (input) => { input.records[1].record.runAttempt-- },
    (input) => { input.records[1].record.allocatorJobId++ },
    (input) => { input.records[1].record.jobId++ },
    (input) => { input.records[1].record.worker = 4 },
    (input) => { input.records[1].record.profile.build = '24G830' },
    (input) => { input.records[6].record.role = 1 },
    (input) => { input.records[6].record.announcementArtifact.id++ },
    (input) => { input.records[6].record.announcementArtifact.digest = `sha256:${'f'.repeat(64)}` },
    (input) => { input.records[11].record.readyArtifact.id++ },
    (input) => { input.records[11].record.assignmentArtifacts.reverse() },
    (input) => { input.records[11].record.assignmentArtifacts.pop() },
    (input) => { input.workers[0].receipt.kind = 'macos-host-cohort-worker/1' },
    (input) => { input.workers[0].receipt.allocatorJobId++ },
    (input) => { input.workers[0].receipt.role = null },
    (input) => { input.workers[0].receipt.readyArtifact.id++ },
    (input) => { input.workers[0].receipt.announcementArtifact.id++ },
    (input) => { input.workers[0].receipt.assignmentArtifact.id++ },
    (input) => { input.workers[0].receipt.sourceRevision = 'b'.repeat(40) },
    (input) => { input.workers[0].receipt.qualified = true },
    (input) => { input.workers[0].prerequisites.build = '24G830' },
    (input) => { input.workers.pop() },
    (input) => { input.workers[4] = input.workers[0] },
  ]
  for (const change of changes) {
    const input = structuredClone(original)
    change(input)
    assert.throws(() => validateMacHostCohort(input), undefined, change.toString())
  }
})

test('partial publication or a failed allocator, readiness job, guard or minority worker cannot qualify', () => {
  const original = fixture()
  for (let index = 0; index < original.records.length; index++) {
    const records = original.records.filter((_, other) => other !== index)
    assert.throws(() => validateMacHostCohort({ ...original, records }))
  }
  for (let index = 0; index < original.jobs.length; index++) {
    for (const changes of [
      { conclusion: 'failure' }, { conclusion: 'cancelled' },
      { status: 'in_progress', conclusion: null }, { run_attempt: 1 }, { run_id: 1 },
    ]) {
      const input = structuredClone(original)
      Object.assign(input.jobs[index], changes)
      assert.throws(() => validateMacHostCohort(input))
    }
  }
  const repeated = structuredClone(original)
  repeated.jobs.push({ ...repeated.jobs[2], name: 'Native host worker — arm64 / 5' })
  assert.throws(() => validateMacHostCohort(repeated), /job inventory/)
})

test('successful native workers cannot qualify without one successful current-attempt deadline guard', () => {
  const original = fixture()
  const guard = original.jobs.find((job) => job.name === MAC_COHORT_GUARD_JOB_NAME)
  assert.equal(validateMacHostCohort(original).roles.length, 3)
  const withoutGuard = original.jobs.filter((job) => job !== guard)
  assert.throws(() => validateMacHostCohort({ ...original, jobs: withoutGuard }),
    /one exact current-attempt job/)
  for (const changes of [
    { id: 0 }, { id: '902' },
    { name: 'Enforce a different PR deadline' },
    { conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: 'skipped' },
    { status: 'queued', conclusion: null }, { status: 'in_progress', conclusion: null },
    { run_id: original.identity.runId + 1 }, { run_attempt: original.identity.runAttempt - 1 },
  ]) {
    assert.throws(() => validateMacHostCohort({
      ...original, jobs: [...withoutGuard, { ...guard, ...changes }],
    }), /(?:job|current-attempt)/, JSON.stringify(changes))
  }
  for (const duplicate of [guard, { ...guard, id: 903 }])
    assert.throws(() => validateMacHostCohort({ ...original, jobs: [...original.jobs, duplicate] }),
      /one exact current-attempt job/)
  for (const existing of withoutGuard)
    assert.throws(() => validateMacHostCohort({
      ...original, jobs: [...withoutGuard, { ...guard, id: existing.id }],
    }), /repeats a worker or job/)
})

test('surplus needs an explicit assignment after three same-profile owners and its successful job', () => {
  const original = fixture(Array(5).fill('24H232'))
  assert.deepEqual(validateMacHostCohort(original).workers.map(({ role }) => role), [0, 1, 2, null, null])
  const early = structuredClone(original)
  early.records[6].record.role = null
  early.workers[0].receipt.role = null
  assert.throws(() => validateMacHostCohort(early), /invents surplus/)
  const missing = structuredClone(original)
  missing.records.splice(9, 1)
  assert.throws(() => validateMacHostCohort(missing))
  const failed = structuredClone(original)
  failed.jobs[6].conclusion = 'failure'
  assert.throws(() => validateMacHostCohort(failed), /job to succeed/)
})

test('the fifth worker can consume an assignment after successful allocator completion', () => {
  const input = fixture()
  assert.equal(input.jobs[0].status, 'completed')
  assert.equal(input.jobs[0].conclusion, 'success')
  const receipt = createMacHostCohortWorkerReceipt({ identity: workerIdentity(4), allocatorJobId,
    ready: input.ready, announcement: input.announcements[4],
    assignment: input.assignments[4], prerequisites: prerequisites('24H232') })
  assert.equal(receipt.role, 2)
  assert.deepEqual(receipt, input.workers[4].receipt)
  assert.equal(validateMacHostCohort(input).roles.length, 3)
})

test('the source-owned profile and worker counts cannot be extended by records', () => {
  assert.deepEqual(MAC_PR_COHORT, { workers: 5, shards: 3 })
  assert.equal(requireMacHostCohortProfiles().length, 2)
  for (const profiles of [[], [MAC_HOST_PROFILES.arm64[0]],
    [...MAC_HOST_PROFILES.arm64, { ...MAC_HOST_PROFILES.arm64[1], build: '24H233' }],
    [MAC_HOST_PROFILES.arm64[0], Object.fromEntries(Object.entries(MAC_HOST_PROFILES.arm64[0]).reverse())]])
    assert.throws(() => requireMacHostCohortProfiles(profiles), /exactly two distinct/)
  for (const worker of [-1, 5, '1', 0.5])
    assert.throws(() => macHostCohortArtifactName('announcement', runIdentity, worker), /worker index/)
  assert.throws(() => macHostCohortArtifactName('claim', runIdentity, 0), /record type/)
  assert.throws(() => macHostCohortArtifactName('ready', runIdentity, 0), /cannot name a worker/)
  assert.notEqual(macHostProfileKey(macHostCohortProfile(prerequisites('24G830'))),
    macHostProfileKey(macHostCohortProfile(prerequisites('24H232'))))
  const input = fixture()
  assert.ok(Buffer.byteLength(JSON.stringify(input.ledger.record)) < 8192)
  const bytes = recordArchive([{ name: 'record.json', body: JSON.stringify(input.ledger.record) }])
  assert.deepEqual(decodeMacHostCohortRecord(bytes, {
    ...archiveMetadata(bytes), name: macHostCohortArtifactName('ledger', runIdentity),
  }), input.ledger.record)
})

test('record file reads refuse links, directories, malformed JSON and oversized records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-cohort-reader-'))
  try {
    const path = join(directory, 'record.json')
    const record = createMacHostCohortReady({ identity: runIdentity, allocatorJobId })
    await writeFile(path, JSON.stringify(record).padEnd(8192))
    assert.deepEqual(readMacHostCohortRecord(path), record)
    await symlink(path, join(directory, 'linked.json'))
    assert.throws(() => readMacHostCohortRecord(join(directory, 'linked.json')), /ELOOP/)
    await mkdir(join(directory, 'subdirectory'))
    assert.throws(() => readMacHostCohortRecord(join(directory, 'subdirectory')), /regular file/)
    await writeFile(path, JSON.stringify(record).padEnd(8193))
    assert.throws(() => readMacHostCohortRecord(path), /bounded regular/)
    await writeFile(path, '{')
    assert.throws(() => readMacHostCohortRecord(path), SyntaxError)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Real Python ZIP producers and the production decoder exercise the subprocess
// boundary. These inert record objects do not assert native execution evidence.
function recordArchive(entries) {
  return execFileSync('python3', ['-I', '-c', `import base64, io, json, sys, zipfile
entries = json.load(sys.stdin)
output = io.BytesIO()
with zipfile.ZipFile(output, 'w') as archive:
    for entry in entries:
        info = zipfile.ZipInfo(entry['name'])
        info.create_system = 3
        info.external_attr = entry.get('mode', 0o100600) << 16
        if entry.get('directory'):
            info.external_attr |= 0x10
        info.compress_type = entry.get('compression', zipfile.ZIP_DEFLATED)
        archive.writestr(info, base64.b64decode(entry['bytes']))
sys.stdout.buffer.write(output.getvalue())
`], {
    input: JSON.stringify(entries.map(({ body = '{}', ...entry }) => ({
      ...entry,
      bytes: Buffer.from(body).toString('base64'),
    }))),
    timeout: 5000,
    maxBuffer: 65_536,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function archiveMetadata(bytes) {
  return {
    id: 417,
    name: macHostCohortArtifactName('announcement', runIdentity, 0),
    size_in_bytes: bytes.length,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    expired: false,
  }
}

test('record ZIP decoding verifies actual transport bytes and reads one bounded regular JSON member', () => {
  const record = createMacHostCohortAnnouncement({
    identity: workerIdentity(0),
    allocatorJobId,
    prerequisites: prerequisites('24H232'),
  })
  for (const compression of [0, 8]) {
    const bytes = recordArchive([{ name: 'record.json', body: JSON.stringify(record).padEnd(8192), compression }])
    assert.deepEqual(decodeMacHostCohortRecord(bytes, archiveMetadata(bytes)), record)
    assert.deepEqual(decodeMacHostCohortRecord(new Uint8Array(bytes), archiveMetadata(bytes)), record)
  }
})

test('record ZIP transport rejects altered hashes, lengths, expiry and malformed artifact identity', () => {
  const bytes = recordArchive([{ name: 'record.json' }])
  const original = archiveMetadata(bytes)
  for (const change of [
    (metadata) => metadata.digest = `sha256:${'0'.repeat(64)}`,
    (metadata) => metadata.digest = undefined,
    (metadata) => metadata.size_in_bytes++,
    (metadata) => metadata.size_in_bytes = 16_385,
    (metadata) => metadata.size_in_bytes = 0,
    (metadata) => metadata.expired = true,
    (metadata) => delete metadata.expired,
    (metadata) => metadata.name = 'record.json',
    (metadata) => metadata.id = 0,
    (metadata) => metadata.id = Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const metadata = structuredClone(original)
    change(metadata)
    assert.throws(() => decodeMacHostCohortRecord(bytes, metadata), undefined, change.toString())
  }
  const altered = Buffer.from(bytes)
  altered[0] ^= 1
  assert.throws(() => decodeMacHostCohortRecord(altered, original), /digest/)
  assert.throws(() => decodeMacHostCohortRecord(bytes.subarray(1), original), /size/)
  assert.throws(() => decodeMacHostCohortRecord([...bytes], original), /size/)
  const oversized = recordArchive([{ name: 'record.json', body: ' '.repeat(16_384), compression: 0 }])
  assert.ok(oversized.length > 16_384)
  assert.throws(() => decodeMacHostCohortRecord(oversized, archiveMetadata(oversized)), /metadata/)
  assert.throws(() => downloadMacHostCohortRecord('../jig', original), /repository/)
  assert.throws(() => downloadMacHostCohortRecord('jiggy/jig?query', original), /repository/)
  assert.throws(() => downloadMacHostCohortRecord('jiggy/jig', { ...original, expired: true }), /metadata/)
})

test('record ZIP decoding rejects extra entries, unsafe names and non-regular or encrypted members', () => {
  for (const entries of [
    [],
    [{ name: 'record.json' }, { name: 'other.json' }],
    [{ name: 'record.json' }, { name: 'record.json' }],
    ...['../record.json', '/record.json', 'nested/record.json', 'record.json/'].map((name) => [{ name }]),
    [{ name: 'record.json', mode: 0o120777 }],
    [{ name: 'record.json', mode: 0o040700 }],
    [{ name: 'record.json', mode: 0o010600 }],
    [{ name: 'record.json', directory: true }],
    [{ name: 'record.json', compression: 12 }],
    [{ name: 'record.json', compression: 14 }],
  ]) {
    const bytes = recordArchive(entries)
    assert.throws(() => decodeMacHostCohortRecord(bytes, archiveMetadata(bytes)), /malformed or unsafe/, JSON.stringify(entries))
  }
  const encrypted = recordArchive([{ name: 'record.json' }])
  const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  assert.ok(central > 0)
  encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6)
  encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8)
  assert.throws(() => decodeMacHostCohortRecord(encrypted, archiveMetadata(encrypted)), /malformed or unsafe/)

  const nulName = recordArchive([{ name: 'record.jsonXhidden' }])
  const filename = Buffer.from('record.jsonXhidden')
  let count = 0
  for (let offset = nulName.indexOf(filename); offset >= 0; offset = nulName.indexOf(filename, offset + 1)) {
    nulName[offset + 'record.json'.length] = 0
    count++
  }
  assert.equal(count, 2)
  assert.throws(() => decodeMacHostCohortRecord(nulName, archiveMetadata(nulName)), /malformed or unsafe/)
})

test('record ZIP decoding rejects expansion beyond the JSON bound, invalid UTF-8, invalid JSON and bad CRC', () => {
  for (const body of ['{}'.padEnd(8193), '{', Buffer.from([0xff, 0xfe])]) {
    const bytes = recordArchive([{ name: 'record.json', body }])
    assert.ok(bytes.length < 16_384)
    assert.throws(() => decodeMacHostCohortRecord(bytes, archiveMetadata(bytes)), /malformed or unsafe/)
  }
  const malformed = Buffer.from('not a ZIP archive')
  assert.throws(() => decodeMacHostCohortRecord(malformed, archiveMetadata(malformed)), /malformed or unsafe/)

  const badCrc = recordArchive([{ name: 'record.json', body: '{"role":0}', compression: 0 }])
  const content = badCrc.indexOf(Buffer.from('{"role":0}'))
  assert.ok(content > 0)
  badCrc[content + 8] = '1'.charCodeAt(0)
  assert.throws(() => decodeMacHostCohortRecord(badCrc, archiveMetadata(badCrc)), /malformed or unsafe/)
})
