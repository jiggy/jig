import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  digest,
  githubContext,
  PACKAGE_LAYOUT,
  verifyCandidateBundle,
  writeCandidateReceipt,
  writeQualificationReceipt,
} from './candidate-provenance.mjs'
import {
  acquireCandidate,
  acquireLinuxQualification,
  acquisitionExpectation,
  downloadArtifactDirectory,
  extractArtifactZip,
  validateWorkflowRun,
  verifyArtifactMetadata,
} from './candidate-transfer.mjs'
import {
  CI_QUALIFICATION_JOBS,
  LINUX_QUALIFICATION_JOBS,
  MACOS_QUALIFICATION_JOBS,
  releaseReadiness,
  resolveTriggerSource,
} from './release-readiness.mjs'

const source = 'a'.repeat(40),
  workflowHead = 'b'.repeat(40),
  repository = 'jiggy/jig'
const producer = {
  repository,
  workflowPath: '.github/workflows/ci.yml',
  runId: 100,
  runAttempt: 1,
  event: 'push',
  headSha: source,
  headBranch: 'main',
  headRepository: repository,
}
const profile = {
  platform: 'linux',
  architecture: 'x64',
  version: '1.3.3',
  revision: '274e01c737e85f8142070a9745b43a2ba09fce4c',
  nodeVersion: '24.0.0',
  npmVersion: '11.6.2',
  justVersion: 'just 1.43.1',
}

