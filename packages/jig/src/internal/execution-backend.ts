import { join } from 'node:path'
import type { JsonValue } from '../json.js'
import type { PrivateExecutionIntent } from './execution-intent.js'
import { privateLinuxExecutionPlan, privateMacosExecutionPlan } from './execution-plan.js'
import { privateDomainDigest } from './identity.js'
import {
  cancelPrivateLinuxOwnerStateAllocation,
  normalizePrivateLinuxConfirmedEnforcementReceipt,
  normalizePrivateLinuxOwnerStateAllocationIdentity,
  normalizePrivateLinuxOwnerStateCancellation,
  normalizePrivateLinuxOwnerStateReleaseReceipt,
  normalizePrivateLinuxPreparedOwnerIdentity,
  normalizePrivateLinuxSealedOwnerIdentity,
  type PrivateLinuxBackendMechanismObservation,
  type PrivateLinuxBackendMechanismSupport,
  type PrivateLinuxCgroupBackend,
  type PrivateLinuxComponentProcess,
  type PrivateLinuxConfirmedEnforcementReceipt,
  PrivateLinuxFenceUnconfirmedError,
  type PrivateLinuxOwnerStateAllocationIdentity,
  type PrivateLinuxOwnerStateCancellation,
  type PrivateLinuxOwnerStateReleaseReceipt,
  type PrivateLinuxPreparedOwnerIdentity,
  type PrivateLinuxSealedOwner,
  type PrivateLinuxSealedOwnerIdentity,
  planPrivateLinuxOwnerStateAllocation,
  releasePrivateLinuxOwnerState,
  requirePrivateLinuxCgroupBackend,
} from './linux-rootless-backend.js'
import {
  cancelPrivateMacosOwnerStateAllocation,
  normalizePrivateMacosOwnerStateAllocationIdentity,
  normalizePrivateMacosOwnerStateCancellation,
  normalizePrivateMacosOwnerStateReleaseReceipt,
  type PrivateMacosOwnerStateAllocationIdentity,
  type PrivateMacosOwnerStateCancellation,
  type PrivateMacosOwnerStateReleaseReceipt,
  planPrivateMacosOwnerStateAllocation,
  releasePrivateMacosOwnerState,
} from './macos-backend-state.js'
import {
  normalizePrivateMacosConfirmedEnforcementReceipt,
  normalizePrivateMacosPreparedOwnerIdentity,
  normalizePrivateMacosSealedOwnerIdentity,
  type PrivateMacosBackend,
  type PrivateMacosBackendMechanismObservation,
  type PrivateMacosBackendMechanismSupport,
  type PrivateMacosComponentProcess,
  type PrivateMacosConfirmedEnforcementReceipt,
  PrivateMacosFenceUnconfirmedError,
  type PrivateMacosPreparedOwnerIdentity,
  type PrivateMacosSealedOwner,
  type PrivateMacosSealedOwnerIdentity,
  requirePrivateMacosBackend,
} from './macos-native-backend.js'

export type PrivateExecutionBackend = PrivateLinuxCgroupBackend | PrivateMacosBackend
export type PrivateExecutionBackendKind = 'linux' | 'macos'
export type PrivateExecutionBackendMechanismSupport =
  | PrivateLinuxBackendMechanismSupport
  | PrivateMacosBackendMechanismSupport
export type PrivateExecutionBackendMechanismObservation =
  | PrivateLinuxBackendMechanismObservation
  | PrivateMacosBackendMechanismObservation
export type PrivateExecutionOwnerStateAllocationIdentity =
  | PrivateLinuxOwnerStateAllocationIdentity
  | PrivateMacosOwnerStateAllocationIdentity
export type PrivateExecutionOwnerStateCancellation =
  | PrivateLinuxOwnerStateCancellation
  | PrivateMacosOwnerStateCancellation
export type PrivateExecutionOwnerStateReleaseReceipt =
  | PrivateLinuxOwnerStateReleaseReceipt
  | PrivateMacosOwnerStateReleaseReceipt
export type PrivateExecutionSealedOwnerIdentity =
  | PrivateLinuxSealedOwnerIdentity
  | PrivateMacosSealedOwnerIdentity
export type PrivateExecutionPreparedOwnerIdentity =
  | PrivateLinuxPreparedOwnerIdentity
  | PrivateMacosPreparedOwnerIdentity
