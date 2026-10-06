import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  commandsForShard,
  discoverJigTests,
  NAMED_TEST_GROUPS,
  NATIVE_PREREQUISITE_TESTS,
  PACKAGE_TEST,
  planMacHostTests,
  ROOT_TEST,
  SHARD_COUNT,
} from './macos-host-test-shards.mjs'

test('every current Jig file and named partition enters Mac qualification exactly once', async () => {
  const files = await discoverJigTests(resolve(import.meta.dirname, '../..'))
  const shards = planMacHostTests(files)
  assert.equal(shards.length, SHARD_COUNT)
  const groups = shards.flatMap((shard) => shard.groups)
  for (const file of files) {
    const selected = groups.filter((group) => group.file === file)
    if (NATIVE_PREREQUISITE_TESTS.includes(file)) assert.equal(selected.length, 0)
    else
      assert.deepEqual(
        selected.map((group) => group.pattern).sort(),
        (NAMED_TEST_GROUPS.get(file)?.map((group) => group.pattern) ?? [null]).sort(),
        file,
      )
  }
  for (const shard of shards) {
    assert.ok(shard.groups.length > 0)
    const commands = commandsForShard(shard)
    assert.equal(commands.length, shard.groups.length)
    for (const [index, command] of commands.entries()) {
      assert.equal(command[1], 'test')
      assert.ok(command.includes('--bail=1'))
      assert.ok(command.includes('--timeout'))
      assert.equal(command.filter((part) => part.startsWith('./packages/jig/test/')).length, 1)
      assert.equal(command[2], `./${shard.groups[index].file}`)
      const pattern = shard.groups[index].pattern
      assert.equal(command.includes('--test-name-pattern'), pattern !== null)
      if (pattern) assert.equal(command[command.indexOf('--test-name-pattern') + 1], pattern)
    }
  }
  assert.ok(groups.some((group) => group.file === PACKAGE_TEST))
  const workflow = await readFile(
    resolve(import.meta.dirname, '../../.github/workflows/macos-hosted-candidates.yml'),
    'utf8',
  )
  for (const file of NATIVE_PREREQUISITE_TESTS) {
    assert.ok(workflow.includes(file), `${file} is absent from the native prerequisite step`)
  }
  assert.ok(
    groups.some((group) => group.file === 'packages/jig/test/macos-guardian-storage.test.ts'),
  )
  const future = 'packages/jig/test/future-host-proof.test.ts'
  assert.equal(
    planMacHostTests([...files, future])
      .flatMap((shard) => shard.groups)
      .filter((group) => group.file === future).length,
    1,
  )
  assert.throws(() => planMacHostTests([...files, ROOT_TEST]))
  for (const file of [ROOT_TEST, PACKAGE_TEST, ...NATIVE_PREREQUISITE_TESTS]) {
    assert.throws(() => planMacHostTests(files.filter((current) => current !== file)))
  }
})

test('named patterns partition current and future lifecycle, repair and package cases', () => {
  const names = [
    'contact-import variants are valid current FLOW packages',
    'constructs the Agent fixture with the complete current SDK',
    'contained repair file application exports successful repair evidence',
    'contained repair file application exports mixed-batch repair evidence',
    'contained repair file application exports unsuccessful repair evidence',
    'contained repair file application adds a future repair case',
    'private contained Agent Run lifecycle runs unchanged packed HTTP Agent siblings',
    'private contained Agent Run lifecycle fences root Agent Run success',
    'private contained Agent Run lifecycle fences specialist Agent Run success',
    'private contained Agent Run lifecycle fences root Agent ACP success',
    'private contained Agent Run lifecycle fences future collaborator loss',
    'private contained Agent Run lifecycle executes an added future case',
  ]
  for (const name of names) {
    assert.equal(
      NAMED_TEST_GROUPS.get(ROOT_TEST).filter(({ pattern }) => new RegExp(pattern).test(name))
        .length,
      1,
      name,
    )
  }
  for (const name of [
    'installed CLI reviews and runs a workspace dependency (application: member)',
    'installed CLI reviews a future layout',
    'packed read attachments preserve empty roots and maximum relative paths',
    'packed project entrypoint uses fresh reviewed data and immutable execution',
    'packed project dependencies uses fresh reviewed data and immutable execution',
    'a future installed package case',
  ]) {
    assert.equal(
      NAMED_TEST_GROUPS.get(PACKAGE_TEST).filter(({ pattern }) => new RegExp(pattern).test(name))
        .length,
      1,
      name,
    )
  }
})

test('expensive host cases run before portable checks without dropping work', async () => {
  const files = await discoverJigTests(resolve(import.meta.dirname, '../..'))
  const shards = planMacHostTests(files)
  assert.deepEqual(planMacHostTests([...files].reverse()), shards)
  for (const shard of shards) {
    const commands = commandsForShard(shard)
    const commandIndex = commands.findIndex((command) =>
      command[2].endsWith('/project-command-lifecycle.test.ts'),
    )
    if (commandIndex !== -1) {
      // The previous alphabetical schedule buried this failure after 21 files.
      assert.ok(commandIndex <= 2, `command lifecycle was scheduled at ${commandIndex}`)
    }
  }
})

