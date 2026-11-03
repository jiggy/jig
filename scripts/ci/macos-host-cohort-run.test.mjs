import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import {
  digest,
  PACKAGE_LAYOUT,
  RELEASE_PACKAGE_LAYOUT,
  writeCandidateReceipt,
} from './candidate-provenance.mjs'
import {
  createMacHostCohortAnnouncement,
  createMacHostCohortAssignment,
  createMacHostCohortLedger,
  createMacHostCohortReady,
  createMacHostCohortWorkerReceipt,
  decodeMacHostCohortRecord,
  MAC_COHORT_ALLOCATOR_NAME,
  MAC_COHORT_READY_JOB_NAME,
  macHostCohortArtifactName,
  macHostCohortWorkerName,
} from './macos-host-cohort.mjs'
import {
  allocateMacHostRoles,
  awaitMacHostRole,
  macHostCohortCoordinationDeadline,
  macHostCohortPollDelay,
  macHostCohortRecordReader,
  macHostWorkerMatrix,
  reconcileMacHostCohortReports,
  requireMacHostAllocationProgress,
  selectMacHostAllocatorJob,
  selectMacHostWorkerJob,
  waitForMacHostAllocator,
} from './macos-host-cohort-run.mjs'
import { MAC_HOST_PROFILES } from './macos-host-profiles.mjs'
import {
  INSTALLED_STARTUP_TEST,
  NATIVE_PREREQUISITE_TESTS,
  planMacHostTests,
} from './macos-host-test-shards.mjs'
import { readMacReports } from './test-reports.mjs'

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
const xml = (files, child = '') =>
  `<testsuites tests="${files.length}">${files
    .map(
      (file) =>
        `<testcase file="${file}" classname="fixture" name="complete ${file}">${child}</testcase>`,
    )
    .join('')}</testsuites>`

async function canonicalBundle(temporary, sourceRevision) {
  const root = join(temporary, 'bundle')
  await mkdir(root)
  for (const [kind, name] of Object.entries(PACKAGE_LAYOUT)) {
    const staging = join(temporary, 'contents', kind)
    await mkdir(join(staging, 'package'), { recursive: true })
    await writeFile(
      join(staging, 'package/package.json'),
      JSON.stringify({ name, version: '0.1.0-alpha.1', publishConfig: { access: 'public' } }),
    )
    await mkdir(join(root, kind))
    const archive = join(root, kind, `${kind}.tgz`)
    execFileSync('tar', ['-czf', archive, '-C', staging, 'package'])
    await writeFile(`${archive}.sha256`, `${digest(await readFile(archive))}  ${kind}.tgz\n`)
    await writeFile(
      `${archive}.files`,
      `${execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
        .trimEnd()
        .split('\n')
        .sort()
        .join('\n')}\n`,
    )
  }
  await mkdir(join(root, 'resolution'))
  await writeFile(join(root, 'resolution/bun.lock'), 'fixture resolution\n')
  const candidate = await writeCandidateReceipt({
    root,
    sourceRevision,
    release: {
      schemaVersion: 1,
      sourceRevision,
      eligible: false,
      reason: 'feature-source',
      packages: Object.entries(RELEASE_PACKAGE_LAYOUT).map(([kind, name]) => ({
        kind,
        name,
        version: '0.1.0-alpha.1',
      })),
      pendingPackages: [],
    },
    producer: {
      repository: 'local/local',
      workflowPath: '.github/workflows/ci.yml',
      runId: 41,
      runAttempt: 1,
      event: 'push',
      headSha: sourceRevision,
      headBranch: 'main',
      headRepository: 'local/local',
    },
    buildProfile: {
      version: '1.3.13',
      revision: 'bf2e2cecf27e800962b1e7f03d66278f9d5d2e79',
      platform: 'linux',
      architecture: 'x64',
      nodeVersion: process.versions.node,
      npmVersion: '11.6.2',
      justVersion: 'just 1.43.1',
    },
    resolutionFiles: ['resolution/bun.lock'],
  })
  await writeFile(
    join(root, 'ARTIFACT.json'),
    JSON.stringify({
      schemaVersion: 1,
      repository: 'local/local',
      runId: 41,
      runAttempt: 1,
      sourceRevision,
      receiptSha256: candidate.receiptSha256,
      artifactId: 73,
      artifactDigest: `sha256:${'2'.repeat(64)}`,
    }),
  )
  return root
}

