import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  digest,
  PACKAGE_LAYOUT,
  RELEASE_PACKAGE_LAYOUT,
  writeCandidateReceipt,
} from './candidate-provenance.mjs'
import { preflightCandidate } from './npm-candidate-preflight.mjs'

const revision = 'a'.repeat(40)
const version = '0.1.0-alpha.6'

async function fixture(scenario) {
  const root = await mkdtemp(join(tmpdir(), 'jig-preflight-test-'))
  const bundle = join(root, 'bundle')
  const candidate = join(bundle, 'agent-method')
  const source = join(root, 'source')
  const archive = join(candidate, 'candidate.tgz')
  const registryArchive = join(root, 'registry.tgz')
  const state = join(root, 'state.json')
  const npm = join(root, 'npm.cjs')
  try {
    await mkdir(candidate, { recursive: true })
    await mkdir(join(source, 'package'), { recursive: true })
    await writeFile(
      join(source, 'package/package.json'),
      JSON.stringify({
        name: '@jigging/agent-method',
        version,
        publishConfig: { access: 'public' },
      }),
    )
    execFileSync('tar', ['-czf', archive, '-C', source, 'package'])
    await copyFile(archive, registryArchive)
    await writeFile(
      join(candidate, 'SUCCESS.json'),
      JSON.stringify({
        archive: 'candidate.tgz',
        commit: revision,
        sha256: createHash('sha256')
          .update(await readFile(archive))
          .digest('hex'),
      }),
    )
    await writeFile(
      npm,
      `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const statePath = ${JSON.stringify(state)};
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const args = process.argv.slice(2);
state.calls.push(args);
fs.writeFileSync(statePath, JSON.stringify(state));
if (args[0] === 'view') {
  if (state.error) {
    process.stdout.write(JSON.stringify({error: {code: state.error}}));
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(state.version));
} else if (args[0] === 'pack') {
  if (!args.includes('--ignore-scripts')) process.exit(8);
  const destination = args[args.indexOf('--pack-destination') + 1];
  fs.copyFileSync(${JSON.stringify(registryArchive)}, path.join(destination, 'registry.tgz'));
} else {
  process.stderr.write('unexpected mutation'); process.exit(9);
}
`,
    )
    await chmod(npm, 0o755)
    const configure = (value) => writeFile(state, JSON.stringify({ version, calls: [], ...value }))
    const run = (bundleRoot) => preflightCandidate(candidate, revision, npm, bundleRoot)
    const calls = async () => JSON.parse(await readFile(state, 'utf8')).calls
    const canonical = async ({
      eligible = false,
      pendingPackages = ['@jigging/agent-method', '@jigging/agent-acp', '@jigging/jig'],
    } = {}) => {
      for (const [kind, name] of Object.entries(PACKAGE_LAYOUT)) {
        const directory = join(bundle, kind)
        let file = archive
        if (kind !== 'agent-method') {
          await mkdir(directory)
          const staging = join(root, `source-${kind}`)
          await mkdir(join(staging, 'package'), { recursive: true })
          await writeFile(
            join(staging, 'package/package.json'),
            JSON.stringify({ name, version, publishConfig: { access: 'public' } }),
          )
          file = join(directory, `${kind}.tgz`)
          execFileSync('tar', ['-czf', file, '-C', staging, 'package'])
        }
        const filename = file.split('/').at(-1)
        const sha256 = digest(await readFile(file))
        await writeFile(`${file}.sha256`, `${sha256}  ${filename}\n`)
        await writeFile(
          `${file}.files`,
          `${execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).trimEnd().split('\n').sort().join('\n')}\n`,
        )
        await writeFile(
          join(directory, 'SUCCESS.json'),
          JSON.stringify({ archive: filename, commit: revision, sha256 }),
        )
      }
      await mkdir(join(bundle, 'resolution'))
      await writeFile(join(bundle, 'resolution/bun.lock'), 'frozen fixture closure')
      await writeCandidateReceipt({
        root: bundle,
        sourceRevision: revision,
        release: {
          schemaVersion: 1,
          sourceRevision: revision,
          eligible,
          reason: eligible ? 'versioned-release' : 'pending-changesets',
          packages: Object.entries(RELEASE_PACKAGE_LAYOUT).map(([kind, name]) => ({
            kind,
            name,
            version,
          })),
          pendingPackages: eligible ? [] : pendingPackages,
          ...(eligible ? { releasePlanSha256: 'b'.repeat(64) } : {}),
        },
        producer: {
          repository: 'jiggy/jig',
          workflowPath: '.github/workflows/ci.yml',
          runId: 1,
          runAttempt: 1,
          event: 'pull_request',
          headSha: revision,
          headBranch: 'feature',
          headRepository: 'jiggy/jig',
        },
        buildProfile: {
          platform: 'linux',
          architecture: 'x64',
          version: '1.3.3',
          revision: '274e01c737e85f8142070a9745b43a2ba09fce4c',
          nodeVersion: '24.0.0',
          npmVersion: '11.6.2',
          justVersion: 'just 1.43.1',
        },
        resolutionFiles: ['resolution/bun.lock'],
      })
      return bundle
    }
    await configure({})
    await scenario({
      run,
      calls,
      configure,
      archive,
      registryArchive,
      candidate,
      canonical,
      bundle,
      npm,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('an unpublished exact version is ready without downloading or publishing', async () => {
  await fixture(async ({ configure, run, calls }) => {
    await configure({ error: 'E404' })
    assert.match(await run(), /unpublished version/)
    assert.deepEqual(
      (await calls()).map((args) => args[0]),
      ['view'],
    )
  })
})

test('an existing version requires identical whole archive bytes and leaves the candidate unchanged', async () => {
  await fixture(async ({ run, calls, archive, registryArchive }) => {
    const original = await readFile(archive)
    assert.match(await run(), /exact archive already published/)
    assert.deepEqual(
      (await calls()).map((args) => args[0]),
      ['view', 'pack'],
    )
    await writeFile(registryArchive, 'different bytes')
    await assert.rejects(run(), /generate new release versions from changesets/)
    assert.deepEqual(await readFile(archive), original)
  })
})

test('pending intent skips old-version collisions only for its exact immutable source candidate', async () => {
  await fixture(async ({ canonical, run, calls, registryArchive, archive }) => {
    const bundle = await canonical()
    const original = await readFile(archive)
    await writeFile(registryArchive, 'different old-version registry bytes')
    assert.match(await run(bundle), /changeset-covered source candidate/)
    assert.deepEqual(await calls(), [])
    assert.deepEqual(await readFile(archive), original)
    await writeFile(archive, 'candidate drift')
    await assert.rejects(run(bundle), /digest changed/)
  })
})

test('final release candidates and unrelated pending packages retain strict registry equality', async () => {
  for (const state of [{ eligible: true }, { pendingPackages: ['@jigging/jig'] }]) {
    await fixture(async ({ canonical, run, calls, registryArchive }) => {
      const bundle = await canonical(state)
      await writeFile(registryArchive, 'different immutable published bytes')
      await assert.rejects(run(bundle), /generate new release versions from changesets/)
      assert.deepEqual(
        (await calls()).map((args) => args[0]),
        ['view', 'pack'],
      )
    })
  }
})

test('pending Jig changes never bypass the frozen FLOW dependency registry check', async () => {
  await fixture(async ({ canonical, calls, bundle, npm, registryArchive }) => {
    await canonical()
    await writeFile(registryArchive, 'different FLOW registry bytes')
    await assert.rejects(
      preflightCandidate(join(bundle, 'flow-sdk'), revision, npm, bundle),
      /registry bytes differ from @jigging\/flow/,
    )
    assert.deepEqual(
      (await calls()).map((args) => args[0]),
      ['view', 'pack'],
    )
  })
})

test('missing or malformed canonical release evidence never disables registry checks silently', async () => {
  await fixture(async ({ canonical, run, calls, bundle }) => {
    await canonical()
    const path = join(bundle, 'CANDIDATE.json')
    const receipt = JSON.parse(await readFile(path, 'utf8'))
    for (const release of [
      undefined,
      { ...receipt.release, skipRegistry: true },
      { ...receipt.release, pendingPackages: ['@jigging/flow'] },
    ]) {
      await writeFile(path, JSON.stringify({ ...receipt, release }))
      await assert.rejects(run(bundle), /candidate receipt|candidate release|pending release/)
      assert.deepEqual(await calls(), [])
    }
  })
})

test('authentication, network and malformed version responses fail instead of implying an unpublished version', async () => {
  await fixture(async ({ configure, run, calls }) => {
    for (const error of ['E401', 'E403', 'ECONNRESET']) {
      await configure({ error })
      await assert.rejects(run(), /could not verify registry version/)
      assert.deepEqual(
        (await calls()).map((args) => args[0]),
        ['view'],
      )
    }
    await configure({ version: '0.1.0-alpha.5' })
    await assert.rejects(run(), /invalid registry version response/)
  })
})

test('modified or wrong-revision candidates fail before contacting the registry', async () => {
  await fixture(async ({ run, calls, archive, candidate }) => {
    await assert.rejects(preflightCandidate(candidate, 'b'.repeat(40)), /exact source revision/)
    await writeFile(archive, 'changed after qualification')
    await assert.rejects(run(), /candidate archive digest changed/)
    assert.deepEqual(await calls(), [])
  })
})