async function bundleFixture(action) {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-candidate-provenance-test-'))
  const root = join(temporary, 'bundle')
  await mkdir(root)
  try {
    for (const [kind, name] of Object.entries(PACKAGE_LAYOUT)) {
      const staging = join(temporary, `source-${kind}`)
      await mkdir(join(staging, 'package'), { recursive: true })
      await writeFile(
        join(staging, 'package/package.json'),
        JSON.stringify({ name, version: '0.1.0-alpha.1', publishConfig: { access: 'public' } }),
      )
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
    await writeFile(join(root, 'resolution/bun.lock'), 'actual resolved closure')
    const receipt = await writeCandidateReceipt({
      root,
      sourceRevision: source,
      producer,
      buildProfile: profile,
      resolutionFiles: ['resolution/bun.lock'],
    })
    await action({ temporary, root, receipt })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

test('candidate receipt verifies all five archives, actual inventories and resolution without changing frozen files', async () => {
  await bundleFixture(async ({ root, receipt }) => {
    const before = await readFile(join(root, 'CANDIDATE.json'))
    const verified = await verifyCandidateBundle(root, {
      sourceRevision: source,
      producerRunId: 100,
      producerRunAttempt: 1,
      producerRepository: repository,
    })
    assert.equal(verified.packages.length, 5)
    assert.equal(verified.receiptSha256, receipt.receiptSha256)
    assert.deepEqual(await readFile(join(root, 'CANDIDATE.json')), before)
    for (const expected of [
      { sourceRevision: workflowHead },
      { producerRunId: 101 },
      { producerRunAttempt: 2 },
      { producerRepository: 'fork/jig' },
    ])
      await assert.rejects(verifyCandidateBundle(root, expected), /mismatch/)
  })
})

test('archive, inventory, dependency and symlink tampering fail before qualification', async () => {
  for (const [file, pattern] of [
    ['jig/jig.tgz', /archive digest/],
    ['jig/jig.tgz.files', /inventory digest/],
    ['resolution/bun.lock', /dependency resolution/],
  ]) {
    await bundleFixture(async ({ root }) => {
      await writeFile(join(root, file), 'tampered')
      await assert.rejects(verifyCandidateBundle(root), pattern)
    })
  }
  await bundleFixture(async ({ root, temporary }) => {
    await rm(join(root, 'resolution/bun.lock'))
    await writeFile(join(temporary, 'outside'), 'actual resolved closure')
    await symlink(join(temporary, 'outside'), join(root, 'resolution/bun.lock'))
    await assert.rejects(verifyCandidateBundle(root), /regular file/)
  })
})

test('a self-consistent invented inventory still cannot describe different archive contents', async () => {
  await bundleFixture(async ({ root }) => {
    const path = join(root, 'CANDIDATE.json')
    const receipt = JSON.parse(await readFile(path, 'utf8'))
    const entry = receipt.packages.find((item) => item.kind === 'jig')
    await writeFile(join(root, entry.inventory), 'invented\n')
    entry.inventorySha256 = digest('invented\n')
    await writeFile(path, JSON.stringify(receipt))
    await assert.rejects(verifyCandidateBundle(root), /does not describe/)
  })
})

test('canonical build profile cannot silently adopt the Mac source runtime or a different Just version', async () => {
  await bundleFixture(async ({ root }) => {
    const path = join(root, 'CANDIDATE.json')
    const receipt = JSON.parse(await readFile(path, 'utf8'))
    for (const buildProfile of [
      { ...profile, platform: 'darwin', version: '1.4.2' },
      { ...profile, justVersion: 'just 1.43.2' },
      {},
    ]) {
      await writeFile(path, JSON.stringify({ ...receipt, buildProfile }))
      await assert.rejects(verifyCandidateBundle(root), /build profile/)
    }
  })
})

test('PR head metadata and the checkout merge source have separate identities', async () => {
  await bundleFixture(async ({ temporary }) => {
    const path = join(temporary, 'event.json')
    await writeFile(
      path,
      JSON.stringify({
        pull_request: {
          head: { sha: workflowHead, ref: 'feature', repo: { full_name: 'fork/jig' } },
        },
      }),
    )
    const context = await githubContext({
      sourceRevision: source,
      env: {
        GITHUB_REPOSITORY: repository,
        GITHUB_SHA: source,
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: path,
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/ci.yml@refs/pull/1/merge`,
      },
    })
    assert.equal(context.headSha, workflowHead)
    assert.equal(context.headRepository, 'fork/jig')
    assert.equal(context.workflowPath, '.github/workflows/ci.yml')
  })
})

const artifact = (id, name, run) => ({
  id,
  name,
  expired: false,
  expires_at: '2099-01-01T00:00:00Z',
  digest: `sha256:${'c'.repeat(64)}`,
  workflow_run: { id: run.id, head_sha: run.head_sha },
})
const run = (id, workflowPath, { headSha = source, event = 'push', attempt = 1 } = {}) => ({
  id,
  path: workflowPath,
  run_attempt: attempt,
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  event,
  head_sha: headSha,
  head_branch: 'main',
  status: 'completed',
  conclusion: 'success',
})

test('workflow and artifact metadata rejects fork origins, stale runs, expiry and invalid digest', () => {
  const ci = run(100, producer.workflowPath)
  const expected = {
    repository,
    workflowPath: producer.workflowPath,
    event: 'push',
    headSha: source,
    headBranch: 'main',
    headRepository: repository,
  }
  assert.equal(validateWorkflowRun(ci, expected), ci)
  assert.throws(
    () => validateWorkflowRun({ ...ci, head_repository: { full_name: 'fork/jig' } }, expected),
    /mismatch/,
  )
  for (const changed of [
    { expired: true },
    { expired: undefined },
    { expires_at: '2000-01-01T00:00:00Z' },
    { expires_at: 'invalid' },
    { expires_at: undefined },
    { digest: 'sha256:bad' },
    { workflow_run: undefined },
    { workflow_run: { id: 99, head_sha: source } },
  ])
    assert.throws(
      () =>
        verifyArtifactMetadata(
          { ...artifact(1, 'candidate', ci), ...changed },
          { name: 'candidate', runId: 100, headSha: source },
        ),
      /mismatch/,
    )
})

test('artifact transport digest is checked before extraction', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-transfer-digest-test-'))
  try {
    let extracted = false
    await assert.rejects(
      downloadArtifactDirectory(
        { download: async (_, path) => writeFile(path, 'wrong bytes') },
        { id: 1, digest: `sha256:${'c'.repeat(64)}` },
        join(temporary, 'result'),
        {
          extract: async () => {
            extracted = true
          },
        },
      ),
      /transport digest/,
    )
    assert.equal(extracted, false)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('ZIP extraction rejects traversal and symlink inputs without escaping its destination', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-safe-zip-test-'))
  try {
    for (const [name, mode] of [
      ['../escape', 0],
      ['link', 0o120777],
    ]) {
      const zip = join(temporary, `input-${mode}.zip`)
      execFileSync('python3', [
        '-c',
        'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w"); i=zipfile.ZipInfo(sys.argv[2]); i.external_attr=int(sys.argv[3])<<16; z.writestr(i,"value"); z.close()',
        zip,
        name,
        String(mode),
      ])
      await assert.rejects(extractArtifactZip(zip, join(temporary, `out-${mode}`)))
    }
    await assert.rejects(readFile(join(temporary, 'escape')), /ENOENT/)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('in-progress CI transfers exact current-attempt candidates and refuses stale partial rerun fallback', async () => {
  await bundleFixture(async ({ temporary, root }) => {
    const ci = { ...run(100, producer.workflowPath), status: 'in_progress', conclusion: null }
    const contents = Buffer.from('fixture transport')
    const candidateArtifact = {
      ...artifact(1000, `candidates-${source}-r100-a1`, ci),
      digest: `sha256:${digest(contents)}`,
    }
    const expected = {
      repository,
      workflowPath: producer.workflowPath,
      event: 'push',
      headSha: source,
      headBranch: 'main',
      headRepository: repository,
    }
    const client = {
      api: async (path) =>
        path.includes('/artifacts?')
          ? { artifacts: [candidateArtifact] }
          : path.includes('/workflows/')
            ? { workflow_runs: [ci] }
            : ci,
      download: async (_, path) => writeFile(path, contents),
    }
    const destination = join(temporary, 'download')
    const acquired = await acquireCandidate({
      destination,
      sourceRevision: source,
      expected,
      client,
      timeoutSeconds: 0,
      extract: async (_, to) => cp(root, to, { recursive: true }),
    })
    assert.equal(acquired.artifactId, 1000)
    assert.equal((await readMetadataForTest(join(destination, 'ARTIFACT.json'))).runAttempt, 1)
    ci.run_attempt = 2
    await assert.rejects(
      acquireCandidate({
        destination: join(temporary, 'rerun'),
        sourceRevision: source,
        expected,
        client,
        timeoutSeconds: 0,
      }),
      /deadline/,
    )
  })
})

async function readMetadataForTest(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

test('native qualification writer binds the exact upstream Linux receipt and preserves original producer', async () => {
  await bundleFixture(async ({ root, receipt, temporary }) => {
    const envelope = {
      schemaVersion: 1,
      repository,
      sourceRevision: source,
      runId: 100,
      runAttempt: 1,
      artifactId: 1000,
      artifactDigest: `sha256:${'c'.repeat(64)}`,
      receiptSha256: receipt.receiptSha256,
    }
    await writeFile(join(root, 'ARTIFACT.json'), JSON.stringify(envelope))
    const env = {
      GITHUB_REPOSITORY: repository,
      GITHUB_RUN_ID: '200',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_SHA: source,
      GITHUB_REF: 'refs/heads/main',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/linux-host-conformance.yml@refs/heads/main`,
    }
    const linux = join(temporary, 'linux.json')
    await writeQualificationReceipt({ root, output: linux, kind: 'linux', env })
    const native = await writeQualificationReceipt({
      root,
      output: join(temporary, 'native.json'),
      kind: 'native',
      profile: 'codex',
      upstreamReceipt: linux,
      env: {
        ...env,
        GITHUB_RUN_ID: '400',
        GITHUB_SHA: workflowHead,
        GITHUB_EVENT_NAME: 'workflow_run',
        GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/native-agent-api-qualification.yml@refs/heads/main`,
      },
    })
    assert.equal(native.candidate.sourceRevision, source)
    assert.equal(native.consumer.headSha, workflowHead)
    assert.equal(native.upstream.receipt.consumer.runId, 200)
    const inputs = await writeQualificationReceipt({
      root,
      output: join(temporary, 'INPUTS.json'),
      kind: 'native',
      profile: 'codex',
      stage: 'inputs',
      upstreamReceipt: linux,
      env: {
        ...env,
        GITHUB_RUN_ID: '400',
        GITHUB_SHA: workflowHead,
        GITHUB_EVENT_NAME: 'workflow_run',
        GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/native-agent-api-qualification.yml@refs/heads/main`,
      },
    })
    assert.equal(inputs.stage, 'inputs')
    assert.deepEqual(inputs.candidate, native.candidate)
    await assert.rejects(
      writeQualificationReceipt({
        root,
        output: join(temporary, 'wrong-checkout.json'),
        kind: 'linux',
        env,
        checkedOutRevision: workflowHead,
      }),
      /source mismatch/,
    )
    await assert.rejects(
      writeQualificationReceipt({
        root,
        output: join(temporary, 'bad.json'),
        kind: 'native',
        profile: 'pi',
        env,
      }),
      /requires its Linux receipt/,
    )
  })
})

function readinessFixture() {
  const ci = run(100, producer.workflowPath),
    linux = run(200, '.github/workflows/linux-host-conformance.yml'),
    mac = run(300, '.github/workflows/macos-hosted-candidates.yml')
  const native = run(400, '.github/workflows/native-agent-api-qualification.yml', {
    headSha: workflowHead,
    event: 'workflow_run',
  })
  const runs = new Map([ci, linux, mac, native].map((entry) => [entry.id, entry]))
  const canonical = artifact(1000, `candidates-${source}-r100-a1`, ci)
  const candidate = {
    sourceRevision: source,
    receiptSha256: 'd'.repeat(64),
    producerRunId: 100,
    producerRunAttempt: 1,
    artifactId: canonical.id,
    artifactDigest: canonical.digest,
  }
  const consumer = (entry) => ({
    repository,
    workflowPath: entry.path,
    runId: entry.id,
    runAttempt: entry.run_attempt,
    event: entry.event,
    headSha: entry.head_sha,
    headBranch: 'main',
    headRepository: repository,
  })
  const qualify = (kind, profile, entry) => ({
    schemaVersion: 1,
    stage: 'qualification',
    kind,
    profile,
    candidate: { ...candidate },
    consumer: consumer(entry),
  })
  const linuxReceipt = qualify('linux', '', linux)
  const linuxDigest = digest(`${JSON.stringify(linuxReceipt, null, 2)}\n`)
  const receipts = new Map([
    [2000, linuxReceipt],
    [3000, qualify('macos', 'x64', mac)],
    [3001, qualify('macos', 'arm64', mac)],
  ])
  const artifacts = new Map([
    [100, [canonical]],
    [200, [artifact(2000, `linux-qualification-${source}-r200-a1`, linux)]],
    [
      300,
      ['x64', 'arm64'].map((arch, i) =>
        artifact(3000 + i, `macos-qualification-${arch}-${source}-r300-a1`, mac),
      ),
    ],
    [
      400,
      ['codex', 'claude', 'pi'].map((client, i) => {
        const receipt = qualify('native', client, native)
        receipt.upstream = { receiptSha256: linuxDigest, receipt: structuredClone(linuxReceipt) }
        receipts.set(4000 + i, receipt)
        return artifact(4000 + i, `native-qualification-${client}-${source}-r400-a1`, native)
      }),
    ],
  ])
  const names = new Map([
    [100, [...CI_QUALIFICATION_JOBS, 'candidate-build']],
    [200, [...LINUX_QUALIFICATION_JOBS]],
    [300, [...MACOS_QUALIFICATION_JOBS]],
    [400, ['codex', 'claude', 'pi'].map((client) => `${client} — Ubuntu 24.04`)],
  ])
  const jobs = new Map(
    [...names].map(([id, list]) => [
      id,
      list.map((name, index) => ({
        id: id * 10 + index,
        name,
        status: 'completed',
        conclusion: 'success',
        run_attempt: 1,
      })),
    ]),
  )
  const canonicalReceipt = {
    sourceRevision: source,
    producer: { ...producer },
    receiptSha256: candidate.receiptSha256,
  }
  const clone = (value) => structuredClone(value)
  const client = {
    api: async (path) => {
      const url = new URL(`https://api.github.com/${path}`)
      const workflowMatch = /\/actions\/workflows\/([^/]+)\/runs$/.exec(url.pathname)
      if (workflowMatch)
        return {
          workflow_runs: clone(
            [...runs.values()].filter((entry) => entry.path.endsWith(`/${workflowMatch[1]}`)),
          ),
        }
      const jobsMatch = /\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs$/.exec(url.pathname)
      if (jobsMatch) return { jobs: clone(jobs.get(Number(jobsMatch[1])) ?? []) }
      const artifactsMatch = /\/actions\/runs\/(\d+)\/artifacts$/.exec(url.pathname)
      if (artifactsMatch)
        return { artifacts: clone(artifacts.get(Number(artifactsMatch[1])) ?? []) }
      const runMatch = /\/actions\/runs\/(\d+)$/.exec(url.pathname)
      if (runMatch) return clone(runs.get(Number(runMatch[1])))
      throw new Error(`Unexpected API request: ${path}`)
    },
    readCandidate: async () => clone(canonicalReceipt),
    readQualification: async (entry) => clone(receipts.get(entry.id)),
  }
  return {
    client,
    runs,
    artifacts,
    receipts,
    jobs,
    canonicalReceipt,
    check: (options = {}) =>
      releaseReadiness({ client, repository, sourceRevision: source, ...options }),
  }
}

test('readiness accepts complete canonical qualification even when native descendant SHA has advanced', async () => {
  const fixture = readinessFixture()
  const result = await fixture.check()
  assert.equal(result.readyFlow, true)
  assert.equal(result.readyHost, true)
  assert.deepEqual(result.reasons, [])
  assert.equal(result.producerRunId, 100)
  assert.equal(
    result.obligations.length,
    CI_QUALIFICATION_JOBS.length +
      1 +
      LINUX_QUALIFICATION_JOBS.length +
      MACOS_QUALIFICATION_JOBS.length +
      3,
  )
  assert.deepEqual(
    result.flowSnapshot.runs.map((entry) => entry.runId),
    [100],
  )
  assert.deepEqual(
    result.hostSnapshot.runs.map((entry) => entry.runId),
    [100, 200, 300, 400],
  )
  assert.equal(result.flowSnapshot.artifacts.length, 1)
  assert.equal(result.hostSnapshot.artifacts.length, 7)
  for (const retained of result.hostSnapshot.runs)
    assert.ok(
      retained.jobs.every(
        (job) => job.runId === retained.runId && job.runAttempt === retained.runAttempt,
      ),
    )
  assert.equal(
    await resolveTriggerSource({ client: fixture.client, repository, triggerRunId: 400 }),
    source,
  )
})

test('duplicate and out-of-order completion events re-evaluate the same full prerequisite set', async () => {
  const fixture = readinessFixture()
  for (const triggerRunId of [300, 100, 200, 400, 100]) {
    const result = await fixture.check({ sourceRevision: undefined, triggerRunId })
    assert.equal(result.readyFlow, true)
    assert.equal(result.readyHost, true)
  }
})

test('wrong source, producer run/attempt, fork origin or expired canonical artifact prevents all publication', async () => {
  const mutations = [
    (f) => {
      f.canonicalReceipt.sourceRevision = workflowHead
    },
    (f) => {
      f.canonicalReceipt.producer.runId = 101
    },
    (f) => {
      f.canonicalReceipt.producer.runAttempt = 2
    },
    (f) => {
      f.runs.get(100).head_repository.full_name = 'fork/jig'
    },
    (f) => {
      f.artifacts.get(100)[0].expired = true
    },
    (f) => {
      f.artifacts.set(100, [])
    },
    (f) => {
      f.runs.get(100).run_attempt = 2
    },
  ]
  for (const mutate of mutations) {
    const fixture = readinessFixture()
    mutate(fixture)
    const result = await fixture.check()
    assert.equal(result.readyFlow, false)
    assert.equal(result.readyHost, false)
  }
})

test('failed, cancelled, skipped, missing or stale host evidence blocks Jig while FLOW remains ready', async () => {
  const mutations = [
    (f) => {
      f.runs.get(200).conclusion = 'failure'
    },
    (f) => {
      f.runs.get(300).conclusion = 'cancelled'
    },
    (f) => {
      f.jobs.get(200)[0].conclusion = 'skipped'
    },
    (f) => {
      f.jobs.get(200)[1].run_attempt = 0
    },
    (f) => {
      f.jobs.get(300).find((job) => job.name === 'Native host shard — x64 / 2').run_attempt = 0
    },
    (f) => {
      f.receipts.get(3000).candidate.artifactId = 99
    },
    (f) => {
      f.receipts.get(3001).consumer.runAttempt = 0
    },
    (f) => {
      f.artifacts.get(300).pop()
    },
    (f) => {
      f.runs.get(400).run_attempt = 2
    },
    (f) => {
      f.receipts.get(4000).upstream.receipt.consumer.runId = 201
    },
    (f) => {
      f.receipts.get(4001).upstream.receiptSha256 = 'e'.repeat(64)
    },
    (f) => {
      f.receipts.get(4002).candidate.artifactDigest = `sha256:${'e'.repeat(64)}`
    },
  ]
  for (const mutate of mutations) {
    const fixture = readinessFixture()
    mutate(fixture)
    const result = await fixture.check()
    assert.equal(result.readyFlow, true)
    assert.equal(result.readyHost, false)
    assert.ok(result.reasons.length)
  }
})

test('PR or fork completion cannot identify a release source', async () => {
  const fixture = readinessFixture()
  fixture.runs.get(100).event = 'pull_request'
  assert.equal(
    await resolveTriggerSource({ client: fixture.client, repository, triggerRunId: 100 }),
    undefined,
  )
  fixture.runs.get(400).head_repository.full_name = 'fork/jig'
  assert.equal(
    await resolveTriggerSource({ client: fixture.client, repository, triggerRunId: 400 }),
    undefined,
  )
})

test('readiness refuses a producer rerun that starts while its evidence is being inspected', async () => {
  const fixture = readinessFixture()
  const original = fixture.client.readCandidate
  fixture.client.readCandidate = async (...args) => {
    const value = await original(...args)
    fixture.runs.get(100).run_attempt = 2
    fixture.runs.get(100).status = 'in_progress'
    return value
  }
  const result = await fixture.check()
  assert.equal(result.readyFlow, false)
  assert.equal(result.readyHost, false)
  assert.match(result.reasons.join(' '), /attempt changed/)
})

test('early inputs identify a newer failed native run and cannot qualify it using an older green run', async () => {
  const fixture = readinessFixture()
  const newer = run(401, '.github/workflows/native-agent-api-qualification.yml', {
    headSha: workflowHead,
    event: 'workflow_run',
  })
  newer.conclusion = 'failure'
  fixture.runs.set(401, newer)
  fixture.artifacts.set(401, [artifact(4100, `native-inputs-codex-${source}-r401-a1`, newer)])
  const inputs = structuredClone(fixture.receipts.get(4000))
  inputs.stage = 'inputs'
  inputs.consumer.runId = 401
  fixture.receipts.set(4100, inputs)
  assert.equal(
    await resolveTriggerSource({ client: fixture.client, repository, triggerRunId: 401 }),
    source,
  )
  const result = await fixture.check()
  assert.equal(result.readyFlow, true)
  assert.equal(result.readyHost, false)
  assert.match(result.reasons.join(' '), /pending or failed/)
  newer.conclusion = 'success'
  const onlyInputs = await fixture.check()
  assert.equal(onlyInputs.readyHost, false)
  assert.match(onlyInputs.reasons.join(' '), /current-attempt job/)
})

test('native inputs stage cannot be relabeled as final passing qualification', async () => {
  const fixture = readinessFixture()
  fixture.receipts.get(4000).stage = 'inputs'
  const result = await fixture.check()
  assert.equal(result.readyFlow, true)
  assert.equal(result.readyHost, false)
  assert.match(result.reasons.join(' '), /profile mismatch/)
})

test('a newer manual native run blocks old qualification before protected environment approval', async () => {
  for (const status of ['waiting', 'completed']) {
    const fixture = readinessFixture()
    const newer = run(401, '.github/workflows/native-agent-api-qualification.yml', {
      headSha: source,
      event: 'workflow_dispatch',
    })
    newer.status = status
    newer.conclusion = status === 'completed' ? 'failure' : null
    fixture.runs.set(401, newer)
    assert.equal(
      await resolveTriggerSource({ client: fixture.client, repository, triggerRunId: 401 }),
      source,
    )
    const result = await fixture.check()
    assert.equal(result.readyFlow, true)
    assert.equal(result.readyHost, false)
    assert.equal(result.hostSnapshot, null)
    assert.match(result.reasons.join(' '), /pending or failed/)
  }
})

test('native acquisition verifies current Linux proof and receives its original canonical CI bytes', async () => {
  await bundleFixture(async ({ root, temporary, receipt }) => {
    const fixture = readinessFixture()
    const transport = Buffer.from('canonical artifact transport')
    const candidateArtifact = fixture.artifacts.get(100)[0]
    candidateArtifact.digest = `sha256:${digest(transport)}`
    const linuxReceipt = fixture.receipts.get(2000)
    linuxReceipt.candidate.receiptSha256 = receipt.receiptSha256
    linuxReceipt.candidate.artifactDigest = candidateArtifact.digest
    fixture.client.download = async (_, destination) => writeFile(destination, transport)
    const destination = join(temporary, 'native-bundle')
    const acquired = await acquireLinuxQualification({
      destination,
      qualificationDirectory: join(temporary, 'linux-receipt'),
      sourceRevision: source,
      linuxRunId: 200,
      repository,
      client: fixture.client,
      extract: async (_, to) => cp(root, to, { recursive: true }),
    })
    assert.equal(acquired.linuxRunId, 200)
    assert.equal(acquired.artifactId, candidateArtifact.id)
    assert.equal((await verifyCandidateBundle(destination)).receiptSha256, receipt.receiptSha256)
    fixture.runs.get(200).run_attempt = 2
    await assert.rejects(
      acquireLinuxQualification({
        destination: join(temporary, 'stale-bundle'),
        qualificationDirectory: join(temporary, 'stale-linux-receipt'),
        sourceRevision: source,
        linuxRunId: 200,
        repository,
        client: fixture.client,
      }),
      /current-attempt|attempt/,
    )
  })
})

test('scheduled audit acquisition accepts main producers while release readiness still requires main push', async () => {
  const expected = await acquisitionExpectation(source, {
    GITHUB_REPOSITORY: repository,
    GITHUB_SHA: source,
    GITHUB_REF: 'refs/heads/main',
    GITHUB_EVENT_NAME: 'schedule',
  })
  assert.deepEqual(expected.allowedEvents, ['push', 'schedule', 'workflow_dispatch'])
  assert.doesNotThrow(() =>
    validateWorkflowRun(run(100, producer.workflowPath, { event: 'schedule' }), expected),
  )
  assert.throws(
    () =>
      validateWorkflowRun(
        {
          ...run(100, producer.workflowPath, { event: 'workflow_dispatch' }),
          head_branch: 'alpha',
        },
        expected,
      ),
    /mismatch/,
  )
  const fixture = readinessFixture()
  fixture.runs.get(100).event = 'schedule'
  const result = await fixture.check()
  assert.equal(result.readyFlow, false)
  assert.equal(result.readyHost, false)
})
