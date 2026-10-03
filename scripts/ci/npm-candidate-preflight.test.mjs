import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { preflightCandidate } from './npm-candidate-preflight.mjs'

const revision = 'a'.repeat(40)
const version = '0.1.0-alpha.6'

async function fixture(scenario) {
  const root = await mkdtemp(join(tmpdir(), 'jig-preflight-test-'))
  const candidate = join(root, 'candidate')
  const source = join(root, 'source')
  const archive = join(candidate, 'candidate.tgz')
  const registryArchive = join(root, 'registry.tgz')
  const state = join(root, 'state.json')
  const npm = join(root, 'npm')
  try {
    await mkdir(candidate)
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
    const run = () => preflightCandidate(candidate, revision, npm)
    const calls = async () => JSON.parse(await readFile(state, 'utf8')).calls
    await configure({})
    await scenario({ run, calls, configure, archive, registryArchive, candidate })
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
    await assert.rejects(run(), /bump its version and dependent package versions before merging/)
    assert.deepEqual(await readFile(archive), original)
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
