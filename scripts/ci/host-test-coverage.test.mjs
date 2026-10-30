import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { parse } from 'yaml'

const affectedManifest = JSON.parse(readFileSync(new URL('./test-suites.json', import.meta.url)))

import { MAC_HOST_PROFILES } from './macos-host-profiles.mjs'
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
    const target = affectedManifest.targets.find((target) => target.id === `macos-${arch}`)
    const candidates = MAC_HOST_PROFILES[arch]
    assert.ok(candidates.some(({ build }) => target.inventoryProfile === `macos-${build}`))
    assert.deepEqual(target.profiles, [
      arch === 'arm64' ? 'macos/arm64/bun-1.4.2' : 'macos-24G830/x64/bun-1.4.2',
    ])
    const selected = await discoverHostTests(root, arch)
    assert.deepEqual(selected, files)
    for (const { build } of candidates)
      assert.deepEqual(
        filesForTarget(
          discoverRepositoryTests(root, affectedManifest),
          target.id,
          affectedManifest,
          `macos-${build}`,
        ),
        selected,
        `Every admitted ${arch}/${build} host must execute the complete common inventory`,
      )
    assert.deepEqual(
      selected,
      filesForTarget(discoverRepositoryTests(root, affectedManifest), target.id, affectedManifest),
    )
    const shards = planMacHostTests(selected, arch)
    const primitives = new Set(
      suiteTestFiles(selected, ['macos-native'], affectedManifest, target.inventoryProfile),
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
        const file = shard.groups[index].file
        assert.deepEqual(
          command.slice(0, 2),
          file.endsWith('.node.mjs') ? ['node', '--test'] : ['bun', 'test'],
        )
        assert.ok(command.includes(`./${file}`))
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

test('synthetic costs balance whole files and fixed overhead before prioritizing native work', () => {
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
  const costs = {
    weights: new Map(
      [
        [checkpoint, 80],
        [workspace, 70],
        [factory, 60],
        [specialist, 50],
        [storage, 40],
        [portable, 20],
      ].map(([file, seconds]) => [file, { x64: seconds, arm64: seconds }]),
    ),
    nativePrerequisiteSeconds: 30,
    installedConsumerSeconds: 60,
  }
  const expected = {
    x64: [
      { seconds: 92, files: [factory, future] },
      { seconds: 100, files: [checkpoint, portable] },
      { seconds: 110, files: [workspace, storage] },
      { seconds: 110, files: [specialist] },
    ],
    arm64: [
      {
        seconds: 412,
        files: [checkpoint, workspace, factory, specialist, storage, portable, future],
      },
    ],
  }
  for (const arch of ['x64', 'arm64']) {
    const shards = planMacHostTests(files, arch, costs)
    assert.deepEqual(planMacHostTests([...files].reverse(), arch, costs), shards)
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
        const index = baseline.files.includes(storage) ? 1 : 0
        assert.equal(shard.groups[index].file, future)
        assert.equal(shard.groups[index].estimatedSeconds, 2)
      }
      if (baseline.files.includes(storage)) assert.equal(shard.groups[0].file, storage)
    }
  }
})

