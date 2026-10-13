import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const workflowPath = join(repositoryRoot, '.github/workflows/pypi-publish.yml')
const workflow = JSON.parse(
  execFileSync(
    'bun',
    [
      '--no-env-file',
      '--no-install',
      '--config=/dev/null',
      '--eval',
      'process.stdout.write(JSON.stringify(Bun.YAML.parse(await Bun.file(process.argv[1]).text())))',
      workflowPath,
    ],
    { encoding: 'utf8', timeout: 10_000 },
  ),
)
const guardName = 'Verify current Python qualification and pending archive identity'
const guard = workflow.jobs.publish.steps.find((step) => step.name === guardName)
assert.equal(typeof guard?.run, 'string', 'Protected Python publisher must have its live guard')

const source = 'a'.repeat(40)
const repository = 'fixture/jig'
const wheel = 'jiggy_flow-0.1.0a7-py3-none-any.whl'
const sdist = 'jiggy_flow-0.1.0a7.tar.gz'
const requiredJobs = [
  'Build Python SDK artifacts',
  'Source and package tests',
  'test',
  'Python 3.11 on ubuntu-24.04',
  'Python 3.12 on ubuntu-24.04',
  'Python 3.13 on ubuntu-24.04',
  'Python 3.14 on ubuntu-24.04',
  'Python 3.14 on macos-14',
  'Python 3.13 on windows-2022',
]
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

// The actual workflow runs gh, so an isolated executable supplies controlled
// read-only responses. Unknown paths fail rather than reaching a live API.
const fakeGithub = `import { readFileSync, writeFileSync } from 'node:fs';
const path = process.env.PYTHON_PUBLISH_FIXTURE_STATE;
const state = JSON.parse(readFileSync(path, 'utf8'));
const [command, endpoint, ...extra] = process.argv.slice(2);
if (command !== 'api' || extra.length) throw Error('Unexpected GitHub invocation');
state.calls.push(endpoint);
let value;
if (/\\/actions\\/runs\\/100$/.test(endpoint)) {
  state.runReads++;
  value = state.run;
  if (state.rerunAtFinalCheck && state.runReads > 1)
    value = { ...value, run_attempt: 2, status: 'queued', conclusion: null };
} else if (/\\/runs\\/100\\/attempts\\/1\\/jobs\\?per_page=100&page=\\d+$/.test(endpoint)) {
  const page = Number(new URL('https://fixture.invalid/' + endpoint).searchParams.get('page'));
  value = { jobs: state.jobPages ? (state.jobPages[page - 1] ?? []) : state.jobs };
  if (state.malformedJobs) value = { jobs: null };
} else if (/\\/actions\\/artifacts\\/500$/.test(endpoint)) {
  value = state.artifact;
} else throw Error('Unrecognized fixture API endpoint: ' + endpoint);
writeFileSync(path, JSON.stringify(state));
process.stdout.write(JSON.stringify(value));
`