// Real Git inventories, tarballs and inert JUnit inputs exercise reconciliation.
// These fixtures establish validator behavior, never native execution proof.
async function fixture(t, builds = ['24H232', '24G830', '24H232', '24G830', '24H232']) {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-mac-cohort-run-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const repository = join(temporary, 'repository')
  await mkdir(repository)
  const git = (args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' })
  git(['init', '--quiet'])
  const files = [
    ...NATIVE_PREREQUISITE_TESTS,
    INSTALLED_STARTUP_TEST,
    ...Array.from({ length: 12 }, (_, index) => `packages/jig/test/host/cohort-${index}.test.ts`),
    'packages/jig/test/macos/cohort-native.test.ts',
    'packages/display-web/test/cohort.test.ts',
  ]
  for (const file of files) {
    await mkdir(dirname(join(repository, file)), { recursive: true })
    await writeFile(join(repository, file), 'test("fixture case", () => {})\n')
  }
  git(['add', '.'])
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'fixture source inventory',
  ])
  const sourceRevision = git(['rev-parse', 'HEAD']).trim()
  const identity = { sourceRevision, runId: 500, runAttempt: 2 }
  const bundleDirectory = await canonicalBundle(temporary, sourceRevision)
  const evidenceDirectory = join(temporary, 'workers')
  const normalizedDirectory = join(temporary, 'normalized')
  await mkdir(evidenceDirectory)
  const shards = planMacHostTests(files, 'arm64', { plan: 'pull-request' })
  const records = []
  const jobs = []
  const receipts = []
  const directories = []
  const allocatorJobId = 9000
  const assignments = []
  const publish = (type, record, worker) => {
    const entry = {
      artifact: {
        id: 2000 + records.length,
        name: macHostCohortArtifactName(type, identity, worker),
        digest: `sha256:${digest(JSON.stringify(record))}`,
      },
      record,
    }
    records.push(entry)
    return entry
  }
  const ready = publish('ready', createMacHostCohortReady({ identity, allocatorJobId }))
  for (const [worker, build] of builds.entries()) {
    const observed = prerequisites(build)
    const owner = { ...identity, worker, jobId: 1000 + worker }
    const announcement = publish('announcement', createMacHostCohortAnnouncement({
      identity: owner, allocatorJobId, prerequisites: observed,
    }), worker)
    const assignment = publish('assignment', createMacHostCohortAssignment({
      identity, allocatorJobId, announcement, assignments,
    }), worker)
    assignments.push(assignment)
    const receipt = createMacHostCohortWorkerReceipt({
      identity: owner, allocatorJobId, ready, announcement, assignment, prerequisites: observed,
    })
    const role = receipt.role
    receipts.push(receipt)
    jobs.push({
      id: owner.jobId,
      name: macHostCohortWorkerName(worker),
      run_id: identity.runId,
      run_attempt: identity.runAttempt,
      status: 'completed',
      conclusion: 'success',
    })
    const directory = join(
      evidenceDirectory,
      `macos-cohort-worker-${worker}-${sourceRevision}-r${identity.runId}-a${identity.runAttempt}`,
    )
    directories.push(directory)
    await mkdir(directory)
    await writeFile(join(directory, 'worker.json'), JSON.stringify(receipt))
    await writeFile(join(directory, 'prerequisites.json'), JSON.stringify(observed))
    await writeFile(join(directory, 'source.txt'), `${sourceRevision}\n`)
    if (role === null) continue
    for (const file of ['CANDIDATE.json', 'ARTIFACT.json'])
      await writeFile(join(directory, file), await readFile(join(bundleDirectory, file)))
    await writeFile(join(directory, `shard-${role}.complete`), `${sourceRevision} arm64 ${role}\n`)
    await writeFile(
      join(directory, 'test-plan.json'),
      JSON.stringify({
        architecture: 'arm64',
        shard: role,
        shardCount: shards.length,
        installed: role === shards.length - 1,
        groups: shards[role].groups,
        nativeFiles: role === 0 ? NATIVE_PREREQUISITE_TESTS : [],
      }),
    )
    for (const [index, group] of shards[role].groups.entries())
      await writeFile(join(directory, `shard-${role}-group-${index}.xml`), xml([group.file]))
    if (role === 0)
      await writeFile(join(directory, 'native-tests.xml'), xml(NATIVE_PREREQUISITE_TESTS))
    if (role === shards.length - 1)
      await writeFile(join(directory, 'installed-startup.xml'), xml([INSTALLED_STARTUP_TEST]))
  }
  publish('ledger', createMacHostCohortLedger({ identity, allocatorJobId, ready, assignments }))
  for (const [id, name] of [
    [allocatorJobId, MAC_COHORT_ALLOCATOR_NAME],
    [9001, MAC_COHORT_READY_JOB_NAME],
  ]) jobs.push({
    id, name, run_id: identity.runId, run_attempt: identity.runAttempt,
    status: 'completed', conclusion: 'success',
  })
  const options = {
    repository,
    identity,
    evidenceDirectory,
    normalizedDirectory,
    bundleDirectory,
    records,
    jobs,
  }
  return {
    ...options,
    temporary,
    files,
    shards,
    receipts,
    directories,
    reconcile: (changes = {}) => reconcileMacHostCohortReports({ ...options, ...changes }),
  }
}

