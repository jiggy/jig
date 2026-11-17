import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'
import {
  commandsForShard,
  createFrozenMacPlan,
  DEFAULT_MAC_SHARD_POLICY,
  discoverHostTests,
  HOST_TEST_DIRECTORIES,
  INSTALLED_STARTUP_TEST,
  isHostTestFile,
  NATIVE_PREREQUISITE_TESTS,
  planMacHostTests,
  readFrozenMacPlan,
} from './macos-host-test-shards.mjs'
import { discoverRepositoryTests, filesForTarget, suiteTestFiles } from './suite-inventory.mjs'

const affectedManifest = JSON.parse(readFileSync(new URL('./test-suites.json', import.meta.url)))
const repository = resolve(import.meta.dirname, '../..')
const source = 'a'.repeat(40)
const required = [...NATIVE_PREREQUISITE_TESTS, INSTALLED_STARTUP_TEST]
const ordinary = [
  'packages/jig/test/host/first.test.ts',
  'packages/jig/test/host/second.test.ts',
  'packages/jig/test/portable/third.test.ts',
]

test('bounded ARM shards retain complete whole-file coverage and repeat native checks on every actual host', async () => {
  const files = await discoverHostTests(repository)
  assert.deepEqual(
    files,
    filesForTarget(
      discoverRepositoryTests(repository, affectedManifest),
      'macos-arm64',
      affectedManifest,
    ),
  )
  const shards = planMacHostTests(files, 'arm64')
  assert.equal(
    shards.length,
    3,
    'Current measured inventory needs three useful workers under the default target',
  )
  assert.deepEqual(planMacHostTests([...files].reverse(), 'arm64'), shards)
  const groups = shards.flatMap(({ groups }) => groups.map(({ file }) => file))
  assert.deepEqual([...groups, ...required].sort(), [...files].sort())
  assert.equal(new Set(groups).size, groups.length)
  assert.equal(shards.filter(({ installed }) => installed).length, 1)
  assert.equal(shards.at(-1).installed, true)
  const profile = affectedManifest.targets.find(({ id }) => id === 'macos-arm64').inventoryProfile
  const primitives = new Set(suiteTestFiles(files, ['macos-native'], affectedManifest, profile))
  for (const shard of shards) {
    assert.deepEqual(shard.nativeFiles, NATIVE_PREREQUISITE_TESTS)
    const firstOther = shard.groups.findIndex(({ file }) => !primitives.has(file))
    if (firstOther >= 0)
      assert.ok(shard.groups.slice(firstOther).every(({ file }) => !primitives.has(file)))
    for (const [index, command] of commandsForShard(shard).entries()) {
      assert.equal(command.filter((argument) => argument.startsWith('./')).length, 1)
      assert.ok(command.includes(`./${shard.groups[index].file}`))
      assert.ok(!command.some((argument) => argument.includes('test-name-pattern')))
    }
  }
  for (const packageName of ['display-model', 'display-web', 'display-tui'])
    assert.ok(groups.some((file) => file.startsWith(`packages/${packageName}/test/`)))
  for (const file of required)
    assert.throws(
      () =>
        planMacHostTests(
          files.filter((item) => item !== file),
          'arm64',
        ),
      /missing/,
    )
  assert.throws(() => planMacHostTests([...files, files[0]], 'arm64'), /repeats/)
  assert.throws(() => planMacHostTests(files, 'x64'), /Apple Silicon/)
})

