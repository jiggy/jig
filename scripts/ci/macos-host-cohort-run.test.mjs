import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
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
  macHostCohortClaimName,
  macHostCohortProfile,
  macHostCohortWorkerName,
} from './macos-host-cohort.mjs'
import {
  macHostWorkerMatrix,
  reconcileMacHostCohortReports,
  selectMacHostWorkerJob,
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
  const claims = []
  const jobs = []
  const receipts = []
  const directories = []
  const nextRoles = new Map()
  for (const [worker, build] of builds.entries()) {
    const observed = prerequisites(build)
    const profile = macHostCohortProfile(observed)
    const nextRole = nextRoles.get(build) ?? 0
    nextRoles.set(build, nextRole + 1)
    const role = nextRole < 3 ? nextRole : null
    const owner = { ...identity, worker, jobId: 1000 + worker }
    let artifact = null
    if (role !== null) {
      const claim = { kind: 'macos-host-cohort-claim/1', ...owner, profile, role }
      artifact = {
        id: 2000 + worker,
        name: macHostCohortClaimName(identity, profile, role),
        digest: `sha256:${digest(JSON.stringify(claim))}`,
      }
      claims.push({ artifact, claim })
    }
    const receipt = {
      kind: 'macos-host-cohort-worker/1',
      ...owner,
      profile,
      role,
      claimArtifact: artifact,
      conflicts: Array.from({ length: role ?? 3 }, (_, prior) =>
        macHostCohortClaimName(identity, profile, prior),
      ),
    }
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
  const options = {
    repository,
    identity,
    evidenceDirectory,
    normalizedDirectory,
    bundleDirectory,
    claims,
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
    await refusesBeforeNormalization(f, { jobs }, /each exact current-attempt worker job/)
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
  await refusesBeforeNormalization(f, {}, /profile differs from its native prerequisites/)
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
  await refusesBeforeNormalization(f, { jobs }, /each exact current-attempt worker job/)
})

test('all finalized claims are required, including owners from the minority profile', async (t) => {
  const f = await fixture(t)
  const missing = f.claims.filter(({ claim }) => claim.worker !== 1)
  await refusesBeforeNormalization(f, { claims: missing }, /finalized claim inventory/)
  const stale = structuredClone(f.claims)
  stale.find(({ claim }) => claim.worker === 1).claim.runAttempt--
  await refusesBeforeNormalization(f, { claims: stale }, /foreign source, run or attempt/)
  const changed = structuredClone(f.claims)
  changed.find(({ claim }) => claim.worker === 1).artifact.digest = `sha256:${'f'.repeat(64)}`
  await refusesBeforeNormalization(f, { claims: changed }, /does not belong to its executing worker/)
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