async function refusesBeforeNormalization(f, changes = {}, pattern) {
  await assert.rejects(f.reconcile(changes), pattern)
  assert.equal(existsSync(f.normalizedDirectory), false)
}

const coordinationIdentity = { sourceRevision: 'a'.repeat(40), runId: 500, runAttempt: 2 }
const allocatorJobId = 9000
const coordinationJob = (id, name, status = 'in_progress') => ({
  id, name, run_id: coordinationIdentity.runId, run_attempt: coordinationIdentity.runAttempt,
  status, conclusion: null,
})
const coordinationJobs = () => [
  coordinationJob(allocatorJobId, MAC_COHORT_ALLOCATOR_NAME),
  coordinationJob(9001, MAC_COHORT_READY_JOB_NAME),
  coordinationJob(9002, 'Acquire canonical macos host artifacts'),
  ...Array.from({ length: 5 }, (_, worker) =>
    coordinationJob(1000 + worker, macHostCohortWorkerName(worker), 'queued')),
]

// A real controlled HTTP service persists each publication in a temporary
// directory and serves the actual ZIP bytes. It can lose an upload response
// after publication. These are coordination protocol tests, not native proof.
async function coordinationProtocol(t, { dropAssignmentResponse = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'jig-mac-coordination-'))
  const published = join(directory, 'published')
  const jobsPath = join(directory, 'jobs.json')
  const requestsPath = join(directory, 'requests.jsonl')
  await mkdir(published)
  await writeFile(jobsPath, JSON.stringify(coordinationJobs()))
  await writeFile(requestsPath, '')
  const entries = async () => Promise.all(
    (await readdir(published)).sort().map(async (id) => ({
      artifact: JSON.parse(await readFile(join(published, id, 'artifact.json'), 'utf8')),
      record: JSON.parse(await readFile(join(published, id, 'record.json'), 'utf8')),
    })),
  )
  let publication = Promise.resolve()
  const server = createServer(async (request, response) => {
    try {
      await appendFile(requestsPath, JSON.stringify({ method: request.method, path: request.url }) + '\n')
      if (request.method === 'GET' && request.url === '/jobs') {
        response.setHeader('content-type', 'application/json')
        response.end(await readFile(jobsPath))
      } else if (request.method === 'GET' && request.url === '/artifacts') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify((await entries()).map(({ artifact }) => artifact)))
      } else if (request.method === 'GET' && /^\/artifacts\/[0-9]+\/zip$/.test(request.url)) {
        response.end(await readFile(join(published, request.url.split('/')[2], 'record.zip')))
      } else if (request.method === 'POST' && request.url === '/artifacts') {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        const { name, record } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const save = publication.then(async () => {
          const id = 2000 + (await readdir(published)).length
          const staging = await mkdtemp(join(directory, 'upload-'))
          const source = JSON.stringify(record) + '\n'
          const archive = execFileSync('python3', ['-I', '-c',
            'import io,sys,zipfile\nout=io.BytesIO()\nwith zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as archive: archive.writestr("record.json",sys.stdin.buffer.read())\nsys.stdout.buffer.write(out.getvalue())',
          ], { input: source })
          const artifact = { id, name, digest: 'sha256:' + digest(archive), size_in_bytes: archive.length, expired: false }
          await writeFile(join(staging, 'record.json'), source)
          await writeFile(join(staging, 'record.zip'), archive)
          await writeFile(join(staging, 'artifact.json'), JSON.stringify(artifact))
          await rename(staging, join(published, String(id)))
          return artifact
        })
        publication = save.then(() => undefined, () => undefined)
        const artifact = await save
        if (dropAssignmentResponse && name.startsWith('macos-cohort-assignment-')) {
          request.socket.destroy()
          return
        }
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ id: artifact.id, name: artifact.name, digest: artifact.digest }))
      } else {
        response.writeHead(404)
        response.end()
      }
    } catch (error) {
      response.writeHead(500)
      response.end(error.message)
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    const stopped = once(server, 'close')
    server.closeAllConnections()
    server.close()
    await stopped
    await publication
    await rm(directory, { recursive: true, force: true })
  })
  const origin = 'http://127.0.0.1:' + server.address().port
  const json = async (path, options) => {
    const response = await fetch(origin + path, { ...options, signal: AbortSignal.timeout(5000) })
    assert.equal(response.status, 200)
    return response.json()
  }
  const artifacts = {
    upload: (name, record) => json('/artifacts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, record }),
    }),
  }
  const publish = async (type, record, worker) => ({
    artifact: await artifacts.upload(macHostCohortArtifactName(type, coordinationIdentity, worker), record),
    record,
  })
  const setJob = async (id, change) => {
    const jobs = JSON.parse(await readFile(jobsPath, 'utf8'))
    const selected = jobs.find((job) => job.id === id)
    assert.ok(selected)
    Object.assign(selected, change)
    await writeFile(jobsPath + '.next', JSON.stringify(jobs))
    await rename(jobsPath + '.next', jobsPath)
  }
  const reader = () => macHostCohortRecordReader({
    identity: coordinationIdentity,
    listArtifacts: () => json('/artifacts'),
    download: async (artifact) => {
      const response = await fetch(origin + '/artifacts/' + artifact.id + '/zip', {
        signal: AbortSignal.timeout(5000),
      })
      assert.equal(response.status, 200)
      return decodeMacHostCohortRecord(new Uint8Array(await response.arrayBuffer()), artifact)
    },
  })
  return {
    identity: coordinationIdentity, allocatorJobId, artifacts, publish, setJob, entries,
    metadataPath: (id) => join(published, String(id), 'artifact.json'),
    readJobs: () => json('/jobs'), readRecords: reader(), reader,
    deadlineMs: Date.now() + 60_000,
    announce: async (worker, build = '24H232') => {
      await setJob(1000 + worker, { status: 'in_progress' })
      return publish('announcement', createMacHostCohortAnnouncement({
        identity: { ...coordinationIdentity, worker, jobId: 1000 + worker },
        allocatorJobId, prerequisites: prerequisites(build),
      }), worker)
    },
    waitForRecord: async (type, worker) => {
      const name = macHostCohortArtifactName(type, coordinationIdentity, worker)
      const deadline = Date.now() + 45_000
      for (;;) {
        const entry = (await entries()).find(({ artifact }) => artifact.name === name)
        if (entry) return entry
        if (Date.now() >= deadline) throw new Error('Protocol publication was not observed')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    },
    requests: async () => (await readFile(requestsPath, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse),
  }
}

test('the singleton allocator publishes arriving roles without waiting for queued Mac predecessors', async (t) => {
  const f = await coordinationProtocol(t)
  await f.announce(4)
  const allocation = allocateMacHostRoles(f)
  await f.waitForRecord('assignment', 4)
  assert.ok((await f.readJobs()).filter((job) => job.name.startsWith('Native host worker') && job.id !== 1004)
    .every((job) => job.status === 'queued'))
  for (const worker of [1, 0, 3, 2]) await f.announce(worker, [1, 3].includes(worker) ? '24G830' : '24H232')
  const result = await allocation
  assert.deepEqual(result.assignments.map(({ record }) => [record.worker, record.role])
    .sort(([left], [right]) => left - right), [
    [0, 1], [1, 0], [2, 2], [3, 1], [4, 0],
  ])
  assert.deepEqual(result.ledger.record.assignmentArtifacts, result.assignments.map(({ artifact }) => artifact))
  assert.equal((await f.entries()).length, 12)
})

test('a lost upload response leaves one durable assignment and aborts without reassignment', async (t) => {
  const f = await coordinationProtocol(t, { dropAssignmentResponse: true })
  await f.announce(3)
  await assert.rejects(allocateMacHostRoles(f), /fetch failed/)
  const entries = await f.entries()
  assert.equal(entries.filter(({ artifact }) => artifact.name.startsWith('macos-cohort-assignment-')).length, 1)
  assert.equal(entries.some(({ artifact }) => artifact.name.startsWith('macos-cohort-ledger-')), false)
})

test('the real readiness and assignment readers consume published records and enforce an expired work bound', async (t) => {
  const f = await coordinationProtocol(t)
  const ready = await f.publish('ready', createMacHostCohortReady(f))
  assert.equal((await waitForMacHostAllocator(f)).artifact.id, ready.artifact.id)
  const assignments = []
  for (const worker of [0, 1, 2, 3]) {
    const announcement = await f.announce(worker, [1, 3].includes(worker) ? '24G830' : '24H232')
    assignments.push(await f.publish('assignment', createMacHostCohortAssignment({
      ...f, announcement, assignments,
    }), worker))
  }
  await f.setJob(1004, { status: 'in_progress' })
  const receipt = awaitMacHostRole({
    ...f, identity: { ...f.identity, worker: 4, jobId: 1004 },
    prerequisites: prerequisites('24H232'),
  })
  const announcement = await f.waitForRecord('announcement', 4)
  assignments.push(await f.publish('assignment', createMacHostCohortAssignment({
    ...f, announcement, assignments,
  }), 4))
  await f.publish('ledger', createMacHostCohortLedger({ ...f, ready, assignments }))
  await f.setJob(allocatorJobId, { status: 'completed', conclusion: 'success' })
  const actual = await receipt
  assert.equal(actual.role, 2)
  assert.equal(actual.worker, 4)
  await assert.rejects(waitForMacHostAllocator(f), /allocator completed before worker readiness/)

  const pending = await coordinationProtocol(t)
  await assert.rejects(waitForMacHostAllocator({
    ...pending, deadlineMs: Date.now() + 150,
  }), /coordination deadline/)
  const stopped = await coordinationProtocol(t)
  await stopped.setJob(allocatorJobId, { status: 'completed', conclusion: 'failure' })
  await assert.rejects(waitForMacHostAllocator(stopped), /allocator did not succeed/)
})

test('real record polling caches ZIP transfers and refuses changed metadata or duplicate publications', async (t) => {
  const f = await coordinationProtocol(t)
  const ready = await f.publish('ready', createMacHostCohortReady(f))
  assert.equal((await f.readRecords()).length, 1)
  assert.equal((await f.readRecords()).length, 1)
  assert.equal((await f.requests()).filter(({ path }) => path.endsWith('/zip')).length, 1)
  const original = await readFile(f.metadataPath(ready.artifact.id), 'utf8')
  await writeFile(f.metadataPath(ready.artifact.id), JSON.stringify({
    ...JSON.parse(original), digest: 'sha256:' + 'f'.repeat(64),
  }))
  await assert.rejects(f.readRecords(), /immutable artifact metadata changed/)
  await writeFile(f.metadataPath(ready.artifact.id), original)
  const duplicate = await f.publish('ready', ready.record)
  await assert.rejects(f.readRecords(), /duplicate record artifacts/)
  const second = JSON.parse(await readFile(f.metadataPath(duplicate.artifact.id), 'utf8'))
  await writeFile(f.metadataPath(duplicate.artifact.id), JSON.stringify({
    ...second, id: ready.artifact.id, name: macHostCohortArtifactName('ledger', f.identity),
  }))
  await assert.rejects(f.readRecords(), /duplicate record artifacts/)
  assert.equal((await f.requests()).filter(({ path }) => path.endsWith('/zip')).length, 1)
  assert.equal((await f.entries()).length, 2)
})

test('coordination deadlines and polling delays preserve absolute caps without a fake clock', () => {
  const now = 1_000_000
  assert.equal(macHostCohortCoordinationDeadline('ready', now + 1_000_000, now), now + 180_000)
  assert.equal(macHostCohortCoordinationDeadline('claim', now + 1_000_000, now), now + 120_000)
  for (const mode of ['ready', 'claim', 'allocate']) {
    assert.equal(macHostCohortCoordinationDeadline(mode, now + 35_000, now), now + 35_000)
    assert.throws(() => macHostCohortCoordinationDeadline(mode, now, now), /coordination deadline/)
  }
  assert.equal(macHostCohortCoordinationDeadline('claim', now + 120_000, now + 30_000), now + 120_000)
  assert.equal(macHostCohortPollDelay(now, now), 5000)
  assert.equal(macHostCohortPollDelay(now, now + 59_999), 5000)
  assert.equal(macHostCohortPollDelay(now, now + 60_000), 15_000)
  assert.equal(macHostCohortPollDelay(now + 60_000, now + 60_000), 5000)
})

test('observed acquisition, readiness, and native failures make further allocation impossible', () => {
  const identity = coordinationIdentity
  for (const name of [
    'Acquire canonical macos host artifacts', MAC_COHORT_READY_JOB_NAME,
    macHostCohortWorkerName(3), 'prerequisites',
    "github.event_name == 'pull_request' && format('Native host worker — {0} / {1}', matrix.arch, matrix.worker) || format('Native host shard — {0} / 0', matrix.arch)",
  ]) {
    for (const conclusion of ['failure', 'cancelled', 'skipped']) {
      const jobs = coordinationJobs()
      if (!jobs.some((job) => job.name === name)) jobs.push(coordinationJob(1100, name))
      Object.assign(jobs.find((job) => job.name === name), { status: 'completed', conclusion })
      assert.throws(() => requireMacHostAllocationProgress(jobs, identity, allocatorJobId),
        /prerequisite or worker did not succeed/)
    }
  }
  assert.doesNotThrow(() => requireMacHostAllocationProgress(coordinationJobs(), identity, allocatorJobId))
})

test('allocator selection rejects missing, duplicate, stale, inactive, or failed jobs', () => {
  const jobs = coordinationJobs()
  assert.equal(selectMacHostAllocatorJob(jobs, coordinationIdentity), allocatorJobId)
  for (const observed of [
    [], [jobs[0], { ...jobs[0], id: 9005 }],
    ...[
      { id: 0 }, { run_id: 499 }, { run_attempt: 1 }, { status: 'queued' },
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'failure' },
    ].map((change) => [{ ...jobs[0], ...change }]),
  ]) assert.throws(() => selectMacHostAllocatorJob(observed, coordinationIdentity), /allocator/)
})