test('planner selects the fewest useful workers meeting the estimate and reports an unmet bounded target honestly', () => {
  const files = [...required, ...ordinary]
  const costs = {
    weights: new Map(ordinary.map((file) => [file, { arm64: 100 }])),
    nativePrerequisiteSeconds: 10,
    installedConsumerSeconds: 40,
  }
  const plan = (targetSeconds, maxShards = 3) =>
    planMacHostTests(files, 'arm64', {
      ...costs,
      policy: { targetSeconds, minShards: 1, maxShards },
    })
  assert.equal(plan(350).length, 1)
  assert.equal(plan(250).length, 2)
  assert.equal(plan(150).length, 3)
  assert.equal(plan(1, 2).length, 2)
  assert.equal(planMacHostTests([...required, ordinary[0]], 'arm64', costs).length, 1)
  assert.equal(planMacHostTests(files, 'arm64', { ...costs, shardCount: 2 }).length, 2)
  for (const policy of [
    { targetSeconds: 0, minShards: 1, maxShards: 3 },
    { targetSeconds: 100, minShards: 4, maxShards: 3 },
    { ...DEFAULT_MAC_SHARD_POLICY, maxShards: 9 },
  ])
    assert.throws(() => planMacHostTests(files, 'arm64', { policy }), /policy/)
  assert.throws(() => planMacHostTests(files, 'arm64', { shardCount: 4 }), /outside/)
  const tiny = createFrozenMacPlan(files, 'arm64', {
    source,
    policy: { targetSeconds: 1, minShards: 1, maxShards: 2 },
  })
  assert.equal(tiny.shards.length, 2)
  assert.equal(tiny.withinTarget, false)
})

test('frozen plans bind source, complete inventory, policy and exact deterministic assignments', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'jig-mac-plan-'))
  const file = resolve(root, 'PLAN.json')
  const files = [...required, ...ordinary]
  try {
    const plan = createFrozenMacPlan(files, 'arm64', { source })
    assert.deepEqual(createFrozenMacPlan([...files].reverse(), 'arm64', { source }), plan)
    await writeFile(file, JSON.stringify(plan))
    assert.deepEqual(await readFrozenMacPlan(file, { files, source }), plan)
    await assert.rejects(readFrozenMacPlan(file, { files, source: 'b'.repeat(40) }), /differs/)
    await assert.rejects(
      readFrozenMacPlan(file, { files: [...files, 'packages/jig/test/host/new.test.ts'], source }),
      /differs/,
    )
    for (const mutate of [
      (value) => value.shards[0].groups.pop(),
      (value) => value.shards[0].nativeFiles.pop(),
      (value) => {
        value.shards[0].installed = !value.shards[0].installed
      },
      (value) => {
        value.policy.targetSeconds++
      },
      (value) => {
        value.digest = '0'.repeat(64)
      },
      (value) => {
        value.foreign = true
      },
    ]) {
      const changed = structuredClone(plan)
      mutate(changed)
      await writeFile(file, JSON.stringify(changed))
      await assert.rejects(readFrozenMacPlan(file, { files, source }), /differs/)
    }
    const link = resolve(root, 'linked.json')
    await symlink(file, link)
    await assert.rejects(readFrozenMacPlan(link, { files, source }), /Invalid/)
    assert.throws(() => createFrozenMacPlan(files, 'arm64', { source: 'HEAD' }), /exact Git source/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('frozen plan reads reject oversized files and special files without blocking', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'jig-mac-plan-special-'))
  try {
    const oversized = resolve(root, 'oversized.json')
    await writeFile(oversized, Buffer.alloc(1024 * 1024 + 1, 32))
    await assert.rejects(
      readFrozenMacPlan(oversized, { files: [...required, ...ordinary], source }),
      /Invalid/,
    )
    await assert.rejects(
      readFrozenMacPlan(root, { files: [...required, ...ordinary], source }),
      /Invalid/,
    )
    const fifo = resolve(root, 'plan.fifo')
    const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8' })
    assert.equal(created.status, 0, created.stderr)
    const result = spawnSync(
      process.execPath,
      [resolve(import.meta.dirname, 'macos-host-test-shards.mjs'), 'matrix', fifo],
      {
        encoding: 'utf8',
        timeout: 5000,
      },
    )
    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Invalid frozen Mac plan file/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('future whole-file suites inherit explicit roles while hidden, dependency and neighboring files stay inert', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'jig-host-discovery-'))
  try {
    const result = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const expected = []
    for (const [index, directory] of HOST_TEST_DIRECTORIES.entries()) {
      const owning = directory === 'packages/jig/test' ? `${directory}/host` : directory
      const file = `${owning}/nested/future${['.test.ts', '_test.ts', '.spec.mjs', '_spec.tsx'][index]}`
      await mkdir(resolve(root, file, '..'), { recursive: true })
      await writeFile(resolve(root, file), 'test("future",()=>{})')
      expected.push(file)
      for (const ignored of [
        `${directory}/.private/hidden.test.ts`,
        `${directory}/node_modules/dependency.test.ts`,
        `${directory}/package-smoke.ts`,
      ]) {
        await mkdir(resolve(root, ignored, '..'), { recursive: true })
        await writeFile(resolve(root, ignored), 'inert')
        assert.equal(isHostTestFile(ignored), false)
      }
      await symlink(resolve(root, file), resolve(root, owning, 'linked.test.ts'))
    }
    assert.deepEqual(await discoverHostTests(root), expected.sort())
    assert.ok(expected.every(isHostTestFile))
    assert.equal(isHostTestFile('packages/display-web/test-neighbor/foreign.test.ts'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'jig-mac-runner-'))
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  for (const file of [...required, ...ordinary]) {
    await mkdir(resolve(root, file, '..'), { recursive: true })
    await writeFile(resolve(root, file), '')
  }
  await writeFile(
    resolve(root, ordinary[0]),
    String.raw`import {test,expect} from 'bun:test'; import {appendFileSync} from 'node:fs'; test('actual failure',()=>{appendFileSync(process.env.CALLS,'first\n');expect(1).toBe(2)});`,
  )
  await writeFile(
    resolve(root, ordinary[1]),
    String.raw`import {test} from 'bun:test'; import {appendFileSync} from 'node:fs'; test('later',()=>appendFileSync(process.env.CALLS,'later\n'));`,
  )
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=CI fixture',
      '-c',
      'user.email=ci@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
    { cwd: root },
  )
  return root
}

