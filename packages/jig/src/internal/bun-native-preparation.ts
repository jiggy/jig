import { lstat, mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { CheckError } from '../diagnostics.js'
import type { JsonValue } from '../json.js'
import {
  type CapturedFile,
  type CapturedPackage,
  type CapturedPackageBacking,
  createCapturedPackage,
} from '../package/capture.js'
import { packageDigest } from '../package/digest.js'
import { assertNoPathCollisions, comparePathBytes, validateLogicalPath } from '../package/paths.js'
import {
  type PrivateBunPreparationOwnerFact,
  type PrivateProjectCoordinator,
  readPrivateBunPreparationOwner,
  replacePrivateBunPreparationOwner,
} from './activation-admission-store.js'
import {
  assertPrivateBunExecutionLayoutFiles,
  normalizePrivateBunExecutionLayout,
  type PrivateBunExecutionLayout,
  privateBunAliasPackageName,
} from './bun-execution-layout.js'
import { requirePrivateBunPatches } from './bun-native-lock-policy.js'
import {
  encodePrivateBunMessage,
  PRIVATE_BUN_PREPARATION_LIMITS,
  PRIVATE_BUN_PREPARED_MESSAGE_BYTES,
  PRIVATE_BUN_SOURCE_MESSAGE_BYTES,
  privateBunMessageFits,
} from './bun-native-preparation-protocol.js'
import {
  inspectPrivateBunPackageInput,
  requirePrivateBunResolutionPermission,
} from './bun-package-input.js'
import {
  admitPrivateExecutionOwner,
  cancelPrivateExecutionOwnerStateAllocation,
  normalizePrivateExecutionConfirmedEnforcementReceipt,
  normalizePrivateExecutionOwnerStateAllocationIdentity,
  normalizePrivateExecutionSealedOwnerIdentity,
  type PrivateExecutionBackend,
  type PrivateExecutionComponentProcess,
  type PrivateExecutionConfirmedEnforcementReceipt,
  type PrivateExecutionLaunchPlan,
  type PrivateExecutionOwnerStateAllocationIdentity,
  type PrivateExecutionSealedOwnerIdentity,
  planPrivateExecutionOwnerStateAllocation,
  privateExecutionBackendKind,
  privateExecutionOwnerAllocationDigest,
  privateExecutionPreparedOwnerDigest,
  recoverPrivateExecutionFence,
  releasePrivateExecutionOwnerState,
  requirePrivateExecutionBackend,
  sealPrivateExecutionOwner,
} from './execution-backend.js'
import {
  type PrivateInstalledBunSupport,
  requirePrivateInstalledBunSupport,
  revalidatePrivateInstalledBunSupport,
} from './installed-bun-support.js'

const PREPARATION_WALL_MS = 60_000
const BUN_POLICY = Object.freeze(['--no-env-file', '--no-install', '--config=/dev/null'] as const)
const WORKER_FAILURE_CODES = new Set([
  'PACKAGE_BUN_INPUT_LIMIT',
  'PACKAGE_BUN_LOCK_INVALID',
  'PACKAGE_BUN_LOCK_STALE',
  'PACKAGE_BUN_OUTPUT_LIMIT',
  'PACKAGE_BUN_OUTPUT_UNSUPPORTED',
  'PACKAGE_BUN_PREPARATION_FAILED',
  'PACKAGE_BUN_PROTOCOL',
  'PACKAGE_BUN_SOURCE_CHANGED',
  'PACKAGE_BUN_SOURCE_UNSUPPORTED',
  'PACKAGE_BUN_RESOLUTION_FAILED',
  'PACKAGE_BUN_RESOLUTION_VERSION_UNAVAILABLE',
  'PACKAGE_BUN_RESOLVED_SOURCE_UNSUPPORTED',
])

export interface PrivatePreparedBunPackage {
  readonly captured: CapturedPackage
  readonly layout: PrivateBunExecutionLayout
}

/**
 * Prepare one Bun package in the same rootless envelope used by Runs.
 *
 * Only the fixed, script-disabled Bun installer inherits network access.
 * Authored Flow code is never executed and normal Runs remain network-isolated.
 */
export async function preparePrivateBunPackage(input: {
  readonly captured: CapturedPackage
  readonly installedSupport: PrivateInstalledBunSupport
  readonly backend: PrivateExecutionBackend
  readonly projectRoot: string
  readonly coordinator: PrivateProjectCoordinator
  readonly deadlineUnixMs?: number
  readonly signal?: AbortSignal
  readonly allowResolutionNetwork?: boolean
  readonly workspace?: {
    readonly target: string
    readonly members: readonly string[]
    readonly selected: readonly string[]
  }
}): Promise<PrivatePreparedBunPackage> {
  const classification =
    input.workspace === undefined
      ? await inspectPrivateBunPackageInput(input.captured)
      : input.captured.files.some(({ path }) => path === 'bun.lock')
        ? {
            state: 'locked' as const,
            manifestPath: 'package.json' as const,
            lockPath: 'bun.lock' as const,
          }
        : { state: 'unlocked' as const, manifestPath: 'package.json' as const }
  if (classification.state === 'direct') {
    throw new TypeError('Bun dependency preparation requires runtime dependencies or a lock')
  }
  requirePrivateBunResolutionPermission(classification, input.allowResolutionNetwork)
  input.signal?.throwIfAborted()
  const installedSupport = requirePrivateInstalledBunSupport(input.installedSupport)
  await revalidatePrivateInstalledBunSupport(installedSupport)
  const backend = requirePrivateExecutionBackend(input.backend)
  const source = {
    ...(await sourceMessage(input.captured)),
    ...(input.workspace === undefined
      ? {}
      : {
          workspace: {
            target: input.workspace.target,
            members: input.workspace.members,
            selected: input.workspace.selected,
          },
        }),
  }
  const sourceBytes = encodePrivateBunMessage(source)
  if (!privateBunMessageFits(sourceBytes.byteLength - 1, PRIVATE_BUN_SOURCE_MESSAGE_BYTES)) {
    throw new CheckError(
      'invalid',
      'PACKAGE_BUN_INPUT_LIMIT',
      'locked Bun package is too large to prepare',
    )
  }
  await recoverPrivateBunPreparationOwner(input)
  const now = Date.now()
  const parent = await preparationOwnerParent(input.projectRoot)
  const allocation = await planPrivateExecutionOwnerStateAllocation(backend, {
    parent,
    name: `prep-${input.captured.digest.slice('sha256:'.length, 'sha256:'.length + 48)}`,
  })
  const plan = preparationPlan(
    backend,
    installedSupport,
    allocation,
    classification.state === 'unlocked',
    now,
    input.deadlineUnixMs,
  )
  let fact = await replacePrivateBunPreparationOwner({
    projectRoot: input.projectRoot,
    coordinator: input.coordinator,
    expectedDigest: null,
    value: checkpointValue({ allocation }),
  })
  if (fact === null) throw new Error('Bun preparation allocation was not retained')
  let terminal: PrivatePreparedBunPackage | CheckError | undefined
  let component: PrivateExecutionComponentProcess | undefined

  try {
    const sealed = await sealPrivateExecutionOwner(backend, plan, allocation)
    fact = await requireFact(
      replacePrivateBunPreparationOwner({
        projectRoot: input.projectRoot,
        coordinator: input.coordinator,
        expectedDigest: fact.digest,
        value: checkpointValue({ allocation, owner: sealed.identity }),
      }),
    )
    component = await admitPrivateExecutionOwner(sealed, input.signal)
    const interaction = await interact(component, sourceBytes, input)
    terminal = interaction.terminal
    fact = await requireFact(
      replacePrivateBunPreparationOwner({
        projectRoot: input.projectRoot,
        coordinator: input.coordinator,
        expectedDigest: fact.digest,
        value: checkpointValue({
          allocation,
          owner: sealed.identity,
          fence: interaction.fence,
        }),
      }),
    )
    await releasePrivateExecutionOwnerState(sealed.identity, interaction.fence)
    await replacePrivateBunPreparationOwner({
      projectRoot: input.projectRoot,
      coordinator: input.coordinator,
      expectedDigest: fact.digest,
      value: null,
    })
    if (terminal instanceof CheckError) throw terminal
    return terminal
  } catch (error) {
    if (!(terminal instanceof CheckError)) await terminal?.captured.dispose().catch(() => undefined)
    await component?.terminate().catch(() => undefined)
    try {
      await recoverPrivateBunPreparationOwner(input)
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'Bun preparation and cleanup did not both complete',
      )
    }
    throw error
  }
}

