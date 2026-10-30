import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { acquireIntelInput, healthRows, intelHealthRecord, INTEL_WORKFLOW, selectIntelTargets, verifyIntelInput } from './intel-nightly.mjs'
import { digest, PACKAGE_LAYOUT, RELEASE_PACKAGE_LAYOUT, writeCandidateReceipt } from './candidate-provenance.mjs'
import { MAC_HOST_SHARDS } from './macos-host-test-shards.mjs'
import { executionInventory } from './job-evidence.mjs'
import { MACOS_QUALIFICATION_JOBS } from './release-readiness.mjs'

const repository = 'jiggy/jig'
const mainSource = 'a'.repeat(40)
const publishedSource = 'b'.repeat(40)
const workflowHead = 'c'.repeat(40)
const env = {
  GITHUB_REPOSITORY: repository,
  GITHUB_RUN_ID: '100',
  GITHUB_RUN_ATTEMPT: '2',
  GITHUB_SHA: workflowHead,
}
const target = { source: publishedSource, version: '0.1.0-alpha.42', label: 'jig-v0.1.0-alpha.42' }

function qualification() {
  return {
    schemaVersion: 1,
    stage: 'qualification',
    kind: 'macos',
    profile: 'x64',
    candidate: { sourceRevision: publishedSource },
    consumer: {
      repository,
      workflowPath: INTEL_WORKFLOW,
      event: 'schedule',
      headBranch: 'main',
      headRepository: repository,
      headSha: workflowHead,
      runId: 100,
      runAttempt: 2,
    },
  }
}

test('nightly selects the public alpha version before distinct exact main source', async () => {
  const requests = []
  const client = { api: async (path) => {
    requests.push(path)
    return { sha: publishedSource }
  } }
  const publishedVersion = async () => target.version
  const targets = await selectIntelTargets({ client, repository, mainSource, publishedVersion })
  assert.deepEqual(targets.map((row) => row.source), [publishedSource, mainSource])
  assert.equal(targets[0].version, target.version)
  assert.equal(targets[0].expected.event, 'push')
  assert.equal(targets[0].expected.headSha, publishedSource)
  assert.equal(requests[0], `repos/${repository}/commits/${target.label}`)
  const same = await selectIntelTargets({ client, repository,
    mainSource: publishedSource, publishedVersion })
  assert.equal(same.length, 1)
  assert.equal(same[0].version, target.version)
})

test('only an unpublished channel omits released coverage and registry errors fail selection', async () => {
  const options = { repository, mainSource,
    client: { api: async () => { throw new Error('unexpected API request') } } }
  const targets = await selectIntelTargets({ ...options, publishedVersion: async () => undefined })
  assert.deepEqual(targets.map((row) => row.source), [mainSource])
  await assert.rejects(() => selectIntelTargets({ ...options,
    publishedVersion: async () => { throw new Error('registry unavailable') },
  }), /registry unavailable/)
  for (const version of ['latest', '1.2.3; echo invalid', null, ''])
    await assert.rejects(() => selectIntelTargets({ ...options,
      publishedVersion: async () => version,
    }), /Invalid published Jig version/)
})

test('manual PR selection pins its merge source separately from producer head metadata', async () => {
  const client = { api: async () => ({ state: 'open', merge_commit_sha: publishedSource,
    base: { repo: { full_name: repository } },
    head: { sha: mainSource, ref: 'feature', repo: { full_name: 'contributor/jig' } },
  }) }
  const [selected] = await selectIntelTargets({ client, repository, mainSource, pullRequest: '42' })
  assert.equal(selected.source, publishedSource)
  assert.equal(selected.expected.headSha, mainSource)
  assert.equal(selected.expected.headRepository, 'contributor/jig')
  assert.equal(selected.expected.event, 'pull_request')
  for (const pullRequest of ['-1', '1; echo unsafe', '01'])
    await assert.rejects(() => selectIntelTargets({ client, repository, mainSource, pullRequest }), /Invalid PR/)
  await assert.rejects(() => selectIntelTargets({ repository, mainSource, pullRequest: '42',
    client: { api: async () => ({ state: 'closed' }) },
  }), /open PR/)
})

