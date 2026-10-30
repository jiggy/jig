import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { balanceWholeFiles, HOST_TEST_DURATIONS, hostTestSeconds } from './host-test-scheduling.mjs'
import { discoverRepositoryTests, filesForTarget, suiteTestFiles } from './suite-inventory.mjs'

// Keep the complete ARM role on one runner during hosted image rollouts.
// Different kernel builds cannot supply parts of one profile's qualification.
export const MAC_HOST_SHARDS = Object.freeze({ x64: 4, arm64: 1 })
export function macHostShardCount(architecture) {
  if (!Object.hasOwn(MAC_HOST_SHARDS, architecture))
    throw new Error('Mac qualification requires x64 or arm64')
  return MAC_HOST_SHARDS[architecture]
}
export const INSTALLED_STARTUP_TEST = 'packages/jig/test/startup/native-agent-startup.test.ts'
export const NATIVE_PREREQUISITE_TESTS = [
  'packages/jig/test/macos/macos-process-controls.test.ts',
  'packages/jig/test/macos/macos-execution.test.ts',
  'packages/jig/test/macos/macos-descriptor-files.test.ts',
  'packages/jig/test/macos/macos-descriptor-handoff.test.ts',
  'packages/jig/test/macos/macos-volume.test.ts',
  'packages/jig/test/macos/macos-backend-state.test.ts',
  'packages/jig/test/macos/macos-native-backend.test.ts',
  'packages/jig/test/macos/macos-guardian.test.ts',
]

// Maximum successful whole-file observations from complete Linux/Mac runs live
// in the source-pinned timing catalog. They affect placement, never coverage.
const WEIGHTS = new Map(
  Object.keys(HOST_TEST_DURATIONS.fileSeconds.x64).map((file) => [
    file,
    {
      x64: HOST_TEST_DURATIONS.fileSeconds.x64[file],
      arm64: HOST_TEST_DURATIONS.fileSeconds.arm64[file],
    },
  ]),
)
const NATIVE_PREREQUISITE_WEIGHTS = Object.freeze(
  Object.fromEntries(
    ['x64', 'arm64'].map((arch) => [arch, HOST_TEST_DURATIONS.fixedSeconds[arch].native]),
  ),
)
const INSTALLED_CONSUMER_WEIGHTS = Object.freeze(
  Object.fromEntries(
    ['x64', 'arm64'].map((arch) => [arch, HOST_TEST_DURATIONS.fixedSeconds[arch].installed]),
  ),
)
const manifest = JSON.parse(readFileSync(new URL('./test-suites.json', import.meta.url), 'utf8'))
const TEST_FILE = /(?:(?:\.test|_test|\.spec|_spec)\.(?:[cm]?[jt]sx?)|\.node\.mjs)$/
export const HOST_TEST_DIRECTORIES = Object.freeze([
  'packages/jig/test',
  'packages/display-model/test',
  'packages/display-web/test',
  'packages/display-tui/test',
])

// Match the filesystem walk when reconstructing the inventory from Git. Hidden
// directories and dependency copies cannot become an additional owning command.
export function isHostTestFile(file) {
  return (
    HOST_TEST_DIRECTORIES.some((directory) => file.startsWith(`${directory}/`)) &&
    file.split('/').every((part) => !part.startsWith('.') && part !== 'node_modules') &&
    TEST_FILE.test(file)
  )
}

export async function discoverHostTests(root, architecture = 'x64') {
  macHostShardCount(architecture)
  // Each architecture selects its exact full-role inventory. Preserve portable
  // cases on Mac until a separate classification audit proves host neutrality.
  return filesForTarget(discoverRepositoryTests(root, manifest), `macos-${architecture}`, manifest)
}