export type PrivateExecutionConfirmedEnforcementReceipt =
  | PrivateLinuxConfirmedEnforcementReceipt
  | PrivateMacosConfirmedEnforcementReceipt
export type PrivateExecutionSealedOwner = PrivateLinuxSealedOwner | PrivateMacosSealedOwner
export type PrivateExecutionComponentProcess =
  | PrivateLinuxComponentProcess
  | PrivateMacosComponentProcess
export class PrivateExecutionFenceUnconfirmedError extends Error {
  override readonly cause: unknown
  constructor(cause: unknown) {
    super('execution ownership fence is unconfirmed')
    this.name = 'PrivateExecutionFenceUnconfirmedError'
    this.cause = cause
  }
}

export function requirePrivateExecutionBackend(value: unknown): PrivateExecutionBackend {
  try {
    return requirePrivateLinuxCgroupBackend(value)
  } catch (linuxError) {
    try {
      return requirePrivateMacosBackend(value)
    } catch {
      throw linuxError
    }
  }
}

export function privateExecutionBackendKind(
  value: PrivateExecutionBackend,
): PrivateExecutionBackendKind {
  const backend = requirePrivateExecutionBackend(value)
  try {
    requirePrivateLinuxCgroupBackend(backend)
    return 'linux'
  } catch {
    requirePrivateMacosBackend(backend)
    return 'macos'
  }
}

export async function inspectPrivateExecutionBackendSupport(
  value: PrivateExecutionBackend,
): Promise<PrivateExecutionBackendMechanismSupport> {
  const backend = requirePrivateExecutionBackend(value)
  return privateExecutionBackendKind(backend) === 'linux'
    ? await (backend as PrivateLinuxCgroupBackend).inspectSupport()
    : await (backend as PrivateMacosBackend).inspectSupport()
}

export async function observePrivateExecutionBackendMechanism(
  value: PrivateExecutionBackend,
): Promise<PrivateExecutionBackendMechanismObservation> {
  const backend = requirePrivateExecutionBackend(value)
  return privateExecutionBackendKind(backend) === 'linux'
    ? await (backend as PrivateLinuxCgroupBackend).observeMechanism()
    : await (backend as PrivateMacosBackend).observeMechanism()
}

export async function planPrivateExecutionOwnerStateAllocation(
  backendValue: PrivateExecutionBackend,
  location: { readonly parent: string; readonly name: string },
): Promise<PrivateExecutionOwnerStateAllocationIdentity> {
  const backend = requirePrivateExecutionBackend(backendValue)
  return privateExecutionBackendKind(backend) === 'linux'
    ? await planPrivateLinuxOwnerStateAllocation(location)
    : await planPrivateMacosOwnerStateAllocation(location)
}

export function normalizePrivateExecutionOwnerStateAllocationIdentity(
  value: unknown,
): PrivateExecutionOwnerStateAllocationIdentity {
  switch (recordKind(value)) {
    case 'private-linux-owner-state-allocation/1':
      return normalizePrivateLinuxOwnerStateAllocationIdentity(value)
    case 'private-macos-owner-state-allocation/1':
      return normalizePrivateMacosOwnerStateAllocationIdentity(value)
    default:
      throw new TypeError('execution owner-state allocation is invalid')
  }
}

export async function cancelPrivateExecutionOwnerStateAllocation(
  value: PrivateExecutionOwnerStateAllocationIdentity,
): Promise<PrivateExecutionOwnerStateCancellation> {
  const allocation = normalizePrivateExecutionOwnerStateAllocationIdentity(value)
  return allocation.kind === 'private-linux-owner-state-allocation/1'
    ? await cancelPrivateLinuxOwnerStateAllocation(allocation)
    : await cancelPrivateMacosOwnerStateAllocation(allocation)
}

export function normalizePrivateExecutionOwnerStateCancellation(
  value: unknown,
): PrivateExecutionOwnerStateCancellation {
  switch (recordKind(value)) {
    case 'private-linux-owner-state-cancellation/1':
      return normalizePrivateLinuxOwnerStateCancellation(value)
    case 'private-macos-owner-state-cancellation/1':
      return normalizePrivateMacosOwnerStateCancellation(value)
    default:
      throw new TypeError('execution owner-state cancellation is invalid')
  }
}