async function interact(
  component: PrivateExecutionComponentProcess,
  sourceBytes: Uint8Array,
  input: {
    readonly captured: CapturedPackage
    readonly workspace?: { readonly target: string; readonly selected: readonly string[] }
  },
): Promise<{
  readonly terminal: PrivatePreparedBunPackage | CheckError
  readonly fence: PrivateExecutionConfirmedEnforcementReceipt
}> {
  let terminal: PrivatePreparedBunPackage | CheckError | undefined
  const stderr = collectBounded(component.stderr, 64 * 1024)
  try {
    await component.write(sourceBytes)
    await component.closeInput()
    for await (const value of jsonLines(component.stdout, PRIVATE_BUN_PREPARED_MESSAGE_BYTES)) {
      const message = ordinaryRecord(value, 'preparation message')
      if (message.type === 'prepared') {
        if (
          terminal !== undefined ||
          !Array.isArray(message.files) ||
          Reflect.ownKeys(message).length !== 3
        )
          throw protocolFailure()
        terminal = await decodePrivateBunPreparedResult(message.files, message.layout, input)
      } else if (message.type === 'failure') {
        if (
          terminal !== undefined ||
          typeof message.code !== 'string' ||
          !WORKER_FAILURE_CODES.has(message.code) ||
          typeof message.message !== 'string'
        ) {
          throw protocolFailure()
        }
        let location: { path: string; pointer: string } | undefined
        if (message.location !== undefined) {
          const value = ordinaryRecord(message.location, 'preparation diagnostic location')
          if (
            message.code !== 'PACKAGE_BUN_LOCK_STALE' ||
            Reflect.ownKeys(value).length !== 2 ||
            typeof value.path !== 'string' ||
            !(value.path === 'package.json' || value.path.endsWith('/package.json')) ||
            !input.captured.files.some((file) => file.path === value.path) ||
            typeof value.pointer !== 'string' ||
            ![
              '',
              '/name',
              '/version',
              '/dependencies',
              '/devDependencies',
              '/optionalDependencies',
              '/peerDependencies',
            ].includes(value.pointer)
          )
            throw protocolFailure()
          location = { path: value.path, pointer: value.pointer }
        }
        terminal = new CheckError(
          message.code === 'PACKAGE_BUN_SOURCE_UNSUPPORTED' ||
            message.code === 'PACKAGE_BUN_RESOLVED_SOURCE_UNSUPPORTED' ||
            message.code === 'PACKAGE_BUN_RESOLUTION_FAILED' ||
            message.code === 'PACKAGE_BUN_RESOLUTION_VERSION_UNAVAILABLE' ||
            message.code === 'PACKAGE_BUN_PREPARATION_FAILED' ||
            message.code === 'PACKAGE_BUN_OUTPUT_UNSUPPORTED'
            ? 'unavailable'
            : 'invalid',
          message.code,
          boundedMessage(message.message),
          location?.path ??
            (message.code.startsWith('PACKAGE_BUN_RESOL') ||
            message.code === 'PACKAGE_BUN_INPUT_LIMIT' ||
            message.code === 'PACKAGE_BUN_OUTPUT_LIMIT'
              ? 'package.json'
              : message.code.includes('LOCK') || message.code.includes('SOURCE_UNSUPPORTED')
                ? 'bun.lock'
                : undefined),
          location?.pointer,
        )
      } else {
        throw protocolFailure()
      }
    }
    const [fence] = await Promise.all([component.enforcement, stderr])
    if (
      terminal === undefined ||
      (!(terminal instanceof CheckError) && fence.exitCode !== 0) ||
      !fence.fenced
    ) {
      if (!(terminal instanceof CheckError)) await terminal?.captured.dispose()
      terminal = new CheckError(
        'unavailable',
        'PACKAGE_BUN_PREPARATION_FAILED',
        'the locked production dependencies could not be prepared by the pinned Bun runtime',
      )
    }
    return Object.freeze({ terminal, fence })
  } catch (error) {
    if (!(terminal instanceof CheckError)) await terminal?.captured.dispose().catch(() => undefined)
    await component.terminate().catch(() => undefined)
    await stderr.catch(() => undefined)
    throw error
  }
}

