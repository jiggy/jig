import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SHARD_COUNT = 5
export const ROOT_TEST = 'packages/jig/test/root-agent-run-lifecycle.test.ts'
export const NATIVE_PREREQUISITE_TESTS = [
  'packages/jig/test/macos-process-controls.test.ts',
  'packages/jig/test/macos-execution.test.ts',
  'packages/jig/test/macos-descriptor-files.test.ts',
  'packages/jig/test/macos-descriptor-handoff.test.ts',
  'packages/jig/test/macos-volume.test.ts',
  'packages/jig/test/macos-backend-state.test.ts',
  'packages/jig/test/macos-native-backend.test.ts',
  'packages/jig/test/macos-guardian.test.ts',
]

// The three patterns partition the complete root Agent lifecycle file. New
// tests enter the first shard unless they join one of the two named groups.
export const ROOT_PATTERNS = [
  '^(?!(?:contained repair file application |private contained Agent Run lifecycle fences ))',
  '^contained repair file application ',
  '^private contained Agent Run lifecycle fences ',
]

// Advisory Intel timings from the complete hosted qualification. They affect
// scheduling only; every discovered test file is assigned even without a hint.
const WEIGHTS = new Map([
  ['run-checkpoint-lifecycle.test.ts', 237],
  ['http-request-lifecycle.test.ts', 204],
  ['project-command-lifecycle.test.ts', 190],
  ['package-provider-host.test.ts', 158],
  ['finite-acp-lifecycle.test.ts', 123],
  ['bun-native-preparation.test.ts', 64],
  ['macos-guardian-storage.test.ts', 56],
  ['contract-generation.test.ts', 26],
])
const TEST_FILE = /(?:\.test|_test|\.spec|_spec)\.(?:[cm]?[jt]sx?)$/

export async function discoverJigTests(root) {
  const directory = join(root, 'packages/jig/test')
  const found = []
  async function walk(parent) {
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const path = join(parent, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && TEST_FILE.test(entry.name)) {
        found.push(relative(root, path).split(sep).join('/'))
      }
    }
  }
  await walk(directory)
  return found.sort()
}

export function planMacHostTests(files) {
  const unique = new Set(files)
  if (unique.size !== files.length || !unique.has(ROOT_TEST)) {
    throw new Error('Mac host test inventory is missing the root lifecycle file or repeats a file')
  }
  for (const file of NATIVE_PREREQUISITE_TESTS) {
    if (!unique.has(file)) throw new Error(`Mac native prerequisite test is missing: ${file}`)
  }
  const shards = Array.from({ length: SHARD_COUNT }, (_, index) => ({
    index,
    files: [],
    rootPattern: ROOT_PATTERNS[index] ?? null,
    // Root lifecycle groups take about 5, 8 and 7 minutes on hosted Intel.
    // The last shard also owns native startup and packed consumer smoke.
    estimatedSeconds: [318, 472, 394, 0, 190][index],
  }))
  const ordinary = files
    .filter((file) => file !== ROOT_TEST && !NATIVE_PREREQUISITE_TESTS.includes(file))
    .map((file) => ({ file, weight: WEIGHTS.get(basename(file)) ?? 2 }))
    .sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file))
  for (const { file, weight } of ordinary) {
    const target = [...shards].sort(
      (a, b) => a.estimatedSeconds - b.estimatedSeconds || a.index - b.index,
    )[0]
    target.files.push(file)
    target.estimatedSeconds += weight
  }
  for (const shard of shards) shard.files.sort()
  if (shards.some((shard) => shard.files.length === 0)) {
    throw new Error('Mac host test inventory leaves an empty shard')
  }
  return shards
}

export function commandsForShard(shard, bun = 'bun') {
  // Each file gets a fresh Bun process. Host ownership tests still run
  // sequentially, while a failure cannot leave JS state for the next file.
  const commands = shard.files.map((file) => [bun, 'test', `./${file}`, '--timeout', '420000'])
  if (shard.rootPattern) {
    commands.push([
      bun,
      'test',
      `./${ROOT_TEST}`,
      '--test-name-pattern',
      shard.rootPattern,
      '--timeout',
      '420000',
    ])
  }
  return commands
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2]
  const index = Number(process.argv[3])
  if (
    !['plan', 'run'].includes(mode) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= SHARD_COUNT
  ) {
    console.error(`usage: node scripts/ci/macos-host-test-shards.mjs plan|run 0-${SHARD_COUNT - 1}`)
    process.exit(2)
  }
  const shards = planMacHostTests(await discoverJigTests(process.cwd()))
  const shard = shards[index]
  const commands = commandsForShard(shard, process.env.JIG_CI_BUN || 'bun')
  console.log(JSON.stringify({ shard: index, files: shard.files, rootPattern: shard.rootPattern }))
  if (mode === 'run') {
    for (const [commandIndex, [command, ...args]] of commands.entries()) {
      const timingDirectory = process.env.JIG_MACOS_TEST_TIMINGS_DIRECTORY
      const reporter = timingDirectory
        ? [
            '--reporter=junit',
            `--reporter-outfile=${join(timingDirectory, `shard-${index}-group-${commandIndex}.xml`)}`,
          ]
        : []
      const started = performance.now()
      const result = spawnSync(command, [...args, ...reporter], {
        stdio: 'inherit',
        env: process.env,
      })
      console.log(
        JSON.stringify({
          shard: index,
          group: commandIndex,
          file: args.find((argument) => argument.startsWith('./packages/jig/test/')),
          elapsedMs: Math.round(performance.now() - started),
          status: result.status,
        }),
      )
      if (result.error) throw result.error
      if (result.status !== 0) process.exit(result.status ?? 1)
    }
  }
}
