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

// Advisory case totals from verified complete run 38107858216. Each physical
// suite runs once in a fresh process; hints change placement, never membership.
// Split suites sum their original case timings, rounded up to whole seconds.
const WEIGHTS = new Map([
  ['packages/jig/test/portable/root-agent-fixtures.test.ts', { x64: 2, arm64: 1 }],
  ['packages/jig/test/portable/factory-observation.test.ts', { x64: 1, arm64: 1 }],
  ['packages/jig/test/host/root-agent-composition.test.ts', { x64: 153, arm64: 68 }],
  ['packages/jig/test/host/root-agent-http-composition.test.ts', { x64: 188, arm64: 76 }],
  ['packages/jig/test/host/root-agent-repair.test.ts', { x64: 243, arm64: 71 }],
  ['packages/jig/test/host/root-agent-repair-batch.test.ts', { x64: 199, arm64: 69 }],
  ['packages/jig/test/host/root-agent-fences-run.test.ts', { x64: 103, arm64: 53 }],
  ['packages/jig/test/host/root-agent-fences-acp.test.ts', { x64: 102, arm64: 54 }],
  ['packages/jig/test/host/root-agent-fences-specialist.test.ts', { x64: 153, arm64: 83 }],
  ['packages/jig/test/host/installed-software-factory.test.ts', { x64: 253, arm64: 121 }],
  ['packages/jig/test/host/package-provider-observation.test.ts', { x64: 29, arm64: 17 }],
  ['packages/jig/test/host/installed-workspace-provider.test.ts', { x64: 170, arm64: 121 }],
  ['packages/jig/test/host/installed-package-provider.test.ts', { x64: 115, arm64: 72 }],
  ['packages/jig/test/host/installed-attachments.test.ts', { x64: 15, arm64: 9 }],
  ['packages/jig/test/host/run-checkpoint-lifecycle.test.ts', { x64: 203, arm64: 170 }],
  ['packages/jig/test/host/http-request-lifecycle.test.ts', { x64: 201, arm64: 78 }],
  ['packages/jig/test/host/project-command-lifecycle.test.ts', { x64: 141, arm64: 65 }],
  ['packages/jig/test/host/finite-acp-lifecycle.test.ts', { x64: 172, arm64: 71 }],
  ['packages/jig/test/host/bun-native-preparation.test.ts', { x64: 117, arm64: 67 }],
  ['packages/jig/test/host/project-author-evaluator.test.ts', { x64: 91, arm64: 61 }],
  ['packages/jig/test/portable/activation-admission-store.test.ts', { x64: 55, arm64: 41 }],
  ['packages/jig/test/macos/macos-guardian-storage.test.ts', { x64: 66, arm64: 54 }],
  ['packages/jig/test/portable/contract-generation.test.ts', { x64: 23, arm64: 8 }],
  ['packages/jig/test/portable/markdown-worker.test.ts', { x64: 2, arm64: 1 }],
  ['packages/jig/test/host/markdown-worker.test.ts', { x64: 40, arm64: 16 }],
  ['packages/jig/test/portable/activation-plan2.test.ts', { x64: 9, arm64: 5 }],
  ['packages/jig/test/portable/project-evaluator-child.test.ts', { x64: 11, arm64: 11 }],
  ['packages/jig/test/portable/file-delivery.test.ts', { x64: 10, arm64: 10 }],
  ['packages/jig/test/macos/file-delivery.test.ts', { x64: 9, arm64: 9 }],
  ['packages/jig/test/portable/codex-acp-dispatch.test.ts', { x64: 8, arm64: 6 }],
  ['packages/jig/test/portable/finite-acp-resource.test.ts', { x64: 9, arm64: 9 }],
  ['packages/display-tui/test/portability.test.ts', { x64: 14, arm64: 14 }],
  ['packages/jig/test/portable/workspace-progress.test.ts', { x64: 10, arm64: 10 }],
  ['packages/display-tui/test/native.test.ts', { x64: 15, arm64: 16 }],
])
// Same-run native prerequisite case totals and host-step remainder after group
// execution. The latter includes the installed consumer and startup witnesses.
const NATIVE_PREREQUISITE_WEIGHTS = Object.freeze({ x64: 50, arm64: 38 })
const INSTALLED_CONSUMER_WEIGHTS = Object.freeze({ x64: 464, arm64: 205 })
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