export function normalizePrivateExecutionSealedOwnerIdentity(
  value: unknown,
): PrivateExecutionSealedOwnerIdentity {
  switch (recordKind(value)) {
    case 'private-linux-sealed-owner/1':
      return normalizePrivateLinuxSealedOwnerIdentity(value)
    case 'private-macos-sealed-owner/1':
      return normalizePrivateMacosSealedOwnerIdentity(value)
    default:
      throw new TypeError('sealed execution owner is invalid')
  }
}

export function normalizePrivateExecutionPreparedOwnerIdentity(
  value: unknown,
): PrivateExecutionPreparedOwnerIdentity {
  switch (recordKind(value)) {
    case 'private-linux-prepared-owner/1':
      return normalizePrivateLinuxPreparedOwnerIdentity(value)
    case 'private-macos-prepared-owner/1':
      return normalizePrivateMacosPreparedOwnerIdentity(value)
    default:
      throw new TypeError('prepared execution owner is invalid')
  }
}

export function normalizePrivateExecutionConfirmedEnforcementReceipt(
  value: unknown,
): PrivateExecutionConfirmedEnforcementReceipt {
  switch (recordKind(value)) {
    case 'private-linux-confirmed-enforcement/1':
      return normalizePrivateLinuxConfirmedEnforcementReceipt(value)
    case 'private-macos-confirmed-enforcement/1':
      return normalizePrivateMacosConfirmedEnforcementReceipt(value)
    default:
      throw new TypeError('execution enforcement receipt is invalid')
  }
}

export function normalizePrivateExecutionOwnerStateReleaseReceipt(
  value: unknown,
): PrivateExecutionOwnerStateReleaseReceipt {
  switch (recordKind(value)) {
    case 'private-linux-owner-state-release/1':
      return normalizePrivateLinuxOwnerStateReleaseReceipt(value)
    case 'private-macos-owner-state-release/1':
      return normalizePrivateMacosOwnerStateReleaseReceipt(value)
    default:
      throw new TypeError('execution owner-state release is invalid')
  }
}

export async function sealPrivateExecutionOwner(
  backendValue: PrivateExecutionBackend,
  intent: PrivateExecutionIntent,
  allocationValue: PrivateExecutionOwnerStateAllocationIdentity,
): Promise<PrivateExecutionSealedOwner> {
  const backend = requirePrivateExecutionBackend(backendValue)
  const allocation = normalizePrivateExecutionOwnerStateAllocationIdentity(allocationValue)
  const kind = privateExecutionBackendKind(backend)
  if (!allocation.kind.startsWith(`private-${kind}-`))
    throw new TypeError('execution backend and owner allocation do not match')
  return kind === 'linux'
    ? await (backend as PrivateLinuxCgroupBackend).seal(
        privateLinuxExecutionPlan(intent),
        allocation as PrivateLinuxOwnerStateAllocationIdentity,
      )
    : await (backend as PrivateMacosBackend).seal(
        privateMacosExecutionPlan(intent, allocation as PrivateMacosOwnerStateAllocationIdentity),
        allocation as PrivateMacosOwnerStateAllocationIdentity,
      )
}

export async function launchPrivateExecution(
  backendValue: PrivateExecutionBackend,
  intent: PrivateExecutionIntent,
  signal?: AbortSignal,
): Promise<PrivateExecutionComponentProcess> {
  const backend = requirePrivateExecutionBackend(backendValue)
  return privateExecutionBackendKind(backend) === 'linux'
    ? await (backend as PrivateLinuxCgroupBackend).launch(privateLinuxExecutionPlan(intent), signal)
    : await (backend as PrivateMacosBackend).launch(
        (allocation) => privateMacosExecutionPlan(intent, allocation),
        signal,
      )
}

/** Logical invocation locations, without exposing a host's storage layout to controllers. */
export function privateExecutionLocations(
  allocation: PrivateExecutionOwnerStateAllocationIdentity,
) {
  const data = join(allocation.directory, 'data')
  if (allocation.kind === 'private-macos-owner-state-allocation/1')
    return {
      scratch: join(data, 'work'),
      attachment: (name: string, access: 'read' | 'read-write') =>
        access === 'read' ? join(data, 'inputs', name) : join(data, 'output'),
    }
  return {
    scratch: '/work',
    attachment: (name: string, access: 'read' | 'read-write') =>
      access === 'read' ? `/jig-input/${name}` : '/jig-output',
  }
}

