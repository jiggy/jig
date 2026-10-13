import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { digest } from './candidate-provenance.mjs'
import {
  PYTHON_QUALIFICATION_JOBS,
  pythonReadiness,
  revalidatePythonSnapshot,
  verifyPythonCandidate,
} from './python-readiness.mjs'

const sourceRevision = 'a'.repeat(40)
const repository = 'jiggy/jig'
const version = '0.1.0a14'
const wheel = `jiggy_flow-${version}-py3-none-any.whl`
const sdist = `jiggy_flow-${version}.tar.gz`
const clone = (value) => structuredClone(value)

async function fixture(action) {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-python-readiness-test-'))
  const directory = join(temporary, 'candidate')
  await mkdir(directory)
  const files = { [wheel]: digest('wheel bytes'), [sdist]: digest('sdist bytes') }
  const receipt = {
    package: 'jiggy-flow',
    version,
    commit: sourceRevision,
    candidate: true,
    qualification: 'pending',
    files,
  }
  const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`
  await writeFile(join(directory, wheel), 'wheel bytes')
  await writeFile(join(directory, sdist), 'sdist bytes')
  await writeFile(join(directory, 'SUCCESS.json'), receiptBytes)
  const archive = join(temporary, 'artifact.zip')
  execFileSync('python3', [
    '-c',
    'import pathlib,sys,zipfile\np=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2], "w") as z:\n for f in sorted(p.iterdir()): z.write(f,f.name)',
    directory,
    archive,
  ])
  const zipBytes = await readFile(archive)
  const run = {
    id: 100,
    run_attempt: 1,
    repository: { full_name: repository },
    path: '.github/workflows/ci.yml',
    event: 'push',
    head_branch: 'main',
    head_sha: sourceRevision,
    head_repository: { full_name: repository },
    status: 'completed',
    conclusion: 'success',
  }
  const jobs = PYTHON_QUALIFICATION_JOBS.map((name, index) => ({
    id: 1000 + index,
    name,
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
  }))
  const artifact = {
    id: 500,
    name: `python-candidate-${sourceRevision}-r100-a1`,
    digest: `sha256:${digest(zipBytes)}`,
    expired: false,
    expires_at: '2199-01-01T00:00:00Z',
    workflow_run: { id: 100, head_sha: sourceRevision },
  }
  const state = {
    run,
    jobs,
    artifacts: [artifact],
    zipBytes,
    runReads: 0,
    beforeRunRead: undefined,
  }
  const client = {
    api: async (path) => {
      if (path === `repos/${repository}/actions/runs/100`) {
        state.runReads++
        state.beforeRunRead?.(state)
        return clone(state.run)
      }
      if (path.includes('/attempts/1/jobs?')) return { jobs: clone(state.jobs) }
      if (path.includes('/actions/runs/100/artifacts?'))
        return { artifacts: clone(state.artifacts) }
      if (path === `repos/${repository}/actions/artifacts/500`) return clone(state.artifacts[0])
      throw new Error(`Unexpected fixture API path: ${path}`)
    },
    download: async (id, path) => {
      assert.equal(id, 500)
      await writeFile(path, state.zipBytes)
    },
  }
  const options = { repository, sourceRevision, producerRunId: 100, producerRunAttempt: 1, client }
  try {
    return await action({ options, state, client, directory, files, receiptBytes })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

test('Python readiness binds build-only archives to all current-attempt installed profiles without host gates', () =>
  fixture(async ({ options, files, receiptBytes }) => {
    const snapshot = await pythonReadiness(options)
    assert.equal(snapshot.group, 'python')
    assert.equal(snapshot.run.runAttempt, 1)
    assert.deepEqual(
      snapshot.run.jobs.map((job) => job.name).sort(),
      [...PYTHON_QUALIFICATION_JOBS].sort(),
    )
    assert.equal(snapshot.artifact.artifactId, 500)
    assert.equal(snapshot.receiptSha256, digest(receiptBytes))
    assert.deepEqual(snapshot.files, files)
    assert.equal(snapshot.run.jobs.length, 9)
  }))

test('historical successful event cannot authorize a newer, pending or untrusted producer attempt', async () => {
  for (const changes of [
    { run_attempt: 2 },
    { status: 'in_progress', conclusion: null },
    { conclusion: 'failure' },
    { event: 'pull_request' },
    { event: 'schedule' },
    { head_branch: 'alpha' },
    { head_sha: 'b'.repeat(40) },
    { repository: { full_name: 'fork/jig' } },
    { head_repository: { full_name: 'fork/jig' } },
    { path: '.github/workflows/other.yml' },
  ])
    await fixture(async ({ options, state }) => {
      Object.assign(state.run, changes)
      await assert.rejects(pythonReadiness(options))
    })
})

test('each installed profile and source/build/aggregate obligation must be successful in the current attempt', async () => {
  for (const name of PYTHON_QUALIFICATION_JOBS)
    await fixture(async ({ options, state }) => {
      state.jobs = state.jobs.filter((job) => job.name !== name)
      await assert.rejects(pythonReadiness(options), /current-attempt job/)
    })
  for (const changes of [
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { run_attempt: 2 },
    { id: 0 },
  ])
    await fixture(async ({ options, state }) => {
      Object.assign(state.jobs[0], changes)
      await assert.rejects(pythonReadiness(options))
    })
  await fixture(async ({ options, state }) => {
    state.jobs.push(clone(state.jobs[0]))
    await assert.rejects(pythonReadiness(options), /current-attempt job/)
  })
})

test('only the exact unexpired attempt-scoped artifact and verified transport bytes can qualify', async () => {
  for (const changes of [
    { name: `python-candidate-${sourceRevision}` },
    { name: `python-candidate-${sourceRevision}-r100-a2` },
    { expired: true },
    { expires_at: '2000-01-01T00:00:00Z' },
    { digest: `sha256:${'0'.repeat(64)}` },
    { workflow_run: { id: 101, head_sha: sourceRevision } },
    { workflow_run: { id: 100, head_sha: 'b'.repeat(40) } },
  ])
    await fixture(async ({ options, state }) => {
      Object.assign(state.artifacts[0], changes)
      await assert.rejects(pythonReadiness(options))
    })
  await fixture(async ({ options, state }) => {
    state.artifacts.push(clone(state.artifacts[0]))
    await assert.rejects(pythonReadiness(options), /ambiguous/)
  })
})

test('rerun during authorization or after queueing invalidates the retained snapshot', () =>
  fixture(async ({ options, state, client }) => {
    state.beforeRunRead = (current) => {
      if (current.runReads === 2) current.run.run_attempt = 2
    }
    await assert.rejects(pythonReadiness(options), /triggering CI attempt/)
    state.beforeRunRead = undefined
    state.run.run_attempt = 1
    const snapshot = await pythonReadiness(options)
    state.run.run_attempt = 2
    await assert.rejects(revalidatePythonSnapshot(snapshot, { client }), /triggering CI attempt/)
  }))

test('changed job IDs, artifact IDs/digests or retention invalidate a queued snapshot', async () => {
  for (const mutate of [
    (state) => {
      state.jobs[0].id++
    },
    (state) => {
      state.artifacts[0].id++
    },
    (state) => {
      state.artifacts[0].digest = `sha256:${'0'.repeat(64)}`
    },
    (state) => {
      state.artifacts[0].expired = true
    },
  ])
    await fixture(async ({ options, state, client }) => {
      const snapshot = await pythonReadiness(options)
      mutate(state)
      await assert.rejects(revalidatePythonSnapshot(snapshot, { client }))
    })
})

test('source receipt, exact archive inventory and archive digests are verified independently', async () => {
  await fixture(async ({ directory }) => {
    await writeFile(join(directory, wheel), 'changed bytes')
    await assert.rejects(verifyPythonCandidate(directory, sourceRevision), /archive differs/)
  })
  await fixture(async ({ directory }) => {
    await writeFile(join(directory, 'extra.whl'), 'extra')
    await assert.rejects(verifyPythonCandidate(directory, sourceRevision), /exactly/)
  })
  await fixture(async ({ directory }) => {
    await assert.rejects(verifyPythonCandidate(directory, 'b'.repeat(40)), /source/)
  })
})

test('malformed snapshot identities, obligations and archive pairs cannot become API authorization', () =>
  fixture(async ({ options, client }) => {
    const snapshot = await pythonReadiness(options)
    for (const mutate of [
      (value) => {
        value.repository = 'invalid/repository/path'
      },
      (value) => {
        value.run.runId = 0
      },
      (value) => {
        value.run.runAttempt = 0
      },
      (value) => {
        value.run.jobs.pop()
      },
      (value) => {
        value.run.jobs[0].jobId = value.run.jobs[1].jobId
      },
      (value) => {
        value.run.jobs[0].runAttempt = 2
      },
      (value) => {
        value.artifact.artifactId = 0
      },
      (value) => {
        value.artifact.digest = 'not-a-digest'
      },
      (value) => {
        value.artifact.name = `python-candidate-${sourceRevision}`
      },
      (value) => {
        delete value.files[wheel]
      },
      (value) => {
        value.files[wheel] = 'not-a-digest'
      },
      (value) => {
        value.files['../extra.whl'] = '0'.repeat(64)
      },
      (value) => {
        value.receiptSha256 = 'not-a-digest'
      },
    ]) {
      const forged = clone(snapshot)
      mutate(forged)
      await assert.rejects(revalidatePythonSnapshot(forged, { client }))
    }
  }))