/** Fence and release a preparation owner retained by a prior coordinator. */
export async function recoverPrivateBunPreparationOwner(input: {
  readonly projectRoot: string
  readonly coordinator: PrivateProjectCoordinator
  readonly backend: PrivateExecutionBackend
}): Promise<void> {
  let fact = await readPrivateBunPreparationOwner(input)
  if (fact === null) return
  const backend = requirePrivateExecutionBackend(input.backend)
  let checkpoint = normalizeCheckpoint(fact.value)
  if (checkpoint.owner === undefined) {
    const cancellation = await cancelPrivateExecutionOwnerStateAllocation(checkpoint.allocation)
    await releasePrivateExecutionOwnerState(checkpoint.allocation, cancellation)
  } else {
    const owner = checkpoint.owner
    let fence = checkpoint.fence
    if (fence === undefined) {
      fence = await recoverPrivateExecutionFence(backend, owner)
      checkpoint = Object.freeze({ ...checkpoint, fence })
      fact = await requireFact(
        replacePrivateBunPreparationOwner({
          projectRoot: input.projectRoot,
          coordinator: input.coordinator,
          expectedDigest: fact.digest,
          value: checkpointValue(checkpoint),
        }),
      )
    }
    await releasePrivateExecutionOwnerState(owner, fence)
  }
  await replacePrivateBunPreparationOwner({
    projectRoot: input.projectRoot,
    coordinator: input.coordinator,
    expectedDigest: fact.digest,
    value: null,
  })
}

