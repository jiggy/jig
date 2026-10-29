import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  digest,
  PACKAGE_LAYOUT,
  RELEASE_PACKAGE_LAYOUT,
  verifyCandidateBundle,
  writeCandidateReceipt,
} from './candidate-provenance.mjs'
import {
  acquireCandidate,
  acquisitionExpectation,
  validateWorkflowRun,
} from './candidate-transfer.mjs'

const source = 'a'.repeat(40)
const prHead = 'b'.repeat(40)
const repository = 'jiggy/jig'
const workflowPath = '.github/workflows/ci.yml'
const buildProfile = {
  platform: 'linux',
  architecture: 'x64',
  version: '1.3.3',
  revision: '274e01c737e85f8142070a9745b43a2ba09fce4c',
  nodeVersion: '24.0.0',
  npmVersion: '11.6.2',
  justVersion: 'just 1.43.1',
}

test('native acquisition CLI loads readiness before making its GitHub request', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-native-acquisition-cli-'))
  try {
    await writeFile(
      join(temporary, 'gh'),
      '#!/bin/sh\necho "fixture GitHub refusal" >&2\nexit 7\n',
      {
        mode: 0o700,
      },
    )
    const child = spawnSync(
      process.execPath,
      [
        new URL('./candidate-transfer.mjs', import.meta.url).pathname,
        'acquire-linux',
        join(temporary, 'bundle'),
        '--source',
        source,
        '--linux-run',
        '200',
        '--qualification-output',
        join(temporary, 'qualification'),
      ],
      {
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          PATH: `${temporary}:${process.env.PATH}`,
          GITHUB_REPOSITORY: repository,
          GITHUB_SHA: source,
          GITHUB_REF: 'refs/heads/main',
          GITHUB_EVENT_NAME: 'workflow_run',
        },
      },
    )
    assert.equal(child.status, 1, child.stderr)
    assert.match(child.stderr, /fixture GitHub refusal/)
    assert.doesNotMatch(child.stderr, /unsettled top-level await/)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

function run(id, event = 'push', overrides = {}) {
  return {
    id,
    path: workflowPath,
    run_attempt: 1,
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    event,
    head_sha: source,
    head_branch: 'main',
    status: 'in_progress',
    conclusion: null,
    ...overrides,
  }
}

function env(event) {
  return {
    GITHUB_REPOSITORY: repository,
    GITHUB_SHA: source,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_EVENT_NAME: event,
  }
}

function buildJob(current, overrides = {}) {
  return quickJob(current, { id: current.id * 100 + 1, name: 'candidate-build', ...overrides })
}

function quickJob(current, overrides = {}) {
  return {
    id: current.id * 100,
    name: 'Quick development checks',
    run_id: current.id,
    run_attempt: current.run_attempt,
    head_sha: current.head_sha,
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  }
}

async function withFixture(runs, action) {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-transfer-lineage-test-'))
  const byRun = new Map()
  const requestedEvents = []
  const requestedArtifacts = []
  const downloaded = []
  const requestedJobs = []
  const jobsByRun = new Map(runs.map((current) => [current.id, [quickJob(current)]]))
  try {
    for (const current of runs) {
      const root = join(temporary, `bundle-${current.id}`)
      await mkdir(root)
      for (const [kind, name] of Object.entries(PACKAGE_LAYOUT)) {
        const staging = join(temporary, `source-${current.id}-${kind}`)
        await mkdir(join(staging, 'package'), { recursive: true })
        await writeFile(
          join(staging, 'package/package.json'),
          JSON.stringify({ name, version: '0.1.0-alpha.1' }),
        )
        await writeFile(join(staging, 'package/producer.txt'), `${current.id}\n`)
        await mkdir(join(root, kind))
        const archive = join(root, kind, `${kind}.tgz`)
        execFileSync('tar', ['-czf', archive, '-C', staging, 'package'])
        const hash = digest(await readFile(archive))
        await writeFile(`${archive}.sha256`, `${hash}  ${kind}.tgz\n`)
        const inventory = `${execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
          .trimEnd()
          .split('\n')
          .sort()
          .join('\n')}\n`
        await writeFile(`${archive}.files`, inventory)
      }
      await mkdir(join(root, 'resolution'))
      await writeFile(join(root, 'resolution/bun.lock'), `resolved closure for ${current.id}\n`)
      const receipt = await writeCandidateReceipt({
        root,
        sourceRevision: source,
        release: {
          schemaVersion: 1,
          sourceRevision: source,
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
          repository,
          workflowPath,
          runId: current.id,
          runAttempt: current.run_attempt,
          event: current.event,
          headSha: current.head_sha,
          headBranch: current.head_branch,
          headRepository: current.head_repository.full_name,
        },
        buildProfile,
        resolutionFiles: ['resolution/bun.lock'],
      })
      const transport = Buffer.from(`canonical transport ${current.id}/${current.run_attempt}`)
      const artifact = {
        id: current.id * 10,
        name: `candidates-${source}-r${current.id}-a${current.run_attempt}`,
        expired: false,
        expires_at: '2099-01-01T00:00:00Z',
        digest: `sha256:${digest(transport)}`,
        workflow_run: { id: current.id, head_sha: current.head_sha },
      }
      byRun.set(current.id, { root, receipt, transport, artifact })
    }
    const client = {
      api: async (path) => {
        const url = new URL(`https://api.github.com/${path}`)
        const query = url.searchParams
        if (url.pathname === `/repos/${repository}/actions/workflows/ci.yml/runs`) {
          requestedEvents.push(query.get('event'))
          const matching = runs.filter(
            (current) =>
              current.event === query.get('event') &&
              current.head_sha === query.get('head_sha') &&
              current.head_branch === query.get('branch'),
          )
          const limit = Number(query.get('per_page'))
          const page = Number(query.get('page'))
          assert.equal(limit, 100)
          assert.ok(page > 0)
          return {
            workflow_runs: structuredClone(matching.slice((page - 1) * limit, page * limit)),
          }
        }
        const jobsMatch = url.pathname.match(/\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs$/)
        if (jobsMatch) {
          const runId = Number(jobsMatch[1]),
            attempt = Number(jobsMatch[2])
          assert.ok(
            runs.some((current) => current.id === runId),
            'Requested unknown job owner',
          )
          const limit = Number(query.get('per_page')),
            page = Number(query.get('page'))
          assert.equal(limit, 100)
          assert.ok(page > 0)
          requestedJobs.push({ runId, attempt })
          return {
            jobs: structuredClone(
              (jobsByRun.get(runId) ?? []).slice((page - 1) * limit, page * limit),
            ),
          }
        }
        const match = url.pathname.match(/\/actions\/runs\/(\d+)(\/artifacts)?$/)
        assert.ok(match, `Unexpected API request: ${url.pathname}`)
        const runId = Number(match[1])
        const current = runs.find((entry) => entry.id === runId)
        assert.ok(current, 'Requested unknown run')
        if (match[2]) {
          requestedArtifacts.push(runId)
          return { artifacts: [byRun.get(runId).artifact] }
        }
        return structuredClone(current)
      },
      download: async (artifactId, path) => {
        const entry = [...byRun.values()].find((value) => value.artifact.id === artifactId)
        assert.ok(entry, 'Requested unknown artifact')
        downloaded.push(artifactId)
        await writeFile(path, entry.transport)
      },
    }
    const extract = async (archive, destination) => {
      const bytes = await readFile(archive)
      const entry = [...byRun.values()].find((value) => value.transport.equals(bytes))
      assert.ok(entry, 'Extracted unknown transport')
      await cp(entry.root, destination, { recursive: true })
    }
    await action({
      temporary,
      client,
      extract,
      byRun,
      requestedEvents,
      requestedArtifacts,
      downloaded,
      requestedJobs,
      jobsByRun,
    })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

test('push acquisition selects main-push bytes despite newer same-source scheduled and manual producers', async () => {
  await withFixture(
    [run(100), run(101, 'schedule'), run(102, 'workflow_dispatch')],
    async (fixture) => {
      const expected = await acquisitionExpectation(source, env('push'))
      assert.equal(expected.allowedEvents, undefined)
      const destination = join(fixture.temporary, 'download')
      const acquired = await acquireCandidate({
        destination,
        sourceRevision: source,
        expected,
        client: fixture.client,
        extract: fixture.extract,
        timeoutSeconds: 0,
      })
      assert.equal(acquired.runId, 100)
      assert.equal(acquired.artifactId, 1000)
      assert.equal(acquired.receiptSha256, fixture.byRun.get(100).receipt.receiptSha256)
      assert.deepEqual(fixture.requestedEvents, ['push'])
      assert.deepEqual(fixture.downloaded, [1000])
      const verified = await verifyCandidateBundle(destination, {
        sourceRevision: source,
        producerRunId: 100,
        producerRunAttempt: 1,
        producerRepository: repository,
      })
      assert.equal(verified.producer.event, 'push')
      assert.equal(verified.packages.length, 8)
    },
  )
})

test('an explicit producer ID cannot substitute audit bytes into push qualification', async () => {
  await withFixture([run(100, 'schedule'), run(101, 'workflow_dispatch')], async (fixture) => {
    const expected = await acquisitionExpectation(source, env('push'))
    for (const producerRunId of [100, 101]) {
      await assert.rejects(
        acquireCandidate({
          destination: join(fixture.temporary, `rejected-${producerRunId}`),
          sourceRevision: source,
          producerRunId,
          expected,
          client: fixture.client,
          extract: fixture.extract,
          timeoutSeconds: 0,
        }),
        /workflow producer identity mismatch/,
      )
    }
    assert.deepEqual(fixture.requestedArtifacts, [])
    assert.deepEqual(fixture.downloaded, [])
  })
})

test('manual qualification acquires exact current main candidates', async () => {
  for (const event of ['workflow_dispatch']) {
    await withFixture([run(100), run(101, event)], async (fixture) => {
      const expected = await acquisitionExpectation(source, env(event))
      assert.deepEqual(expected.allowedEvents, ['push', 'workflow_dispatch'])
      const acquired = await acquireCandidate({
        destination: join(fixture.temporary, 'download'),
        sourceRevision: source,
        expected,
        client: fixture.client,
        extract: fixture.extract,
        timeoutSeconds: 0,
      })
      assert.equal(acquired.runId, 101)
      assert.equal(acquired.artifactId, 1010)
      assert.equal(acquired.receiptSha256, fixture.byRun.get(101).receipt.receiptSha256)
      assert.deepEqual(fixture.requestedEvents.sort(), ['push', 'workflow_dispatch'])
      assert.deepEqual(fixture.downloaded, [1010])
    })
  }
})

test('a pending newest push attempt cannot fall back to an older push or newer audit artifact', async () => {
  const pending = run(101, 'push', { run_attempt: 2 })
  await withFixture([run(100), pending, run(102, 'workflow_dispatch')], async (fixture) => {
    // Only an old-attempt artifact is visible for the newest matching push.
    fixture.byRun.get(101).artifact.name = `candidates-${source}-r101-a1`
    const expected = await acquisitionExpectation(source, env('push'))
    await assert.rejects(
      acquireCandidate({
        destination: join(fixture.temporary, 'rejected'),
        sourceRevision: source,
        expected,
        client: fixture.client,
        extract: fixture.extract,
        timeoutSeconds: 0,
      }),
      /acquisition deadline/,
    )
    assert.deepEqual(fixture.requestedEvents, ['push'])
    assert.deepEqual(fixture.requestedArtifacts, [101])
    assert.deepEqual(fixture.downloaded, [])
  })
})

test('audit producer acceptance remains main-only and rejects source, fork and workflow drift', async () => {
  for (const event of ['workflow_dispatch']) {
    const expected = await acquisitionExpectation(source, env(event))
    for (const producerEvent of ['push', 'workflow_dispatch']) {
      assert.doesNotThrow(() => validateWorkflowRun(run(100, producerEvent), expected))
      for (const changes of [
        { head_branch: 'feature' },
        { head_sha: prHead },
        { head_repository: { full_name: 'fork/jig' } },
        { path: '.github/workflows/other.yml' },
      ]) {
        assert.throws(
          () => validateWorkflowRun(run(100, producerEvent, changes), expected),
          /workflow producer identity mismatch/,
        )
      }
    }
  }
})

test('PR acquisition retains its exact head metadata separately from the tested merge source', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-transfer-pr-context-test-'))
  try {
    const eventPath = join(temporary, 'event.json')
    await writeFile(
      eventPath,
      JSON.stringify({
        pull_request: {
          head: { sha: prHead, ref: 'feature', repo: { full_name: 'fork/jig' } },
        },
      }),
    )
    const expected = await acquisitionExpectation(source, {
      ...env('pull_request'),
      GITHUB_REF: 'refs/pull/1/merge',
      GITHUB_EVENT_PATH: eventPath,
    })
    assert.deepEqual(expected, {
      repository,
      workflowPath,
      event: 'pull_request',
      headSha: prHead,
      headBranch: 'feature',
      headRepository: 'fork/jig',
    })
    const matching = run(100, 'pull_request', {
      head_sha: prHead,
      head_branch: 'feature',
      head_repository: { full_name: 'fork/jig' },
    })
    assert.doesNotThrow(() => validateWorkflowRun(matching, expected))
    assert.throws(
      () => validateWorkflowRun({ ...matching, head_sha: source }, expected),
      /workflow producer identity mismatch/,
    )
    assert.throws(
      () => validateWorkflowRun(run(101), expected),
      /workflow producer identity mismatch/,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

async function acquireAfterQuick(fixture, changes = {}) {
  return acquireCandidate({
    destination: join(fixture.temporary, 'download'),
    sourceRevision: source,
    expected: await acquisitionExpectation(source, env('push')),
    client: fixture.client,
    extract: fixture.extract,
    timeoutSeconds: 0,
    afterQuick: true,
    ...changes,
  })
}

for (const initial of ['queued', 'missing']) {
  test(`Mac scheduling waits for ${initial} Quick work before downloading the existing canonical bundle`, async () => {
    const ci = run(100)
    await withFixture([ci], async (fixture) => {
      fixture.jobsByRun.set(
        100,
        initial === 'missing' ? [] : [quickJob(ci, { status: 'queued', conclusion: null })],
      )
      let clock = 0,
        waits = 0
      const destination = join(fixture.temporary, 'download')
      const acquired = await acquireAfterQuick(fixture, {
        timeoutSeconds: 30,
        now: () => clock,
        sleep: async (milliseconds) => {
          assert.deepEqual(fixture.downloaded, [])
          assert.deepEqual(fixture.requestedArtifacts, [])
          clock += milliseconds
          waits++
          fixture.jobsByRun.set(100, [
            quickJob(ci, waits === 1 ? { status: 'in_progress', conclusion: null } : {}),
          ])
        },
      })
      assert.equal(waits, 2)
      assert.equal(clock, 20_000)
      assert.deepEqual(
        fixture.requestedJobs,
        Array.from({ length: 3 }, () => ({ runId: 100, attempt: 1 })),
      )
      assert.deepEqual(fixture.downloaded, [1000])
      assert.equal(acquired.runId, 100)
      assert.equal(acquired.runAttempt, 1)
      assert.equal(acquired.receiptSha256, fixture.byRun.get(100).receipt.receiptSha256)
      const verified = await verifyCandidateBundle(destination, {
        sourceRevision: source,
        producerRunId: 100,
        producerRunAttempt: 1,
        producerRepository: repository,
      })
      assert.equal(verified.packages.length, 8)
      assert.deepEqual(
        JSON.parse(await readFile(join(destination, 'ARTIFACT.json'), 'utf8')),
        acquired,
      )
    })
  })
}

test('Mac scheduling refuses unsuccessful, duplicate and foreign current-attempt Quick evidence before download', async () => {
  const ci = run(100)
  await withFixture([ci], async (fixture) => {
    const badEvidence = [
      ['duplicate name', [quickJob(ci), quickJob(ci, { id: 10001 })], /Ambiguous/],
      ['stale attempt', [quickJob(ci, { run_attempt: 0 })], /identity mismatch/],
      ['missing attempt', [quickJob(ci, { run_attempt: undefined })], /identity mismatch/],
      ['foreign run', [quickJob(ci, { run_id: 101 })], /identity mismatch/],
      ['foreign head', [quickJob(ci, { head_sha: prHead })], /identity mismatch/],
      ['invalid job ID', [quickJob(ci, { id: 0 })], /identity mismatch/],
      ...['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', null].map((conclusion) => [
        `completed ${conclusion}`,
        [quickJob(ci, { conclusion })],
        /did not succeed/,
      ]),
      ['unfinished success', [quickJob(ci, { status: 'in_progress' })], /pending.*status/],
      [
        'unknown status',
        [quickJob(ci, { status: 'unknown', conclusion: null })],
        /pending.*status/,
      ],
    ]
    for (const [label, jobs, pattern] of badEvidence) {
      fixture.jobsByRun.set(100, jobs)
      await assert.rejects(acquireAfterQuick(fixture), pattern, label)
      assert.deepEqual(fixture.downloaded, [], label)
      assert.deepEqual(fixture.requestedArtifacts, [], label)
    }
  })
})

test('a completed producer cannot keep waiting for missing or unfinished Quick work', async () => {
  const ci = run(100, 'push', { status: 'completed', conclusion: 'success' })
  await withFixture([ci], async (fixture) => {
    for (const jobs of [[], [quickJob(ci, { status: 'queued', conclusion: null })]]) {
      fixture.jobsByRun.set(100, jobs)
      await assert.rejects(acquireAfterQuick(fixture), /Completed CI producer/)
    }
    assert.deepEqual(fixture.downloaded, [])
    assert.deepEqual(fixture.requestedArtifacts, [])
  })
})

test('default acquisition keeps Linux and FLOW independent of Quick scheduling', async () => {
  const ci = run(100)
  await withFixture([ci], async (fixture) => {
    fixture.jobsByRun.set(100, [quickJob(ci, { conclusion: 'failure' })])
    const acquired = await acquireAfterQuick(fixture, { afterQuick: false })
    assert.equal(acquired.artifactId, 1000)
    assert.deepEqual(fixture.requestedJobs, [])
    assert.deepEqual(fixture.downloaded, [1000])
  })
})

test('only the explicit Mac scheduling opt-in permits a bounded ten-minute poll', async () => {
  const ci = run(100)
  await withFixture([ci], async (fixture) => {
    for (const changes of [
      { afterQuick: false, timeoutSeconds: 600 },
      { afterQuick: 'true', timeoutSeconds: 600 },
      { timeoutSeconds: 601 },
    ])
      await assert.rejects(
        acquireAfterQuick(fixture, changes),
        /timeout.*0–300|must be boolean|timeout.*0–600/,
      )
    assert.deepEqual(fixture.requestedEvents, [])
    let clock = 0
    fixture.jobsByRun.set(100, [quickJob(ci, { status: 'queued', conclusion: null })])
    const acquired = await acquireAfterQuick(fixture, {
      timeoutSeconds: 600,
      now: () => clock,
      sleep: async (milliseconds) => {
        assert.deepEqual(fixture.downloaded, [])
        clock += milliseconds
        if (clock >= 590_000) fixture.jobsByRun.set(100, [quickJob(ci)])
      },
    })
    assert.equal(clock, 590_000)
    assert.equal(acquired.artifactId, 1000)
    assert.deepEqual(fixture.downloaded, [1000])
  })
})

test('pending Quick work still expires at the exact acquisition bound without passing credit', async () => {
  const ci = run(100)
  await withFixture([ci], async (fixture) => {
    let clock = 0
    fixture.jobsByRun.set(100, [quickJob(ci, { status: 'in_progress', conclusion: null })])
    await assert.rejects(
      acquireAfterQuick(fixture, {
        timeoutSeconds: 600,
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds
        },
      }),
      /acquisition deadline/,
    )
    assert.equal(clock, 600_000)
    assert.deepEqual(fixture.downloaded, [])
    assert.deepEqual(fixture.requestedArtifacts, [])
  })
})

test('successful older Quick evidence cannot bypass the newest pending producer attempt', async () => {
  const older = run(100),
    newest = run(101, 'push', { run_attempt: 2 })
  await withFixture([older, newest], async (fixture) => {
    fixture.jobsByRun.set(101, [quickJob(newest, { status: 'queued', conclusion: null })])
    await assert.rejects(acquireAfterQuick(fixture), /acquisition deadline/)
    assert.deepEqual(fixture.requestedJobs, [{ runId: 101, attempt: 2 }])
    assert.deepEqual(fixture.requestedArtifacts, [])
    assert.deepEqual(fixture.downloaded, [])
  })
})

test('Mac scheduling retains the post-download rerun refusal and emits no artifact envelope', async () => {
  const ci = run(100)
  await withFixture([ci], async (fixture) => {
    const download = fixture.client.download
    fixture.client.download = async (...args) => {
      await download(...args)
      ci.run_attempt = 2
    }
    await assert.rejects(acquireAfterQuick(fixture), /attempt changed during acquisition/)
    assert.deepEqual(fixture.requestedJobs, [{ runId: 100, attempt: 1 }])
    assert.deepEqual(fixture.downloaded, [1000])
    await assert.rejects(readFile(join(fixture.temporary, 'download/ARTIFACT.json')), /ENOENT/)
  })
})

test('Quick success cannot substitute for immutable candidate transport proof', async () => {
  await withFixture([run(100)], async (fixture) => {
    fixture.byRun.get(100).artifact.digest = `sha256:${'d'.repeat(64)}`
    await assert.rejects(acquireAfterQuick(fixture), /transport digest mismatch/)
    assert.deepEqual(fixture.downloaded, [1000])
    await assert.rejects(readFile(join(fixture.temporary, 'download/ARTIFACT.json')), /ENOENT/)
  })
})

test('PR scheduling binds the Quick head to the producer metadata rather than its tested merge source', async () => {
  const ci = run(100, 'pull_request', { head_sha: prHead, head_branch: 'feature' })
  await withFixture([ci], async (fixture) => {
    const expected = {
      repository,
      workflowPath,
      event: 'pull_request',
      headSha: prHead,
      headBranch: 'feature',
      headRepository: repository,
    }
    const acquired = await acquireAfterQuick(fixture, { expected })
    assert.equal(acquired.sourceRevision, source)
    assert.deepEqual(fixture.downloaded, [1000])
    fixture.jobsByRun.set(100, [quickJob(ci, { head_sha: source })])
    await assert.rejects(
      acquireAfterQuick(fixture, {
        expected,
        destination: join(fixture.temporary, 'wrong-job-head'),
      }),
      /identity mismatch/,
    )
    assert.deepEqual(fixture.downloaded, [1000])
  })
})

test('the actual Mac acquisition step waits for Quick before complete native allocation', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/macos-hosted-candidates.yml', import.meta.url),
    'utf8',
  )
  const start = workflow.indexOf('        name: "Acquire the exact canonical CI candidates"\n')
  assert.ok(start >= 0)
  const end = workflow.indexOf('      -\n', start)
  assert.ok(end > start)
  const step = workflow.slice(start, end)
  assert.doesNotMatch(step, /AFTER_QUICK|needs\.plan/)
  const commands = step.split('        run: |\n')[1]
  assert.ok(commands)
  const shell = commands
    .split('\n')
    .filter((line) => line.length)
    .map((line) => {
      assert.ok(line.startsWith('          '))
      return line.slice(10)
    })
    .join('\n')
  const temporary = await mkdtemp(join(tmpdir(), 'jig-mac-acquisition-step-test-'))
  try {
    const bin = join(temporary, 'bin'),
      captured = join(temporary, 'arguments.txt')
    await mkdir(bin)
    await writeFile(join(bin, 'node'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURED_ARGUMENTS"\n', {
      mode: 0o700,
    })
    execFileSync('/bin/sh', ['-c', shell], {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        RUNNER_TEMP: temporary,
        GITHUB_SHA: source,
        CAPTURED_ARGUMENTS: captured,
      },
      timeout: 5000,
      stdio: 'pipe',
    })
    assert.deepEqual((await readFile(captured, 'utf8')).trimEnd().split('\n'), [
      'scripts/ci/candidate-transfer.mjs',
      'acquire',
      join(temporary, 'macos-host-artifacts'),
      '--source',
      source,
      '--after-quick',
      'true',
      '--producer-timeout-seconds',
      '1800',
      '--timeout-seconds',
      '600',
    ])
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('host acquisition waits for the exact queued producer before starting its transfer deadline', async () => {
  const ci = run(100)
  await withFixture([ci], async (fixture) => {
    fixture.jobsByRun.set(100, [buildJob(ci, { status: 'queued', conclusion: null })])
    const artifact = fixture.byRun.get(100).artifact
    const name = artifact.name
    artifact.name = `candidates-${source}-r100-a0`
    let clock = 0
    const acquired = await acquireAfterQuick(fixture, {
      afterQuick: false,
      producerTimeoutSeconds: 1800,
      timeoutSeconds: 300,
      now: () => clock,
      sleep: async (milliseconds) => {
        assert.deepEqual(fixture.downloaded, [])
        if (clock < 330_000) {
          assert.deepEqual(fixture.requestedArtifacts, [])
          assert.equal(milliseconds, 30_000)
        } else {
          assert.equal(milliseconds, 10_000)
        }
        clock += milliseconds
        if (clock >= 330_000) fixture.jobsByRun.set(100, [buildJob(ci)])
        if (clock >= 570_000) artifact.name = name
      },
    })
    assert.equal(clock, 570_000)
    assert.equal(acquired.runId, 100)
    assert.equal(acquired.runAttempt, 1)
    assert.deepEqual(fixture.downloaded, [1000])
    assert.deepEqual(
      fixture.requestedJobs,
      Array.from({ length: 12 }, () => ({ runId: 100, attempt: 1 })),
    )
  })
})

test('pending candidate production expires at its absolute bound without reading artifacts', async () => {
  const ci = run(100)
  await withFixture([ci], async (fixture) => {
    fixture.jobsByRun.set(100, [buildJob(ci, { status: 'in_progress', conclusion: null })])
    let clock = 0
    await assert.rejects(
      acquireAfterQuick(fixture, {
        afterQuick: false,
        producerTimeoutSeconds: 65,
        timeoutSeconds: 300,
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds
        },
      }),
      /producer deadline/,
    )
    assert.equal(clock, 65_000)
    assert.deepEqual(fixture.requestedArtifacts, [])
    assert.deepEqual(fixture.downloaded, [])
  })
})

test('candidate production refuses failed, ambiguous and foreign jobs before artifact transfer', async () => {
  const ci = run(100)
  await withFixture([ci], async (fixture) => {
    const invalid = [
      ['duplicate', [buildJob(ci), buildJob(ci, { id: 10001 })], /Ambiguous/],
      ['stale attempt', [buildJob(ci, { run_attempt: 0 })], /identity mismatch/],
      ['foreign run', [buildJob(ci, { run_id: 101 })], /identity mismatch/],
      ['foreign head', [buildJob(ci, { head_sha: prHead })], /identity mismatch/],
      ...['failure', 'cancelled', 'skipped', 'timed_out'].map((conclusion) => [
        conclusion,
        [buildJob(ci, { conclusion })],
        /did not succeed/,
      ]),
    ]
    for (const [label, jobs, pattern] of invalid) {
      fixture.jobsByRun.set(100, jobs)
      await assert.rejects(
        acquireAfterQuick(fixture, {
          afterQuick: false,
          producerTimeoutSeconds: 1800,
        }),
        pattern,
        label,
      )
      assert.deepEqual(fixture.requestedArtifacts, [], label)
      assert.deepEqual(fixture.downloaded, [], label)
    }
  })
})

test('completed producers cannot retain a missing or unfinished candidate build', async () => {
  const ci = run(100, 'push', { status: 'completed', conclusion: 'failure' })
  await withFixture([ci], async (fixture) => {
    for (const jobs of [[], [buildJob(ci, { status: 'queued', conclusion: null })]]) {
      fixture.jobsByRun.set(100, jobs)
      await assert.rejects(
        acquireAfterQuick(fixture, {
          afterQuick: false,
          producerTimeoutSeconds: 1800,
        }),
        /Completed CI producer/,
      )
    }
    assert.deepEqual(fixture.requestedArtifacts, [])
    assert.deepEqual(fixture.downloaded, [])
  })
})

test('a successful producer with no artifact uses only the unchanged transfer bound', async () => {
  const ci = run(100)
  await withFixture([ci], async (fixture) => {
    fixture.jobsByRun.set(100, [buildJob(ci)])
    fixture.byRun.get(100).artifact.name = `candidates-${source}-r100-a0`
    let clock = 0
    await assert.rejects(
      acquireAfterQuick(fixture, {
        afterQuick: false,
        producerTimeoutSeconds: 1800,
        timeoutSeconds: 25,
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds
        },
      }),
      /acquisition deadline/,
    )
    assert.equal(clock, 25_000)
    assert.deepEqual(fixture.requestedJobs, [{ runId: 100, attempt: 1 }])
    assert.deepEqual(fixture.downloaded, [])
  })
})

test('a ready producer attempt cannot change while its artifact is pending', async () => {
  const ci = run(100)
  await withFixture([ci], async (fixture) => {
    fixture.jobsByRun.set(100, [buildJob(ci)])
    fixture.byRun.get(100).artifact.name = `candidates-${source}-r100-a0`
    let clock = 0
    await assert.rejects(
      acquireAfterQuick(fixture, {
        afterQuick: false,
        producerTimeoutSeconds: 1800,
        timeoutSeconds: 300,
        now: () => clock,
        sleep: async (milliseconds) => {
          clock += milliseconds
          ci.run_attempt = 2
        },
      }),
      /producer changed after readiness/,
    )
    assert.equal(clock, 10_000)
    assert.deepEqual(fixture.downloaded, [])
  })
})

test('producer waiting refuses invalid or excessive budgets before GitHub requests', async () => {
  await withFixture([run(100)], async (fixture) => {
    for (const producerTimeoutSeconds of [-1, 1801, NaN, Infinity, 0.5])
      await assert.rejects(
        acquireAfterQuick(fixture, {
          producerTimeoutSeconds,
        }),
        /producer timeout.*0–1800/,
      )
    assert.deepEqual(fixture.requestedEvents, [])
    assert.deepEqual(fixture.requestedJobs, [])
    assert.deepEqual(fixture.downloaded, [])
  })
})

test('host readiness retains the Quick gate before any native artifact transfer', async () => {
  const ci = run(100)
  await withFixture([ci], async (fixture) => {
    fixture.jobsByRun.set(100, [buildJob(ci), quickJob(ci, { status: 'queued', conclusion: null })])
    let clock = 0
    const acquired = await acquireAfterQuick(fixture, {
      producerTimeoutSeconds: 60,
      timeoutSeconds: 0,
      now: () => clock,
      sleep: async (milliseconds) => {
        assert.deepEqual(fixture.requestedArtifacts, [])
        clock += milliseconds
        fixture.jobsByRun.set(100, [buildJob(ci), quickJob(ci)])
      },
    })
    assert.equal(clock, 30_000)
    assert.equal(acquired.artifactId, 1000)
  })
})

test('a slow readiness response cannot start transfer after the producer deadline', async () => {
  const ci = run(100)
  await withFixture([ci], async (fixture) => {
    fixture.jobsByRun.set(100, [buildJob(ci)])
    const api = fixture.client.api
    let clock = 0
    fixture.client.api = async (path) => {
      const response = await api(path)
      if (path.includes('/jobs?')) clock = 1_801_000
      return response
    }
    await assert.rejects(
      acquireAfterQuick(fixture, {
        afterQuick: false,
        producerTimeoutSeconds: 1800,
        timeoutSeconds: 300,
        now: () => clock,
      }),
      /producer deadline/,
    )
    assert.deepEqual(fixture.requestedArtifacts, [])
    assert.deepEqual(fixture.downloaded, [])
  })
})

test('either failed prerequisite refuses while the other producer job is pending', async () => {
  const ci = run(100)
  await withFixture([ci], async (fixture) => {
    for (const jobs of [
      [
        buildJob(ci, { status: 'queued', conclusion: null }),
        quickJob(ci, { conclusion: 'failure' }),
      ],
      [
        buildJob(ci, { conclusion: 'failure' }),
        quickJob(ci, { status: 'queued', conclusion: null }),
      ],
    ]) {
      fixture.jobsByRun.set(100, jobs)
      await assert.rejects(
        acquireAfterQuick(fixture, {
          producerTimeoutSeconds: 1800,
        }),
        /did not succeed/,
      )
    }
    assert.deepEqual(fixture.requestedArtifacts, [])
    assert.deepEqual(fixture.downloaded, [])
  })
})

test('Linux acquisition separates producer readiness from transfer within its outer job bound', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/linux-host-conformance.yml', import.meta.url),
    'utf8',
  )
  const acquisition = workflow.slice(
    workflow.indexOf('  host-artifacts:\n'),
    workflow.indexOf('  host-suite:\n'),
  )
  assert.match(acquisition, /timeout-minutes: 40/)
  assert.match(acquisition, /--producer-timeout-seconds 1800 --timeout-seconds 300/)
  assert.doesNotMatch(acquisition, /--after-quick/)
})
