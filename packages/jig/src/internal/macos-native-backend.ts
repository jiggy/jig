import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, realpath, rmdir } from 'node:fs/promises'
import { constants as osConstants, release as osRelease } from 'node:os'
import { join, posix } from 'node:path'
import { canonicalJson, type JsonObject, type JsonValue } from '../json.js'
import type { ExactComponentExit, ExactComponentProcess } from '../run/session.js'
import { privateDomainDigest } from './identity.js'
import { type PrivateCapturedInput, requirePrivateCapturedInput } from './input-capture.js'
import { privateInstallationFileDigest } from './installation-verification.js'
import {
  cancelPrivateMacosOwnerStateAllocation,
  normalizePrivateMacosOwnerStateAllocationIdentity,
  openPrivateMacosBackendState,
  type PrivateMacosOwnerStateAllocationIdentity,
  planPrivateMacosOwnerStateAllocation,
  releasePrivateMacosOwnerState,
} from './macos-backend-state.js'
import {
  type PrivateMacosGuardian,
  type PrivateMacosGuardianCapturedInput,
  type PrivateMacosGuardianResult,
  preparePrivateMacosGuardian,
  recoverPrivateMacosGuardian,
  releasePrivateMacosGuardian,
} from './macos-guardian-client.js'
import { retainPrivateMacosGuardianOutput } from './macos-guardian-output.js'
import {
  type PrivateMacosGuardianStorage,
  requirePrivateMacosGuardianStorage,
} from './macos-guardian-storage.js'
import type { PrivateMacosGuardianStart } from './macos-native-supervisor.js'
import { PRIVATE_MACOS_MAX_OUTPUT_BYTES } from './macos-output-policy.js'
import { privateMacosCurrentProcessIdentity } from './macos-process-controls.js'
import {
  type PrivateMacosSandboxFiles,
  privateMacosSandboxProfile,
} from './macos-sandbox-profile.js'
import {
  normalizePrivateMacosScopeResult,
  type PrivateMacosScopeLimits,
  type PrivateMacosScopeResult,
  type PrivateMacosStopReason,
  requirePrivateMacosScopeLimits,
} from './macos-scope-execution.js'

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
const ENVIRONMENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const authenticBackends = new WeakSet<object>()
const authenticSealedOwners = new WeakMap<object, SealedData>()

export interface PrivateMacosBackendOptions {
  readonly bunPath: string
  readonly supervisorPath: string
  readonly launcherPath: string
}
export interface PrivateMacosBackendMechanismSupport {
  readonly kind: 'macos-supervised-seatbelt-mechanism/1'
  readonly digest: string
  readonly platform: 'darwin-x64-23.4.0-23E224'
  readonly trustedBunPath: string
  readonly trustedBunDigest: string
  readonly trustedSupervisorPath: string
  readonly trustedSupervisorDigest: string
  readonly trustedLauncherPath: string
  readonly trustedLauncherDigest: string
  readonly resourceAccounting: 'supervised-sampled-with-termination'
  readonly resourceOvershoot: true
}
export interface PrivateMacosBackendMechanismObservation {
  readonly support: PrivateMacosBackendMechanismSupport
}
export interface PrivateMacosCapturedInput {
  readonly input: PrivateCapturedInput
  readonly path: string
}
export interface PrivateMacosLaunchPlan {
  readonly runId: string
  readonly limits: PrivateMacosScopeLimits
  readonly command: readonly [string, ...string[]]
  readonly cwd: string
  readonly environment?: Readonly<Record<string, string>>
  readonly files: PrivateMacosSandboxFiles
  readonly maxOutputBytes: number
  readonly storage?: PrivateMacosGuardianStorage
  readonly capturedInputs?: readonly PrivateMacosCapturedInput[]
}
interface SealedInput {
  readonly path: string
  readonly bytes: number
  readonly digest: string
}
interface SealedImmutablePath {
  readonly path: string
  readonly device: string
  readonly inode: string
  readonly type: 'file' | 'directory'
}
interface SealedPlan extends Omit<PrivateMacosLaunchPlan, 'capturedInputs' | 'environment'> {
  readonly environment: Readonly<Record<string, string>>
  readonly capturedInputs: readonly SealedInput[]
  readonly immutablePaths: readonly SealedImmutablePath[]
}
export interface PrivateMacosSealedOwnerIdentity {
  readonly kind: 'private-macos-sealed-owner/1'
  readonly digest: string
  readonly runId: string
  readonly nonce: string
  readonly mechanismDigest: string
  readonly sealedPlanDigest: string
  readonly allocation: PrivateMacosOwnerStateAllocationIdentity
}
export interface PrivateMacosPreparedOwnerIdentity {
  readonly kind: 'private-macos-prepared-owner/1'
  readonly digest: string
  readonly owner: PrivateMacosSealedOwnerIdentity
}
export interface PrivateMacosConfirmedEnforcementReceipt {
  readonly kind: 'private-macos-confirmed-enforcement/1'
  readonly ownerDigest: string
  readonly stopReason: PrivateMacosStopReason | 'recovered'
  readonly exitCode: number | null
  readonly signal: number | null
  readonly fenced: true
  readonly outputLost: boolean
  readonly recovered: boolean
  readonly evidence: PrivateMacosScopeResult['evidence']
}
export interface PrivateMacosEnvelopeIdentity {
  readonly kind: 'macos-supervised-seatbelt/1'
  readonly mechanismDigest: string
  readonly sealedPlanDigest: string
  readonly limits: PrivateMacosScopeLimits
  readonly resourceAccounting: 'supervised-sampled-with-termination'
  readonly resourceOvershoot: true
  readonly network: 'isolated' | 'inherited'
  readonly writableBytes: number | null
}
export interface PrivateMacosSealedOwner {
  readonly identity: PrivateMacosSealedOwnerIdentity
  admit(
    signal?: AbortSignal,
    beforeAdmission?: (prepared: PrivateMacosPreparedOwnerIdentity) => Promise<void>,
  ): Promise<PrivateMacosComponentProcess>
}
export type PrivateMacosComponentProcess = ExactComponentProcess & {
  readonly output?: ReturnType<typeof retainPrivateMacosGuardianOutput>['output']
  readonly owner: PrivateMacosPreparedOwnerIdentity
  readonly process: Readonly<{ pid: number; version: number }>
  readonly evidence: Promise<PrivateMacosScopeResult['evidence']>
  readonly terminationReason: Promise<PrivateMacosConfirmedEnforcementReceipt['stopReason']>
  readonly enforcement: Promise<PrivateMacosConfirmedEnforcementReceipt>
  readonly envelope: PrivateMacosEnvelopeIdentity
}