test('every incident conversation scenario remains an independent complete host obligation', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const files = discoverRepositoryTests(root, affectedManifest)
  const expected = ['replacement', 'commentary', 'budget', 'refused-successor']
    .map((scenario) => `packages/jig/test/host/installed-incident-brief-${scenario}.test.ts`)
    .sort()
  for (const target of ['linux', 'macos-x64', 'macos-arm64']) {
    const selected = filesForTarget(files, target, affectedManifest)
    assert.deepEqual(
      selected.filter((file) => file.startsWith('packages/jig/test/host/installed-incident-brief')),
      expected,
      target,
    )
  }
  const mac = await discoverHostTests(root)
  for (const arch of ['x64', 'arm64']) {
    const groups = planMacHostTests(mac, arch).flatMap((shard) => shard.groups)
    for (const file of expected)
      assert.equal(groups.filter((group) => group.file === file).length, 1, `${arch}: ${file}`)
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

test('the Mac group runner preserves the first child failure and starts no later group', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'jig-mac-group-failure-'))
  try {
    const calls = resolve(root, 'calls.jsonl')
    const bun = resolve(root, 'failing-bun')
    await writeFile(
      bun,
      `#!/usr/bin/env node\nimport {appendFileSync} from 'node:fs'; appendFileSync(process.env.CALLS, JSON.stringify(process.argv.slice(2))+'\\n'); process.exit(42);\n`,
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
          FLOW_NODE: spawnSync('/bin/sh', ['-c', 'command -v node'], {
            encoding: 'utf8',
          }).stdout.trim(),
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

test('Node material suites retain their runtime, whole file and timeout in native command plans', () => {
  const file = 'packages/display-web/test/material.node.mjs'
  assert.equal(isHostTestFile(file), true)
  assert.deepEqual(commandsForShard({ groups: [{ file }] }, '/tools/bun', '/tools/node'), [
    ['/tools/node', '--test', '--test-timeout=420000', `./${file}`],
  ])
})

test('four Intel shards and one complete Apple Silicon host cover identical work', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const files = await discoverHostTests(root, 'x64')
  const plans = await Promise.all(
    Object.keys(MAC_HOST_SHARDS).map(async (arch) =>
      planMacHostTests(await discoverHostTests(root, arch), arch),
    ),
  )
  assert.deepEqual(MAC_HOST_SHARDS, { x64: 4, arm64: 1 })
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
    ['run', 'arm64', '1'],
    ['run', 'x64', '4'],
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
      '#!/usr/bin/env node\nimport {appendFileSync} from "node:fs"; appendFileSync(process.env.CALLS,JSON.stringify({args:process.argv.slice(2),startup:process.env.JIG_NATIVE_AGENT_STARTUP,expectation:process.env.JIG_CODEX_MACOS_STARTUP_EXPECTATION})+"\\n");\n',
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
    ['arm64', '24.6.0', '24H232', 'unsupported'],
  ]) {
    const result = run('Darwin', arch, release, build)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), expectation)
  }
  for (const tuple of [
    ['Darwin', 'arm64', '23.4.0', '23E224'],
    ['Darwin', 'x86_64', '24.6.0', '24G831'],
    ['Darwin', 'x86_64', '24.6.0', '24H232'],
    ['Darwin', 'arm64', '24.6.0', '24H233'],
    ['Linux', 'x86_64', '23.4.0', '23E224'],
  ]) {
    assert.equal(run(...tuple).status, 2, `unqualified tuple ${tuple} must refuse`)
  }
  assert.match(
    qualification,
    /JIG_NATIVE_AGENT_STARTUP=1 JIG_CODEX_MACOS_STARTUP_EXPECTATION="\$codex_startup_expectation" \\\n\s*bun test packages\/jig\/test\/startup\/native-agent-startup\.test\.ts/,
  )
  assert.ok(qualification.includes('macos-codex-preferences'))
  assert.match(qualification, /--profile "\$inventory_profile"/)
  assert.match(
    qualification,
    /if \[\[ "\$mode" == shard \]\]; then\n\s*bun scripts\/ci\/probe-macos-host\.ts --hosted > \/dev\/null\nfi/,
  )
})

test('every required and nightly hosted Mac shard checks its exact target before compilation and builds', async () => {
  const workflow = parse(
    await readFile(
      resolve(import.meta.dirname, '../../.github/workflows/macos-hosted-candidates.yml'),
      'utf8',
    ),
  )
  assert.deepEqual([...new Set(workflow.jobs.prerequisites.strategy.matrix.include.map(({ arch }) => arch))], ['arm64'])
  const nightly = parse(await readFile(
    resolve(import.meta.dirname, '../../.github/workflows/macos-intel-nightly.yml'), 'utf8',
  ))
  assert.equal(nightly.jobs.prerequisites['runs-on'], 'macos-15-intel')
  for (const job of [workflow.jobs.prerequisites, nightly.jobs.prerequisites]) {
    const probes = job.steps.filter((step) =>
      /bun scripts\/ci\/probe-macos-host\.ts --hosted/.test(step.run ?? ''),
    )
    assert.equal(probes.length, 1)
    const probe = probes[0]
    assert.equal(probe.if, undefined)
    assert.match(probe.env.EXPECTED_ARCH, /^\$\{\{ matrix\.arch \}\}$/)
    assert.match(probe.run, /set -o pipefail/)
    assert.match(probe.run, /tee "\$RUNNER_TEMP\/mac-evidence\/prerequisites\.json"/)
    const setup = job.steps.filter((step) => /clang |just --justfile/.test(step.run ?? ''))
    assert.ok(setup.length >= 2)
    assert.ok(setup.every((step) => job.steps.indexOf(probe) < job.steps.indexOf(step)))
  }
})

