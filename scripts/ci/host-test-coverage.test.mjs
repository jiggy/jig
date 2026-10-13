import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'

const affectedManifest = JSON.parse(readFileSync(new URL('./test-suites.json', import.meta.url)))

import {
  commandsForShard,
  discoverHostTests,
  HOST_TEST_DIRECTORIES,
  INSTALLED_STARTUP_TEST,
  isHostTestFile,
  MAC_HOST_SHARDS,
  macHostShardCount,
  NATIVE_PREREQUISITE_TESTS,
  planMacHostTests,
} from './macos-host-test-shards.mjs'
import { discoverRepositoryTests, filesForTarget, suiteTestFiles } from './suite-inventory.mjs'

test('current full Mac role assignment owns every selected file once without name partitions', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const files = await discoverHostTests(root)
  assert.deepEqual(
    files,
    filesForTarget(discoverRepositoryTests(root, affectedManifest), 'macos-x64', affectedManifest),
  )
  for (const packageName of ['display-model', 'display-web', 'display-tui'])
    assert.ok(files.some((file) => file.startsWith(`packages/${packageName}/test/`)))
  assert.ok(files.includes(INSTALLED_STARTUP_TEST))
  for (const file of [
    'root-agent-repair.test.ts',
    'root-agent-repair-unsuccessful.test.ts',
    'installed-software-factory.test.ts',
    'installed-software-factory-blocked.test.ts',
  ])
    assert.ok(files.includes(`packages/jig/test/host/${file}`), file)
  assert.ok(files.some((file) => file.includes('/portable/')))
  assert.ok(
    !files.some(
      (file) =>
        file.includes('/linux-host/') || file.includes('/live/') || file.includes('/macos-23E224/'),
    ),
  )
  for (const arch of ['x64', 'arm64']) {
    const shards = planMacHostTests(files, arch)
    const primitives = new Set(
      suiteTestFiles(files, ['macos-native'], affectedManifest, 'macos-24G830'),
    )
    for (const shard of shards) {
      const firstOther = shard.groups.findIndex(({ file }) => !primitives.has(file))
      if (firstOther >= 0)
        assert.ok(shard.groups.slice(firstOther).every(({ file }) => !primitives.has(file)))
    }
    const groups = shards.flatMap((shard) => shard.groups)
    for (const file of files)
      assert.equal(
        groups.filter((group) => group.file === file).length,
        NATIVE_PREREQUISITE_TESTS.includes(file) || file === INSTALLED_STARTUP_TEST ? 0 : 1,
        file,
      )
    for (const shard of shards)
      for (const [index, command] of commandsForShard(shard).entries()) {
        assert.equal(command[2], `./${shard.groups[index].file}`)
        assert.equal(command.includes('--test-name-pattern'), false)
        assert.deepEqual(Object.keys(shard.groups[index]).sort(), ['estimatedSeconds', 'file'])
      }
    for (const file of [...NATIVE_PREREQUISITE_TESTS, INSTALLED_STARTUP_TEST])
      assert.throws(() =>
        planMacHostTests(
          files.filter((current) => current !== file),
          arch,
        ),
      )
    assert.throws(() => planMacHostTests([...files, files[0]], arch))
  }
})