test('Intel health requires a complete receipt from this exact nightly source and attempt', () => {
  const good = qualification()
  const record = intelHealthRecord(good, target, env)
  assert.equal(record.version, target.version)
  assert.equal(record.outcome, 'passed')
  const mutations = [
    (row) => { row.stage = 'inputs' },
    (row) => { row.profile = 'arm64' },
    (row) => { row.candidate.sourceRevision = mainSource },
    (row) => { row.consumer.workflowPath = '.github/workflows/macos-hosted-candidates.yml' },
    (row) => { row.consumer.event = 'pull_request' },
    (row) => { row.consumer.headRepository = 'fork/jig' },
    (row) => { row.consumer.runId++ },
    (row) => { row.consumer.runAttempt-- },
    (row) => { row.consumer.headSha = mainSource },
  ]
  for (const mutate of mutations) {
    const changed = structuredClone(good)
    mutate(changed)
    assert.throws(() => intelHealthRecord(changed, target, env), /exact-source qualification/)
  }
})

test('old Intel health never turns a missing current result green', () => {
  const record = intelHealthRecord(qualification(), target, env)
  assert.equal(healthRows([target], [record], env)[0].passed, true)
  for (const change of [
    { runAttempt: 1 }, { runId: 99 }, { sourceRevision: mainSource },
    { workflowHead: mainSource }, { version: '0.1.0-alpha.38' }, { outcome: 'failed' },
  ]) assert.equal(healthRows([target], [{ ...record, ...change }], env)[0].passed, false)
  assert.equal(healthRows([target], [], env)[0].passed, false)
  assert.equal(healthRows([target], [record, record], env)[0].passed, false)
})

test('release evidence requires full ARM while Intel retains its independent full inventory', () => {
  assert.deepEqual(executionInventory({ scope: 'macos' }).targets.map((row) => row.id), ['macos-arm64'])
  const intel = executionInventory({ scope: 'macos-intel' }).targets
  assert.deepEqual(intel.map((row) => row.id), ['macos-x64'])
  assert.ok(intel[0].testInventory.length > 200)
  assert.ok(intel[0].requiresArtifacts && intel[0].requiresResidue)
  assert.ok(MACOS_QUALIFICATION_JOBS.every((name) => !name.includes('x64')))
  assert.deepEqual(MACOS_QUALIFICATION_JOBS, [
    'Native host qualification — arm64',
    ...Array.from({ length: MAC_HOST_SHARDS.arm64 }, (_, shard) => `Native host shard — arm64 / ${shard}`),
  ])
})

