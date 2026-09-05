import { lstat, mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { CheckError } from '../diagnostics.js'
import type { JsonValue } from '../json.js'
import {
  createCapturedPackage,
  type CapturedFile,
  type CapturedPackage,
  type CapturedPackageBacking,
} from '../package/capture.js'
import { packageDigest } from '../package/digest.js'
import { assertNoPathCollisions, comparePathBytes, validateLogicalPath } from '../package/paths.js'
import { inspectPrivateBunPackageInput } from './bun-package-input.js'
import {
  readPrivateBunPreparationOwner,
  replacePrivateBunPreparationOwner,
  type PrivateBunPreparationOwnerFact,
  type PrivateProjectCoordinator,
} from './activation-admission-store.js'
import { privateDomainDigest } from './identity.js'
import {
  PRIVATE_BUN_PREPARATION_LIMITS,
  PRIVATE_BUN_PREPARED_MESSAGE_BYTES,
  PRIVATE_BUN_SOURCE_MESSAGE_BYTES,
  encodePrivateBunMessage,
  privateBunMessageFits,
} from './bun-native-preparation-protocol.js'
import {
  requirePrivateInstalledBunSupport,
  revalidatePrivateInstalledBunSupport,
  type PrivateInstalledBunSupport,
} from './installed-bun-support.js'
import {
  requirePrivateLinuxCgroupBackend,
  cancelPrivateLinuxOwnerStateAllocation,
  normalizePrivateLinuxConfirmedEnforcementReceipt,
  normalizePrivateLinuxOwnerStateAllocationIdentity,
  normalizePrivateLinuxSealedOwnerIdentity,
  planPrivateLinuxOwnerStateAllocation,
  releasePrivateLinuxOwnerState,
  type PrivateLinuxCgroupBackend,
  type PrivateLinuxComponentProcess,
  type PrivateLinuxConfirmedEnforcementReceipt,
  type PrivateLinuxOwnerStateAllocationIdentity,
  type PrivateLinuxSealedOwnerIdentity,
} from './linux-rootless-backend.js'

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
])

/**
 * Prepare one locked Bun package in the same rootless envelope used by Runs.
 *
 * Only the fixed, script-disabled Bun installer inherits network access.
 * Authored Flow code is never executed and normal Runs remain network-isolated.
 */