function preparationPlan(
  backend: PrivateExecutionBackend,
  support: PrivateInstalledBunSupport,
  allocation: PrivateExecutionOwnerStateAllocationIdentity,
  allowResolutionNetwork: boolean,
  now: number,
  requestedDeadlineUnixMs: number | undefined,
): PrivateExecutionLaunchPlan {
  const deadlineUnixMs = Math.min(
    now + PREPARATION_WALL_MS,
    requestedDeadlineUnixMs ?? Number.MAX_SAFE_INTEGER,
  )
  const limits = {
    memoryBytes: 512 * 1024 * 1024,
    pids: 64,
    cpuQuotaMicros: 100_000,
    cpuPeriodMicros: 100_000,
    deadlineUnixMs,
    cancellationGraceMs: 1_000,
    cleanupTimeoutMs: 5_000,
  } as const
  if (privateExecutionBackendKind(backend) === 'linux') {
    return Object.freeze({
      kind: 'linux',
      plan: Object.freeze({
        runId: `prep-${process.pid.toString(36)}-${now.toString(36)}`,
        limits,
        readOnlyMounts: [
          ...support.runtimeMounts,
          { source: '/etc/resolv.conf', destination: '/etc/resolv.conf' },
          {
            source: support.preparationWorkerPath,
            destination: support.sandboxPreparationWorkerPath,
          },
        ],
        command: [
          support.sandboxExecutablePath,
          ...BUN_POLICY,
          support.sandboxPreparationWorkerPath,
          ...(allowResolutionNetwork ? ['--allow-resolution-network'] : []),
        ] as readonly [string, ...string[]],
        network: 'inherited',
      }),
    })
  }
  if (allocation.kind !== 'private-macos-owner-state-allocation/1')
    throw new TypeError('native preparation requires a native owner allocation')
  const data = join(allocation.directory, 'data')
  return Object.freeze({
    kind: 'macos',
    plan: Object.freeze({
      runId: `prep-${process.pid.toString(36)}-${now.toString(36)}`,
      limits: {
        memoryBytes: limits.memoryBytes,
        pids: limits.pids,
        cpuQuotaMicros: limits.cpuQuotaMicros,
        cpuPeriodMicros: limits.cpuPeriodMicros,
        deadlineUnixMs,
        cleanupTimeoutMs: limits.cleanupTimeoutMs,
      },
      command: [
        support.executablePath,
        ...BUN_POLICY,
        support.preparationWorkerPath,
        ...(allowResolutionNetwork ? ['--allow-resolution-network'] : []),
      ] as readonly [string, ...string[]],
      cwd: join(data, 'work'),
      environment: { TMPDIR: join(data, 'tmp') },
      files: {
        readOnlyFiles: [support.executablePath, support.preparationWorkerPath],
        readOnlyTrees: [],
        writableTrees: [join(data, 'work'), join(data, 'tmp')],
        protectedRoots: [join(allocation.directory, 'control')],
        network: 'inherited' as const,
      },
      maxOutputBytes: PRIVATE_BUN_PREPARED_MESSAGE_BYTES,
      storage: {
        mountPath: data,
        bytes: 512 * 1024 * 1024,
        collect: null,
      },
    }),
  })
}