test('the real group runner stops after a real Bun test failure and validates its frozen source plan', async () => {
  const root = await fixture()
  const script = resolve(repository, 'scripts/ci/macos-host-test-shards.mjs')
  const file = resolve(root, 'PLAN.json')
  const calls = resolve(root, 'calls')
  const env = {
    ...process.env,
    GITHUB_SHA: '',
    JIG_MACOS_MIN_SHARDS: '1',
    JIG_MACOS_MAX_SHARDS: '1',
    CALLS: calls,
  }
  const cli = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    })
  try {
    const frozen = cli('freeze', 'arm64', file)
    assert.equal(frozen.status, 0, frozen.stderr)
    assert.equal(cli('freeze', 'arm64', file).status, 1, 'Frozen plans cannot be overwritten')
    env.JIG_MACOS_TEST_PLAN_FILE = file
    assert.equal(cli('count', 'arm64').stdout.trim(), '1')
    assert.deepEqual(JSON.parse(cli('matrix', file).stdout), { include: [{ shard: 0 }] })
    const planned = JSON.parse(cli('plan', 'arm64', '0').stdout)
    assert.equal(planned.planDigest, JSON.parse(await readFile(file)).digest)
    assert.deepEqual(planned.nativeFiles, NATIVE_PREREQUISITE_TESTS)
    const result = cli('run', 'arm64', '0')
    assert.equal(result.status, 1, result.stderr)
    assert.equal(await readFile(calls, 'utf8'), 'first\n')
    const observation = result.stdout
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map(JSON.parse)
      .find((row) => 'status' in row)
    assert.equal(observation.status, 1)
    assert.ok(observation.elapsedMs >= 0)
    assert.equal(cli('plan', 'arm64', '1').status, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Node material suites retain real runtime, whole-file command and unchanged timeout', () => {
  assert.deepEqual(
    commandsForShard({ groups: [{ file: 'packages/jig/test/portable/material.node.mjs' }] }),
    [['node', '--test', '--test-timeout=420000', './packages/jig/test/portable/material.node.mjs']],
  )
})

