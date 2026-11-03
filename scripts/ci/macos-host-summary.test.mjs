import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'
import {
  digest,
  PACKAGE_LAYOUT,
  RELEASE_PACKAGE_LAYOUT,
  writeCandidateReceipt,
} from './candidate-provenance.mjs'
import {
  macHostCohortArtifactName,
  macHostCohortProfile,
  macHostCohortWorkerName,
} from './macos-host-cohort.mjs'
import {
  INSTALLED_STARTUP_TEST,
  macHostShardCount,
  NATIVE_PREREQUISITE_TESTS,
  planMacHostTests,
} from './macos-host-test-shards.mjs'

import { filesForTarget, gitRepositoryTests } from './suite-inventory.mjs'

const repository = resolve(import.meta.dirname, '../..')
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repository,
  encoding: 'utf8',
}).trim()
const catalog = JSON.parse(await readFile(new URL('./test-suites.json', import.meta.url), 'utf8'))
const testcase = (file, name, child = '') =>
  `<testcase file="${file}" classname="host proof" name="${name}" line="1">${child}</testcase>`
// Bun emits nested suites. Count actual cases, never their parent totals.
const junit = (cases) =>
  `<testsuites tests="${(cases.match(/<testcase\b/g) ?? []).length}"><testsuite><testsuite>${cases}</testsuite></testsuite></testsuites>`
const prerequisites = (arch) => ({
  kind: 'macos-host-prerequisites/1',
  arch,
  kernel: '24.6.0',
  build: arch === 'arm64' ? '24H232' : '24G830',
  bun: '1.4.2',
  revision: '744846f844374847c902b5e7fd59b4342a51ef99',
  processIdentityBytes: 56,
  coalitionIdentityBytes: 40,
  coalitionUsageBytes: 296,
  pidVersion: 1,
  backendQualified: false,
})