interface PreparationCheckpoint {
  readonly allocation: PrivateExecutionOwnerStateAllocationIdentity
  readonly owner?: PrivateExecutionSealedOwnerIdentity
  readonly fence?: PrivateExecutionConfirmedEnforcementReceipt
}

function checkpointValue(checkpoint: PreparationCheckpoint): JsonValue {
  return Object.freeze({
    kind: 'private-bun-preparation-owner/1',
    allocation: checkpoint.allocation,
    ...(checkpoint.owner === undefined ? {} : { owner: checkpoint.owner }),
    ...(checkpoint.fence === undefined ? {} : { fence: checkpoint.fence }),
  }) as unknown as JsonValue
}

function normalizeCheckpoint(value: JsonValue): PreparationCheckpoint {
  const record = ordinaryRecord(value, 'Bun preparation owner')
  const keys = Object.keys(record).sort().join('\0')
  const allocation = normalizePrivateExecutionOwnerStateAllocationIdentity(record.allocation)
  if (record.kind !== 'private-bun-preparation-owner/1')
    throw new TypeError('Bun preparation owner is invalid')
  if (keys === 'allocation\0kind') return Object.freeze({ allocation })
  if (keys !== 'allocation\0fence\0kind\0owner' && keys !== 'allocation\0kind\0owner') {
    throw new TypeError('Bun preparation owner is invalid')
  }
  const owner = normalizePrivateExecutionSealedOwnerIdentity(record.owner)
  if (
    privateExecutionOwnerAllocationDigest(owner) !== allocation.digest ||
    (owner.kind.includes('-linux-') ? 'linux' : 'macos') !==
      (allocation.kind.includes('-linux-') ? 'linux' : 'macos')
  ) {
    throw new TypeError('Bun preparation owner does not match its allocation')
  }
  if (keys === 'allocation\0kind\0owner') return Object.freeze({ allocation, owner })
  const fence = normalizePrivateExecutionConfirmedEnforcementReceipt(record.fence)
  const expectedOwnerDigest = privateExecutionPreparedOwnerDigest(owner)
  if (fence.ownerDigest !== expectedOwnerDigest) {
    throw new TypeError('Bun preparation fence does not match its owner')
  }
  return Object.freeze({ allocation, owner, fence })
}

async function preparationOwnerParent(projectRoot: string): Promise<string> {
  const state = await realpath(join(projectRoot, '.jig'))
  const parent = join(state, 'private-preparation-owners')
  await mkdir(parent, { mode: 0o700 }).catch((error) => {
    if (!hasCode(error, 'EEXIST')) throw error
  })
  const information = await lstat(parent)
  const uid = typeof process.getuid === 'function' ? process.getuid() : -1
  if (
    !information.isDirectory() ||
    information.isSymbolicLink() ||
    information.uid !== uid ||
    (information.mode & 0o077) !== 0 ||
    (await realpath(parent)) !== parent
  ) {
    throw new Error('private Bun preparation owner directory is not protected')
  }
  return parent
}