interface NormalizedOptions {
  readonly bunPath: string
  readonly supervisorPath: string
  readonly launcherPath: string
}
interface SealedData {
  readonly backend: PrivateMacosBackend
  readonly sourcePlan: PrivateMacosLaunchPlan
  readonly sealedPlan: SealedPlan
  readonly mechanism: PrivateMacosBackendMechanismObservation
  readonly identity: PrivateMacosSealedOwnerIdentity
  readonly prepared: PrivateMacosPreparedOwnerIdentity
}

export class PrivateMacosFenceUnconfirmedError extends Error {
  override readonly cause: unknown
  constructor(cause: unknown) {
    super('native macOS launch failed without a confirmed ownership fence')
    this.name = 'PrivateMacosFenceUnconfirmedError'
    this.cause = cause
  }
}

/** One qualified private Mac implementation; this is not a public Backend SPI. */
export class PrivateMacosBackend {
  readonly #options: NormalizedOptions
  constructor(options: PrivateMacosBackendOptions) {
    this.#options = Object.freeze({
      bunPath: absolute(options.bunPath, 'Bun'),
      supervisorPath: absolute(options.supervisorPath, 'supervisor'),
      launcherPath: absolute(options.launcherPath, 'launcher'),
    })
    authenticBackends.add(this)
    Object.freeze(this)
  }

  async inspectSupport(): Promise<PrivateMacosBackendMechanismSupport> {
    requirePrivateMacosBackend(this)
    return observeSupport(this.#options)
  }

  async observeMechanism(): Promise<PrivateMacosBackendMechanismObservation> {
    requirePrivateMacosBackend(this)
    return Object.freeze({ support: await observeSupport(this.#options) })
  }

  async seal(
    plan: PrivateMacosLaunchPlan,
    ownerState: PrivateMacosOwnerStateAllocationIdentity,
  ): Promise<PrivateMacosSealedOwner> {
    requirePrivateMacosBackend(this)
    const allocation = normalizePrivateMacosOwnerStateAllocationIdentity(ownerState)
    const [mechanism, sealedPlan] = await Promise.all([
      this.observeMechanism(),
      sealPlan(plan, allocation),
    ])
    const sealedPlanDigest = privateDomainDigest('JIG-Macos-Sealed-Plan/1', {
      mechanismDigest: mechanism.support.digest,
      plan: sealedPlan as unknown as JsonValue,
    })
    const fields = {
      kind: 'private-macos-sealed-owner/1' as const,
      runId: sealedPlan.runId,
      nonce: randomBytes(12).toString('hex'),
      mechanismDigest: mechanism.support.digest,
      sealedPlanDigest,
      allocation,
    }
    const identity = normalizePrivateMacosSealedOwnerIdentity({
      ...fields,
      digest: privateDomainDigest('JIG-Macos-Sealed-Owner/1', fields as unknown as JsonValue),
    })
    const state = await openPrivateMacosBackendState(allocation)
    try {
      await state.seal(identity as unknown as JsonObject)
    } finally {
      await state.close()
    }
    const prepared = preparedFor(identity)
    let admitted = false
    const sealed = Object.freeze({
      identity,
      admit: async (
        signal?: AbortSignal,
        beforeAdmission?: (prepared: PrivateMacosPreparedOwnerIdentity) => Promise<void>,
      ) => {
        if (admitted) throw new TypeError('sealed native macOS owner was already admitted')
        admitted = true
        return this.#launch(plan, sealed, signal, beforeAdmission)
      },
    })
    authenticSealedOwners.set(
      sealed,
      Object.freeze({
        backend: this,
        sourcePlan: plan,
        sealedPlan,
        mechanism,
        identity,
        prepared,
      }),
    )
    return sealed
  }

  async launch(
    planFor: (allocation: PrivateMacosOwnerStateAllocationIdentity) => PrivateMacosLaunchPlan,
    signal?: AbortSignal,
  ): Promise<PrivateMacosComponentProcess> {
    requirePrivateMacosBackend(this)
    const parent = await realpath(await mkdtemp('/private/tmp/jig-native-owner-'))
    const allocation = await planPrivateMacosOwnerStateAllocation({
      parent,
      name: `owner-${randomBytes(12).toString('hex')}`,
    })
    let sealed: PrivateMacosSealedOwner | undefined
    try {
      const plan = planFor(allocation)
      sealed = await this.seal(plan, allocation)
      const component = await sealed.admit(signal)
      const enforcement = component.enforcement
        .then(async (receipt) => {
          await releasePrivateMacosOwnerState(sealed!.identity.allocation, receipt as never)
          await rmdir(parent)
          return receipt
        })
        .catch((error): never => {
          throw new PrivateMacosFenceUnconfirmedError(error)
        })
      return Object.freeze({
        ...component,
        enforcement,
        evidence: enforcement.then((receipt) => receipt.evidence),
        terminationReason: enforcement.then((receipt) => receipt.stopReason),
        completion: enforcement.then((receipt) =>
          Object.freeze({
            exitCode: receipt.exitCode,
            signal: signalName(receipt.signal),
            fenced: true,
            stopReason: commonStopReason(receipt.stopReason),
          }),
        ),
        async terminate() {
          await component.terminate()
          await enforcement
        },
      })
    } catch (error) {
      try {
        if (sealed === undefined) {
          const cancelled = await cancelPrivateMacosOwnerStateAllocation(allocation)
          await releasePrivateMacosOwnerState(allocation, cancelled)
        } else {
          const receipt = await this.recoverFence(sealed.identity)
          await releasePrivateMacosOwnerState(sealed.identity.allocation, receipt as never)
        }
        await rmdir(parent)
      } catch (cleanupError) {
        throw new PrivateMacosFenceUnconfirmedError(
          new AggregateError(
            [error, cleanupError],
            `native macOS automatic owner cleanup failed (${errorText(error)}; ${errorText(cleanupError)})`,
          ),
        )
      }
      throw error
    }
  }

  async recoverFence(value: unknown): Promise<PrivateMacosConfirmedEnforcementReceipt> {
    requirePrivateMacosBackend(this)
    const owner = isPrepared(value)
      ? normalizePrivateMacosPreparedOwnerIdentity(value).owner
      : normalizePrivateMacosSealedOwnerIdentity(value)
    const state = await openPrivateMacosBackendState(owner.allocation)
    try {
      const current = await state.read()
      if (!sameJson(current.sealed, owner))
        throw new Error('native macOS sealed owner state changed')
      if (current.phase === 'finished') return requireReceiptFor(owner, current.final)
      if (!['sealed', 'active'].includes(current.phase))
        throw new PrivateMacosFenceUnconfirmedError(
          new Error('native macOS owner has no recoverable execution'),
        )
      if (await exists(state.guardianDirectory)) {
        const mechanism = await this.observeMechanism()
        if (mechanism.support.digest !== owner.mechanismDigest)
          throw new Error('native macOS recovery mechanism changed')
        await recoverPrivateMacosGuardian(
          state.guardianDirectory,
          owner.allocation.ownerToken,
          5000,
          { bun: this.#options.bunPath, supervisor: this.#options.supervisorPath },
        )
        await releasePrivateMacosGuardian(state.guardianDirectory, owner.allocation.ownerToken)
      }
      await removeEmptyData(state.dataPath)
      const receipt = recoveredReceipt(preparedFor(owner))
      await state.recover(receipt as unknown as JsonObject)
      return receipt
    } catch (error) {
      if (error instanceof PrivateMacosFenceUnconfirmedError) throw error
      throw new PrivateMacosFenceUnconfirmedError(error)
    } finally {
      await state.close()
    }
  }

  async #launch(
    plan: PrivateMacosLaunchPlan,
    sealed: PrivateMacosSealedOwner,
    signal?: AbortSignal,
    beforeAdmission?: (prepared: PrivateMacosPreparedOwnerIdentity) => Promise<void>,
  ): Promise<PrivateMacosComponentProcess> {
    const data = requireSealed(sealed, this, plan)
    const state = await openPrivateMacosBackendState(data.identity.allocation)
    let guardian: PrivateMacosGuardian | undefined
    let active = false
    let componentReturned = false
    const cancel = () => guardian?.cancel()
    try {
      const current = await state.read()
      if (current.phase !== 'sealed') throw new Error('native macOS owner is not sealed for launch')
      if (!sameJson(current.sealed, data.identity))
        throw new Error('native macOS sealed owner state changed before launch')
      const mechanism = await this.observeMechanism()
      if (mechanism.support.digest !== data.mechanism.support.digest)
        throw new Error('native macOS mechanism changed after sealing')
      await revalidatePlan(data.sealedPlan)
      await mkdir(state.guardianDirectory, { mode: 0o700 })
      if (data.sealedPlan.storage !== undefined) await mkdir(state.dataPath, { mode: 0o700 })
      guardian = await preparePrivateMacosGuardian({
        bun: this.#options.bunPath,
        supervisor: this.#options.supervisorPath,
        configuration: guardianConfiguration(data, state),
        capturedInputs: guardianInputs(plan),
      })
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) throw new Error('native macOS Run was cancelled before admission')
      if (beforeAdmission !== undefined) await beforeAdmission(data.prepared)
      if (signal?.aborted) throw new Error('native macOS Run was cancelled before admission')
      await state.admit()
      active = true
      const processIdentity = await guardian.admit()
      if (signal?.aborted) guardian.cancel()
      else guardian.continue()
      const retained =
        data.sealedPlan.storage?.collect === 'output'
          ? retainPrivateMacosGuardianOutput(guardian)
          : undefined
      const terminal = retained?.completion ?? guardian.completion
      const enforcement = terminal
        .then(async (result) => {
          const receipt = receiptFor(data.prepared, result)
          await releasePrivateMacosGuardian(
            state.guardianDirectory,
            data.identity.allocation.ownerToken,
          )
          await removeEmptyData(state.dataPath)
          await state.finish(receipt as unknown as JsonObject)
          return receipt
        })
        .catch((error): never => {
          throw new PrivateMacosFenceUnconfirmedError(error)
        })
        .finally(async () => {
          signal?.removeEventListener('abort', cancel)
          await state.close()
        })
      const completion = enforcement.then(
        (receipt): ExactComponentExit =>
          Object.freeze({
            exitCode: receipt.exitCode,
            signal: signalName(receipt.signal),
            fenced: true,
            stopReason: commonStopReason(receipt.stopReason),
          }),
      )
      let inputClosed = false
      let terminationRequested = false
      componentReturned = true
      return Object.freeze({
        ...(retained === undefined ? {} : { output: retained.output }),
        owner: data.prepared,
        process: processIdentity,
        envelope: envelopeFor(data),
        stdout: guardian.stdout,
        stderr: guardian.stderr,
        completion,
        enforcement,
        evidence: enforcement.then((receipt) => receipt.evidence),
        terminationReason: enforcement.then((receipt) => receipt.stopReason),
        async write(bytes: Uint8Array) {
          if (inputClosed) throw new Error('native macOS Run input is closed')
          await writeBytes(guardian!.stdin, bytes)
        },
        async closeInput() {
          if (inputClosed) return
          inputClosed = true
          guardian!.stdin.end()
        },
        async terminate() {
          if (!terminationRequested) {
            terminationRequested = true
            guardian!.cancel()
          }
          await enforcement
        },
      })
    } catch (error) {
      signal?.removeEventListener('abort', cancel)
      try {
        if (guardian !== undefined) {
          guardian.cancel()
          await guardian.completion
          await releasePrivateMacosGuardian(
            state.guardianDirectory,
            data.identity.allocation.ownerToken,
          )
        } else if (await exists(state.guardianDirectory)) {
          await recoverPrivateMacosGuardian(
            state.guardianDirectory,
            data.identity.allocation.ownerToken,
            5000,
            { bun: this.#options.bunPath, supervisor: this.#options.supervisorPath },
          )
          await releasePrivateMacosGuardian(
            state.guardianDirectory,
            data.identity.allocation.ownerToken,
          )
        }
        await removeEmptyData(state.dataPath)
        const receipt = recoveredReceipt(data.prepared)
        await state.recover(receipt as unknown as JsonObject)
      } catch (fenceError) {
        throw new PrivateMacosFenceUnconfirmedError(fenceError)
      } finally {
        if (!componentReturned) await state.close()
      }
      if (active) throw error
      throw error
    }
  }
}

export function requirePrivateMacosBackend(value: unknown): PrivateMacosBackend {
  if (value === null || typeof value !== 'object' || !authenticBackends.has(value))
    throw new TypeError('native macOS Backend was not produced by the private constructor')
  return value as PrivateMacosBackend
}

export function normalizePrivateMacosSealedOwnerIdentity(
  value: unknown,
): PrivateMacosSealedOwnerIdentity {
  const record = exact(value, [
    'kind',
    'digest',
    'runId',
    'nonce',
    'mechanismDigest',
    'sealedPlanDigest',
    'allocation',
  ])
  const allocation = normalizePrivateMacosOwnerStateAllocationIdentity(record.allocation)
  const fields = {
    kind: record.kind,
    runId: record.runId,
    nonce: record.nonce,
    mechanismDigest: record.mechanismDigest,
    sealedPlanDigest: record.sealedPlanDigest,
    allocation,
  }
  if (
    record.kind !== 'private-macos-sealed-owner/1' ||
    typeof record.digest !== 'string' ||
    !DIGEST.test(record.digest) ||
    typeof record.runId !== 'string' ||
    !RUN_ID.test(record.runId) ||
    typeof record.nonce !== 'string' ||
    !/^[0-9a-f]{24}$/.test(record.nonce) ||
    typeof record.mechanismDigest !== 'string' ||
    !DIGEST.test(record.mechanismDigest) ||
    typeof record.sealedPlanDigest !== 'string' ||
    !DIGEST.test(record.sealedPlanDigest) ||
    record.digest !==
      privateDomainDigest('JIG-Macos-Sealed-Owner/1', fields as unknown as JsonValue)
  )
    throw new TypeError('invalid native macOS sealed owner')
  return Object.freeze({
    ...fields,
    kind: 'private-macos-sealed-owner/1' as const,
    runId: record.runId as string,
    nonce: record.nonce as string,
    mechanismDigest: record.mechanismDigest as string,
    sealedPlanDigest: record.sealedPlanDigest as string,
    digest: record.digest,
  })
}

export function normalizePrivateMacosPreparedOwnerIdentity(
  value: unknown,
): PrivateMacosPreparedOwnerIdentity {
  const record = exact(value, ['kind', 'digest', 'owner'])
  const owner = normalizePrivateMacosSealedOwnerIdentity(record.owner)
  if (
    record.kind !== 'private-macos-prepared-owner/1' ||
    typeof record.digest !== 'string' ||
    !DIGEST.test(record.digest) ||
    record.digest !==
      privateDomainDigest('JIG-Macos-Prepared-Owner/1', owner as unknown as JsonValue)
  )
    throw new TypeError('invalid native macOS prepared owner')
  return Object.freeze({
    kind: 'private-macos-prepared-owner/1' as const,
    digest: record.digest,
    owner,
  })
}

export function normalizePrivateMacosConfirmedEnforcementReceipt(
  value: unknown,
): PrivateMacosConfirmedEnforcementReceipt {
  const record = exact(value, [
    'kind',
    'ownerDigest',
    'stopReason',
    'exitCode',
    'signal',
    'fenced',
    'outputLost',
    'recovered',
    'evidence',
  ])
  if (
    record.kind !== 'private-macos-confirmed-enforcement/1' ||
    typeof record.ownerDigest !== 'string' ||
    !DIGEST.test(record.ownerDigest) ||
    typeof record.stopReason !== 'string' ||
    ![
      'payload_exit',
      'cancelled',
      'coordinator_lost',
      'deadline',
      'setup_failed',
      'memory_limit',
      'process_limit',
      'cpu_limit',
      'accounting_failed',
      'recovered',
    ].includes(record.stopReason) ||
    record.fenced !== true ||
    typeof record.outputLost !== 'boolean' ||
    typeof record.recovered !== 'boolean' ||
    record.recovered !== (record.stopReason === 'recovered')
  )
    throw new TypeError('invalid native macOS enforcement receipt')
  const scope = normalizePrivateMacosScopeResult({
    reason: record.stopReason === 'recovered' ? 'coordinator_lost' : record.stopReason,
    exitCode: record.exitCode,
    signal: record.signal,
    fenced: true,
    evidence: record.evidence,
  })
  return Object.freeze({
    kind: 'private-macos-confirmed-enforcement/1' as const,
    ownerDigest: record.ownerDigest,
    stopReason: record.stopReason as PrivateMacosConfirmedEnforcementReceipt['stopReason'],
    exitCode: scope.exitCode,
    signal: scope.signal,
    fenced: true,
    outputLost: record.outputLost,
    recovered: record.recovered,
    evidence: scope.evidence,
  })
}

function preparedFor(owner: PrivateMacosSealedOwnerIdentity): PrivateMacosPreparedOwnerIdentity {
  return Object.freeze({
    kind: 'private-macos-prepared-owner/1' as const,
    digest: privateDomainDigest('JIG-Macos-Prepared-Owner/1', owner as unknown as JsonValue),
    owner,
  })
}

async function observeSupport(
  options: NormalizedOptions,
): Promise<PrivateMacosBackendMechanismSupport> {
  privateMacosCurrentProcessIdentity()
  if (osRelease() !== '23.4.0' || process.arch !== 'x64')
    throw new Error('native macOS Backend is not qualified on this host')
  const [bunPath, supervisorPath, launcherPath] = await Promise.all([
    realpath(options.bunPath),
    realpath(options.supervisorPath),
    realpath(options.launcherPath),
  ])
  if (
    bunPath !== options.bunPath ||
    supervisorPath !== options.supervisorPath ||
    launcherPath !== options.launcherPath
  )
    throw new Error('native macOS mechanism paths are not canonical')
  const [trustedBunDigest, trustedSupervisorDigest, trustedLauncherDigest] = await Promise.all([
    privateInstallationFileDigest(bunPath),
    privateInstallationFileDigest(supervisorPath),
    privateInstallationFileDigest(launcherPath),
  ])
  const fields = {
    kind: 'macos-supervised-seatbelt-mechanism/1' as const,
    platform: 'darwin-x64-23.4.0-23E224' as const,
    trustedBunPath: bunPath,
    trustedBunDigest,
    trustedSupervisorPath: supervisorPath,
    trustedSupervisorDigest,
    trustedLauncherPath: launcherPath,
    trustedLauncherDigest,
    resourceAccounting: 'supervised-sampled-with-termination' as const,
    resourceOvershoot: true as const,
  }
  return Object.freeze({
    ...fields,
    digest: privateDomainDigest('JIG-Macos-Mechanism/1', fields),
  })
}

async function sealPlan(
  value: PrivateMacosLaunchPlan,
  allocation: PrivateMacosOwnerStateAllocationIdentity,
): Promise<SealedPlan> {
  if (value === null || typeof value !== 'object' || !RUN_ID.test(value.runId))
    throw new TypeError('invalid native macOS launch plan')
  const command = [...value.command]
  if (
    command.length === 0 ||
    command.some((part) => typeof part !== 'string' || part.includes('\0')) ||
    !canonical(command[0]!) ||
    !canonical(value.cwd) ||
    !Number.isSafeInteger(value.maxOutputBytes) ||
    value.maxOutputBytes < 1 ||
    value.maxOutputBytes > PRIVATE_MACOS_MAX_OUTPUT_BYTES
  )
    throw new TypeError('invalid native macOS launch configuration')
  const environment = Object.freeze({ ...(value.environment ?? {}) })
  if (
    Object.entries(environment).some(
      ([name, item]) => !ENVIRONMENT.test(name) || typeof item !== 'string' || item.includes('\0'),
    )
  )
    throw new TypeError('invalid native macOS launch environment')
  const limits = requirePrivateMacosScopeLimits(value.limits)
  const files = Object.freeze({
    readOnlyFiles: Object.freeze([...value.files.readOnlyFiles]),
    readOnlyTrees: Object.freeze([...value.files.readOnlyTrees]),
    writableTrees: Object.freeze([...value.files.writableTrees]),
    protectedRoots: Object.freeze([
      ...value.files.protectedRoots,
      posix.join(allocation.directory, 'control'),
    ]),
    network: value.files.network,
  })
  privateMacosSandboxProfile(files)
  const storage = value.storage === undefined ? undefined : Object.freeze({ ...value.storage })
  if (storage !== undefined && storage.mountPath !== posix.join(allocation.directory, 'data'))
    throw new TypeError('native macOS storage does not belong to its owner')
  if (storage === undefined && files.writableTrees.length !== 0)
    throw new TypeError('native macOS writable paths require bounded storage')
  if (storage !== undefined) requirePrivateMacosGuardianStorage(storage, files, value.cwd)
  const captures = (value.capturedInputs ?? []).map(({ path, input }) => {
    const captured = requirePrivateCapturedInput(input)
    return Object.freeze({ path, bytes: captured.bytes, digest: captured.digest })
  })
  const projectedInputs =
    storage === undefined ? undefined : posix.join(storage.mountPath, 'inputs')
  if (
    projectedInputs !== undefined &&
    files.readOnlyTrees.includes(projectedInputs) &&
    captures.length === 0
  )
    throw new TypeError('native macOS input projection has no captured inputs')
  const immutablePaths: SealedImmutablePath[] = []
  for (const [path, type] of [
    ...files.readOnlyFiles.map((path) => [path, 'file'] as const),
    ...files.readOnlyTrees.map((path) => [path, 'directory'] as const),
  ]) {
    // The guardian creates this tree from already captured descriptors after
    // attaching the bounded volume. Its files are authenticated by digest and
    // cannot exist at coordinator-side sealing time.
    if (path === projectedInputs) continue
    if (immutablePaths.some((entry) => entry.path === path))
      throw new TypeError('native macOS immutable projection is duplicated')
    if ((await realpath(path)) !== path)
      throw new TypeError('native macOS immutable path is aliased')
    const info = await lstat(path, { bigint: true })
    if ((type === 'file' && !info.isFile()) || (type === 'directory' && !info.isDirectory()))
      throw new TypeError('native macOS immutable projection has the wrong type')
    immutablePaths.push(
      Object.freeze({ path, type, device: String(info.dev), inode: String(info.ino) }),
    )
  }
  const sealed = Object.freeze({
    runId: value.runId,
    limits,
    command: Object.freeze(command) as readonly [string, ...string[]],
    cwd: value.cwd,
    environment,
    files,
    maxOutputBytes: value.maxOutputBytes,
    ...(storage === undefined ? {} : { storage }),
    capturedInputs: Object.freeze(captures),
    immutablePaths: Object.freeze(immutablePaths),
  })
  await revalidatePlan(sealed)
  return sealed
}

async function revalidatePlan(plan: SealedPlan): Promise<void> {
  privateMacosSandboxProfile(plan.files)
  requirePrivateMacosScopeLimits(plan.limits)
  for (const expected of plan.immutablePaths) {
    if ((await realpath(expected.path)) !== expected.path)
      throw new Error('native macOS immutable path changed')
    const info = await lstat(expected.path, { bigint: true })
    if (
      String(info.dev) !== expected.device ||
      String(info.ino) !== expected.inode ||
      (expected.type === 'file' && !info.isFile()) ||
      (expected.type === 'directory' && !info.isDirectory())
    )
      throw new Error('native macOS immutable projection changed')
  }
}

function guardianConfiguration(
  data: SealedData,
  state: Awaited<ReturnType<typeof openPrivateMacosBackendState>>,
): PrivateMacosGuardianStart {
  return Object.freeze({
    type: 'start' as const,
    ownerDirectory: state.guardianDirectory,
    ownerToken: data.identity.allocation.ownerToken,
    launcher: data.mechanism.support.trustedLauncherPath,
    cwd: data.sealedPlan.cwd,
    command: data.sealedPlan.command,
    environment: data.sealedPlan.environment,
    files: data.sealedPlan.files,
    limits: data.sealedPlan.limits,
    maxOutputBytes: data.sealedPlan.maxOutputBytes,
    ...(data.sealedPlan.storage === undefined ? {} : { storage: data.sealedPlan.storage }),
    ...(data.sealedPlan.capturedInputs.length === 0
      ? {}
      : { inputs: data.sealedPlan.capturedInputs }),
  })
}

function guardianInputs(
  plan: PrivateMacosLaunchPlan,
): readonly PrivateMacosGuardianCapturedInput[] {
  return Object.freeze(
    (plan.capturedInputs ?? []).map((file) =>
      Object.freeze({ path: file.path, input: file.input }),
    ),
  )
}

function receiptFor(
  prepared: PrivateMacosPreparedOwnerIdentity,
  terminal: PrivateMacosGuardianResult,
): PrivateMacosConfirmedEnforcementReceipt {
  if (terminal.result === null) {
    if (!terminal.recovered) throw new Error('native macOS guardian has no enforcement result')
    return recoveredReceipt(prepared)
  }
  const result = normalizePrivateMacosScopeResult(terminal.result)
  return normalizePrivateMacosConfirmedEnforcementReceipt({
    kind: 'private-macos-confirmed-enforcement/1',
    ownerDigest: prepared.digest,
    stopReason: result.reason,
    exitCode: result.exitCode,
    signal: result.signal,
    fenced: true,
    outputLost: terminal.outputLost,
    recovered: false,
    evidence: result.evidence,
  })
}

function recoveredReceipt(
  prepared: PrivateMacosPreparedOwnerIdentity,
): PrivateMacosConfirmedEnforcementReceipt {
  return normalizePrivateMacosConfirmedEnforcementReceipt({
    kind: 'private-macos-confirmed-enforcement/1',
    ownerDigest: prepared.digest,
    stopReason: 'recovered',
    exitCode: null,
    signal: null,
    fenced: true,
    outputLost: true,
    recovered: true,
    evidence: {
      cpuNanoseconds: '0',
      peakFootprintBytes: '0',
      peakTasks: 0,
      samples: 0,
      pauses: 0,
      incompleteSamples: 0,
      maxSampleMilliseconds: 0,
    },
  })
}

function requireReceiptFor(
  owner: PrivateMacosSealedOwnerIdentity,
  value: unknown,
): PrivateMacosConfirmedEnforcementReceipt {
  const receipt = normalizePrivateMacosConfirmedEnforcementReceipt(value)
  if (receipt.ownerDigest !== preparedFor(owner).digest)
    throw new Error('native macOS enforcement receipt does not match its owner')
  return receipt
}

function requireSealed(
  value: PrivateMacosSealedOwner,
  backend: PrivateMacosBackend,
  plan: PrivateMacosLaunchPlan,
): SealedData {
  const data = authenticSealedOwners.get(value)
  if (
    data === undefined ||
    data.backend !== backend ||
    data.sourcePlan !== plan ||
    !Object.isFrozen(value)
  )
    throw new TypeError('sealed native macOS owner was not produced for this launch')
  return data
}

function envelopeFor(data: SealedData): PrivateMacosEnvelopeIdentity {
  return Object.freeze({
    kind: 'macos-supervised-seatbelt/1' as const,
    mechanismDigest: data.mechanism.support.digest,
    sealedPlanDigest: data.identity.sealedPlanDigest,
    limits: data.sealedPlan.limits,
    resourceAccounting: 'supervised-sampled-with-termination' as const,
    resourceOvershoot: true as const,
    network: data.sealedPlan.files.network,
    writableBytes: data.sealedPlan.storage?.bytes ?? null,
  })
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...keys].sort().join()
  )
    throw new TypeError('invalid native macOS backend record')
  return value as Record<string, unknown>
}

function isPrepared(value: unknown): boolean {
  return (value as { kind?: unknown })?.kind === 'private-macos-prepared-owner/1'
}

function sameJson(left: unknown, right: unknown): boolean {
  return Buffer.from(canonicalJson(left as JsonValue)).equals(
    Buffer.from(canonicalJson(right as JsonValue)),
  )
}

function absolute(value: string, label: string): string {
  if (!canonical(value)) throw new TypeError(`native macOS ${label} path is invalid`)
  return value
}

function canonical(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    value !== '/' &&
    posix.normalize(value) === value &&
    !value.includes('\0')
  )
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function removeEmptyData(path: string): Promise<void> {
  try {
    await rmdir(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function signalName(signal: number | null): string | null {
  if (signal === null) return null
  return (
    Object.entries(osConstants.signals).find(([, value]) => value === signal)?.[0] ?? `SIG${signal}`
  )
}

function commonStopReason(
  reason: PrivateMacosConfirmedEnforcementReceipt['stopReason'],
): NonNullable<ExactComponentExit['stopReason']> {
  switch (reason) {
    case 'memory_limit':
    case 'process_limit':
    case 'cpu_limit':
    case 'accounting_failed':
      return 'setup_failed'
    default:
      return reason
  }
}

async function writeBytes(stream: NodeJS.WritableStream, bytes: Uint8Array): Promise<void> {
  if (bytes.length === 0) return
  await new Promise<void>((resolve, reject) => {
    stream.write(bytes, (error?: Error | null) => (error ? reject(error) : resolve()))
  })
}