function fixture(scenario) {
  const root = mkdtempSync(join(tmpdir(), 'jig-python-publisher-'))
  const bin = join(root, 'bin')
  const dist = join(root, 'dist')
  const statePath = join(root, 'api.json')
  const bytes = {
    [wheel]: Buffer.from('retained qualified wheel fixture'),
    [sdist]: Buffer.from('retained qualified source distribution fixture'),
  }
  const files = Object.fromEntries(
    Object.entries(bytes).map(([name, value]) => [name, hash(value)]),
  )
  const receiptBytes = Buffer.from(
    JSON.stringify({
      package: 'jiggy-flow',
      version: '0.1.0a7',
      commit: source,
      candidate: true,
      qualification: 'pending',
      files,
    }),
  )
  const jobs = requiredJobs.map((name, index) => ({
    jobId: 1000 + index,
    name,
    runId: 100,
    runAttempt: 1,
  }))
  const snapshot = {
    schemaVersion: 1,
    repository,
    group: 'python',
    sourceRevision: source,
    run: {
      runId: 100,
      runAttempt: 1,
      workflowPath: '.github/workflows/ci.yml',
      event: 'push',
      headSha: source,
      headBranch: 'main',
      headRepository: repository,
      jobs,
    },
    artifact: {
      artifactId: 500,
      name: `python-candidate-${source}-r100-a1`,
      digest: `sha256:${'c'.repeat(64)}`,
      runId: 100,
      headSha: source,
    },
    receiptSha256: hash(receiptBytes),
    files,
  }
  const state = {
    calls: [],
    runReads: 0,
    run: {
      id: 100,
      run_attempt: 1,
      status: 'completed',
      conclusion: 'success',
      repository: { full_name: repository },
      path: '.github/workflows/ci.yml',
      event: 'push',
      head_sha: source,
      head_branch: 'main',
      head_repository: { full_name: repository },
    },
    jobs: jobs.map((job) => ({
      id: job.jobId,
      name: job.name,
      run_attempt: 1,
      status: 'completed',
      conclusion: 'success',
    })),
    artifact: {
      id: 500,
      name: snapshot.artifact.name,
      digest: snapshot.artifact.digest,
      expired: false,
      expires_at: '2099-01-01T00:00:00Z',
      workflow_run: { id: 100, head_sha: source },
    },
  }
  mkdirSync(bin)
  mkdirSync(dist)
  for (const [name, value] of Object.entries(bytes)) writeFileSync(join(dist, name), value)
  const executable = join(bin, 'gh')
  writeFileSync(join(bin, 'github.mjs'), fakeGithub)
  // An explicit selected Node avoids interpreter/tool-manager differences and
  // keeps the fake executable from consulting any credentials or live CLI.
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
  writeFileSync(
    executable,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(bin, 'github.mjs'))} "$@"\n`,
  )
  chmodSync(executable, 0o755)
  function run({ env = {}, script = guard.run, authorize = true } = {}) {
    writeFileSync(statePath, JSON.stringify(state))
    const marker = join(root, 'publish-authorized')
    rmSync(marker, { force: true })
    const runtimeEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !/TOKEN|KEY|PASSWORD|SECRET|CREDENTIAL|^NODE_OPTIONS$/i.test(name),
      ),
    )
    const result = spawnSync('bash', ['-e'], {
      cwd: root,
      input: `${script}\n${authorize ? 'touch publish-authorized\n' : ''}`,
      encoding: 'utf8',
      timeout: 45_000,
      env: {
        ...runtimeEnvironment,
        PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`,
        PYTHON_PUBLISH_FIXTURE_STATE: statePath,
        QUALIFICATION_SNAPSHOT: JSON.stringify(snapshot),
        EXPECTED_RECEIPT_SHA256: snapshot.receiptSha256,
        SOURCE_REVISION: source,
        GITHUB_REPOSITORY: repository,
        GH_TOKEN: 'fixture-token-with-no-authority',
        RUNNER_TEMP: root,
        ...env,
      },
    })
    return {
      ...result,
      state: JSON.parse(readFileSync(statePath, 'utf8')),
      authorized: (() => {
        try {
          return readFileSync(marker).length === 0
        } catch {
          return false
        }
      })(),
    }
  }
  try {
    scenario({ root, dist, bytes, snapshot, state, receiptBytes, run })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function refused(result, message) {
  assert.equal(result.error, undefined, 'A subprocess error or timeout is not a policy refusal')
  assert.ok(Number.isInteger(result.status), 'Policy refusal requires a completed process')
  assert.notEqual(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.authorized, false, 'No mutation may follow a refused live guard')
  if (message) assert.match(result.stderr, message)
}

test('protected Python publication acquires immutable artifacts and checks live proof before OIDC', () => {
  const { authorize, prepare, publish, verify } = workflow.jobs
  assert.deepEqual(publish.needs, ['authorize', 'prepare'])
  assert.equal(publish.environment, 'pypi')
  assert.deepEqual(publish.permissions, { actions: 'read', 'id-token': 'write' })
  assert.equal(
    publish.steps.some((step) => step.uses?.startsWith('actions/checkout@')),
    false,
  )
  assert.equal(
    publish.steps.some((step) => step.run?.includes('scripts/')),
    false,
  )
  const gateIndex = publish.steps.indexOf(guard)
  const oidcIndex = publish.steps.findIndex((step) =>
    step.uses?.startsWith('pypa/gh-action-pypi-publish@'),
  )
  assert.ok(gateIndex >= 0 && oidcIndex > gateIndex)
  for (const job of [prepare, verify]) {
    const download = job.steps.find((step) => step.uses?.startsWith('actions/download-artifact@'))
    assert.equal(
      download.with['artifact-ids'],
      '${{ needs.authorize.outputs.candidate_artifact_id }}',
    )
    assert.equal(download.with.name, undefined)
  }
  assert.equal(
    publish.steps[0].with['artifact-ids'],
    '${{ needs.prepare.outputs.pending_artifact_id }}',
  )
  assert.equal(publish.steps[0].with.name, undefined)
  assert.equal(prepare.outputs.pending_artifact_id, '${{ steps.pending.outputs.artifact-id }}')
  assert.equal(authorize['timeout-minutes'], 5)
  assert.match(
    authorize.steps.find((step) => step.id === 'ready').run,
    /--producer-attempt "\$PRODUCER_RUN_ATTEMPT"/,
  )
  assert.equal(
    authorize.steps.find((step) => step.id === 'ready').env.PRODUCER_RUN_ATTEMPT,
    '${{ github.event.workflow_run.run_attempt }}',
  )
})

test('a qualified wheel/sdist pair or either legitimate pending subset permits the next action', () => {
  for (const pending of [[wheel, sdist], [wheel], [sdist]])
    fixture(({ dist, run }) => {
      for (const name of [wheel, sdist]) if (!pending.includes(name)) rmSync(join(dist, name))
      const result = run()
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.equal(result.authorized, true)
      assert.deepEqual(result.state.calls, [
        `repos/${repository}/actions/runs/100`,
        `repos/${repository}/actions/runs/100/attempts/1/jobs?per_page=100&page=1`,
        `repos/${repository}/actions/artifacts/500`,
        `repos/${repository}/actions/runs/100`,
      ])
    })
})

test('queued reruns, stale completed attempts and a rerun during verification block mutation', () => {
  for (const update of [
    (state) => Object.assign(state.run, { run_attempt: 2, status: 'queued', conclusion: null }),
    (state) => Object.assign(state.run, { run_attempt: 2 }),
    (state) => Object.assign(state.run, { status: 'in_progress', conclusion: null }),
    (state) => Object.assign(state.run, { conclusion: 'failure' }),
    (state) => Object.assign(state, { rerunAtFinalCheck: true }),
  ])
    fixture(({ state, run }) => {
      update(state)
      refused(run(), /qualification changed/)
    })
})

test('live producer identity cannot switch source, workflow, branch, event or repository', () => {
  for (const update of [
    (run) => {
      run.id = 101
    },
    (run) => {
      run.head_sha = 'b'.repeat(40)
    },
    (run) => {
      run.path = '.github/workflows/linux-host-conformance.yml'
    },
    (run) => {
      run.head_branch = 'feature'
    },
    (run) => {
      run.event = 'pull_request'
    },
    (run) => {
      run.repository.full_name = 'fork/jig'
    },
    (run) => {
      run.head_repository.full_name = 'fork/jig'
    },
  ])
    fixture(({ state, run }) => {
      update(state.run)
      refused(run(), /qualification changed/)
    })
})

test('every required Python build, source, aggregate and interpreter job needs current successful identity', () => {
  const cases = [
    ...requiredJobs.flatMap((_, index) =>
      ['missing', 'stale', 'substituted'].map((change) => [index, change]),
    ),
    ...['failed', 'cancelled', 'skipped', 'duplicate'].map((change) => [7, change]),
  ]
  for (const [index, change] of cases)
    fixture(({ state, run }) => {
      const job = state.jobs[index]
      if (change === 'missing') state.jobs.splice(index, 1)
      if (change === 'failed' || change === 'cancelled' || change === 'skipped')
        job.conclusion = change === 'failed' ? 'failure' : change
      if (change === 'stale') job.run_attempt = 2
      if (change === 'substituted') job.id += 100
      if (change === 'duplicate') state.jobs.push({ ...job })
      refused(run(), /qualification job changed/)
    })
})

test('candidate artifact ID, digest, producer, source and retention cannot be substituted', () => {
  for (const update of [
    (artifact) => {
      artifact.id = 501
    },
    (artifact) => {
      artifact.name = `python-candidate-${source}-r100-a2`
    },
    (artifact) => {
      artifact.digest = `sha256:${'d'.repeat(64)}`
    },
    (artifact) => {
      artifact.expired = true
    },
    (artifact) => {
      artifact.expires_at = '2000-01-01T00:00:00Z'
    },
    (artifact) => {
      artifact.expires_at = 'unavailable'
    },
    (artifact) => {
      artifact.workflow_run.id = 101
    },
    (artifact) => {
      artifact.workflow_run.head_sha = 'b'.repeat(40)
    },
  ])
    fixture(({ state, run }) => {
      update(state.artifact)
      refused(run(), /artifact changed or expired/)
    })
})

test('snapshot receipt, producer, source, group and required matrix bind to authorized inputs', () => {
  for (const update of [
    (snapshot) => {
      snapshot.receiptSha256 = 'd'.repeat(64)
    },
    (snapshot) => {
      snapshot.sourceRevision = 'b'.repeat(40)
    },
    (snapshot) => {
      snapshot.repository = 'fork/jig'
    },
    (snapshot) => {
      snapshot.group = 'host'
    },
    (snapshot) => {
      snapshot.run.runAttempt = 2
    },
    (snapshot) => {
      snapshot.run.headSha = 'b'.repeat(40)
    },
    (snapshot) => {
      snapshot.run.headRepository = 'fork/jig'
    },
    (snapshot) => {
      snapshot.run.event = 'pull_request'
    },
    (snapshot) => {
      snapshot.run.jobs.pop()
    },
    (snapshot) => {
      snapshot.run.jobs[0].runAttempt = 2
    },
    (snapshot) => {
      snapshot.run.jobs[0].runId = 101
    },
    (snapshot) => {
      snapshot.artifact.artifactId = 501
    },
    (snapshot) => {
      snapshot.artifact.runId = 101
    },
  ])
    fixture(({ snapshot, run }) => {
      const expectedReceipt = snapshot.receiptSha256
      update(snapshot)
      refused(run({ env: { EXPECTED_RECEIPT_SHA256: expectedReceipt } }))
    })
})

test('tampered, missing, extra, misnamed and non-regular pending distributions refuse mutation', () => {
  for (const update of [
    (data) => {
      writeFileSync(join(data.dist, wheel), 'changed wheel bytes')
    },
    (data) => {
      writeFileSync(join(data.dist, sdist), 'changed source bytes')
    },
    (data) => {
      rmSync(data.dist, { recursive: true })
      mkdirSync(data.dist)
    },
    (data) => {
      writeFileSync(join(data.dist, 'SUCCESS.json'), '{}')
    },
    (data) => {
      rmSync(join(data.dist, wheel))
      writeFileSync(join(data.dist, 'jiggy_flow-0.1.0a8-py3-none-any.whl'), data.bytes[wheel])
    },
    (data) => {
      rmSync(join(data.dist, wheel))
      mkdirSync(join(data.dist, wheel))
    },
    (data) => {
      rmSync(join(data.dist, wheel))
      writeFileSync(join(data.root, 'external-wheel'), data.bytes[wheel])
      symlinkSync(join(data.root, 'external-wheel'), join(data.dist, wheel))
    },
    (data) => {
      rmSync(data.dist, { recursive: true })
      writeFileSync(data.dist, data.bytes[wheel])
    },
    (data) => {
      rmSync(data.dist, { recursive: true })
      mkdirSync(join(data.root, 'other-dist'))
      writeFileSync(join(data.root, 'other-dist', wheel), data.bytes[wheel])
      symlinkSync(join(data.root, 'other-dist'), data.dist)
    },
  ])
    fixture((data) => {
      update(data)
      refused(data.run())
    })
})

test('authorized distributions require a valid matching wheel/sdist version pair and whole-file hashes', () => {
  for (const update of [
    (snapshot) => {
      delete snapshot.files[sdist]
    },
    (snapshot) => {
      snapshot.files['jiggy_flow-0.1.0a8.tar.gz'] = snapshot.files[sdist]
      delete snapshot.files[sdist]
    },
    (snapshot) => {
      snapshot.files[wheel] = 'malformed hash'
    },
    (snapshot) => {
      snapshot.files['other.whl'] = 'a'.repeat(64)
    },
  ])
    fixture(({ snapshot, run }) => {
      update(snapshot)
      refused(run(), /distribution identities/)
    })
})

test('live API pagination is complete and malformed evidence refuses publication', () => {
  fixture(({ state, run }) => {
    const unrelated = Array.from({ length: 100 }, (_, index) => ({
      id: 2000 + index,
      name: `unrelated-${index}`,
    }))
    state.jobPages = [unrelated, state.jobs]
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.authorized, true)
    assert.ok(result.state.calls.some((path) => path.endsWith('page=2')))
  })
  fixture(({ state, run }) => {
    state.malformedJobs = true
    refused(run(), /Malformed GitHub Python evidence/)
  })
})

test('prepare and final registry verification reject a changed or symlinked original receipt', () => {
  for (const job of [workflow.jobs.prepare, workflow.jobs.verify]) {
    const script = job.steps.find((step) => step.name === 'Check original Python build receipt').run
    fixture(({ root, receiptBytes, run }) => {
      const candidate = join(root, 'candidate')
      mkdirSync(candidate)
      writeFileSync(join(candidate, 'SUCCESS.json'), receiptBytes)
      assert.equal(run({ script, authorize: false }).status, 0)
      writeFileSync(join(candidate, 'SUCCESS.json'), 'substituted original receipt')
      refused(run({ script }), /receipt changed/)
      rmSync(join(candidate, 'SUCCESS.json'))
      writeFileSync(join(root, 'external-receipt'), receiptBytes)
      symlinkSync(join(root, 'external-receipt'), join(candidate, 'SUCCESS.json'))
      refused(run({ script }), /receipt changed/)
    })
  }
})
