import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  commandsForShard,
  discoverJigTests,
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
    files.filter((file) => file !== ROOT_TEST),
  )
  for (const shard of shards) {
    assert.ok(shard.files.length > 0)
    for (const file of shard.files) assert.ok(file.startsWith('packages/jig/test/'))
    for (const command of commandsForShard(shard)) {
      assert.equal(command[1], 'test')
      assert.ok(command.includes('--timeout'))
      assert.ok(command.some((part) => part.startsWith('./packages/jig/test/')))
    }
  }
  assert.ok(
    shards
      .flatMap((shard) => shard.files)
      .includes('packages/jig/test/package-provider-host.test.ts'),
  )
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