test('real ZIP mirrors preserve canonical bytes and refuse transport, source, producer and published-byte drift', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-intel-input-'))
  const root = join(temporary, 'bundle')
  await mkdir(root)
  try {
    for (const [kind, name] of Object.entries(PACKAGE_LAYOUT)) {
      const staging = join(temporary, kind)
      await mkdir(join(staging, 'package'), { recursive: true })
      await writeFile(join(staging, 'package/package.json'), JSON.stringify({
        name, version: target.version, publishConfig: { access: 'public' },
      }))
      await mkdir(join(root, kind))
      const archive = join(root, kind, `${kind}.tgz`)
      execFileSync('tar', ['-czf', archive, '-C', staging, 'package'])
      await writeFile(`${archive}.sha256`, `${digest(await readFile(archive))}  ${kind}.tgz\n`)
      const inventory = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trimEnd().split('\n').sort().join('\n')
      await writeFile(`${archive}.files`, inventory + '\n')
    }
    const producer = { repository, workflowPath: '.github/workflows/ci.yml', event: 'push',
      headBranch: 'main', headRepository: repository, headSha: publishedSource, runId: 42, runAttempt: 1 }
    await mkdir(join(root, 'resolution'))
    await writeFile(join(root, 'resolution/bun.lock'), 'exact fixture resolution')
    const receipt = await writeCandidateReceipt({ root, sourceRevision: publishedSource, producer,
      resolutionFiles: ['resolution/bun.lock'],
      release: { schemaVersion: 1, sourceRevision: publishedSource, eligible: true,
        reason: 'versioned-release', pendingPackages: [], releasePlanSha256: 'e'.repeat(64),
        packages: Object.entries(RELEASE_PACKAGE_LAYOUT).map(([kind, name]) => ({ kind, name, version: target.version })),
      },
      buildProfile: { platform: 'linux', architecture: 'x64', version: '1.3.3',
        revision: '274e01c737e85f8142070a9745b43a2ba09fce4c', justVersion: 'just 1.43.1',
        nodeVersion: '24.0.0', npmVersion: '11.6.2' },
    })
    await writeFile(join(root, 'ARTIFACT.json'), JSON.stringify({ schemaVersion: 1,
      repository, sourceRevision: publishedSource, runId: 42, runAttempt: 1,
      artifactId: 43, artifactDigest: `sha256:${'d'.repeat(64)}`, receiptSha256: receipt.receiptSha256,
    }))
    const selected = { ...target, expected: { ...producer } }
    const jigArchive = receipt.packages.find((entry) => entry.kind === 'jig').archive
    const integrity = `sha512-${createHash('sha512').update(await readFile(join(root, jigArchive))).digest('base64')}`
    const binding = await verifyIntelInput(root, selected, { integrityForVersion: async () => integrity })
    assert.equal(binding.producerRunId, 42)
    await assert.rejects(() => verifyIntelInput(root, selected, { integrityForVersion: async () => 'sha512-wrong' }), /exact published/)
    await assert.rejects(() => verifyIntelInput(root, { ...selected, version: '9.9.9' }), /version mismatch/)

    const zip = join(temporary, 'mirror.zip')
    execFileSync('python3', ['-c', 'import pathlib,sys,zipfile\nroot=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w") as z:\n for p in root.rglob("*"):\n  if p.is_file(): z.write(p,str(p.relative_to(root)))', root, zip])
    const run = { id: 100, run_attempt: 2, path: INTEL_WORKFLOW, head_branch: 'main',
      event: 'schedule', head_sha: workflowHead, repository: { full_name: repository }, head_repository: { full_name: repository } }
    const artifact = { id: 500, name: `intel-inputs-${publishedSource}-r100-a2`, expired: false,
      expires_at: new Date(Date.now() + 60_000).toISOString(), digest: `sha256:${digest(await readFile(zip))}`,
      workflow_run: { id: run.id, head_sha: workflowHead } }
    const client = {
      api: async (path) => path.includes('/artifacts') ? { artifacts: [artifact] } : { workflow_runs: [run] },
      download: async (_id, destination) => cp(zip, destination),
    }
    const mainTarget = { source: publishedSource, expected: producer, label: 'main' }
    const result = await acquireIntelInput({ client, repository, target: mainTarget, destination: join(temporary, 'acquired') })
    assert.deepEqual(result, binding)
    assert.equal(digest(await readFile(join(temporary, 'acquired', jigArchive))), digest(await readFile(join(root, jigArchive))))
    await assert.rejects(() => acquireIntelInput({ client, repository,
      target: { ...mainTarget, expected: { ...producer, headBranch: 'foreign' } },
      destination: join(temporary, 'foreign') }), /producer headBranch mismatch/)
    artifact.digest = `sha256:${'f'.repeat(64)}`
    await assert.rejects(() => acquireIntelInput({ client, repository, target: mainTarget,
      destination: join(temporary, 'tampered') }), /transport digest mismatch/)
    run.event = 'workflow_dispatch'
    let downloads = 0
    await assert.rejects(() => acquireIntelInput({ repository, target: mainTarget,
      destination: join(temporary, 'manual-mirror'),
      client: {
        api: async (path) => {
          if (path.includes('/workflows/ci.yml/')) throw new Error('CI unavailable in fixture')
          return { workflow_runs: [run] }
        },
        download: async () => { downloads++ },
      },
    }), /CI unavailable in fixture/)
    assert.equal(downloads, 0, 'manual PR runs cannot seed trusted scheduled inputs')
  } finally { await rm(temporary, { recursive: true, force: true }) }
})