async function fixture(
  architecture,
  run,
  { plan = 'complete', sourceRepository = repository, sourceRevision = revision } = {},
) {
  const root = await mkdtemp(resolve(tmpdir(), 'jig-mac-summary-'))
  try {
    const count = macHostShardCount(architecture, plan)
    const directories = []
    const files = filesForTarget(
      gitRepositoryTests(sourceRepository, sourceRevision),
      `macos-${architecture}`,
      catalog,
    )
    const plans = planMacHostTests(files, architecture, { plan }).map((shard) => ({
      architecture,
      shard: shard.index,
      shardCount: count,
      installed: shard.index === count - 1,
      groups: shard.groups,
      nativeFiles: shard.index === 0 ? NATIVE_PREREQUISITE_TESTS : [],
    }))
    for (const plan of plans) {
      const shard = plan.shard
      const directory = resolve(
        root,
        `macos-prerequisites-${architecture}-${shard}-${sourceRevision}`,
      )
      await mkdir(directory)
      directories.push(directory)
      await writeFile(
        resolve(directory, 'prerequisites.json'),
        JSON.stringify(prerequisites(architecture)),
      )
      await writeFile(resolve(directory, 'test-plan.json'), JSON.stringify(plan))
      await writeFile(
        resolve(directory, `shard-${shard}.complete`),
        `${sourceRevision} ${architecture} ${shard}\n`,
      )
      for (const [index, group] of plan.groups.entries())
        await writeFile(
          resolve(directory, `shard-${shard}-group-${index}.xml`),
          junit(testcase(group.file, 'executes proof')),
        )
      if (shard === 0)
        await writeFile(
          resolve(directory, 'native-tests.xml'),
          junit(
            NATIVE_PREREQUISITE_TESTS.map((file) => testcase(file, 'native prerequisite')).join(''),
          ),
        )
      if (plan.installed)
        await writeFile(
          resolve(directory, 'installed-startup.xml'),
          junit(testcase(INSTALLED_STARTUP_TEST, 'starts pinned client offline')),
        )
    }
    const jobs = Array.from({ length: count }, (_, shard) => ({
      name: `Native host shard — ${architecture} / ${shard}`,
      status: 'completed',
      created_at: '2026-10-01T00:00:00Z',
      started_at: '2026-10-01T00:02:00Z',
      completed_at: '2026-10-01T00:12:00Z',
    }))
    const jobsPath = resolve(root, 'jobs.json')
    await writeFile(jobsPath, JSON.stringify(jobs))
    const summarize = async (expectedShardCount = count, environment = {}, timeout) => {
      const output = resolve(root, 'summary.json')
      const result = spawnSync(
        'python3',
        [
          resolve(repository, 'scripts/ci/macos-host-summary.py'),
          architecture,
          sourceRevision,
          String(expectedShardCount),
          root,
          jobsPath,
          output,
        ],
        {
          cwd: sourceRepository,
          encoding: 'utf8',
          timeout,
          env: {
            ...process.env,
            JIG_MACOS_TEST_PLAN: plan,
            GITHUB_EVENT_NAME: plan === 'pull-request' ? 'pull_request' : 'push',
            GITHUB_RUN_ID: '42',
            GITHUB_RUN_ATTEMPT: '2',
            ...environment,
          },
        },
      )
      assert.equal(result.error, undefined)
      return { ...result, report: JSON.parse(await readFile(output, 'utf8')) }
    }
    await run({
      root,
      architecture,
      plan,
      sourceRepository,
      sourceRevision,
      count,
      directories,
      plans,
      jobs,
      jobsPath,
      summarize,
      expectedCount: files.length,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function addCohortReceipts(f) {
  const workers = [4, 0, 2]
  const identity = { sourceRevision: f.sourceRevision, runId: 42, runAttempt: 2 }
  const profile = macHostCohortProfile(prerequisites('arm64'))
  const receipts = []
  const start = Date.parse('2026-10-01T00:00:00Z')
  const timestamp = (seconds) => new Date(start + seconds * 1000).toISOString()
  const jobs = Array.from({ length: 5 }, (_, worker) => ({
    id: 1000 + worker,
    name: macHostCohortWorkerName(worker),
    run_id: identity.runId,
    run_attempt: identity.runAttempt,
    status: 'completed',
    conclusion: 'success',
    created_at: timestamp(0),
    started_at: timestamp(60 * (worker + 1)),
    completed_at: timestamp(60 * (worker + 1) + 500 + 100 * worker),
  }))
  for (const [role, worker] of workers.entries()) {
    const receipt = {
      kind: 'macos-host-cohort-worker/2',
      ...identity,
      worker,
      jobId: 1000 + worker,
      allocatorJobId: 900,
      profile,
      role,
      readyArtifact: {
        id: 2000,
        name: macHostCohortArtifactName('ready', identity),
        digest: `sha256:${'2'.repeat(64)}`,
      },
      announcementArtifact: {
        id: 3000 + worker,
        name: macHostCohortArtifactName('announcement', identity, worker),
        digest: `sha256:${'3'.repeat(64)}`,
      },
      assignmentArtifact: {
        id: 4000 + worker,
        name: macHostCohortArtifactName('assignment', identity, worker),
        digest: `sha256:${'4'.repeat(64)}`,
      },
    }
    receipts.push(receipt)
    await writeFile(resolve(f.directories[role], 'worker.json'), JSON.stringify(receipt))
  }
  await writeFile(f.jobsPath, JSON.stringify([...jobs].reverse()))
  return { ...f, workers, receipts, jobs }
}

// Small real source inventories keep repeated diagnostic refusals inexpensive.
// Inert receipts and reports establish parser behavior, never native execution.
async function cohortFixture(run) {
  const sourceRepository = await mkdtemp(resolve(tmpdir(), 'jig-mac-summary-source-'))
  try {
    const git = (args) => execFileSync('git', ['-C', sourceRepository, ...args], { encoding: 'utf8' })
    git(['init', '--quiet'])
    const files = [
      ...NATIVE_PREREQUISITE_TESTS,
      INSTALLED_STARTUP_TEST,
      ...Array.from({ length: 12 }, (_, index) => `packages/jig/test/host/summary-${index}.test.ts`),
    ]
    for (const file of files) {
      await mkdir(dirname(resolve(sourceRepository, file)), { recursive: true })
      await writeFile(resolve(sourceRepository, file), 'test("fixture case", () => {})\n')
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
    await fixture('arm64', async (f) => run(await addCohortReceipts(f)), {
      plan: 'pull-request',
      sourceRepository,
      sourceRevision,
    })
  } finally {
    await rm(sourceRepository, { recursive: true, force: true })
  }
}

test('summary projects the single complete validator and optional timings on both architectures', async () => {
  for (const arch of ['x64', 'arm64'])
    await fixture(arch, async (f) => {
      let result = await f.summarize()
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.report.executed, f.expectedCount)
      assert.equal(result.report.qualified, true)
      assert.equal(result.report.timing_available, true)
      assert.equal(result.report.shards.length, f.count)
      assert.ok(
        result.report.shards.every(
          (row) => row.timing.wait_seconds === 120 && row.timing.job_seconds === 600,
        ),
      )
      result = await f.summarize(f.count - 1)
      assert.equal(result.status, 1)
      assert.equal(result.report.qualified, false)
      await writeFile(f.jobsPath, 'malformed optional timing')
      result = await f.summarize()
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.report.qualified, true)
      assert.equal(result.report.timing_available, false)
      const lastShard = f.count - 1
      const marker = resolve(f.directories[lastShard], `shard-${lastShard}.complete`)
      await rm(marker)
      await assert.rejects(readFile(marker), { code: 'ENOENT' })
      const missing = spawnSync(
        'node',
        ['-e', 'require("node:fs").readFileSync(process.argv[1])', marker],
        {
          encoding: 'utf8',
        },
      )
      assert.equal(missing.status, 1, missing.stderr)
      assert.match(missing.stderr, /ENOENT/)
      result = await f.summarize()
      assert.equal(result.status, 1, `${arch}: ${result.stdout}${result.stderr}`)
      assert.equal(result.report.qualified, false)
      assert.match(result.stdout, /Qualification: \*\*failed\*\*/)
    })
})

test('summary names only the build tested by the complete ARM host', async () => {
  await fixture('arm64', async (f) => {
    assert.equal(f.count, 1)
    for (const build of ['24G830', '24H232']) {
      await writeFile(
        resolve(f.directories[0], 'prerequisites.json'),
        JSON.stringify({ ...prerequisites('arm64'), build }),
      )
      const result = await f.summarize()
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.report.executed, f.expectedCount)
      assert.deepEqual(result.report.hostProfile, {
        arch: 'arm64',
        kernel: '24.6.0',
        build,
        bun: '1.4.2',
        revision: prerequisites('arm64').revision,
      })
      assert.ok(
        result.stdout.includes(`Tested host: \`arm64\` Darwin \`24.6.0\` build \`${build}\``),
      )
      assert.ok(!result.stdout.includes(build === '24G830' ? '24H232' : '24G830'))
    }
  })
})

test('summary refuses missing or unsupported kernel prerequisites despite complete reports', async () => {
  for (const architecture of ['x64', 'arm64'])
    await fixture(architecture, async (f) => {
      const path = resolve(f.directories.at(-1), 'prerequisites.json')
      await writeFile(
        path,
        JSON.stringify({
          ...prerequisites(architecture),
          build: architecture === 'arm64' ? '24H233' : '24H232',
        }),
      )
      let result = await f.summarize()
      assert.equal(result.status, 1)
      assert.equal(result.report.qualified, false)
      assert.equal(result.report.executed, 0)
      await rm(path)
      result = await f.summarize()
      assert.equal(result.status, 1)
      assert.equal(result.report.qualified, false)
    })
})

async function diagnosticsUnavailable(f, roles = [0], environment = {}, timeout) {
  const result = await f.summarize(f.count, environment, timeout)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.report.qualified, true)
  assert.equal(result.report.executed, f.expectedCount)
  assert.equal(result.report.timing_available, false)
  for (const role of roles) assert.equal(result.report.shards[role].timing, null)
  return result
}

test('PR timing follows selected physical workers instead of logical role numbers', async () => {
  await cohortFixture(async (f) => {
    const result = await f.summarize()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.report.qualified, true)
    assert.equal(result.report.executed, f.expectedCount)
    assert.equal(result.report.timing_available, true)
    assert.deepEqual(result.report.shards.map(({ timing }) => timing), [
      { wait_seconds: 300, job_seconds: 900 },
      { wait_seconds: 60, job_seconds: 500 },
      { wait_seconds: 180, job_seconds: 700 },
    ])
  })
})