export async function preparePrivateBunPackage(input: {
  readonly captured: CapturedPackage
  readonly installedSupport: PrivateInstalledBunSupport
  readonly backend: PrivateLinuxCgroupBackend
  readonly projectRoot: string
  readonly coordinator: PrivateProjectCoordinator
  readonly deadlineUnixMs?: number
  readonly signal?: AbortSignal
}): Promise<CapturedPackage> {
  const classification = await inspectPrivateBunPackageInput(input.captured)
  if (classification.state !== 'locked') {
    throw new TypeError('Bun dependency preparation requires package.json and bun.lock')
  }
  const installedSupport = requirePrivateInstalledBunSupport(input.installedSupport)
  await revalidatePrivateInstalledBunSupport(installedSupport)
  const backend = requirePrivateLinuxCgroupBackend(input.backend)
  const source = await sourceMessage(input.captured)
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
  const plan = {
    runId: `prep-${process.pid.toString(36)}-${now.toString(36)}`,
    limits: {
      memoryBytes: 512 * 1024 * 1024,
      pids: 64,
      cpuQuotaMicros: 100_000,
      cpuPeriodMicros: 100_000,
      deadlineUnixMs: Math.min(
        now + PREPARATION_WALL_MS,
        input.deadlineUnixMs ?? Number.MAX_SAFE_INTEGER,
      ),
      cancellationGraceMs: 1_000,
      cleanupTimeoutMs: 5_000,
    },
    readOnlyMounts: [
      ...installedSupport.runtimeMounts,
      { source: '/etc/resolv.conf', destination: '/etc/resolv.conf' },
      {
        source: installedSupport.preparationWorkerPath,
        destination: installedSupport.sandboxPreparationWorkerPath,
      },
    ],
    command: [
      installedSupport.sandboxExecutablePath,
      ...BUN_POLICY,
      installedSupport.sandboxPreparationWorkerPath,
    ],
    network: 'inherited',
  } as const
  const parent = await preparationOwnerParent(input.projectRoot)
  const allocation = await planPrivateLinuxOwnerStateAllocation({
    parent,
    name: `prep-${input.captured.digest.slice('sha256:'.length, 'sha256:'.length + 48)}`,
  })
  let fact = await replacePrivateBunPreparationOwner({
    projectRoot: input.projectRoot,
    coordinator: input.coordinator,
    expectedDigest: null,
    value: checkpointValue({ allocation }),
  })
  if (fact === null) throw new Error('Bun preparation allocation was not retained')
  let terminal: CapturedPackage | CheckError | undefined
  let component: PrivateLinuxComponentProcess | undefined

  try {
    const sealed = await backend.seal(plan, allocation)
    fact = await requireFact(
      replacePrivateBunPreparationOwner({
        projectRoot: input.projectRoot,
        coordinator: input.coordinator,
        expectedDigest: fact.digest,
        value: checkpointValue({ allocation, owner: sealed.identity }),
      }),
    )
    component = await sealed.admit(input.signal)
    const interaction = await interact(component, sourceBytes)
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
    await releasePrivateLinuxOwnerState(sealed.identity, interaction.fence)
    await replacePrivateBunPreparationOwner({
      projectRoot: input.projectRoot,
      coordinator: input.coordinator,
      expectedDigest: fact.digest,
      value: null,
    })
    if (terminal instanceof CheckError) throw terminal
    return terminal
  } catch (error) {
    if (!(terminal instanceof CheckError)) await terminal?.dispose().catch(() => undefined)
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
  component: PrivateLinuxComponentProcess,
  sourceBytes: Uint8Array,
): Promise<{
  readonly terminal: CapturedPackage | CheckError
  readonly fence: PrivateLinuxConfirmedEnforcementReceipt
}> {
  let terminal: CapturedPackage | CheckError | undefined
  const stderr = collectBounded(component.stderr, 64 * 1024)
  try {
    await component.write(sourceBytes)
    await component.closeInput()
    for await (const value of jsonLines(component.stdout, PRIVATE_BUN_PREPARED_MESSAGE_BYTES)) {
      const message = ordinaryRecord(value, 'preparation message')
      if (message.type === 'prepared') {
        if (terminal !== undefined || !Array.isArray(message.files)) throw protocolFailure()
        terminal = await capturedFromPrepared(message.files)
      } else if (message.type === 'failure') {
        if (
          terminal !== undefined ||
          typeof message.code !== 'string' ||
          !WORKER_FAILURE_CODES.has(message.code) ||
          typeof message.message !== 'string'
        ) {
          throw protocolFailure()
        }
        terminal = new CheckError(
          message.code === 'PACKAGE_BUN_SOURCE_UNSUPPORTED' ||
            message.code === 'PACKAGE_BUN_PREPARATION_FAILED' ||
            message.code === 'PACKAGE_BUN_OUTPUT_UNSUPPORTED'
            ? 'unavailable'
            : 'invalid',
          message.code,
          boundedMessage(message.message),
          message.code.includes('LOCK') || message.code.includes('SOURCE_UNSUPPORTED')
            ? 'bun.lock'
            : undefined,
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
      if (!(terminal instanceof CheckError)) await terminal?.dispose()
      terminal = new CheckError(
        'unavailable',
        'PACKAGE_BUN_PREPARATION_FAILED',
        'the locked production dependencies could not be prepared by the pinned Bun runtime',
      )
    }
    return Object.freeze({ terminal, fence })
  } catch (error) {
    if (!(terminal instanceof CheckError)) await terminal?.dispose().catch(() => undefined)
    await component.terminate().catch(() => undefined)
    await stderr.catch(() => undefined)
    throw error
  }
}

/** Fence and release a preparation owner retained by a prior coordinator. */
export async function recoverPrivateBunPreparationOwner(input: {
  readonly projectRoot: string
  readonly coordinator: PrivateProjectCoordinator
  readonly backend: PrivateLinuxCgroupBackend
}): Promise<void> {
  let fact = await readPrivateBunPreparationOwner(input)
  if (fact === null) return
  const backend = requirePrivateLinuxCgroupBackend(input.backend)
  let checkpoint = normalizeCheckpoint(fact.value)
  if (checkpoint.owner === undefined) {
    const cancellation = await cancelPrivateLinuxOwnerStateAllocation(checkpoint.allocation)
    await releasePrivateLinuxOwnerState(checkpoint.allocation, cancellation)
  } else {
    let fence = checkpoint.fence
    if (fence === undefined) {
      fence = await backend.recoverFence(checkpoint.owner)
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
    await releasePrivateLinuxOwnerState(checkpoint.owner, fence)
  }
  await replacePrivateBunPreparationOwner({
    projectRoot: input.projectRoot,
    coordinator: input.coordinator,
    expectedDigest: fact.digest,
    value: null,
  })
}

interface PreparationCheckpoint {
  readonly allocation: PrivateLinuxOwnerStateAllocationIdentity
  readonly owner?: PrivateLinuxSealedOwnerIdentity
  readonly fence?: PrivateLinuxConfirmedEnforcementReceipt
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
  const allocation = normalizePrivateLinuxOwnerStateAllocationIdentity(record.allocation)
  if (record.kind !== 'private-bun-preparation-owner/1')
    throw new TypeError('Bun preparation owner is invalid')
  if (keys === 'allocation\0kind') return Object.freeze({ allocation })
  if (keys !== 'allocation\0fence\0kind\0owner' && keys !== 'allocation\0kind\0owner') {
    throw new TypeError('Bun preparation owner is invalid')
  }
  const owner = normalizePrivateLinuxSealedOwnerIdentity(record.owner)
  if (
    owner.ownerStateAllocationDigest !== allocation.digest ||
    owner.ownerStateParent !== allocation.parent ||
    owner.ownerStateName !== allocation.name ||
    owner.ownerStateDirectory !== allocation.directory ||
    owner.ownerToken !== allocation.ownerToken
  ) {
    throw new TypeError('Bun preparation owner does not match its allocation')
  }
  if (keys === 'allocation\0kind\0owner') return Object.freeze({ allocation, owner })
  const fence = normalizePrivateLinuxConfirmedEnforcementReceipt(record.fence)
  const expectedOwnerDigest = privateDomainDigest(
    'JIG-Rootless-Linux-Prepared-Owner/1',
    owner as unknown as JsonValue,
  )
  if (fence.ownerDigest !== expectedOwnerDigest) {
    throw new TypeError('Bun preparation fence does not match its owner')
  }
  return Object.freeze({ allocation, owner, fence })
}

async function preparationOwnerParent(projectRoot: string): Promise<string> {
  const state = await realpath(join(projectRoot, '.jig'))
  const parent = join(state, 'private-preparation-linux-owners')
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

async function capturedFromPrepared(value: readonly unknown[]): Promise<CapturedPackage> {
  if (value.length > PRIVATE_BUN_PREPARATION_LIMITS.preparedFiles) throw protocolFailure()
  const contents = new Map<string, Uint8Array>()
  const files: CapturedFile[] = []
  let total = 0
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
  return createCapturedPackage('prepared Bun dependency tree', frozenFiles, digest, backing)
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
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new CheckError('unavailable', 'PACKAGE_BUN_PROTOCOL', `${label} bytes are invalid`)
  }
  return new Uint8Array(Buffer.from(value, 'base64'))
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