test('only PRs select five ARM workers; main and manual execution retain one complete host', () => {
  assert.deepEqual(macHostWorkerMatrix('pull_request'), {
    include: Array.from({ length: 5 }, (_, worker) => ({ arch: 'arm64', worker })),
  })
  for (const event of ['push', 'workflow_dispatch'])
    assert.deepEqual(macHostWorkerMatrix(event), { include: [{ arch: 'arm64', worker: 0 }] })
  for (const event of [undefined, '', 'pull_request_target', 'workflow_run'])
    assert.throws(() => macHostWorkerMatrix(event), /Unknown hosted Mac workflow event/)
})

test('a claim binds to one actual active worker job in the current run attempt', () => {
  const identity = { sourceRevision: 'a'.repeat(40), runId: 500, runAttempt: 2, worker: 2 }
  const job = {
    id: 1002,
    name: 'Native host worker — arm64 / 2',
    run_id: 500,
    run_attempt: 2,
    status: 'in_progress',
    conclusion: null,
  }
  assert.equal(
    selectMacHostWorkerJob(
      [{ ...job, id: 900, name: 'Quick development checks' }, job],
      identity,
    ),
    1002,
  )
  for (const jobs of [
    undefined,
    [],
    [job, { ...job, id: 1003 }],
    ...[
      { id: 0 },
      { id: '1002' },
      { run_id: 499 },
      { run_attempt: 1 },
      { name: 'Native host worker — arm64 / 1' },
      { status: 'queued' },
      { status: 'completed', conclusion: 'success' },
      { conclusion: 'failure' },
    ].map((changes) => [{ ...job, ...changes }]),
  ])
    assert.throws(() => selectMacHostWorkerJob(jobs, identity), /unique active current-attempt/)
  for (const worker of [-1, 5, '2'])
    assert.throws(() => selectMacHostWorkerJob([job], { ...identity, worker }), /worker index/)
})