test('foreign, swapped or repeated PR worker mappings cannot supply diagnostic timings', async () => {
  await cohortFixture(async (f) => {
    const path = resolve(f.directories[0], 'worker.json')
    for (const changes of [
      { sourceRevision: 'a'.repeat(40) },
      { runId: 41 },
      { runAttempt: 1 },
      { worker: 1 },
      { jobId: 1001 },
      { allocatorJobId: false },
      { kind: 'macos-host-cohort-worker/1' },
      { role: 1 },
      { role: false },
      { profile: { ...f.receipts[0].profile, build: '24G830' } },
      { qualified: true },
    ]) {
      await writeFile(path, JSON.stringify({ ...f.receipts[0], ...changes }))
      await diagnosticsUnavailable(f)
    }
    const secondPath = resolve(f.directories[1], 'worker.json')
    await writeFile(path, JSON.stringify(f.receipts[1]))
    await writeFile(secondPath, JSON.stringify(f.receipts[0]))
    await diagnosticsUnavailable(f, [0, 1])
    await writeFile(secondPath, JSON.stringify(f.receipts[1]))
    await writeFile(path, JSON.stringify({ ...f.receipts[1], role: 0 }))
    await diagnosticsUnavailable(f, [0, 1])
  })
})

test('PR job metadata must match one successful current-attempt worker and valid intervals', async () => {
  await cohortFixture(async (f) => {
    for (const changes of [
      { id: 9999 },
      { name: 'Native host worker — arm64 / 3' },
      { run_id: 41 },
      { run_attempt: 1 },
      { status: 'in_progress' },
      { conclusion: 'failure' },
      { created_at: 'malformed' },
      { completed_at: '2026-09-30T23:00:00Z' },
    ]) {
      await writeFile(
        f.jobsPath,
        JSON.stringify(
          f.jobs.map((job, worker) =>
            worker === f.workers[0] ? { ...job, ...changes } : job,
          ),
        ),
      )
      await diagnosticsUnavailable(f)
    }
    await writeFile(f.jobsPath, JSON.stringify([...f.jobs, f.jobs[f.workers[0]]]))
    await diagnosticsUnavailable(f)
    await writeFile(f.jobsPath, JSON.stringify(f.jobs))
    await diagnosticsUnavailable(f, [0, 1, 2], { GITHUB_RUN_ID: '' })
    await diagnosticsUnavailable(f, [0, 1, 2], { GITHUB_RUN_ATTEMPT: '3' })
  })
})