async function requireFact(
  promise: Promise<PrivateBunPreparationOwnerFact | null>,
): Promise<PrivateBunPreparationOwnerFact> {
  const fact = await promise
  if (fact === null) throw new Error('Bun preparation cleanup owner was not retained')
  return fact
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === code
  )
}

async function sourceMessage(
  captured: CapturedPackage,
): Promise<Readonly<Record<string, unknown>>> {
  if (captured.files.length > PRIVATE_BUN_PREPARATION_LIMITS.sourceFiles) {
    throw new CheckError(
      'invalid',
      'PACKAGE_BUN_INPUT_LIMIT',
      'locked Bun package has too many files',
    )
  }
  const files: { readonly path: string; readonly content: string }[] = []
  let total = 0
  for (const file of captured.files) {
    total += file.size
    if (total > PRIVATE_BUN_PREPARATION_LIMITS.sourceBytes) {
      throw new CheckError(
        'invalid',
        'PACKAGE_BUN_INPUT_LIMIT',
        'locked Bun package is too large to prepare',
      )
    }
    files.push(
      Object.freeze({
        path: file.path,
        content: Buffer.from(
          await captured.read(file.path, PRIVATE_BUN_PREPARATION_LIMITS.sourceBytes),
        ).toString('base64'),
      }),
    )
  }
  return Object.freeze({ type: 'source', files: Object.freeze(files) })
}

export async function decodePrivateBunPreparedResult(
  value: readonly unknown[],
  rawLayout: unknown,
  input: {
    readonly captured: CapturedPackage
    readonly workspace?: { readonly target: string; readonly selected: readonly string[] }
  },
): Promise<PrivatePreparedBunPackage> {
  let layout: PrivateBunExecutionLayout
  try {
    layout = normalizePrivateBunExecutionLayout(rawLayout)
  } catch {
    throw protocolFailure()
  }
  const selected = [...(input.workspace?.selected ?? [])].sort(comparePathBytes)
  if (
    layout.flowRoot !== (input.workspace?.target ?? '') ||
    JSON.stringify(layout.members) !== JSON.stringify(selected)
  )
    throw protocolFailure()
  if (value.length + layout.aliases.length > PRIVATE_BUN_PREPARATION_LIMITS.preparedFiles)
    throw protocolFailure()
  const contents = new Map<string, Uint8Array>()
  const files: CapturedFile[] = []
  let total = Buffer.byteLength(JSON.stringify(layout))
  let prior: string | undefined
  for (const raw of value) {
    const record = ordinaryRecord(raw, 'prepared file')
    if (
      typeof record.path !== 'string' ||
      typeof record.content !== 'string' ||
      Reflect.ownKeys(record).length !== 2
    )
      throw protocolFailure()
    validateLogicalPath(record.path)
    if (prior !== undefined && comparePathBytes(prior, record.path) >= 0) {
      throw protocolFailure()
    }
    prior = record.path
    const bytes = decodeBase64(record.content, record.path)
    total += bytes.byteLength
    if (total > PRIVATE_BUN_PREPARATION_LIMITS.preparedBytes) throw protocolFailure()
    contents.set(record.path, bytes)
    files.push(Object.freeze({ path: record.path, size: bytes.byteLength }))
  }
  assertNoPathCollisions(files.map(({ path }) => path))
  try {
    assertPrivateBunExecutionLayoutFiles(layout, files)
  } catch {
    throw protocolFailure()
  }
  const patchPaths = new Set(
    input.workspace === undefined
      ? []
      : Object.values(
          requirePrivateBunPatches(
            JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(
                await input.captured.read('package.json', 1024 * 1024),
              ),
            ).patchedDependencies,
          ),
        ),
  )
  const retainedSource = input.captured.files.filter(
    ({ path }) =>
      input.workspace === undefined ||
      path === 'package.json' ||
      path === 'bun.lock' ||
      patchPaths.has(path) ||
      selected.some((member) => path.startsWith(`${member}/`)),
  )
  const sourcePaths = new Set(retainedSource.map(({ path }) => path))
  for (const file of retainedSource) {
    const actual = contents.get(file.path)
    if (
      actual === undefined ||
      !Buffer.from(actual).equals(Buffer.from(await input.captured.read(file.path)))
    )
      throw protocolFailure()
  }
  for (const file of files) {
    if (
      !sourcePaths.has(file.path) &&
      file.path !== 'bun.lock' &&
      !file.path.split('/').includes('node_modules')
    )
      throw protocolFailure()
  }
  for (const alias of layout.aliases) {
    const bytes = contents.get(`${alias.target}/package.json`)
    let manifest: Record<string, unknown>
    try {
      manifest = ordinaryRecord(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        'workspace manifest',
      )
    } catch {
      throw protocolFailure()
    }
    if (manifest.name !== privateBunAliasPackageName(alias.path)) throw protocolFailure()
  }
  const frozenFiles = Object.freeze(files)
  const backing: CapturedPackageBacking = {
    stream(path: string): AsyncIterable<Uint8Array> {
      const bytes = contents.get(path)
      if (bytes === undefined) throw protocolFailure()
      return (async function* (): AsyncGenerator<Uint8Array> {
        yield bytes
      })()
    },
    async dispose(): Promise<void> {
      contents.clear()
    },
  }
  const digest = await packageDigest(frozenFiles, (file) => backing.stream(file.path))
  return Object.freeze({
    captured: createCapturedPackage('prepared Bun dependency tree', frozenFiles, digest, backing),
    layout,
  })
}

