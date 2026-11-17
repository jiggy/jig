import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, openSync, readFileSync, readSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { balanceWholeFiles, HOST_TEST_DURATIONS, hostTestSeconds } from './host-test-scheduling.mjs'
import { discoverRepositoryTests, filesForTarget, suiteTestFiles } from './suite-inventory.mjs'

export const DEFAULT_MAC_SHARD_POLICY = Object.freeze({
  targetSeconds: 1200,
  minShards: 1,
  maxShards: 3,
})

function requireArchitecture(architecture) {
  if (architecture !== 'arm64') throw new Error('Mac qualification requires Apple Silicon arm64')
}

export function validateMacShardPolicy(policy) {
  if (
    !policy ||
    Object.keys(policy).sort().join(',') !== 'maxShards,minShards,targetSeconds' ||
    !Number.isInteger(policy.targetSeconds) ||
    policy.targetSeconds < 1 ||
    policy.targetSeconds > 86400 ||
    !Number.isInteger(policy.minShards) ||
    !Number.isInteger(policy.maxShards) ||
    policy.minShards < 1 ||
    policy.maxShards > 8 ||
    policy.minShards > policy.maxShards
  )
    throw new Error('Invalid bounded Mac shard policy')
  return {
    targetSeconds: policy.targetSeconds,
    minShards: policy.minShards,
    maxShards: policy.maxShards,
  }
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

// Successful whole-file observations from complete native runs live
// in the source-pinned timing catalog. They affect placement, never coverage.
const WEIGHTS = new Map(
  Object.keys(HOST_TEST_DURATIONS.fileSeconds.arm64).map((file) => [
    file,
    {
      arm64: HOST_TEST_DURATIONS.fileSeconds.arm64[file],
    },
  ]),
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

export async function discoverHostTests(root, architecture = 'arm64') {
  requireArchitecture(architecture)
  // Each architecture selects its exact full-role inventory. Preserve portable
  // cases on Mac until a separate classification audit proves host neutrality.
  return filesForTarget(discoverRepositoryTests(root, manifest), `macos-${architecture}`, manifest)
}

export function planMacHostTests(
  files,
  architecture,
  {
    policy = DEFAULT_MAC_SHARD_POLICY,
    shardCount,
    weights = WEIGHTS,
    nativePrerequisiteSeconds = HOST_TEST_DURATIONS.fixedSeconds.arm64.native,
    installedConsumerSeconds = HOST_TEST_DURATIONS.fixedSeconds.arm64.installed,
  } = {},
) {
  requireArchitecture(architecture)
  policy = validateMacShardPolicy(policy)
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
  const maximum = Math.min(policy.maxShards, ordinary.length)
  if (policy.minShards > maximum)
    throw new Error('Mac inventory cannot fill the requested shard capacity')
  const candidates =
    shardCount === undefined
      ? Array.from(
          { length: maximum - policy.minShards + 1 },
          (_, index) => index + policy.minShards,
        )
      : [shardCount]
  if (
    candidates.some(
      (count) => !Number.isInteger(count) || count < policy.minShards || count > maximum,
    )
  )
    throw new Error('Mac shard count is outside the bounded policy')
  let shards
  for (const count of candidates) {
    const initialSeconds = Array.from(
      { length: count },
      (_, index) =>
        nativePrerequisiteSeconds + (index === count - 1 ? installedConsumerSeconds : 0),
    )
    shards = balanceWholeFiles(
      ordinary,
      count,
      (file) => weights.get(file)?.[architecture] ?? hostTestSeconds(file, architecture),
      initialSeconds,
      { allowEmptyShards: true },
    ).map((shard) => ({
      ...shard,
      architecture,
      nativeFiles: [...NATIVE_PREREQUISITE_TESTS],
      installed: shard.index === count - 1,
    }))
    if (Math.max(...shards.map(({ estimatedSeconds }) => estimatedSeconds)) <= policy.targetSeconds)
      break
  }
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
  if (shards.some((shard) => shard.groups.length === 0 && !shard.installed)) {
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

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}
function digest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}
function gitSource(root) {
  const source = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  if (
    !/^[a-f0-9]{40}$/.test(source) ||
    (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== source)
  )
    throw new Error('Mac plan checkout does not match the exact Git source')
  return source
}

export function createFrozenMacPlan(
  files,
  architecture,
  { source, policy = DEFAULT_MAC_SHARD_POLICY } = {},
) {
  if (!/^[a-f0-9]{40}$/.test(source ?? '')) throw new Error('Mac plan requires an exact Git source')
  policy = validateMacShardPolicy(policy)
  const shards = planMacHostTests(files, architecture, { policy })
  const plan = {
    version: 1,
    source,
    architecture,
    policy,
    inventoryDigest: digest([...files].sort()),
    estimatedSeconds: Math.max(...shards.map(({ estimatedSeconds }) => estimatedSeconds)),
    withinTarget: shards.every(({ estimatedSeconds }) => estimatedSeconds <= policy.targetSeconds),
    shards,
  }
  return { ...plan, digest: digest(plan) }
}

export async function readFrozenMacPlan(file, { root = process.cwd(), files, source } = {}) {
  const maximumBytes = 1024 * 1024
  if (!constants.O_NOFOLLOW || !constants.O_NONBLOCK)
    throw new Error('Frozen Mac plan reads require no-follow and nonblocking support')
  let descriptor
  try {
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch {
    throw new Error('Invalid frozen Mac plan file')
  }
  let observed
  try {
    const metadata = fstatSync(descriptor)
    if (!metadata.isFile() || metadata.size > maximumBytes)
      throw new Error('Invalid frozen Mac plan file')
    // Keep validation and bounded reading on the opened inode. A replacement
    // path cannot redirect the read, and concurrent growth cannot exceed this bound.
    const bytes = Buffer.alloc(maximumBytes + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null)
      if (count === 0) break
      length += count
    }
    if (length > maximumBytes) throw new Error('Invalid frozen Mac plan file')
    observed = JSON.parse(bytes.subarray(0, length).toString('utf8'))
  } finally {
    closeSync(descriptor)
  }
  const expected = createFrozenMacPlan(files ?? (await discoverHostTests(root, 'arm64')), 'arm64', {
    source: source ?? gitSource(root),
    policy: observed.policy,
  })
  if (stableJson(observed) !== stableJson(expected))
    throw new Error('Frozen Mac plan differs from its source, inventory or policy')
  return expected
}

function environmentPolicy() {
  return validateMacShardPolicy({
    targetSeconds: Number(
      process.env.JIG_MACOS_TARGET_SECONDS ?? DEFAULT_MAC_SHARD_POLICY.targetSeconds,
    ),
    minShards: Number(process.env.JIG_MACOS_MIN_SHARDS ?? DEFAULT_MAC_SHARD_POLICY.minShards),
    maxShards: Number(process.env.JIG_MACOS_MAX_SHARDS ?? DEFAULT_MAC_SHARD_POLICY.maxShards),
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2]
  const architecture = process.argv[3]
  if (mode === 'matrix' && process.argv.length === 4) {
    const plan = await readFrozenMacPlan(architecture)
    console.log(JSON.stringify({ include: plan.shards.map(({ index }) => ({ shard: index })) }))
    process.exit(0)
  }
  requireArchitecture(architecture)
  const files = await discoverHostTests(process.cwd(), architecture)
  if (mode === 'freeze' && process.argv.length === 5) {
    const plan = createFrozenMacPlan(files, architecture, {
      source: gitSource(process.cwd()),
      policy: environmentPolicy(),
    })
    await writeFile(process.argv[4], `${JSON.stringify(plan)}\n`, { flag: 'wx' })
    console.log(
      JSON.stringify({
        digest: plan.digest,
        shardCount: plan.shards.length,
        estimatedSeconds: plan.estimatedSeconds,
        withinTarget: plan.withinTarget,
      }),
    )
    process.exit(0)
  }
  const frozen = process.env.JIG_MACOS_TEST_PLAN_FILE
    ? await readFrozenMacPlan(process.env.JIG_MACOS_TEST_PLAN_FILE, { files })
    : undefined
  const shards =
    frozen?.shards ?? planMacHostTests(files, architecture, { policy: environmentPolicy() })
  const count = shards.length
  if (mode === 'count' && process.argv.length === 4) {
    console.log(count)
    process.exit(0)
  }
  const index = Number(process.argv[4])
  if (
    process.argv.length !== 5 ||
    !['plan', 'run'].includes(mode) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= count
  )
    throw new Error(
      'usage: macos-host-test-shards.mjs freeze arm64 FILE | matrix FILE | count arm64 | plan|run arm64 INDEX',
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
    installed: shard.installed,
    groups: shard.groups,
    nativeFiles: shard.nativeFiles,
    ...(frozen ? { planDigest: frozen.digest } : {}),
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