test('Mac scheduling balances observed slow files and work outside the file runner', async () => {
  const files = await discoverJigTests(resolve(import.meta.dirname, '../..'))
  // Representative command wall times, independent of the planner's estimates.
  // Fixed costs include native prerequisites and genuine startup/installed
  // checks; partitioned lifecycle work is counted by its retained case names.
  const fixedSeconds = [60, 0, 0, 0, 384]
  const measuredSeconds = new Map([
    ['run-checkpoint-lifecycle.test.ts', 241],
    ['project-command-lifecycle.test.ts', 192],
    ['http-request-lifecycle.test.ts', 190],
    ['bun-native-preparation.test.ts', 174],
    ['finite-acp-lifecycle.test.ts', 166],
    ['project-author-evaluator.test.ts', 85],
    ['activation-admission-store.test.ts', 57],
    ['macos-guardian-storage.test.ts', 51],
    ['contract-generation.test.ts', 32],
    ['markdown-worker.test.ts', 47],
  ])
  // Individual retained cases, rather than planner weights: a partition change
  // must route the work once and still balance its complete observed cost.
  const namedCases = new Map([
    [
      ROOT_TEST,
      [
        [
          'private contained Agent Run lifecycle runs two unchanged packed HTTP Agents through simultaneous deep specialist branches',
          129,
        ],
        [
          'private contained Agent Run lifecycle executes and cleans a five-level branch within the unchanged aggregate envelope',
          97,
        ],
        [
          'private contained Agent Run lifecycle runs unchanged packed HTTP Agent siblings without a native Agent provider',
          57,
        ],
        [
          'private contained Agent Run lifecycle delivers complete selected Skill bytes from a workspace child Binding',
          37,
        ],
        [
          'private contained Agent Run lifecycle delivers complete selected Skill bytes from a workspace root Flow',
          31,
        ],
        [
          'private contained Agent Run lifecycle runs a Bun subprocess and asynchronous I/O from root and child Flow recipes',
          30,
        ],
        [
          'contained repair file application exports unsuccessful repair evidence through a JSON leaf and real contained commands',
          123,
        ],
        [
          'contained repair file application exports batch repair evidence through a JSON leaf and real contained commands',
          119,
        ],
        [
          'contained repair file application exports mixed-batch repair evidence through a JSON leaf and real contained commands',
          116,
        ],
        [
          'contained repair file application exports successful repair evidence through a JSON leaf and real contained commands',
          83,
        ],
        [
          'private contained Agent Run lifecycle fences specialist Agent Run success, invalid output, cancellation, deadline, and loss',
          235,
        ],
        [
          'private contained Agent Run lifecycle fences root Agent Run success, invalid output, cancellation, deadline, and loss',
          142,
        ],
        [
          'private contained Agent Run lifecycle fences root Agent ACP success, invalid output, cancellation, deadline, and loss',
          130,
        ],
      ],
    ],
    [
      PACKAGE_TEST,
      [
        ['installed CLI reviews and runs a workspace dependency (application: member)', 83],
        ['installed CLI reviews and runs a workspace dependency (application: root)', 73],
        ['installed CLI reviews and runs a workspace dependency (application: nested)', 94],
        ['packed read attachments preserve empty roots and maximum relative paths', 24],
        ['packed project entrypoint uses fresh reviewed data and immutable execution', 53],
        ['packed project dependencies uses fresh reviewed data and immutable execution', 101],
      ],
    ],
  ])
  for (const shard of planMacHostTests(files)) {
    const seconds = shard.groups.reduce(
      (total, { file, pattern }) =>
        total +
        (pattern
          ? namedCases
              .get(file)
              .filter(([name]) => new RegExp(pattern).test(name))
              .reduce((sum, [, seconds]) => sum + seconds, 0)
          : (measuredSeconds.get(file.split('/').at(-1)) ?? 0)),
      fixedSeconds[shard.index],
    )
    assert.ok(seconds <= 720, `shard ${shard.index} concentrates ${seconds}s of observed work`)
  }
})

test('the Mac group runner preserves the first child failure and starts no later group', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'jig-mac-group-failure-'))
  try {
    const calls = resolve(root, 'calls.jsonl')
    const bun = resolve(root, 'failing-bun')
    await writeFile(
      bun,
      `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.CALLS, JSON.stringify(process.argv.slice(2))+'\\n'); process.exit(42);\n`,
      { mode: 0o700 },
    )
    const child = spawnSync(
      process.execPath,
      ['scripts/ci/macos-host-test-shards.mjs', 'run', '0'],
      {
        cwd: resolve(import.meta.dirname, '../..'),
        env: { ...process.env, JIG_CI_BUN: bun, CALLS: calls },
        encoding: 'utf8',
      },
    )
    assert.equal(child.status, 42, child.stderr)
    const lines = (await readFile(calls, 'utf8')).trim().split('\n')
    assert.equal(lines.length, 1)
    const first = commandsForShard(
      planMacHostTests(await discoverJigTests(resolve(import.meta.dirname, '../..')))[0],
      bun,
    )[0]
    assert.deepEqual(JSON.parse(lines[0]), first.slice(1))
    const timing = child.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .at(-1)
    assert.equal(timing.status, 42)
    assert.equal(timing.pattern, first[first.indexOf('--test-name-pattern') + 1])
  } finally {
    await rm(root, { recursive: true, force: true })
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
