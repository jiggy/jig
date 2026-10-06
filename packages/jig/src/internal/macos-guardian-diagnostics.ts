import { AsyncLocalStorage } from 'node:async_hooks'

export type PrivateMacosGuardianPhase =
  | 'prepared'
  | 'admitted'
  | 'ready'
  | 'running'
  | 'collecting'
  | 'terminal'
export type PrivateMacosGuardianRecoveryStep =
  | 'receive'
  | 'validate'
  | 'output-transfer'
  | 'terminal-cleanup'

const failureSteps = [
  'configuration',
  'admission',
  'input-transfer',
  'storage',
  'input-projection',
  'scope-preparation',
  'execution',
  'collection',
  'storage-recovery',
] as const
export type PrivateMacosGuardianFailureStep = (typeof failureSteps)[number]

const causes = new Map([
  ['macOS control channel ended', 'CONTROL_EOF'],
  ['macOS control channel socket failed', 'CONTROL_SOCKET'],
  ['macOS control channel capacity exceeded', 'CONTROL_CAPACITY'],
  ['macOS control channel malformed', 'CONTROL_MALFORMED'],
  ['macOS control channel truncated', 'CONTROL_TRUNCATED'],
  ['macOS control deadline expired', 'CONTROL_DEADLINE'],
  ['macOS control delivery unavailable', 'CONTROL_DELIVERY'],
  ['invalid macOS guardian response', 'INVALID_RESPONSE'],
  ['macOS collector has no successful fenced owner', 'INVALID_COLLECTOR'],
  ['macOS collector descriptor count changed', 'DESCRIPTOR_COUNT'],
  ['macOS guardian job removal is unconfirmed', 'JOB_REMOVAL_UNCONFIRMED'],
  ['macOS volume create failed', 'VOLUME_CREATE'],
  ['macOS volume attach failed', 'VOLUME_ATTACH'],
  ['macOS volume info failed', 'VOLUME_INFO'],
  ['macOS volume detach failed', 'VOLUME_DETACH'],
  ['macOS volume plist conversion failed', 'VOLUME_PLIST'],
  ['macOS image attachment does not match its allocation', 'VOLUME_IMAGE'],
  ['macOS volume device does not match its allocation', 'VOLUME_DEVICE'],
] as const)

export interface PrivateMacosGuardianFailure {
  readonly step: PrivateMacosGuardianFailureStep
  readonly cause: 'OTHER' | NonNullable<ReturnType<typeof causes.get>>
}

function closedCause(error: unknown): PrivateMacosGuardianFailure['cause'] {
  try {
    return error instanceof Error
      ? (causes.get(error.message as Parameters<typeof causes.get>[0]) ?? 'OTHER')
      : 'OTHER'
  } catch {
    return 'OTHER'
  }
}

/** Fixed preparation evidence carried by the authenticated private control channel. */
export function privateMacosGuardianFailure(
  step: PrivateMacosGuardianFailureStep,
  error: unknown,
): PrivateMacosGuardianFailure {
  return Object.freeze({ step, cause: closedCause(error) })
}

export function normalizePrivateMacosGuardianFailure(
  value: unknown,
): PrivateMacosGuardianFailure | null {
  if (value === null) return null
  const record = value as PrivateMacosGuardianFailure
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== 'cause,step' ||
    !failureSteps.includes(record.step) ||
    (record.cause !== 'OTHER' && ![...causes.values()].includes(record.cause))
  )
    throw new Error('invalid macOS guardian response')
  return Object.freeze({ step: record.step, cause: record.cause })
}

export interface PrivateMacosGuardianRecoveryDiagnostic {
  readonly phase: PrivateMacosGuardianPhase
  readonly step: PrivateMacosGuardianRecoveryStep
  readonly cause: string
}
type Observer = (event: PrivateMacosGuardianRecoveryDiagnostic) => void
const observers = new AsyncLocalStorage<Observer>()

/** Private, invocation-scoped host-test evidence; never a payload or CLI surface. */
export function withPrivateMacosGuardianDiagnostics<T>(observer: Observer, run: () => T): T {
  return observers.run(observer, run)
}

/** Emit once before recovery discards the original failure; observers cannot affect settlement. */
export function reportPrivateMacosGuardianRecovery(
  phase: PrivateMacosGuardianPhase,
  step: PrivateMacosGuardianRecoveryStep,
  error: unknown,
): void {
  try {
    const observer = observers.getStore()
    if (observer === undefined) return
    const cause = closedCause(error)
    observer(Object.freeze({ phase, step, cause }))
  } catch {
    // Diagnostics must not interrupt fencing, cleanup, or the original outcome.
  }
}