test('3+2 workers validate every executed role and normalize one complete exact profile', async (t) => {
  const f = await fixture(t)
  const result = await f.reconcile()
  assert.equal(Object.hasOwn(result, 'qualified'), false)
  assert.equal(result.profile.build, '24H232')
  assert.deepEqual(result.roles.map(({ worker, role }) => ({ worker, role })), [
    { worker: 0, role: 0 },
    { worker: 2, role: 1 },
    { worker: 4, role: 2 },
  ])
  assert.deepEqual(result.reports.map(({ worker, role }) => ({ worker, role })), [
    { worker: 0, role: 0 },
    { worker: 1, role: 0 },
    { worker: 2, role: 1 },
    { worker: 3, role: 1 },
    { worker: 4, role: 2 },
  ])
  assert.ok(result.reports.every((report) => report.executed > 0))
  assert.deepEqual(
    (await readdir(f.normalizedDirectory)).sort(),
    [0, 1, 2].map((role) => `macos-prerequisites-arm64-${role}-${f.identity.sourceRevision}`),
  )
  const complete = readMacReports({
    repository: f.repository,
    source: f.identity.sourceRevision,
    targetId: 'macos-arm64',
    evidenceDirectory: f.normalizedDirectory,
    detailed: true,
    plan: 'pull-request',
  })
  assert.equal(complete.qualified, true)
  assert.equal(complete.executed, f.files.length)
  assert.equal(complete.hostProfile.build, '24H232')
  assert.equal(
    result.reports
      .filter(({ worker }) => [0, 2, 4].includes(worker))
      .reduce((total, report) => total + report.executed, 0),
    f.files.length,
  )
})

