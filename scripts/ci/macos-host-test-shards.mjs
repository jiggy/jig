import { spawnSync } from 'node:child_process'
import { readdir, writeFile } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MAC_HOST_SHARDS = Object.freeze({ x64: 3, arm64: 2 })
export function macHostShardCount(architecture) {
  if (!Object.hasOwn(MAC_HOST_SHARDS, architecture))
    throw new Error('Mac qualification requires x64 or arm64')
  return MAC_HOST_SHARDS[architecture]
}
export const ROOT_TEST = 'packages/jig/test/root-agent-run-lifecycle.test.ts'
export const PACKAGE_TEST = 'packages/jig/test/package-provider-host.test.ts'
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

// Exhaustive, disjoint partitions of the two longest files. Catch-all patterns
// admit future cases; names select work, while wall-time hints only place it.
// Intel evidence: macOS hosted candidates runs 37452493021 and 37459864656.
export const NAMED_TEST_GROUPS = new Map([
  [
    ROOT_TEST,
    [
      {
        pattern:
          '^(?!(?:contained repair file application |private contained Agent Run lifecycle fences |private contained Agent Run lifecycle runs two unchanged packed HTTP Agents through simultaneous deep specialist branches$))',
        estimatedSeconds: 255,
      },
      {
        pattern:
          '^private contained Agent Run lifecycle runs two unchanged packed HTTP Agents through simultaneous deep specialist branches$',
        estimatedSeconds: 167,
      },
      {
        pattern:
          '^contained repair file application (?!exports (?:batch|mixed-batch) repair evidence )',
        estimatedSeconds: 220,
      },
      {
        pattern:
          '^contained repair file application exports (?:batch|mixed-batch) repair evidence ',
        estimatedSeconds: 235,
      },
      {
        pattern: '^private contained Agent Run lifecycle fences (?!root Agent (?:Run|ACP) )',
        estimatedSeconds: 235,
      },
      {
        pattern: '^private contained Agent Run lifecycle fences root Agent Run ',
        estimatedSeconds: 142,
      },
      {
        pattern: '^private contained Agent Run lifecycle fences root Agent ACP ',
        estimatedSeconds: 130,
      },
    ],
  ],
  [
    PACKAGE_TEST,
    [
      { pattern: '^installed CLI reviews ', estimatedSeconds: 250 },
      { pattern: '^(?!installed CLI reviews )', estimatedSeconds: 179 },
    ],
  ],
])

// Advisory Intel timings from the complete hosted qualification. They affect
// scheduling only; every discovered test file is assigned even without a hint.
const WEIGHTS = new Map([
  ['run-checkpoint-lifecycle.test.ts', 241],
  ['http-request-lifecycle.test.ts', 190],
  ['project-command-lifecycle.test.ts', 192],
  ['finite-acp-lifecycle.test.ts', 166],
  ['bun-native-preparation.test.ts', 174],
  ['project-author-evaluator.test.ts', 86],
  ['activation-admission-store.test.ts', 57],
  ['macos-guardian-storage.test.ts', 51],
  ['contract-generation.test.ts', 32],
  ['markdown-worker.test.ts', 47],
  ['activation-plan2.test.ts', 10],
  ['project-evaluator-child.test.ts', 10],
  ['file-delivery.test.ts', 10],
  ['codex-acp-dispatch.test.ts', 7],
  ['finite-acp-resource.test.ts', 9],
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

export function planMacHostTests(files, architecture) {
  const count = macHostShardCount(architecture)
  const unique = new Set(files)
  if (unique.size !== files.length) {
    throw new Error('Mac host test inventory repeats a file')
  }
  for (const file of NAMED_TEST_GROUPS.keys()) {
    if (!unique.has(file)) throw new Error(`Mac partitioned test file is missing: ${file}`)
  }
  for (const file of NATIVE_PREREQUISITE_TESTS) {
    if (!unique.has(file)) throw new Error(`Mac native prerequisite test is missing: ${file}`)
  }
  const shards = Array.from({ length: count }, (_, index) => ({
    index,
    architecture,
    groups: [],
    // Include native prerequisites in shard zero and the installed smoke tail
    // in the last shard. These costs must participate in balancing, too.
    estimatedSeconds: (index === 0 ? 60 : 0) + (index === count - 1 ? 384 : 0),
  }))
  const ordinary = files
    .filter((file) => !NATIVE_PREREQUISITE_TESTS.includes(file))
    .flatMap((file) =>
      (
        NAMED_TEST_GROUPS.get(file) ?? [
          { pattern: null, estimatedSeconds: WEIGHTS.get(basename(file)) ?? 2 },
        ]
      ).map((group) => ({ file, ...group })),
    )
    .sort(
      (a, b) =>
        b.estimatedSeconds - a.estimatedSeconds ||
        a.file.localeCompare(b.file) ||
        (a.pattern ?? '').localeCompare(b.pattern ?? ''),
    )
  for (const group of ordinary) {
    const target = [...shards].sort(
      (a, b) => a.estimatedSeconds - b.estimatedSeconds || a.index - b.index,
    )[0]
    target.groups.push(group)
    target.estimatedSeconds += group.estimatedSeconds
  }
  // Keep the expensive containment cases first so failures do not wait behind
  // unrelated portable checks. Assignment remains exhaustive and deterministic.
  if (shards.some((shard) => shard.groups.length === 0)) {
    throw new Error('Mac host test inventory leaves an empty shard')
  }
  return shards
}

export function commandsForShard(shard, bun = 'bun') {
  // Each group gets a fresh Bun process. Host ownership tests still run
  // sequentially, while a failure cannot leave JS state for the next group.
  return shard.groups.map(({ file, pattern }) => [
    bun,
    'test',
    `./${file}`,
    '--bail=1',
    ...(pattern ? ['--test-name-pattern', pattern] : []),
    '--timeout',
    '420000',
  ])
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
  const shards = planMacHostTests(await discoverJigTests(process.cwd()), architecture)
  const shard = shards[index]
  const commands = commandsForShard(shard, process.env.JIG_CI_BUN || 'bun')
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
          architecture,
          shard: index,
          group: commandIndex,
          file: args.find((argument) => argument.startsWith('./packages/jig/test/')),
          pattern: shard.groups[commandIndex].pattern,
          elapsedMs: Math.round(performance.now() - started),
          status: result.status,
        }),
      )
      if (result.error) throw result.error
      if (result.status !== 0) process.exit(result.status ?? 1)
    }
  }
}