test('missing, malformed, oversized or linked PR receipts remove timings without changing proof', async () => {
  await cohortFixture(async (f) => {
    const path = resolve(f.directories[0], 'worker.json')
    for (const bytes of [
      'malformed',
      'null',
      `${JSON.stringify(f.receipts[0])}${' '.repeat(8193)}`,
      `${'['.repeat(4096)}${']'.repeat(4096)}`,
    ]) {
      await writeFile(path, bytes)
      await diagnosticsUnavailable(f)
    }
    await rm(path)
    // A same-number static job cannot substitute for the missing PR mapping.
    await writeFile(
      f.jobsPath,
      JSON.stringify([...f.jobs, { ...f.jobs[0], name: 'Native host shard — arm64 / 0' }]),
    )
    await diagnosticsUnavailable(f)
    const outside = resolve(f.root, 'outside-worker.json')
    await writeFile(outside, JSON.stringify(f.receipts[0]))
    await symlink(outside, path)
    await diagnosticsUnavailable(f)
    await rm(path)
    execFileSync('mkfifo', [path])
    await diagnosticsUnavailable(f, [0], {}, 5000)
  })
})

test('the actual workflow summary step consumes exact shard evidence and refuses an incomplete run', async () => {
  const verify = async (f) => {
    const plan = f.plan
    if (plan === 'pull-request') await addCohortReceipts(f)
    const workflow = parse(
      await readFile(resolve(repository, '.github/workflows/macos-hosted-candidates.yml'), 'utf8'),
    )
    const script = workflow.jobs['qualified-architecture'].steps.find(
      (step) => step.name === 'Require complete exact-revision proof and summarize coverage',
    ).run
    const canonical = resolve(f.root, 'macos-host-artifacts')
    await mkdir(canonical)
    for (const [kind, name] of Object.entries(PACKAGE_LAYOUT)) {
      const contents = resolve(f.root, 'contents', kind)
      await mkdir(resolve(contents, 'package'), { recursive: true })
      await mkdir(resolve(canonical, kind))
      await writeFile(
        resolve(contents, 'package/package.json'),
        JSON.stringify({ name, version: '0.1.0-alpha.1' }),
      )
      const archive = resolve(canonical, kind, `${kind}.tgz`)
      const packed = spawnSync('tar', ['-czf', archive, '-C', contents, 'package'], {
        encoding: 'utf8',
        env: { ...process.env, LC_ALL: 'C' },
      })
      assert.equal(packed.status, 0, packed.stderr)
      const inventory = spawnSync('tar', ['-tzf', archive], {
        encoding: 'utf8',
        env: { ...process.env, LC_ALL: 'C' },
      })
      assert.equal(inventory.status, 0, inventory.stderr)
      await writeFile(`${archive}.sha256`, `${digest(await readFile(archive))}  ${kind}.tgz\n`)
      await writeFile(
        `${archive}.files`,
        `${inventory.stdout.trimEnd().split('\n').sort().join('\n')}\n`,
      )
    }
    await mkdir(resolve(canonical, 'resolution'))
    await writeFile(resolve(canonical, 'resolution/bun.lock'), 'fixture resolution')
    const candidate = await writeCandidateReceipt({
      root: canonical,
      sourceRevision: revision,
      release: {
        schemaVersion: 1,
        sourceRevision: revision,
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
        headSha: revision,
        headBranch: 'main',
        headRepository: 'local/local',
      },
      buildProfile: {
        version: '1.3.3',
        revision: '274e01c737e85f8142070a9745b43a2ba09fce4c',
        platform: 'linux',
        architecture: 'x64',
        nodeVersion: process.versions.node,
        npmVersion: '11.6.2',
        justVersion: 'just 1.43.1',
      },
      resolutionFiles: ['resolution/bun.lock'],
    })
    await writeFile(
      resolve(canonical, 'ARTIFACT.json'),
      JSON.stringify({
        schemaVersion: 1,
        repository: 'local/local',
        runId: 41,
        runAttempt: 1,
        sourceRevision: revision,
        receiptSha256: candidate.receiptSha256,
        artifactId: 73,
        artifactDigest: `sha256:${'2'.repeat(64)}`,
      }),
    )
    for (const directory of f.directories)
      for (const filename of ['CANDIDATE.json', 'ARTIFACT.json'])
        await cp(resolve(canonical, filename), resolve(directory, filename))
    const evidence = resolve(f.root, 'macos-evidence')
    await cp(f.jobsPath, resolve(f.root, 'mac-job-timings.json'))
    const markdown = resolve(f.root, 'step-summary.md')
    const run = async () => {
      await rm(evidence, { recursive: true, force: true })
      await mkdir(evidence)
      for (const directory of f.directories) {
        const suffix = plan === 'pull-request' ? '' : '-r42-a2'
        await cp(directory, resolve(evidence, `${directory.split('/').at(-1)}${suffix}`), {
          recursive: true,
        })
      }
      return spawnSync('/bin/sh', ['-c', script], {
        cwd: repository,
        encoding: 'utf8',
        env: {
          ...process.env,
          RUNNER_TEMP: f.root,
          EXPECTED_ARCH: f.architecture,
          EXPECTED_SHA: revision,
          SHARD_COUNT: String(f.count),
          GITHUB_RUN_ID: '42',
          GITHUB_RUN_ATTEMPT: '2',
          GITHUB_EVENT_NAME: plan === 'pull-request' ? 'pull_request' : 'push',
          JIG_MACOS_TEST_PLAN: plan,
          GITHUB_STEP_SUMMARY: markdown,
        },
      })
    }
    const successful = await run()
    assert.equal(successful.status, 0, successful.stderr)
    assert.match(await readFile(markdown, 'utf8'), /Qualification: \*\*passed\*\*/)
    const jsonPath = resolve(f.root, 'mac-summary.json')
    const summary = JSON.parse(await readFile(jsonPath, 'utf8'))
    assert.equal(summary.qualified, true)
    assert.equal(summary.timing_available, true)
    if (plan === 'pull-request') {
      assert.deepEqual(summary.shards.map(({ timing }) => timing.job_seconds), [900, 500, 700])
      return
    }
    const marker = resolve(f.directories[0], 'shard-0.complete')
    await rm(marker)
    const incomplete = await run()
    assert.equal(incomplete.status, 1, `${incomplete.stdout}\n${incomplete.stderr}`)
    assert.equal(JSON.parse(await readFile(jsonPath, 'utf8')).qualified, false)
    await writeFile(marker, `${revision} arm64 0\n`)
    await writeFile(resolve(f.directories[0], 'CANDIDATE.json'), 'another candidate')
    const wrongCandidate = await run()
    assert.equal(wrongCandidate.status, 1)
    assert.match(wrongCandidate.stderr, /different canonical candidate/)
  }
  for (const plan of ['complete', 'pull-request']) await fixture('arm64', verify, { plan })
})