export function planMacHostTests(
  files,
  architecture,
  {
    weights = WEIGHTS,
    nativePrerequisiteSeconds = NATIVE_PREREQUISITE_WEIGHTS[architecture],
    installedConsumerSeconds = INSTALLED_CONSUMER_WEIGHTS[architecture],
  } = {},
) {
  const count = macHostShardCount(architecture)
  const unique = new Set(files)
  if (unique.size !== files.length) {
    throw new Error('Mac host test inventory repeats a file')
  }
  for (const file of NATIVE_PREREQUISITE_TESTS) {
    if (!unique.has(file)) throw new Error(`Mac native prerequisite test is missing: ${file}`)
  }
  if (!unique.has(INSTALLED_STARTUP_TEST)) {
    throw new Error(`Mac installed startup test is missing: ${INSTALLED_STARTUP_TEST}`)
  }
  const ordinary = files.filter(
    (file) => !NATIVE_PREREQUISITE_TESTS.includes(file) && file !== INSTALLED_STARTUP_TEST,
  )
  const initialSeconds = Array.from(
    { length: count },
    (_, index) =>
      (index === 0 ? nativePrerequisiteSeconds : 0) +
      (index === count - 1 ? installedConsumerSeconds : 0),
  )
  const shards = balanceWholeFiles(
    ordinary,
    count,
    (file) => weights.get(file)?.[architecture] ?? hostTestSeconds(file, architecture),
    initialSeconds,
  ).map((shard) => ({ ...shard, architecture }))
  // Expose primitive failures before long application scenarios without changing
  // LPT membership, weights or the order within either partition.
  const profile = manifest.targets.find(
    (target) => target.id === `macos-${architecture}`,
  ).inventoryProfile
  const primitives = new Set(suiteTestFiles(files, ['macos-native'], manifest, profile))
  for (const shard of shards)
    shard.groups = [
      ...shard.groups.filter(({ file }) => primitives.has(file)),
      ...shard.groups.filter(({ file }) => !primitives.has(file)),
    ]
  if (shards.some((shard) => shard.groups.length === 0)) {
    throw new Error('Mac host test inventory leaves an empty shard')
  }
  return shards
}

export function commandsForShard(shard, bun = 'bun', node = 'node') {
  // Each group retains its actual runtime in a fresh sequential process.
  return shard.groups.map(({ file }) =>
    file.endsWith('.node.mjs')
      ? [node, '--test', '--test-timeout=420000', `./${file}`]
      : [bun, 'test', `./${file}`, '--bail=1', '--timeout', '420000'],
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2]
  const architecture = process.argv[3]
  const count = Object.hasOwn(MAC_HOST_SHARDS, architecture) ? macHostShardCount(architecture) : 0
  const index = Number(process.argv[4])
  if (mode === 'count' && count && process.argv.length === 4) {
    console.log(count)
    process.exit(0)
  }
  if (
    process.argv.length !== 5 ||
    !['plan', 'run'].includes(mode) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= count
  ) {
    console.error(
      'usage: node scripts/ci/macos-host-test-shards.mjs count x64|arm64 or plan|run x64|arm64 shard',
    )
    process.exit(2)
  }
  const shards = planMacHostTests(
    await discoverHostTests(process.cwd(), architecture),
    architecture,
  )
  const shard = shards[index]
  const node = process.env.FLOW_NODE
  if (
    mode === 'run' &&
    shard.groups.some(({ file }) => file.endsWith('.node.mjs')) &&
    (!node || !isAbsolute(node))
  )
    throw new Error('Node material tests require the verified absolute FLOW_NODE executable')
  const commands = commandsForShard(shard, process.env.JIG_CI_BUN || 'bun', node || 'node')
  const plan = {
    architecture,
    shard: index,
    shardCount: count,
    installed: index === count - 1,
    groups: shard.groups,
    nativeFiles: index === 0 ? NATIVE_PREREQUISITE_TESTS : [],
  }
  console.log(JSON.stringify(plan))
  if (mode === 'run') {
    if (process.env.JIG_MACOS_TEST_TIMINGS_DIRECTORY)
      await writeFile(
        join(process.env.JIG_MACOS_TEST_TIMINGS_DIRECTORY, 'test-plan.json'),
        `${JSON.stringify(plan)}\n`,
      )
    for (const [commandIndex, [command, ...args]] of commands.entries()) {
      const timingDirectory = process.env.JIG_MACOS_TEST_TIMINGS_DIRECTORY
      const nodeCommand = shard.groups[commandIndex].file.endsWith('.node.mjs')
      const destination =
        timingDirectory && join(timingDirectory, `shard-${index}-group-${commandIndex}.xml`)
      const reporter = destination
        ? nodeCommand
          ? [
              '--test-reporter=spec',
              '--test-reporter-destination=stdout',
              '--test-reporter=./scripts/ci/source-node-reporter.mjs',
              `--test-reporter-destination=${destination}`,
            ]
          : ['--reporter=junit', `--reporter-outfile=${destination}`]
        : []
      const commandArguments = nodeCommand
        ? [...args.slice(0, -1), ...reporter, args.at(-1)]
        : [...args, ...reporter]
      const started = performance.now()
      const result = spawnSync(command, commandArguments, {
        stdio: 'inherit',
        env: process.env,
      })
      console.log(
        JSON.stringify({
          architecture,
          shard: index,
          group: commandIndex,
          file: args.find((argument) =>
            /^\.\/packages\/(?:jig|display-(?:model|web|tui))\/test\//.test(argument),
          ),
          elapsedMs: Math.round(performance.now() - started),
          status: result.status,
        }),
      )
      if (result.error) throw result.error
      if (result.status !== 0) process.exit(result.status ?? 1)
    }
  }
}