/** Mechanism startup allowance; workload and parent deadlines remain caller-owned. */
export function privateExecutionSetupAllowance(backend: PrivateExecutionBackend): number {
  return privateExecutionBackendKind(backend) === 'macos' ? 15_000 : 0
}

export async function admitPrivateExecutionOwner(
  sealed: PrivateExecutionSealedOwner,
  signal?: AbortSignal,
  beforeAdmission?: (prepared: PrivateExecutionPreparedOwnerIdentity) => Promise<void>,
): Promise<PrivateExecutionComponentProcess> {
  if (sealed.identity.kind === 'private-linux-sealed-owner/1')
    return await (sealed as PrivateLinuxSealedOwner).admit(signal, beforeAdmission)
  return await (sealed as PrivateMacosSealedOwner).admit(signal, beforeAdmission)
}

export async function recoverPrivateExecutionFence(
  backendValue: PrivateExecutionBackend,
  ownerValue: PrivateExecutionSealedOwnerIdentity | PrivateExecutionPreparedOwnerIdentity,
): Promise<PrivateExecutionConfirmedEnforcementReceipt> {
  const backend = requirePrivateExecutionBackend(backendValue)
  const owner = ownerValue.kind.includes('-prepared-')
    ? normalizePrivateExecutionPreparedOwnerIdentity(ownerValue)
    : normalizePrivateExecutionSealedOwnerIdentity(ownerValue)
  const backendKind = privateExecutionBackendKind(backend)
  const ownerKind = owner.kind.includes('-linux-') ? 'linux' : 'macos'
  if (backendKind !== ownerKind) throw new TypeError('execution owner belongs to another backend')
  return backendKind === 'linux'
    ? await (backend as PrivateLinuxCgroupBackend).recoverFence(owner)
    : await (backend as PrivateMacosBackend).recoverFence(owner)
}

export async function releasePrivateExecutionOwnerState(
  ownerValue: PrivateExecutionOwnerStateAllocationIdentity | PrivateExecutionSealedOwnerIdentity,
  proofValue: PrivateExecutionOwnerStateCancellation | PrivateExecutionConfirmedEnforcementReceipt,
): Promise<PrivateExecutionOwnerStateReleaseReceipt> {
  const ownerKind = ownerValue.kind.includes('-linux-') ? 'linux' : 'macos'
  const proofKind = proofValue.kind.includes('-linux-') ? 'linux' : 'macos'
  if (ownerKind !== proofKind)
    throw new TypeError('execution release proof belongs to another backend')
  if (ownerKind === 'linux') return await releasePrivateLinuxOwnerState(ownerValue, proofValue)
  const allocation =
    ownerValue.kind === 'private-macos-sealed-owner/1' ? ownerValue.allocation : ownerValue
  return await releasePrivateMacosOwnerState(allocation, proofValue as never)
}

export function privateExecutionOwnerAllocationDigest(
  owner: PrivateExecutionSealedOwnerIdentity,
): string {
  return owner.kind === 'private-linux-sealed-owner/1'
    ? owner.ownerStateAllocationDigest
    : owner.allocation.digest
}

export function privateExecutionPreparedOwnerDigest(
  owner: PrivateExecutionSealedOwnerIdentity,
): string {
  return owner.kind === 'private-linux-sealed-owner/1'
    ? privateDomainDigest('JIG-Rootless-Linux-Prepared-Owner/1', owner as unknown as JsonValue)
    : privateDomainDigest('JIG-Macos-Prepared-Owner/1', owner as unknown as JsonValue)
}

export function isPrivateExecutionFenceUnconfirmed(
  error: unknown,
): error is
  | PrivateExecutionFenceUnconfirmedError
  | PrivateLinuxFenceUnconfirmedError
  | PrivateMacosFenceUnconfirmedError {
  return (
    error instanceof PrivateExecutionFenceUnconfirmedError ||
    error instanceof PrivateLinuxFenceUnconfirmedError ||
    error instanceof PrivateMacosFenceUnconfirmedError
  )
}

function recordKind(value: unknown): unknown {
  return value !== null && typeof value === 'object'
    ? (value as { kind?: unknown }).kind
    : undefined
}