test('one complete ARM runner owns native and installed proof within the former combined allowance', async () => {
  const workflow = parse(
    await readFile(
      resolve(import.meta.dirname, '../../.github/workflows/macos-hosted-candidates.yml'),
      'utf8',
    ),
  )
  const job = workflow.jobs.prerequisites
  const matrix = job.strategy.matrix.include
  for (const [arch, count] of Object.entries({ arm64: MAC_HOST_SHARDS.arm64 })) {
    const roles = matrix.filter((role) => role.arch === arch)
    assert.deepEqual(
      roles.map((role) => role.shard).sort(),
      Array.from({ length: count }, (_, i) => i),
    )
    assert.deepEqual(
      roles.filter((role) => role.installed).map((role) => role.shard),
      [count - 1],
    )
    assert.equal(
      workflow.jobs['qualified-architecture'].strategy.matrix.include.find(
        (role) => role.arch === arch,
      ).count,
      count,
    )
  }
  const arm = matrix.filter((role) => role.arch === 'arm64')
  assert.deepEqual(arm, [{ arch: 'arm64', shard: 0, installed: true }])
  const nightly = parse(await readFile(
    resolve(import.meta.dirname, '../../.github/workflows/macos-intel-nightly.yml'), 'utf8',
  ))
  const intel = Array.from({ length: MAC_HOST_SHARDS.x64 }, (_, shard) => ({
    arch: 'x64', shard, installed: shard === MAC_HOST_SHARDS.x64 - 1,
  }))
  const evaluate = (expression, role, profile = false) =>
    runInNewContext(expression.replace(/^\$\{\{\s*|\s*\}\}$/g, ''), {
      matrix: role,
      inputs: { include_startup_profile: profile },
    })
  const native = job.steps.find((step) =>
    /bun test packages\/jig\/test\/macos\/macos-process-controls/.test(step.run ?? ''),
  )
  const clients = job.steps.find((step) =>
    /scripts\/ci\/install-macos-test-clients/.test(step.run ?? ''),
  )
  const qualifier = job.steps.find((step) => /qualify-macos-host\.sh --shard/.test(step.run ?? ''))
  assert.equal(evaluate(native.if, arm[0]), true)
  assert.equal(evaluate(clients.if, arm[0]), true)
  assert.equal(qualifier.if, undefined)
  assert.match(qualifier.run, /--shard "\$\{\{ matrix\.shard \}\}"/)
  for (const profile of [false, true]) {
    const minutes = evaluate(job['timeout-minutes'], arm[0], profile)
    assert.equal(minutes, profile ? 90 : 60)
    assert.ok(minutes < (profile ? 100 : 70))
    for (const role of intel)
      assert.equal(
        evaluate(nightly.jobs.prerequisites['timeout-minutes'], role, profile),
        profile && role.installed ? 65 : 35,
      )
    const total = minutes + intel.reduce(
      (sum, role) => sum + evaluate(nightly.jobs.prerequisites['timeout-minutes'], role, profile),
      0,
    )
    assert.ok(total < (profile ? 270 : 210))
  }
  const receipt = workflow.jobs['qualified-architecture'].steps.find((step) =>
    /candidate-provenance\.mjs qualification/.test(step.run ?? ''),
  )
  assert.match(
    receipt.run,
    /cp "\$RUNNER_TEMP\/mac-summary\.json" "\$RUNNER_TEMP\/macos-qualification\/mac-summary\.json"/,
  )
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
  check(parsed)
  // JSON is YAML too: indentation, scalar quoting and step labels carry no role.
  for (const step of parsed.jobs['host-suite'].steps) step.name = 'Renamed step'
  check(parse(JSON.stringify(parsed, null, 1)))
  parsed.jobs['host-suite'].steps.find((step) => step.env?.JIG_CI_COMMAND_CONTEXT).if = 'false'
  assert.throws(() => check(parsed), /installed-evidence/)
})