test('an incomplete or skipped minority role prevents normalization of the complete majority', async (t) => {
  const f = await fixture(t)
  const directory = f.directories[3]
  const file = f.shards[1].groups[0].file
  const path = join(directory, 'shard-1-group-0.xml')
  const original = await readFile(path)
  for (const malformed of [xml([]), xml([file], '<skipped/>'), xml([file], '<failure/>')]) {
    await writeFile(path, malformed)
    await refusesBeforeNormalization(f)
  }
  await rm(path)
  assert.equal(existsSync(path), false)
  await refusesBeforeNormalization(f)
  await writeFile(path, original)
  await rm(join(directory, 'shard-1.complete'))
  await refusesBeforeNormalization(f, {}, /ENOENT/)
})

test('minority candidate drift and a failed minority job cannot be discarded', async (t) => {
  const f = await fixture(t)
  for (const file of ['CANDIDATE.json', 'ARTIFACT.json']) {
    const path = join(f.directories[1], file)
    const original = await readFile(path)
    await writeFile(path, `${original.toString()}\n`)
    await refusesBeforeNormalization(f, {}, /different canonical candidate/)
    await writeFile(path, original)
  }
  for (const changes of [
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { status: 'in_progress', conclusion: null },
    { run_attempt: 1 },
  ]) {
    const jobs = f.jobs.map((job, worker) => (worker === 1 ? { ...job, ...changes } : job))
    await refusesBeforeNormalization(f, { jobs }, /each exact current-attempt job/)
  }
})

