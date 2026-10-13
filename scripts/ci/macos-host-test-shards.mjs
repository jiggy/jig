import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { discoverRepositoryTests, filesForTarget } from './suite-inventory.mjs'

export const MAC_HOST_SHARDS = Object.freeze({ x64: 3, arm64: 2 })
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

// Advisory whole-file elapsed times from verified complete run38156769162,
// attempt1. Hints place every applicable file once; they cannot omit coverage.
// Repair/factory split hints are conservative projections from that same run.
// Factory includes fresh setup and initial review in both consumers; its new
// cold second review still needs measurement.
const WEIGHTS = new Map([
  ['packages/display-tui/test/native.test.ts', { x64: 15, arm64: 17 }],
  ['packages/display-tui/test/portability.test.ts', { x64: 14, arm64: 14 }],
  ['packages/jig/test/host/bun-native-preparation.test.ts', { x64: 137, arm64: 67 }],
  ['packages/jig/test/host/finite-acp-lifecycle.test.ts', { x64: 200, arm64: 64 }],
  ['packages/jig/test/host/http-request-lifecycle.test.ts', { x64: 197, arm64: 71 }],
  ['packages/jig/test/host/installed-attachments.test.ts', { x64: 15, arm64: 11 }],
  ['packages/jig/test/host/installed-package-provider.test.ts', { x64: 142, arm64: 68 }],
  ['packages/jig/test/host/installed-software-factory-blocked.test.ts', { x64: 86, arm64: 38 }],
  ['packages/jig/test/host/installed-software-factory.test.ts', { x64: 213, arm64: 107 }],
  ['packages/jig/test/host/installed-workspace-provider.test.ts', { x64: 211, arm64: 119 }],
  ['packages/jig/test/host/markdown-worker.test.ts', { x64: 25, arm64: 15 }],
  ['packages/jig/test/host/package-provider-observation.test.ts', { x64: 35, arm64: 18 }],
  ['packages/jig/test/host/project-author-evaluator.test.ts', { x64: 78, arm64: 58 }],
  ['packages/jig/test/host/project-command-lifecycle.test.ts', { x64: 125, arm64: 59 }],
  ['packages/jig/test/host/root-agent-composition.test.ts', { x64: 152, arm64: 66 }],
  ['packages/jig/test/host/root-agent-fences-acp.test.ts', { x64: 120, arm64: 56 }],
  ['packages/jig/test/host/root-agent-fences-run.test.ts', { x64: 116, arm64: 46 }],
  ['packages/jig/test/host/root-agent-fences-specialist.test.ts', { x64: 270, arm64: 83 }],
  ['packages/jig/test/host/root-agent-http-composition.test.ts', { x64: 190, arm64: 64 }],
  ['packages/jig/test/host/root-agent-repair-batch.test.ts', { x64: 194, arm64: 91 }],
  ['packages/jig/test/host/root-agent-repair-unsuccessful.test.ts', { x64: 108, arm64: 41 }],
  ['packages/jig/test/host/root-agent-repair.test.ts', { x64: 96, arm64: 30 }],
  ['packages/jig/test/host/run-checkpoint-lifecycle.test.ts', { x64: 221, arm64: 160 }],
  ['packages/jig/test/macos/macos-guardian-storage.test.ts', { x64: 56, arm64: 44 }],
  ['packages/jig/test/portable/activation-admission-store.test.ts', { x64: 51, arm64: 41 }],
  ['packages/jig/test/portable/contract-generation.test.ts', { x64: 19, arm64: 8 }],
  ['packages/jig/test/portable/project-evaluator-child.test.ts', { x64: 11, arm64: 11 }],
  ['packages/jig/test/portable/workspace-progress.test.ts', { x64: 10, arm64: 11 }],
])
// Actual owning-step wall time for native prerequisites and the installed tail.
// The latter includes genuine-client startup and all four installed consumers.
const NATIVE_PREREQUISITE_WEIGHTS = Object.freeze({ x64: 59, arm64: 36 })
const INSTALLED_CONSUMER_WEIGHTS = Object.freeze({ x64: 450, arm64: 250 })
const manifest = JSON.parse(
  readFileSync(new URL('./affected-manifest.json', import.meta.url), 'utf8'),
)
const TEST_FILE = /(?:\.test|_test|\.spec|_spec)\.(?:[cm]?[jt]sx?)$/
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

export async function discoverHostTests(root) {
  // Both 24G architectures share the same full-role inventory. Preserve portable
  // cases on Mac until a separate classification audit proves host neutrality.
  return filesForTarget(
    discoverRepositoryTests(root, manifest),
    'macos-x64',
    manifest,
    'macos-24G830',
  )
}

export function planMacHostTests(files, architecture) {
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
  const shards = Array.from({ length: count }, (_, index) => ({
    index,
    architecture,
    groups: [],
    // Include native prerequisites in shard zero and the installed smoke tail
    // in the last shard. These costs must participate in balancing, too.
    estimatedSeconds:
      (index === 0 ? NATIVE_PREREQUISITE_WEIGHTS[architecture] : 0) +
      (index === count - 1 ? INSTALLED_CONSUMER_WEIGHTS[architecture] : 0),
  }))
  const ordinary = files
    .filter((file) => !NATIVE_PREREQUISITE_TESTS.includes(file) && file !== INSTALLED_STARTUP_TEST)
    .map((file) => ({
      file,
      estimatedSeconds: WEIGHTS.get(file)?.[architecture] ?? 2,
    }))
    .sort((a, b) => b.estimatedSeconds - a.estimatedSeconds || a.file.localeCompare(b.file))
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
  return shard.groups.map(({ file }) => [
    bun,
    'test',
    `./${file}`,
    '--bail=1',
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
  const shards = planMacHostTests(await discoverHostTests(process.cwd()), architecture)
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
