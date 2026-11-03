import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  MAC_PR_COHORT,
  claimMacHostRole,
  decodeMacHostCohortClaim,
  downloadMacHostCohortClaim,
  isMacHostRoleConflict,
  macHostCohortClaimName,
  macHostCohortProfile,
  macHostCohortWorkerName,
  macHostProfileKey,
  readMacHostCohortClaim,
  requireMacHostCohortProfiles,
  validateMacHostCohort,
} from './macos-host-cohort.mjs'
import { MAC_HOST_PROFILES } from './macos-host-profiles.mjs'

const sourceRevision = 'a'.repeat(40)
const runIdentity = { sourceRevision, runId: 41636509252, runAttempt: 2 }
const conflictMessage =
  'Failed to CreateArtifact: Received non-retryable error: Failed request: (409) Conflict: an artifact with this name already exists on the workflow run'
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
  ...identity,
  worker,
  jobId: 125921198936 + worker,
})

// A controlled artifact protocol server exercises real competing HTTP requests.
// Its records are assignment data only: no fixture claims native execution.
async function artifactServer(run) {
  const reserved = new Map()
  const finalized = new Map()
  const held = []
  let nextId = 100
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost')
    const send = (code, value) => {
      response.writeHead(code, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    if (url.pathname === '/denied') return send(403, { message: 'Forbidden' })
    if (url.pathname === '/other-conflict') return send(409, { message: 'Unrelated conflict' })
    if (request.method !== 'PUT' || !url.pathname.startsWith('/claims/'))
      return send(404, { message: 'Not found' })
    const name = decodeURIComponent(url.pathname.slice('/claims/'.length))
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const bytes = Buffer.concat(chunks)
    if (bytes.length > 8192) return send(413, { message: 'Claim too large' })
    let claim
    try {
      claim = JSON.parse(bytes.toString())
    } catch {
      return send(400, { message: 'Invalid JSON' })
    }
    if (reserved.has(name)) return send(409, { message: 'an artifact with this name already exists on the workflow run' })
    const artifact = {
      id: nextId++,
      name,
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    }
    reserved.set(name, { artifact, claim })
    const finish = () => {
      finalized.set(name, { artifact, claim })
      send(201, artifact)
    }
    if (url.searchParams.get('hold') === 'true') held.push(finish)
    else finish()
    server.emit('reservation', name)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  const controller = new AbortController()
  const client = ({ hold = false, path } = {}) => ({
    async upload(name, claim) {
      const response = await fetch(
        `${origin}${path ?? `/claims/${encodeURIComponent(name)}`}?hold=${hold}`,
        { method: 'PUT', body: JSON.stringify(claim), signal: controller.signal },
      )
      const value = await response.json()
      if (!response.ok)
        throw new Error(
          `Failed to CreateArtifact: Received non-retryable error: Failed request: (${response.status}) ${response.statusText}: ${value.message}`,
        )
      return value
    },
  })
  try {
    await run({
      server,
      client,
      claims: () => [...finalized.values()],
      reservations: () => [...reserved.values()],
      release: () => held.splice(0).forEach((finish) => finish()),
    })
  } finally {
    controller.abort()
    held.splice(0).forEach((finish) => finish())
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

async function cohort(server, builds, identity = runIdentity) {
  const workers = await Promise.all(builds.map(async (build, worker) => {
    const observed = prerequisites(build)
    return {
      prerequisites: observed,
      receipt: await claimMacHostRole({
        identity: workerIdentity(worker, identity),
        prerequisites: observed,
        artifacts: server.client(),
      }),
    }
  }))
  return {
    identity,
    workers,
    claims: server.claims().filter(({ claim }) => claim.runId === identity.runId),
    // Ordinary GitHub metadata fixtures test the assignment validator's binding.
    // Source/native reports must be independently checked by the full aggregate.
    jobs: workers.map(({ receipt }) => ({
      id: receipt.jobId,
      name: macHostCohortWorkerName(receipt.worker),
      run_id: identity.runId,
      run_attempt: identity.runAttempt,
      status: 'completed',
      conclusion: 'success',
    })),
  }
}

test('all 32 pool assignments produce a complete exact-profile cohort through competing HTTP claims', async () => {
  await artifactServer(async (server) => {
    for (let assignment = 0; assignment < 32; assignment++) {
      const builds = Array.from({ length: MAC_PR_COHORT.workers }, (_, worker) =>
        assignment & (1 << worker) ? '24H232' : '24G830',
      )
      const input = await cohort(server, builds, { ...runIdentity, runId: runIdentity.runId + assignment })
      const selected = validateMacHostCohort(input)
      assert.equal(selected.roles.length, 3)
      assert.deepEqual(selected.roles.map(({ role }) => role), [0, 1, 2])
      const expected = builds.filter((build) => build === '24H232').length >= 3 ? '24H232' : '24G830'
      assert.equal(selected.profile.build, expected)
      assert.ok(selected.roles.every(({ profile }) => profile.build === expected))
      assert.equal(selected.workers.length, 5)
      const gCount = builds.filter((build) => build === '24G830').length
      assert.equal(input.claims.length, Math.min(gCount, 3) + Math.min(5 - gCount, 3))
    }
  })
})

test('workers advance after a name reservation without waiting for that owner to finish uploading', { timeout: 5000 }, async () => {
  await artifactServer(async (server) => {
    const reservation = once(server.server, 'reservation')
    const first = claimMacHostRole({
      identity: workerIdentity(0),
      prerequisites: prerequisites('24H232'),
      artifacts: server.client({ hold: true }),
    })
    await reservation
    assert.equal(server.claims().length, 0)
    const second = await claimMacHostRole({
      identity: workerIdentity(1),
      prerequisites: prerequisites('24H232'),
      artifacts: server.client(),
    })
    assert.equal(second.role, 1)
    assert.equal(server.claims().length, 1)
    server.release()
    assert.equal((await first).role, 0)
    assert.equal(server.claims().length, 2)
  })
})

test('the assignment theorem refuses a changed profile count or duplicate tuple', () => {
  assert.equal(requireMacHostCohortProfiles().length, 2)
  for (const profiles of [[], [MAC_HOST_PROFILES.arm64[0]], [...MAC_HOST_PROFILES.arm64, { ...MAC_HOST_PROFILES.arm64[1], build: '24H233' }], [MAC_HOST_PROFILES.arm64[0], Object.fromEntries(Object.entries(MAC_HOST_PROFILES.arm64[0]).reverse())]])
    assert.throws(() => requireMacHostCohortProfiles(profiles), /exactly two distinct/)
})

test('profile and run identities bind claim names without permitting arbitrary counts or unsafe identifiers', async () => {
  const g = macHostCohortProfile(prerequisites('24G830'))
  const h = macHostCohortProfile(prerequisites('24H232'))
  assert.notEqual(macHostProfileKey(g), macHostProfileKey(h))
  const original = macHostCohortClaimName(runIdentity, g, 0)
  for (const [identity, profile, role] of [
    [{ ...runIdentity, sourceRevision: 'b'.repeat(40) }, g, 0],
    [{ ...runIdentity, runId: runIdentity.runId + 1 }, g, 0],
    [{ ...runIdentity, runAttempt: 3 }, g, 0],
    [runIdentity, h, 0],
    [runIdentity, g, 1],
  ]) assert.notEqual(macHostCohortClaimName(identity, profile, role), original)
  for (const mutate of [{ build: '24H233' }, { arch: 'x64' }, { bun: '1.4.3' }, { revision: 'b'.repeat(40) }, { backendQualified: true }])
    assert.throws(() => macHostCohortProfile({ ...prerequisites('24H232'), ...mutate }))
  for (const role of [-1, 3, '0', null, 0.5])
    assert.throws(() => macHostCohortClaimName(runIdentity, g, role))
  for (const identity of [{ ...runIdentity, runAttempt: 0 }, { ...runIdentity, runId: NaN }, { ...runIdentity, sourceRevision: '../forged' }])
    assert.throws(() => macHostCohortClaimName(identity, g, 0))
  await artifactServer(async (server) => {
    await assert.rejects(claimMacHostRole({ identity: { ...workerIdentity(0), shards: 1 }, prerequisites: prerequisites('24H232'), artifacts: server.client() }), /fields/)
    assert.equal(server.reservations().length, 0)
  })
})

test('only the explicit CreateArtifact duplicate-name conflict permits another role', async () => {
  assert.equal(isMacHostRoleConflict(new Error(conflictMessage)), true)
  for (const message of [
    '409 Conflict',
    conflictMessage.replace('CreateArtifact', 'FinalizeArtifact'),
    conflictMessage.replace('409', '429'),
    `${conflictMessage}\nunknown failure`,
    conflictMessage.replace('an artifact with this name already exists on the workflow run', 'unrelated conflict'),
  ]) assert.equal(isMacHostRoleConflict(new Error(message)), false)
  assert.equal(isMacHostRoleConflict({ message: conflictMessage }), false)
  await artifactServer(async (server) => {
    for (const path of ['/denied', '/other-conflict'])
      await assert.rejects(claimMacHostRole({ identity: workerIdentity(0), prerequisites: prerequisites('24H232'), artifacts: server.client({ path }) }))
    assert.equal(server.reservations().length, 0)
  })
})

test('the claim deadline bounds a stalled server without selecting another role', { timeout: 5000 }, async () => {
  await artifactServer(async (server) => {
    await assert.rejects(claimMacHostRole({
      identity: workerIdentity(0),
      prerequisites: prerequisites('24H232'),
      artifacts: server.client({ hold: true }),
      deadlineMs: Date.now() + 100,
    }), /deadline expired/)
    assert.equal(server.reservations().length, 1)
    assert.equal(server.claims().length, 0)
    server.release()
    await assert.rejects(claimMacHostRole({ identity: workerIdentity(1), prerequisites: prerequisites('24H232'), artifacts: server.client(), deadlineMs: Date.now() - 1 }), /deadline/)
    assert.equal(server.reservations().length, 1)
  })
})

test('final aggregation rejects incomplete, stale, foreign, duplicated or failed assignment evidence', async () => {
  await artifactServer(async (server) => {
    const original = await cohort(server, ['24H232', '24G830', '24H232', '24G830', '24H232'])
    assert.equal(validateMacHostCohort(original).profile.build, '24H232')
    const changes = [
      (input) => input.workers.pop(),
      (input) => input.workers[1] = structuredClone(input.workers[0]),
      (input) => input.workers[0].receipt.runAttempt--,
      (input) => input.workers[0].receipt.sourceRevision = 'c'.repeat(40),
      (input) => input.workers[0].receipt.shardCount = 1,
      (input) => input.workers[0].receipt.jobId++,
      (input) => input.workers[0].prerequisites.build = '24G830',
      (input) => input.claims.pop(),
      (input) => input.claims.push(structuredClone(input.claims[0])),
      (input) => input.claims[0].claim.worker = 4,
      (input) => input.claims[0].claim.runAttempt--,
      (input) => input.claims[0].claim.sourceRevision = 'c'.repeat(40),
      (input) => input.claims[0].claim.profile.build = '24G830',
      (input) => input.claims[0].artifact.id++,
      (input) => input.claims[0].artifact.digest = `sha256:${'0'.repeat(64)}`,
      (input) => input.claims[0].artifact.expired = true,
      (input) => input.jobs.pop(),
      (input) => input.jobs[0].run_attempt--,
      (input) => input.jobs[0].run_id++,
      (input) => input.jobs[0].conclusion = 'cancelled',
      (input) => input.jobs[0].status = 'in_progress',
      (input) => input.jobs[0].name = macHostCohortWorkerName(4),
      (input) => input.jobs.push({ ...input.jobs[0], name: 'Native host worker — arm64 / 5' }),
      // A failure on the incomplete, non-selected profile must remain visible.
      (input) => input.jobs[1].conclusion = 'failure',
    ]
    for (const change of changes) {
      const input = structuredClone(original)
      change(input)
      assert.throws(() => validateMacHostCohort(input), undefined, change.toString())
    }
  })
})

test('surplus receipts require all three other finalized owners and their successful jobs', async () => {
  await artifactServer(async (server) => {
    const input = await cohort(server, Array(5).fill('24H232'))
    const selected = validateMacHostCohort(input)
    assert.equal(selected.roles.length, 3)
    const surplus = input.workers.filter(({ receipt }) => receipt.role === null)
    assert.equal(surplus.length, 2)
    assert.ok(surplus.every(({ receipt }) => receipt.conflicts.length === 3))
    for (const change of [
      (copy) => copy.claims.splice(1, 1),
      (copy) => copy.workers.find(({ receipt }) => receipt.role === null).receipt.conflicts.pop(),
      (copy) => copy.workers.find(({ receipt }) => receipt.role === null).receipt.claimArtifact = copy.claims[0].artifact,
      (copy) => copy.jobs.find((job) => job.id === surplus[0].receipt.jobId).conclusion = 'failure',
    ]) {
      const copy = structuredClone(input)
      change(copy)
      assert.throws(() => validateMacHostCohort(copy))
    }
  })
})

test('claim file reads refuse links, directories, malformed JSON and growth beyond the byte bound', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-cohort-reader-'))
  try {
    const path = join(directory, 'claim.json')
    const claim = {
      kind: 'macos-host-cohort-claim/1',
      ...workerIdentity(0),
      profile: macHostCohortProfile(prerequisites('24H232')),
      role: 0,
    }
    await writeFile(path, JSON.stringify(claim).padEnd(8192))
    assert.deepEqual(readMacHostCohortClaim(path), claim)
    await symlink(path, join(directory, 'linked.json'))
    assert.throws(() => readMacHostCohortClaim(join(directory, 'linked.json')), /ELOOP/)
    await mkdir(join(directory, 'subdirectory'))
    assert.throws(() => readMacHostCohortClaim(join(directory, 'subdirectory')), /regular file/)
    await writeFile(path, JSON.stringify(claim).padEnd(8193))
    assert.throws(() => readMacHostCohortClaim(path), /bounded regular/)
    await writeFile(path, '{')
    assert.throws(() => readMacHostCohortClaim(path), SyntaxError)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Real Python ZIP producers and the production decoder exercise the subprocess
// boundary. These inert claim objects do not assert native execution evidence.
function claimArchive(entries) {
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
    name: macHostCohortClaimName(runIdentity, macHostCohortProfile(prerequisites('24H232')), 0),
    size_in_bytes: bytes.length,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    expired: false,
  }
}

test('claim ZIP decoding verifies actual transport bytes and reads one bounded regular JSON member', () => {
  const claim = {
    kind: 'macos-host-cohort-claim/1',
    ...workerIdentity(0),
    profile: macHostCohortProfile(prerequisites('24H232')),
    role: 0,
  }
  for (const compression of [0, 8]) {
    const bytes = claimArchive([{ name: 'claim.json', body: JSON.stringify(claim).padEnd(8192), compression }])
    assert.deepEqual(decodeMacHostCohortClaim(bytes, archiveMetadata(bytes)), claim)
    assert.deepEqual(decodeMacHostCohortClaim(new Uint8Array(bytes), archiveMetadata(bytes)), claim)
  }
})

test('claim ZIP transport rejects altered hashes, lengths, expiry and malformed artifact identity', () => {
  const bytes = claimArchive([{ name: 'claim.json' }])
  const original = archiveMetadata(bytes)
  for (const change of [
    (metadata) => metadata.digest = `sha256:${'0'.repeat(64)}`,
    (metadata) => metadata.digest = undefined,
    (metadata) => metadata.size_in_bytes++,
    (metadata) => metadata.size_in_bytes = 16_385,
    (metadata) => metadata.size_in_bytes = 0,
    (metadata) => metadata.expired = true,
    (metadata) => delete metadata.expired,
    (metadata) => metadata.name = 'claim.json',
    (metadata) => metadata.id = 0,
    (metadata) => metadata.id = Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const metadata = structuredClone(original)
    change(metadata)
    assert.throws(() => decodeMacHostCohortClaim(bytes, metadata), undefined, change.toString())
  }
  const altered = Buffer.from(bytes)
  altered[0] ^= 1
  assert.throws(() => decodeMacHostCohortClaim(altered, original), /digest/)
  assert.throws(() => decodeMacHostCohortClaim(bytes.subarray(1), original), /size/)
  assert.throws(() => decodeMacHostCohortClaim([...bytes], original), /size/)
  const oversized = claimArchive([{ name: 'claim.json', body: ' '.repeat(16_384), compression: 0 }])
  assert.ok(oversized.length > 16_384)
  assert.throws(() => decodeMacHostCohortClaim(oversized, archiveMetadata(oversized)), /metadata/)
  assert.throws(() => downloadMacHostCohortClaim('../jig', original), /repository/)
  assert.throws(() => downloadMacHostCohortClaim('jiggy/jig?query', original), /repository/)
  assert.throws(() => downloadMacHostCohortClaim('jiggy/jig', { ...original, expired: true }), /metadata/)
})

test('claim ZIP decoding rejects extra entries, unsafe names and non-regular or encrypted members', () => {
  for (const entries of [
    [],
    [{ name: 'claim.json' }, { name: 'other.json' }],
    [{ name: 'claim.json' }, { name: 'claim.json' }],
    ...['../claim.json', '/claim.json', 'nested/claim.json', 'claim.json/'].map((name) => [{ name }]),
    [{ name: 'claim.json', mode: 0o120777 }],
    [{ name: 'claim.json', mode: 0o040700 }],
    [{ name: 'claim.json', mode: 0o010600 }],
    [{ name: 'claim.json', directory: true }],
    [{ name: 'claim.json', compression: 12 }],
    [{ name: 'claim.json', compression: 14 }],
  ]) {
    const bytes = claimArchive(entries)
    assert.throws(() => decodeMacHostCohortClaim(bytes, archiveMetadata(bytes)), /malformed or unsafe/, JSON.stringify(entries))
  }
  const encrypted = claimArchive([{ name: 'claim.json' }])
  const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  assert.ok(central > 0)
  encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6)
  encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8)
  assert.throws(() => decodeMacHostCohortClaim(encrypted, archiveMetadata(encrypted)), /malformed or unsafe/)

  const nulName = claimArchive([{ name: 'claim.jsonXhidden' }])
  const filename = Buffer.from('claim.jsonXhidden')
  let count = 0
  for (let offset = nulName.indexOf(filename); offset >= 0; offset = nulName.indexOf(filename, offset + 1)) {
    nulName[offset + 'claim.json'.length] = 0
    count++
  }
  assert.equal(count, 2)
  assert.throws(() => decodeMacHostCohortClaim(nulName, archiveMetadata(nulName)), /malformed or unsafe/)
})

test('claim ZIP decoding rejects expansion beyond the JSON bound, invalid UTF-8, invalid JSON and bad CRC', () => {
  for (const body of ['{}'.padEnd(8193), '{', Buffer.from([0xff, 0xfe])]) {
    const bytes = claimArchive([{ name: 'claim.json', body }])
    assert.ok(bytes.length < 16_384)
    assert.throws(() => decodeMacHostCohortClaim(bytes, archiveMetadata(bytes)), /malformed or unsafe/)
  }
  const malformed = Buffer.from('not a ZIP archive')
  assert.throws(() => decodeMacHostCohortClaim(malformed, archiveMetadata(malformed)), /malformed or unsafe/)

  const badCrc = claimArchive([{ name: 'claim.json', body: '{"role":0}', compression: 0 }])
  const content = badCrc.indexOf(Buffer.from('{"role":0}'))
  assert.ok(content > 0)
  badCrc[content + 8] = '1'.charCodeAt(0)
  assert.throws(() => decodeMacHostCohortClaim(badCrc, archiveMetadata(badCrc)), /malformed or unsafe/)
})