test('worker receipts, native prerequisites and source markers remain current and mutually bound', async (t) => {
  const f = await fixture(t)
  const directory = f.directories[1]
  const receiptPath = join(directory, 'worker.json')
  const receipt = f.receipts[1]
  for (const changes of [
    { worker: 0 },
    { sourceRevision: 'a'.repeat(40) },
    { runId: 499 },
    { runAttempt: 1 },
    { jobId: 999 },
    { qualified: true },
  ]) {
    await writeFile(receiptPath, JSON.stringify({ ...receipt, ...changes }))
    await refusesBeforeNormalization(f)
  }
  await writeFile(receiptPath, JSON.stringify(receipt))
  await writeFile(join(directory, 'source.txt'), `${'a'.repeat(40)}\n`)
  await refusesBeforeNormalization(f, {}, /worker or source/)
  await writeFile(join(directory, 'source.txt'), `${f.identity.sourceRevision}\n`)
  await writeFile(join(directory, 'prerequisites.json'), JSON.stringify(prerequisites('24H232')))
  await refusesBeforeNormalization(f, {}, /assignment differs from its announced worker and profile/)
})

test('all five exact directories and regular files are required, without linked evidence', async (t) => {
  const f = await fixture(t)
  const extra = join(f.evidenceDirectory, 'unexpected-worker')
  await mkdir(extra)
  await refusesBeforeNormalization(f, {}, /exactly five current-attempt/)
  await rm(extra, { recursive: true })
  const current = f.directories[1]
  const stale = current.replace(/-a2$/, '-a1')
  await rename(current, stale)
  await refusesBeforeNormalization(f, {}, /exactly five current-attempt/)
  await rename(stale, current)
  const linkedFile = join(current, 'linked.xml')
  await symlink(join(current, 'native-tests.xml'), linkedFile)
  await refusesBeforeNormalization(f, {}, /only regular files/)
  await rm(linkedFile)
  const moved = join(f.temporary, 'moved-worker')
  await rename(current, moved)
  await symlink(moved, current)
  await refusesBeforeNormalization(f, {}, /unlinked directory/)
})

