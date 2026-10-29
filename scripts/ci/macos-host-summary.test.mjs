import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'
import {
  digest,
  PACKAGE_LAYOUT,
  RELEASE_PACKAGE_LAYOUT,
  writeCandidateReceipt,
} from './candidate-provenance.mjs'
import {
  INSTALLED_STARTUP_TEST,
  MAC_HOST_SHARDS,
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

async function fixture(architecture, run) {
  const root = await mkdtemp(resolve(tmpdir(), 'jig-mac-summary-'))
  try {
    const count = MAC_HOST_SHARDS[architecture]
    const directories = []
    const files = filesForTarget(
      gitRepositoryTests(repository, revision),
      `macos-${architecture}`,
      catalog,
    )
    const plans = planMacHostTests(files, architecture).map((shard) => ({
      architecture,
      shard: shard.index,
      shardCount: count,
      installed: shard.index === count - 1,
      groups: shard.groups,
      nativeFiles: shard.index === 0 ? NATIVE_PREREQUISITE_TESTS : [],
    }))
    for (const plan of plans) {
      const shard = plan.shard
      const directory = resolve(root, `macos-prerequisites-${architecture}-${shard}-${revision}`)
      await mkdir(directory)
      directories.push(directory)
      await writeFile(
        resolve(directory, 'prerequisites.json'),
        JSON.stringify(prerequisites(architecture)),
      )
      await writeFile(resolve(directory, 'test-plan.json'), JSON.stringify(plan))
      await writeFile(
        resolve(directory, `shard-${shard}.complete`),
        `${revision} ${architecture} ${shard}\n`,
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
    const summarize = async (expectedShardCount = count) => {
      const output = resolve(root, 'summary.json')
      const result = spawnSync(
        'python3',
        [
          'scripts/ci/macos-host-summary.py',
          architecture,
          revision,
          String(expectedShardCount),
          root,
          jobsPath,
          output,
        ],
        { cwd: repository, encoding: 'utf8' },
      )
      assert.equal(result.error, undefined)
      return { ...result, report: JSON.parse(await readFile(output, 'utf8')) }
    }
    await run({
      root,
      architecture,
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

test('summary refuses missing or mixed kernel prerequisites despite complete reports', async () => {
  for (const architecture of ['x64', 'arm64'])
    await fixture(architecture, async (f) => {
      const path = resolve(f.directories.at(-1), 'prerequisites.json')
      await writeFile(
        path,
        JSON.stringify({
          ...prerequisites(architecture),
          build: architecture === 'arm64' ? '24G830' : '24H232',
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

test('the actual workflow summary step consumes exact shard evidence and refuses an incomplete run', async () => {
  await fixture('arm64', async (f) => {
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
      for (const directory of f.directories)
        await cp(directory, resolve(evidence, `${directory.split('/').at(-1)}-r42-a2`), {
          recursive: true,
        })
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
          GITHUB_STEP_SUMMARY: markdown,
        },
      })
    }
    const successful = await run()
    assert.equal(successful.status, 0, successful.stderr)
    assert.match(await readFile(markdown, 'utf8'), /Qualification: \*\*passed\*\*/)
    const jsonPath = resolve(f.root, 'mac-summary.json')
    assert.equal(JSON.parse(await readFile(jsonPath, 'utf8')).qualified, true)
    await rm(resolve(f.directories.at(-1), 'shard-1.complete'))
    assert.equal((await run()).status, 1)
    assert.equal(JSON.parse(await readFile(jsonPath, 'utf8')).qualified, false)
    await writeFile(resolve(f.directories.at(-1), 'shard-1.complete'), `${revision} arm64 1\n`)
    await writeFile(resolve(f.directories[0], 'CANDIDATE.json'), 'another candidate')
    const wrongCandidate = await run()
    assert.equal(wrongCandidate.status, 1)
    assert.match(wrongCandidate.stderr, /different canonical candidate/)
  })
})