async function* jsonLines(
  source: AsyncIterable<Uint8Array>,
  maximum: number,
): AsyncGenerator<unknown> {
  let pending: Buffer[] = []
  let pendingBytes = 0
  for await (const chunk of source) {
    const bytes = Buffer.from(chunk)
    let start = 0
    for (;;) {
      const end = bytes.indexOf(0x0a, start)
      if (end === -1) break
      pending.push(bytes.subarray(start, end))
      pendingBytes += end - start
      if (pendingBytes > maximum) throw protocolFailure()
      const line = pending.length === 1 ? pending[0]! : Buffer.concat(pending, pendingBytes)
      pending = []
      pendingBytes = 0
      try {
        yield JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line))
      } catch {
        throw protocolFailure()
      }
      start = end + 1
    }
    if (start < bytes.byteLength) {
      pending.push(bytes.subarray(start))
      pendingBytes += bytes.byteLength - start
      if (pendingBytes > maximum) throw protocolFailure()
    }
  }
  if (pendingBytes !== 0) throw protocolFailure()
}

function ordinaryRecord(value: unknown, label: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new CheckError('unavailable', 'PACKAGE_BUN_PROTOCOL', `${label} is invalid`)
  }
  return value as Record<string, unknown>
}

function decodeBase64(value: string, label: string): Uint8Array {
  const maximum = 4 * Math.ceil(PRIVATE_BUN_PREPARATION_LIMITS.preparedBytes / 3)
  if (value.length > maximum) {
    throw new CheckError('unavailable', 'PACKAGE_BUN_PROTOCOL', `${label} bytes are invalid`)
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) {
    throw new CheckError('unavailable', 'PACKAGE_BUN_PROTOCOL', `${label} bytes are invalid`)
  }
  return bytes
}

function protocolFailure(): CheckError {
  return new CheckError(
    'unavailable',
    'PACKAGE_BUN_PROTOCOL',
    'the Bun preparation worker protocol failed',
  )
}

function boundedMessage(value: string): string {
  const result = [...value].slice(0, 1_024).join('')
  return result.length === 0 ? 'Bun dependency preparation failed' : result
}

async function collectBounded(source: AsyncIterable<Uint8Array>, maximum: number): Promise<void> {
  let total = 0
  for await (const chunk of source) {
    total += chunk.byteLength
    if (total > maximum) throw protocolFailure()
  }
}
