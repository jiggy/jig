import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  commandsForShard,
  discoverJigTests,
  NATIVE_PREREQUISITE_TESTS,
  planMacHostTests,
  ROOT_PATTERNS,
  ROOT_TEST,
  SHARD_COUNT,
} from './macos-host-test-shards.mjs'

test('every current Jig test file belongs to exactly one Mac host shard', async () => {
  const files = await discoverJigTests(resolve(import.meta.dirname, '../..'))
  const shards = planMacHostTests(files)
  assert.equal(shards.length, SHARD_COUNT)
  assert.deepEqual(
    shards.flatMap((shard) => shard.files).sort(),
    files.filter((file) => file !== ROOT_TEST && !NATIVE_PREREQUISITE_TESTS.includes(file)),
  )
  for (const shard of shards) {
    assert.ok(shard.files.length > 0)
    for (const file of shard.files) assert.ok(file.startsWith('packages/jig/test/'))
    assert.equal(
      commandsForShard(shard).length,
      shard.files.length + Number(Boolean(shard.rootPattern)),
    )
    for (const command of commandsForShard(shard)) {
      assert.equal(command[1], 'test')
      assert.ok(command.includes('--bail=1'))
      assert.ok(command.includes('--timeout'))
      assert.equal(command.filter((part) => part.startsWith('./packages/jig/test/')).length, 1)
    }
  }
  assert.ok(
    shards
      .flatMap((shard) => shard.files)
      .includes('packages/jig/test/package-provider-host.test.ts'),
  )
  const workflow = await readFile(
    resolve(import.meta.dirname, '../../.github/workflows/macos-hosted-candidates.yml'),
    'utf8',
  )
  for (const file of NATIVE_PREREQUISITE_TESTS) {
    assert.ok(workflow.includes(file), `${file} is absent from the native prerequisite step`)
  }
  assert.ok(
    shards
      .flatMap((shard) => shard.files)
      .includes('packages/jig/test/macos-guardian-storage.test.ts'),
  )
})

test('root Agent name patterns partition fixture, repair, lifecycle and fence tests', () => {
  const names = [
    'contact-import variants are valid current FLOW packages',
    'constructs the Agent fixture with the complete current SDK',
    'contained repair file application exports successful repair evidence',
    'contained repair file application exports mixed-batch repair evidence',
    'private contained Agent Run lifecycle runs unchanged packed HTTP Agent siblings',
    'private contained Agent Run lifecycle fences root Agent Run success',
    'private contained Agent Run lifecycle fences specialist Agent Run success',
    'private contained Agent Run lifecycle executes an added future case',
  ]
  for (const name of names) {
    assert.equal(ROOT_PATTERNS.filter((pattern) => new RegExp(pattern).test(name)).length, 1, name)
  }
  assert.equal(ROOT_PATTERNS.length, 3)
  assert.throws(() => planMacHostTests([ROOT_TEST, ROOT_TEST]))
})

test('expensive host cases run before portable checks without dropping work', async () => {
  const files = await discoverJigTests(resolve(import.meta.dirname, '../..'))
  const shards = planMacHostTests(files)
  assert.deepEqual(planMacHostTests([...files].reverse()), shards)
  for (const shard of shards) {
    const commands = commandsForShard(shard)
    if (shard.rootPattern) assert.equal(commands[0][2], `./${ROOT_TEST}`)
    const commandIndex = commands.findIndex((command) =>
      command[2].endsWith('/project-command-lifecycle.test.ts'),
    )
    if (commandIndex !== -1) {
      // The previous alphabetical schedule buried this failure after 21 files.
      assert.ok(commandIndex <= 1, `command lifecycle was scheduled at ${commandIndex}`)
    }
  }
})

test('Mac qualification rejects cancelled, incomplete and wrong-revision shards', async () => {
  const workflow = await readFile(
    resolve(import.meta.dirname, '../../.github/workflows/macos-hosted-candidates.yml'),
    'utf8',
  )
  const script = workflow
    .split('name: Require all five exact-revision shards')[1]
    .split('run: |\n')[1]
    .replace(/^          /gm, '')
  const root = await mkdtemp(resolve(tmpdir(), 'jig-mac-aggregate-'))
  // Use the actual workflow shell with isolated evidence, including its naming.
  const path = (shard) =>
    resolve(
      root,
      'macos-evidence',
      `macos-prerequisites-x64-${shard}-current`,
      `shard-${shard}.complete`,
    )
  const run = () =>
    spawnSync('/bin/sh', ['-c', script], {
      env: { ...process.env, RUNNER_TEMP: root, EXPECTED_ARCH: 'x64', EXPECTED_SHA: 'current' },
    }).status
  try {
    assert.notEqual(run(), 0)
    for (let shard = 0; shard < SHARD_COUNT; shard++) {
      await mkdir(resolve(path(shard), '..'), { recursive: true })
      await writeFile(path(shard), `current x64 ${shard}\n`)
    }
    assert.equal(run(), 0)
    await rm(path(3))
    assert.notEqual(run(), 0)
    await writeFile(path(3), 'previous x64 3\n')
    assert.notEqual(run(), 0)
    await writeFile(path(3), 'current arm64 3\n')
    assert.notEqual(run(), 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('every Linux hostile Jig test file enters provisioned host conformance', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const files = await discoverJigTests(root)
  const workflow = await readFile(
    resolve(root, '.github/workflows/linux-host-conformance.yml'),
    'utf8',
  )
  const gated = []
  for (const file of files) {
    if ((await readFile(resolve(root, file), 'utf8')).includes('JIG_LINUX_ROOTLESS_HOSTILE')) {
      gated.push(file)
    }
  }
  assert.ok(gated.length > 0)
  for (const file of gated)
    assert.ok(workflow.includes(file), `${file} is absent from Linux host conformance`)
  assert.ok(workflow.includes('packages/jig/test/package-smoke.ts'))
})