test('Linux whole-file roles own all hostile and display work while startup remains a separate Mac obligation', async () => {
  const files = discoverRepositoryTests(resolve(import.meta.dirname, '../..'), affectedManifest)
  const linux = filesForTarget(files, 'linux', affectedManifest)
  const mac = filesForTarget(files, 'macos-arm64', affectedManifest)
  const hostile = files.filter((file) => file.startsWith('packages/jig/test/linux-host/'))
  assert.ok(hostile.length > 0)
  for (const file of hostile) {
    assert.ok(linux.includes(file))
    assert.ok(!mac.includes(file))
  }
  assert.ok(!linux.includes(INSTALLED_STARTUP_TEST))
  assert.ok(mac.includes(INSTALLED_STARTUP_TEST))
  for (const name of ['display-model', 'display-web', 'display-tui'])
    assert.ok(linux.some((file) => file.startsWith(`packages/${name}/test/`)))

  const workflow = await readFile(
    resolve(import.meta.dirname, '../../.github/workflows/linux-host-conformance.yml'),
    'utf8',
  )
  const check = (parsed) => {
    const steps = parsed.jobs['host-suite'].steps
    const condition = (step) => step.if.replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/g, '').trim()
    const builds = steps.filter((step) =>
      /just\s+--justfile\s+packages\/jig\/justfile\s+build\b/.test(step.run ?? ''),
    )
    assert.equal(builds.length, 1)
    assert.match(condition(builds[0]), /^matrix\.suite\s*!=\s*'installed-evidence'$/)
    const source = steps.filter((step) =>
      /node\s+--input-type=module\s+-e\s+"\$LINUX_COMMAND_PLANNER"/.test(step.run ?? ''),
    )
    assert.equal(source.length, 1)
    assert.match(condition(source[0]), /^matrix\.suite\s*!=\s*'installed-evidence'$/)
    for (const path of [
      'packages/jig/test/package-smoke.ts',
      'scripts/test-operational-baseline.ts',
      'scripts/test-installed-hostile-baseline.ts',
      'packages/display-model/test/package-smoke.ts',
      'packages/display-web/test/package-smoke.ts',
      'packages/display-tui/test/package-smoke.ts',
    ]) {
      const owners = steps.filter((step) => {
        const context = step.env?.JIG_CI_COMMAND_CONTEXT
        return context && JSON.parse(context).files.includes(path)
      })
      assert.equal(owners.length, 1, path)
      assert.match(condition(owners[0]), /^matrix\.suite\s*==\s*'installed-evidence'$/)
      assert.ok(owners[0].run.includes(path))
      assert.ok(owners[0].run.includes('CI installed script complete:'))
      assert.equal(JSON.parse(owners[0].env.JIG_CI_COMMAND_CONTEXT).commandKind, 'installed-script')
    }
    const commands = steps.map((step) => step.run ?? '').join('\n')
    for (const proof of [
      /scripts\/ci\/provision-github-rootless-host\.sh\s+provision/,
      /candidate-provenance\.mjs\s+verify/,
      /sha256sum\s+--check/,
      /scripts\/ci\/provision-github-rootless-host\.sh\s+assert-clean/,
    ])
      assert.match(commands, proof)
  }
  const parsed = parse(workflow)
  const plan = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', parsed.env.LINUX_COMMAND_PLANNER],
    {
      cwd: resolve(import.meta.dirname, '../..'),
      env: {
        ...process.env,
        GITHUB_SHA: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
      },
      encoding: 'utf8',
    },
  )
  assert.equal(plan.status, 0, plan.stderr)
  const examples = JSON.parse(plan.stdout).examples
  assert.equal(
    examples.find(({ files }) => files[0].endsWith('/native-codex-rehearsal.test.ts')).hostMode,
    'run-delegated',
  )
  assert.equal(
    examples.find(({ files }) => files[0].endsWith('/example-smoke.test.ts')).hostMode,
    'run-acquisition-host',
  )
  check(parsed)
  // JSON is YAML too: indentation, scalar quoting and step labels carry no role.
  for (const step of parsed.jobs['host-suite'].steps) step.name = 'Renamed step'
  check(parse(JSON.stringify(parsed, null, 1)))
  parsed.jobs['host-suite'].steps.find((step) => step.env?.JIG_CI_COMMAND_CONTEXT).if = 'false'
  assert.throws(() => check(parsed), /installed-evidence/)
})
