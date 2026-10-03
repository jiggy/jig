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
] as const)

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
    const cause =
      error instanceof Error
        ? (causes.get(error.message as Parameters<typeof causes.get>[0]) ?? 'OTHER')
        : 'OTHER'
    observer(Object.freeze({ phase, step, cause }))
  } catch {
    // Diagnostics must not interrupt fencing, cleanup, or the original outcome.
  }
}
