import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { digest, PACKAGE_LAYOUT, writeCandidateReceipt } from './candidate-provenance.mjs'
import { MAC_HOST_SHARDS, NATIVE_PREREQUISITE_TESTS } from './macos-host-test-shards.mjs'

const revision = '1'.repeat(40)
const repository = resolve(import.meta.dirname, '../..')
const testcase = (file, name, child = '') =>
  `<testcase file="${file}" classname="host proof" name="${name}" line="1">${child}</testcase>`
// Bun emits nested suites. Count actual cases, never their parent totals.
const junit = (cases) =>
  `<testsuites tests="999"><testsuite tests="999"><testsuite>${cases}</testsuite></testsuite></testsuites>`

async function fixture(architecture, run) {
  const root = await mkdtemp(resolve(tmpdir(), 'jig-mac-summary-'))
  try {
    const count = MAC_HOST_SHARDS[architecture]
    const directories = []
    const plans = []
    for (let shard = 0; shard < count; shard++) {
      const directory = resolve(root, `macos-prerequisites-${architecture}-${shard}-${revision}`)
      await mkdir(directory)
      directories.push(directory)
      const file = `packages/jig/test/proof-${shard}.test.ts`
      const plan = {
        architecture,
        shard,
        shardCount: count,
        installed: shard === count - 1,
        groups: [{ file, pattern: null }],
        nativeFiles: shard === 0 ? NATIVE_PREREQUISITE_TESTS : [],
      }
      plans.push(plan)
      await writeFile(resolve(directory, 'test-plan.json'), JSON.stringify(plan))
      await writeFile(
        resolve(directory, `shard-${shard}.complete`),
        `${revision} ${architecture} ${shard}\n`,
      )
      await writeFile(
        resolve(directory, `shard-${shard}-group-0.xml`),
        junit(testcase(file, 'executes proof') + testcase(file, 'platform skip', '<skipped/>')),
      )
      if (shard === 0)
        await writeFile(
          resolve(directory, 'native-tests.xml'),
          junit(
            NATIVE_PREREQUISITE_TESTS.map((file) => testcase(file, 'native prerequisite')).join(''),
          ),
        )
      if (shard === count - 1)
        await writeFile(
          resolve(directory, 'installed-startup.xml'),
          junit(
            testcase(
              'packages/jig/test/native-agent-startup.test.ts',
              'starts pinned client offline',
            ),
          ),
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
    const summarize = async () => {
      const output = resolve(root, 'summary.json')
      const result = spawnSync(
        'python3',
        [
          'scripts/ci/macos-host-summary.py',
          architecture,
          revision,
          String(count),
          root,
          jobsPath,
          output,
        ],
        { cwd: repository, encoding: 'utf8' },
      )
      assert.equal(result.error, undefined)
      return { ...result, report: JSON.parse(await readFile(output, 'utf8')) }
    }
    await run({ root, architecture, count, directories, plans, jobs, jobsPath, summarize })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('both exact architecture aggregates report executed proof separately from filters and runner wait', async () => {
  for (const architecture of Object.keys(MAC_HOST_SHARDS))
    await fixture(architecture, async ({ count, summarize }) => {
      const result = await summarize()
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.report.qualified, true)
      assert.equal(result.report.executed, count + NATIVE_PREREQUISITE_TESTS.length + 1)
      assert.equal(result.report.skipped_reports, count)
      assert.equal(result.report.failures, 0)
      assert.equal(result.report.timing_available, true)
      assert.deepEqual(
        result.report.shards.map((s) => s.timing),
        Array(count).fill({ wait_seconds: 120, job_seconds: 600 }),
      )
      assert.match(result.stdout, /Runner wait.*Job execution.*Executed cases/)
      assert.match(result.stdout, /they are not executed proof/)
    })
})

test('unavailable or malformed job timing does not grant or remove qualification', async () => {
  await fixture('arm64', async ({ jobsPath, jobs, summarize, directories }) => {
    for (const contents of [null, '{', JSON.stringify([{ ...jobs[0], started_at: 'bad date' }])]) {
      if (contents === null) await rm(jobsPath)
      else await writeFile(jobsPath, contents)
      const result = await summarize()
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.report.timing_available, false)
      assert.match(result.stdout, /unavailable/)
    }
    await rm(resolve(directories[0], 'shard-0.complete'))
    assert.equal((await summarize()).status, 1)
  })
})

test('standalone display reports count actual cases without skip credit and cannot be replaced by Jig reports', async () => {
  await fixture('arm64', async (f) => {
    const displayFiles = [
      'packages/display-model/test/model.test.ts',
      'packages/display-web/test/client.test.ts',
      'packages/display-tui/test/native.test.ts',
    ]
    const plan = f.plans[0]
    for (const file of displayFiles) plan.groups.push({ file, pattern: null })
    await writeFile(resolve(f.directories[0], 'test-plan.json'), JSON.stringify(plan))
    for (const [index, file] of displayFiles.entries())
      await writeFile(
        resolve(f.directories[0], `shard-0-group-${index + 1}.xml`),
        junit(testcase(file, 'independent renderer case')),
      )
    const observed = await f.summarize()
    assert.equal(observed.status, 0, observed.stderr)
    assert.equal(observed.report.executed, f.count + NATIVE_PREREQUISITE_TESTS.length + 4)
    assert.equal(observed.report.skipped_reports, f.count)
    for (const [index, file] of displayFiles.entries()) {
      const path = resolve(f.directories[0], `shard-0-group-${index + 1}.xml`)
      await writeFile(path, junit(testcase('packages/jig/test/proof-0.test.ts', 'foreign proof')))
      assert.equal((await f.summarize()).status, 1)
      await rm(path)
      assert.equal((await f.summarize()).status, 1)
      await writeFile(path, junit(testcase(file, 'independent renderer case')))
    }
  })
})

test('the actual workflow summary step consumes exact shard evidence and refuses an incomplete run', async () => {
  await fixture('arm64', async (f) => {
    const parsed = spawnSync(
      'bun',
      [
        '-e',
        'const workflow=Bun.YAML.parse(await Bun.file(process.argv[1]).text()); console.log(JSON.stringify(workflow.jobs["qualified-architecture"].steps.find(step=>step.name==="Require complete exact-revision proof and summarize coverage").run));',
        resolve(repository, '.github/workflows/macos-hosted-candidates.yml'),
      ],
      { encoding: 'utf8' },
    )
    assert.equal(parsed.status, 0, parsed.stderr)
    const script = JSON.parse(parsed.stdout)
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

test('missing, cancelled, stale and wrong-architecture shard evidence refuses qualification', async () => {
  const changes = [
    (f) => rm(f.directories.at(-1), { recursive: true }),
    (f) => rm(resolve(f.directories[0], 'shard-0.complete')),
    (f) => writeFile(resolve(f.directories[0], 'shard-0.complete'), `${'2'.repeat(40)} x64 0`),
    (f) => writeFile(resolve(f.directories[0], 'shard-0.complete'), `${revision} arm64 0`),
    (f) =>
      writeFile(
        resolve(f.directories[0], 'test-plan.json'),
        JSON.stringify({ ...f.plans[0], architecture: 'arm64' }),
      ),
    (f) =>
      writeFile(
        resolve(f.directories[0], 'test-plan.json'),
        JSON.stringify({ ...f.plans[0], shardCount: 2 }),
      ),
    (f) => writeFile(resolve(f.directories[0], 'test-plan.json'), '{}'),
    (f) =>
      writeFile(
        resolve(f.directories[0], 'test-plan.json'),
        JSON.stringify({ ...f.plans[0], nativeFiles: [] }),
      ),
    (f) => rm(resolve(f.directories.at(-1), 'installed-startup.xml')),
    (f) =>
      writeFile(
        resolve(f.directories.at(-1), 'test-plan.json'),
        JSON.stringify({ ...f.plans.at(-1), installed: false }),
      ),
  ]
  for (const change of changes)
    await fixture('x64', async (f) => {
      await change(f)
      const result = await f.summarize()
      assert.equal(result.status, 1, result.stdout)
      assert.equal(result.report.qualified, false)
      assert.ok(result.report.errors.length > 0)
    })
})

test('completion markers cannot hide missing, failed, malformed or misattributed test proof', async () => {
  const contents = [
    null,
    '<testsuites>',
    '<unrelated/>',
    junit('<testcase name="missing file"/>'),
    junit(testcase('other.test.ts', 'wrong file')),
    junit(testcase('packages/jig/test/proof-0.test.ts', 'failed', '<failure/>')),
    junit(testcase('packages/jig/test/proof-0.test.ts', 'error', '<error/>')),
  ]
  for (const contentsValue of contents)
    await fixture('arm64', async (f) => {
      const path = resolve(f.directories[0], 'shard-0-group-0.xml')
      if (contentsValue === null) await rm(path)
      else await writeFile(path, contentsValue)
      const result = await f.summarize()
      assert.equal(result.status, 1, result.stdout)
      assert.equal(result.report.qualified, false)
    })
  await fixture('arm64', async (f) => {
    await writeFile(
      resolve(f.directories[0], 'native-tests.xml'),
      junit(
        NATIVE_PREREQUISITE_TESTS.map((file) =>
          testcase(file, 'filtered native', '<skipped/>'),
        ).join(''),
      ),
    )
    assert.equal((await f.summarize()).status, 1)
  })
})

test('disjoint name groups count each execution once, and repeated execution fails closed', async () => {
  await fixture('x64', async (f) => {
    const file = f.plans[0].groups[0].file
    f.plans[0].groups = [
      { file, pattern: '^first$' },
      { file, pattern: '^second$' },
    ]
    await writeFile(resolve(f.directories[0], 'test-plan.json'), JSON.stringify(f.plans[0]))
    await writeFile(
      resolve(f.directories[0], 'shard-0-group-0.xml'),
      junit(testcase(file, 'first') + testcase(file, 'second', '<skipped/>')),
    )
    const secondPath = resolve(f.directories[0], 'shard-0-group-1.xml')
    await writeFile(
      secondPath,
      junit(testcase(file, 'first', '<skipped/>') + testcase(file, 'second')),
    )
    const good = await f.summarize()
    assert.equal(good.status, 0, good.stdout)
    assert.equal(good.report.executed, f.count + NATIVE_PREREQUISITE_TESTS.length + 2)
    await writeFile(secondPath, junit(testcase(file, 'first') + testcase(file, 'second')))
    const repeated = await f.summarize()
    assert.equal(repeated.status, 1)
    assert.match(repeated.report.errors.join('\n'), /repeated execution/)
  })
})
