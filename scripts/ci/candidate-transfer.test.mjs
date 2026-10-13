import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  digest,
  PACKAGE_LAYOUT,
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

async function withFixture(runs, action) {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-transfer-lineage-test-'))
  const byRun = new Map()
  const requestedEvents = []
  const requestedArtifacts = []
  const downloaded = []
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
          return { workflow_runs: matching.slice((page - 1) * limit, page * limit) }
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
        return current
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
    })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

test('push acquisition selects main-push bytes despite newer same-source scheduled and manual producers', async () => {
  await withFixture([run(100), run(101, 'schedule'), run(102, 'workflow_dispatch')], async (fixture) => {
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
  })
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

test('scheduled and manual audits still acquire exact current main audit candidates', async () => {
  for (const event of ['schedule', 'workflow_dispatch']) {
    await withFixture([run(100), run(101, event)], async (fixture) => {
      const expected = await acquisitionExpectation(source, env(event))
      assert.deepEqual(expected.allowedEvents, ['push', 'schedule', 'workflow_dispatch'])
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
      assert.deepEqual(fixture.requestedEvents.sort(), ['push', 'schedule', 'workflow_dispatch'])
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
  for (const event of ['schedule', 'workflow_dispatch']) {
    const expected = await acquisitionExpectation(source, env(event))
    for (const producerEvent of ['push', 'schedule', 'workflow_dispatch']) {
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
