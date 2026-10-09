import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  commandsForShard,
  discoverHostTests,
  MAC_HOST_SHARDS,
  macHostShardCount,
  NAMED_TEST_GROUPS,
  NATIVE_PREREQUISITE_TESTS,
  PACKAGE_TEST,
  planMacHostTests,
  ROOT_TEST,
} from './macos-host-test-shards.mjs'

test('every current Jig and display file and named partition enters Mac qualification exactly once', async () => {
  const files = await discoverHostTests(resolve(import.meta.dirname, '../..'))
  for (const packageName of ['display-model', 'display-web', 'display-tui']) {
    assert.ok(
      files.some((file) => file.startsWith(`packages/${packageName}/test/`)),
      `${packageName} has no tests in the qualification inventory`,
    )
  }
  const shards = planMacHostTests(files, 'x64')
  assert.equal(shards.length, macHostShardCount('x64'))
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
      assert.equal(
        command.filter((part) =>
          /^\.\/packages\/(?:jig|display-(?:model|web|tui))\/test\//.test(part),
        ).length,
        1,
      )
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
  for (const packageName of ['jig', 'display-model', 'display-web', 'display-tui']) {
    const future = `packages/${packageName}/test/future-host-proof.test.ts`
    assert.equal(
      planMacHostTests([...files, future], 'x64')
        .flatMap((shard) => shard.groups)
        .filter((group) => group.file === future).length,
      1,
    )
  }
  assert.throws(() => planMacHostTests([...files, ROOT_TEST], 'x64'))
  for (const file of [ROOT_TEST, PACKAGE_TEST, ...NATIVE_PREREQUISITE_TESTS]) {
    assert.throws(() =>
      planMacHostTests(
        files.filter((current) => current !== file),
        'x64',
      ),
    )
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
  const files = await discoverHostTests(resolve(import.meta.dirname, '../..'))
  const shards = planMacHostTests(files, 'x64')
  assert.deepEqual(planMacHostTests([...files].reverse(), 'x64'), shards)
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
  const files = await discoverHostTests(resolve(import.meta.dirname, '../..'))
  // Retained Intel command/case timings from hosted run 37522229440,
  // independent of the planner's estimates.
  // Fixed costs include native prerequisites and genuine startup/installed
  // checks; partitioned lifecycle work is counted by its retained case names.
  const fixedWorkloads = [
    [60, 0, 384],
    [60, 0, 500],
  ]
  const measuredSeconds = new Map([
    ['run-checkpoint-lifecycle.test.ts', 203],
    ['project-command-lifecycle.test.ts', 122],
    ['http-request-lifecycle.test.ts', 185],
    ['bun-native-preparation.test.ts', 103],
    ['finite-acp-lifecycle.test.ts', 140],
    ['project-author-evaluator.test.ts', 76],
    ['activation-admission-store.test.ts', 51],
    ['macos-guardian-storage.test.ts', 54],
    ['contract-generation.test.ts', 19],
    ['markdown-worker.test.ts', 31],
  ])
  // Individual retained cases, rather than planner weights: a partition change
  // must route the work once and still balance its complete observed cost.
  const namedCases = new Map([
    [
      ROOT_TEST,
      [
        [
          'private contained Agent Run lifecycle runs two unchanged packed HTTP Agents through simultaneous deep specialist branches',
          180,
        ],
        [
          'private contained Agent Run lifecycle executes and cleans a five-level branch within the unchanged aggregate envelope',
          72,
        ],
        [
          'private contained Agent Run lifecycle runs unchanged packed HTTP Agent siblings without a native Agent provider',
          51,
        ],
        [
          'private contained Agent Run lifecycle delivers complete selected Skill bytes from a workspace child Binding',
          31,
        ],
        [
          'private contained Agent Run lifecycle delivers complete selected Skill bytes from a workspace root Flow',
          22,
        ],
        [
          'private contained Agent Run lifecycle runs a Bun subprocess and asynchronous I/O from root and child Flow recipes',
          19,
        ],
        [
          'contained repair file application exports unsuccessful repair evidence through a JSON leaf and real contained commands',
          79,
        ],
        [
          'contained repair file application exports batch repair evidence through a JSON leaf and real contained commands',
          95,
        ],
        [
          'contained repair file application exports mixed-batch repair evidence through a JSON leaf and real contained commands',
          82,
        ],
        [
          'contained repair file application exports successful repair evidence through a JSON leaf and real contained commands',
          59,
        ],
        [
          'private contained Agent Run lifecycle fences specialist Agent Run success, invalid output, cancellation, deadline, and loss',
          242,
        ],
        [
          'private contained Agent Run lifecycle fences root Agent Run success, invalid output, cancellation, deadline, and loss',
          100,
        ],
        [
          'private contained Agent Run lifecycle fences root Agent ACP success, invalid output, cancellation, deadline, and loss',
          148,
        ],
      ],
    ],
    [
      PACKAGE_TEST,
      [
        ['installed CLI reviews and runs a workspace dependency (application: member)', 62],
        ['installed CLI reviews and runs a workspace dependency (application: root)', 55],
        ['installed CLI reviews and runs a workspace dependency (application: nested)', 57],
        ['packed read attachments preserve empty roots and maximum relative paths', 15],
        ['packed project entrypoint uses fresh reviewed data and immutable execution', 39],
        ['packed project dependencies uses fresh reviewed data and immutable execution', 73],
      ],
    ],
  ])
  for (const fixedSeconds of fixedWorkloads)
    for (const shard of planMacHostTests(files, 'x64')) {
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
    assert.equal(timing.pattern, first[first.indexOf('--test-name-pattern') + 1])
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
      .map((g) => `${g.file}:${g.pattern}`)
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
        'packages/jig/test/native-agent-startup.test.ts',
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
    /JIG_NATIVE_AGENT_STARTUP=1 JIG_CODEX_MACOS_STARTUP_EXPECTATION="\$codex_startup_expectation" \\\n\s*bun test packages\/jig\/test\/native-agent-startup\.test\.ts/,
  )
  assert.ok(qualification.includes('macos-codex-preferences'))
})

test('every Linux hostile Jig test file enters provisioned host conformance', async () => {
  const root = resolve(import.meta.dirname, '../..')
  const files = await discoverHostTests(root)
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