test('primitive priority preserves existing LPT memberships and budgets and includes future native files', () => {
  const checkpoint = 'packages/jig/test/host/run-checkpoint-lifecycle.test.ts'
  const workspace = 'packages/jig/test/host/installed-workspace-provider.test.ts'
  const factory = 'packages/jig/test/host/installed-software-factory.test.ts'
  const specialist = 'packages/jig/test/host/root-agent-fences-specialist.test.ts'
  const storage = 'packages/jig/test/macos/macos-guardian-storage.test.ts'
  const future = 'packages/jig/test/macos/future-primitive.test.ts'
  const portable = 'packages/jig/test/portable/plain.test.ts'
  const files = [
    ...NATIVE_PREREQUISITE_TESTS,
    INSTALLED_STARTUP_TEST,
    checkpoint,
    workspace,
    factory,
    specialist,
    storage,
    future,
    portable,
  ]
  const expected = {
    x64: [
      { seconds: 491, files: [checkpoint, workspace] },
      { seconds: 487, files: [specialist, factory, future, portable] },
      { seconds: 506, files: [storage] },
    ],
    arm64: [
      { seconds: 402, files: [checkpoint, workspace, specialist, future, portable] },
      { seconds: 401, files: [factory, storage] },
    ],
  }
  for (const arch of ['x64', 'arm64']) {
    const shards = planMacHostTests(files, arch)
    assert.deepEqual(planMacHostTests([...files].reverse(), arch), shards)
    for (const shard of shards) {
      const baseline = expected[arch][shard.index]
      assert.equal(shard.estimatedSeconds, baseline.seconds)
      assert.deepEqual(shard.groups.map(({ file }) => file).sort(), [...baseline.files].sort())
      assert.deepEqual(
        commandsForShard(shard).map((command) => command.slice(0, 2)),
        Array(shard.groups.length).fill(['bun', 'test']),
      )
      assert.ok(
        commandsForShard(shard).every(
          (command) => command.slice(3).join(' ') === '--bail=1 --timeout 420000',
        ),
      )
      if (baseline.files.includes(future)) {
        assert.equal(shard.groups[0].file, future)
        assert.equal(shard.groups[0].estimatedSeconds, 2)
      }
      if (baseline.files.includes(storage)) assert.equal(shard.groups[0].file, storage)
    }
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

test('whole-file scheduling spreads observed work and conservative split projections deterministically', async () => {
  const files = await discoverHostTests(resolve(import.meta.dirname, '../..'))
  const measured = new Map([
    ['packages/display-tui/test/native.test.ts', 15],
    ['packages/display-tui/test/portability.test.ts', 14],
    ['packages/jig/test/host/bun-native-preparation.test.ts', 137],
    ['packages/jig/test/host/finite-acp-lifecycle.test.ts', 200],
    ['packages/jig/test/host/http-request-lifecycle.test.ts', 197],
    ['packages/jig/test/host/installed-attachments.test.ts', 15],
    ['packages/jig/test/host/installed-package-provider.test.ts', 142],
    ['packages/jig/test/host/installed-software-factory-blocked.test.ts', 86],
    ['packages/jig/test/host/installed-software-factory.test.ts', 213],
    ['packages/jig/test/host/installed-workspace-provider.test.ts', 211],
    ['packages/jig/test/host/markdown-worker.test.ts', 25],
    ['packages/jig/test/host/package-provider-observation.test.ts', 35],
    ['packages/jig/test/host/project-author-evaluator.test.ts', 78],
    ['packages/jig/test/host/project-command-lifecycle.test.ts', 125],
    ['packages/jig/test/host/root-agent-composition.test.ts', 152],
    ['packages/jig/test/host/root-agent-fences-acp.test.ts', 120],
    ['packages/jig/test/host/root-agent-fences-run.test.ts', 116],
    ['packages/jig/test/host/root-agent-fences-specialist.test.ts', 270],
    ['packages/jig/test/host/root-agent-http-composition.test.ts', 190],
    ['packages/jig/test/host/root-agent-repair-batch.test.ts', 194],
    ['packages/jig/test/host/root-agent-repair-unsuccessful.test.ts', 108],
    ['packages/jig/test/host/root-agent-repair.test.ts', 96],
    ['packages/jig/test/host/run-checkpoint-lifecycle.test.ts', 221],
    ['packages/jig/test/macos/macos-guardian-storage.test.ts', 56],
    ['packages/jig/test/portable/activation-admission-store.test.ts', 51],
    ['packages/jig/test/portable/contract-generation.test.ts', 19],
    ['packages/jig/test/portable/project-evaluator-child.test.ts', 11],
    ['packages/jig/test/portable/workspace-progress.test.ts', 10],
  ])
  const shards = planMacHostTests(files, 'x64')
  assert.deepEqual(planMacHostTests([...files].reverse(), 'x64'), shards)
  for (const shard of shards) {
    const seconds = shard.groups.reduce(
      (sum, { file }) => sum + (measured.get(file) ?? 0),
      shard.index === 0 ? 59 : shard.index === shards.length - 1 ? 450 : 0,
    )
    assert.ok(seconds <= 1250, `shard ${shard.index} concentrates ${seconds}s of observed work`)
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
      ['scripts/ci/macos-host-test-shards.mjs', 'run', 'x64', '0'],
      {
        cwd: resolve(import.meta.dirname, '../..'),
        env: {
          ...process.env,
          JIG_CI_BUN: bun,
          CALLS: calls,
          JIG_MACOS_TEST_TIMINGS_DIRECTORY: root,
        },
        encoding: 'utf8',
      },
    )
    assert.equal(child.status, 42, child.stderr)
    const lines = (await readFile(calls, 'utf8')).trim().split('\n')
    assert.equal(lines.length, 1)
    const first = commandsForShard(
      planMacHostTests(await discoverHostTests(resolve(import.meta.dirname, '../..')), 'x64')[0],
      bun,
    )[0]
    assert.deepEqual(JSON.parse(lines[0]), [
      ...first.slice(1),
      '--reporter=junit',
      `--reporter-outfile=${resolve(root, 'shard-0-group-0.xml')}`,
    ])
    const plan = JSON.parse(await readFile(resolve(root, 'test-plan.json'), 'utf8'))
    assert.equal(plan.architecture, 'x64')
    assert.equal(plan.shardCount, MAC_HOST_SHARDS.x64)
    assert.equal(plan.installed, false)
    assert.deepEqual(plan.nativeFiles, NATIVE_PREREQUISITE_TESTS)
    const timing = child.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .at(-1)
    assert.equal(timing.status, 42)
    assert.equal(timing.pattern, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('both architecture plans cover identical work within five runner slots', async () => {
  const files = await discoverHostTests(resolve(import.meta.dirname, '../..'))
  const plans = Object.keys(MAC_HOST_SHARDS).map((arch) => planMacHostTests(files, arch))
  assert.equal(plans.flat().length, 5)
  const membership = (plan) =>
    plan
      .flatMap((s) => s.groups)
      .map((g) => g.file)
      .sort()
  assert.deepEqual(membership(plans[0]), membership(plans[1]))
  for (const [index, arch] of Object.keys(MAC_HOST_SHARDS).entries()) {
    assert.equal(plans[index].length, macHostShardCount(arch))
    assert.deepEqual(planMacHostTests([...files].reverse(), arch), plans[index])
    assert.ok(plans[index].every((shard) => shard.architecture === arch && shard.groups.length > 0))
  }
  assert.throws(() => planMacHostTests(files, 'ia32'))
  assert.throws(() => planMacHostTests(files))
  for (const args of [
    ['run', 'arm64', '2'],
    ['run', 'x64', '3'],
    ['plan', 'x64'],
    ['run', 'ia32', '0'],
    ['run', '0'],
  ]) {
    const result = spawnSync(process.execPath, ['scripts/ci/macos-host-test-shards.mjs', ...args], {
      cwd: resolve(import.meta.dirname, '../..'),
      encoding: 'utf8',
    })
    assert.equal(result.status, 2, `${args}: ${result.stderr}`)
  }
})

test('installed startup reporting works with and without a timing directory on system Bash', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'jig-mac-startup-report-'))
  try {
    const source = await readFile(resolve(import.meta.dirname, 'qualify-macos-host.sh'), 'utf8')
    const start = source.indexOf('  startup_options=')
    const end = source.indexOf('  # Pack and install', start)
    assert.ok(start >= 0 && end > start)
    const calls = resolve(root, 'calls.json')
    const bun = resolve(root, 'bun')
    await writeFile(
      bun,
      '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.CALLS,JSON.stringify({args:process.argv.slice(2),startup:process.env.JIG_NATIVE_AGENT_STARTUP,expectation:process.env.JIG_CODEX_MACOS_STARTUP_EXPECTATION})+"\\n");\n',
      { mode: 0o700 },
    )
    for (const [directory, expectation] of [
      ['', 'startup'],
      [root, 'startup'],
      ['', 'unsupported'],
      [root, 'unsupported'],
    ]) {
      await writeFile(calls, '')
      const result = spawnSync(
        '/bin/bash',
        ['-c', `set -euo pipefail\n${source.slice(start, end)}`],
        {
          env: {
            ...process.env,
            PATH: `${root}:${process.env.PATH}`,
            CALLS: calls,
            JIG_MACOS_TEST_TIMINGS_DIRECTORY: directory,
            codex_startup_expectation: expectation,
          },
          encoding: 'utf8',
        },
      )
      assert.equal(result.status, 0, result.stderr)
      const recorded = (await readFile(calls, 'utf8')).trim().split('\n').map(JSON.parse)
      const call = recorded[0]
      assert.equal(recorded.length, 4)
      assert.equal(call.startup, '1')
      assert.equal(call.expectation, expectation)
      assert.deepEqual(call.args, [
        'test',
        'packages/jig/test/startup/native-agent-startup.test.ts',
        '--timeout',
        '120000',
        ...(directory
          ? ['--reporter=junit', `--reporter-outfile=${directory}/installed-startup.xml`]
          : []),
      ])
      assert.deepEqual(
        recorded.slice(1).map((entry) => entry.args),
        [
          ['packages/display-model/test/package-smoke.ts'],
          ['packages/display-web/test/package-smoke.ts'],
          ['packages/display-tui/test/package-smoke.ts'],
        ],
      )
      assert.ok(recorded.slice(1).every((entry) => entry.startup === undefined))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Mac qualification requires genuine Codex startup or explicit refusal by exact profile', async () => {
  const qualification = await readFile(
    resolve(import.meta.dirname, 'qualify-macos-host.sh'),
    'utf8',
  )
  const gate = qualification.match(
    /case "\$\(uname -s\):\$\(uname -m\):\$\(uname -r\):\$\(sw_vers -buildVersion\)" in\n[\s\S]*?\nesac/,
  )
  assert.ok(gate, 'qualification must select the expectation from the actual Mac tuple')
  const shell = `
uname() {
  case "$1" in
    -s) printf '%s\\n' "$TEST_KERNEL" ;;
    -m) printf '%s\\n' "$TEST_ARCH" ;;
    -r) printf '%s\\n' "$TEST_RELEASE" ;;
    *) return 1 ;;
  esac
}
sw_vers() { printf '%s\\n' "$TEST_BUILD"; }
${gate[0]}
printf '%s\\n' "$codex_startup_expectation"
`
  const run = (kernel, arch, release, build) =>
    spawnSync('/bin/bash', ['-c', shell], {
      env: {
        ...process.env,
        TEST_KERNEL: kernel,
        TEST_ARCH: arch,
        TEST_RELEASE: release,
        TEST_BUILD: build,
      },
      encoding: 'utf8',
    })
  for (const [arch, release, build, expectation] of [
    ['x86_64', '23.4.0', '23E224', 'startup'],
    ['x86_64', '24.6.0', '24G830', 'unsupported'],
    ['arm64', '24.6.0', '24G830', 'unsupported'],
  ]) {
    const result = run('Darwin', arch, release, build)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), expectation)
  }
  for (const tuple of [
    ['Darwin', 'arm64', '23.4.0', '23E224'],
    ['Darwin', 'x86_64', '24.6.0', '24G831'],
    ['Linux', 'x86_64', '23.4.0', '23E224'],
  ]) {
    assert.equal(run(...tuple).status, 2, `unqualified tuple ${tuple} must refuse`)
  }
  assert.match(
    qualification,
    /JIG_NATIVE_AGENT_STARTUP=1 JIG_CODEX_MACOS_STARTUP_EXPECTATION="\$codex_startup_expectation" \\\n\s*bun test packages\/jig\/test\/startup\/native-agent-startup\.test\.ts/,
  )
  assert.ok(qualification.includes('macos-codex-preferences'))
})

test('Linux whole-file roles own all hostile and display work while startup remains a separate Mac obligation', async () => {
  const files = discoverRepositoryTests(resolve(import.meta.dirname, '../..'), affectedManifest)
  const linux = filesForTarget(files, 'linux', affectedManifest)
  const mac = filesForTarget(files, 'macos-x64', affectedManifest)
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
  const start = workflow.indexOf('\n  host-suite:\n')
  const end = workflow.indexOf('\n  rootless-linux:\n', start)
  assert.ok(start >= 0 && end > start)
  const shard = workflow.slice(start, end)
  const steps = shard.split(/\n {6}-\n/)
  const builds = steps.filter((step) =>
    step.includes('name: "Build source-test workspace packages"'),
  )
  assert.equal(builds.length, 1)
  assert.match(builds[0], /if: "matrix\.suite != 'installed-evidence'"/)
  assert.match(builds[0], /run: "just --justfile packages\/jig\/justfile build"/)
  const source = steps.find((step) =>
    step.includes('name: "Execute every pinned whole-file source group exactly once"'),
  )
  assert.ok(source)
  assert.match(source, /if: "matrix\.suite != 'installed-evidence'"/)
  assert.ok(source.includes('node --input-type=module -e "$LINUX_COMMAND_PLANNER"'))
  for (const path of [
    'packages/jig/test/package-smoke.ts',
    'scripts/test-operational-baseline.ts',
    'scripts/test-installed-hostile-baseline.ts',
    'packages/display-model/test/package-smoke.ts',
    'packages/display-web/test/package-smoke.ts',
    'packages/display-tui/test/package-smoke.ts',
  ]) {
    const owners = steps.filter(
      (step) =>
        step.includes(`'${path}' >> "$RUNNER_TEMP/linux-command-evidence/`) &&
        step.includes('CI installed script complete:'),
    )
    assert.equal(owners.length, 1, path)
    assert.match(owners[0], /if: "matrix\.suite == 'installed-evidence'"/)
    assert.ok(owners[0].includes(path))
    assert.ok(owners[0].includes(String.raw`\"commandKind\":\"installed-script\"`))
  }
  for (const proof of [
    'scripts/ci/provision-github-rootless-host.sh provision',
    'candidate-provenance.mjs verify',
    'sha256sum --check',
    'scripts/ci/provision-github-rootless-host.sh assert-clean',
  ])
    assert.ok(shard.includes(proof), proof)
})