test('same-profile surplus workers retain no execution proof and still need successful current jobs', async (t) => {
  const f = await fixture(t, Array(5).fill('24G830'))
  const result = await f.reconcile()
  assert.equal(result.profile.build, '24G830')
  assert.deepEqual(result.workers.map(({ role }) => role), [0, 1, 2, null, null])
  assert.equal(result.reports.length, 3)
  await rm(f.normalizedDirectory, { recursive: true })
  for (const file of [
    'unexpected.xml',
    'shard-0.complete',
    'test-plan.json',
    'CANDIDATE.json',
    'ARTIFACT.json',
    'host-conformance.txt',
  ]) {
    const path = join(f.directories[3], file)
    await writeFile(path, 'unexpected execution proof')
    await refusesBeforeNormalization(f, {}, /Surplus Mac cohort worker/)
    await rm(path)
  }
  const jobs = f.jobs.map((job, worker) =>
    worker === 4 ? { ...job, conclusion: 'failure' } : job,
  )
  await refusesBeforeNormalization(f, { jobs }, /each exact current-attempt job/)
})

test('all allocator records are required, including minority announcements and assignments', async (t) => {
  const f = await fixture(t)
  for (const missing of f.records) {
    await refusesBeforeNormalization(f, {
      records: f.records.filter((entry) => entry !== missing),
    }, /complete ready, announcement, assignment and ledger inventory/)
  }
  const stale = structuredClone(f.records)
  stale.find(({ record }) => record.worker === 1).record.runAttempt--
  await refusesBeforeNormalization(f, { records: stale }, /foreign source, run, attempt or allocator/)
  const changed = structuredClone(f.records)
  changed.find(({ record }) => record.worker === 1).artifact.digest = `sha256:${'f'.repeat(64)}`
  await refusesBeforeNormalization(f, { records: changed }, /assignment differs from its announced worker/)
  for (const name of [MAC_COHORT_ALLOCATOR_NAME, MAC_COHORT_READY_JOB_NAME])
    for (const conclusion of ['failure', 'cancelled', 'skipped'])
      await refusesBeforeNormalization(f, {
        jobs: f.jobs.map((job) => job.name === name ? { ...job, conclusion } : job),
      }, /each exact current-attempt job/)
})

test('the canonical archive and artifact envelope are independently verified', async (t) => {
  const f = await fixture(t)
  const archive = join(f.bundleDirectory, 'jig/jig.tgz')
  const original = await readFile(archive)
  await writeFile(archive, 'changed archive')
  await refusesBeforeNormalization(f, {}, /archive digest/)
  await writeFile(archive, original)
  const path = join(f.bundleDirectory, 'ARTIFACT.json')
  const artifact = JSON.parse(await readFile(path, 'utf8'))
  await writeFile(path, JSON.stringify({ ...artifact, runAttempt: artifact.runAttempt + 1 }))
  await refusesBeforeNormalization(f, {}, /artifact envelope mismatch/)
})

test('normalization refuses an existing destination and preserves its retained contents', async (t) => {
  const f = await fixture(t)
  await mkdir(f.normalizedDirectory)
  const canary = join(f.normalizedDirectory, 'earlier-attempt.txt')
  await writeFile(canary, 'retain existing evidence\n')
  await assert.rejects(f.reconcile(), { code: 'EEXIST' })
  assert.deepEqual(await readdir(f.normalizedDirectory), ['earlier-attempt.txt'])
  assert.equal(await readFile(canary, 'utf8'), 'retain existing evidence\n')
})
