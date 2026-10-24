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
  ['macOS scope is not initially empty', 'SCOPE_NOT_EMPTY'],
  ['invalid macOS scope limits', 'SCOPE_LIMITS'],
  ['invalid macOS native launch', 'SCOPE_LAUNCH'],
  ['macOS working directory is outside its directory projections', 'SCOPE_CWD'],
  ['macOS initial accounting is incomplete', 'SCOPE_INITIAL_ACCOUNTING'],
  ['macOS launch handoffs are unavailable', 'SCOPE_HANDOFFS'],
  ['macOS descendant fencing is unconfirmed', 'SCOPE_FENCING'],
  ['macOS final resource accounting is unconfirmed', 'SCOPE_FINAL_ACCOUNTING'],
  ['macOS scope ended before readiness (payload_exit)', 'SCOPE_EARLY_EXIT'],
  ['macOS scope ended before readiness (cancelled)', 'SCOPE_CANCELLED'],
  ['macOS scope ended before readiness (coordinator_lost)', 'SCOPE_COORDINATOR_LOST'],
  ['macOS scope ended before readiness (deadline)', 'SCOPE_DEADLINE'],
  ['macOS scope ended before readiness (setup_failed)', 'SCOPE_SETUP_FAILED'],
  ['macOS scope ended before readiness (memory_limit)', 'SCOPE_MEMORY_LIMIT'],
  ['macOS scope ended before readiness (process_limit)', 'SCOPE_PROCESS_LIMIT'],
  ['macOS scope ended before readiness (cpu_limit)', 'SCOPE_CPU_LIMIT'],
  ['macOS scope ended before readiness (accounting_failed)', 'SCOPE_ACCOUNTING_FAILED'],
  ['macOS collector has no successful fenced owner', 'INVALID_COLLECTOR'],
  ['macOS collector descriptor count changed', 'DESCRIPTOR_COUNT'],
  ['macOS guardian job removal is unconfirmed', 'JOB_REMOVAL_UNCONFIRMED'],
  ['macOS guardian operation deadline expired', 'OPERATION_DEADLINE'],
  ['macOS guardian native clock unavailable', 'NATIVE_CLOCK'],
  ['macOS volume create failed', 'VOLUME_CREATE'],
  ['macOS volume attach failed', 'VOLUME_ATTACH'],
  ['macOS volume info failed', 'VOLUME_INFO'],
  ['macOS volume detach failed', 'VOLUME_DETACH'],
  ['macOS volume plist conversion failed', 'VOLUME_PLIST'],
  ['macOS image attachment count does not match its allocation', 'VOLUME_IMAGE_COUNT'],
  ['macOS image attachment owner does not match its allocation', 'VOLUME_IMAGE_OWNER'],
  ['macOS image attachment sector size does not match its allocation', 'VOLUME_IMAGE_SECTOR_SIZE'],
  [
    'macOS image attachment sector count does not match its allocation',
    'VOLUME_IMAGE_SECTOR_COUNT',
  ],
  ['macOS image attachment encryption does not match its allocation', 'VOLUME_IMAGE_ENCRYPTION'],
  ['macOS image attachment entities do not match its allocation', 'VOLUME_IMAGE_ENTITIES'],
  ['macOS volume device does not match its allocation', 'VOLUME_DEVICE'],
  ['macOS volume capacity is outside its finite profile', 'VOLUME_CAPACITY'],
  ['macOS volume requires a canonical private path', 'VOLUME_PATH'],
  ['macOS volume directory is aliased', 'VOLUME_DIRECTORY_ALIAS'],
  ['macOS volume directory is not private', 'VOLUME_DIRECTORY_PRIVATE'],
  ['macOS volume directory identity changed', 'VOLUME_DIRECTORY_IDENTITY'],
  ['invalid macOS volume ownership token', 'VOLUME_TOKEN'],
  ['macOS volume journal is unsafe', 'VOLUME_JOURNAL_UNSAFE'],
  ['macOS volume journal changed', 'VOLUME_JOURNAL_CHANGED'],
  ['macOS volume ownership authentication failed', 'VOLUME_AUTHENTICATION'],
  ['invalid macOS volume allocation', 'VOLUME_ALLOCATION'],
  ['macOS image inventory is invalid', 'VOLUME_INVENTORY'],
  ['macOS volume control directory changed', 'VOLUME_CONTROL_IDENTITY'],
  ['macOS volume backing journal is invalid', 'VOLUME_BACKING_JOURNAL'],
  ['macOS volume backing identity changed', 'VOLUME_BACKING_IDENTITY'],
  ['macOS attached image has no authenticated backing', 'VOLUME_ATTACHED_BACKING_MISSING'],
  ['macOS volume backing changed before detach', 'VOLUME_BACKING_DETACH_IDENTITY'],
  ['macOS volume mount allocation changed', 'VOLUME_MOUNT_IDENTITY'],
  ['macOS volume backing changed before removal', 'VOLUME_BACKING_REMOVE_IDENTITY'],
  ['macOS recovery tools are not fenced', 'RECOVERY_TOOLS_UNFENCED'],
] as const)

const filesystemCauses = new Map([
  ['ENOENT', 'FILESYSTEM_MISSING'],
  ['EBUSY', 'FILESYSTEM_BUSY'],
  ['ENOTEMPTY', 'FILESYSTEM_NOT_EMPTY'],
  ['EIO', 'FILESYSTEM_IO'],
  ['EACCES', 'FILESYSTEM_ACCESS'],
  ['EPERM', 'FILESYSTEM_PERMISSION'],
  ['ENOSPC', 'FILESYSTEM_FULL'],
  ['EROFS', 'FILESYSTEM_READ_ONLY'],
] as const)
const closedCauses = new Set([...causes.values(), ...filesystemCauses.values(), 'ABORTED'])

export interface PrivateMacosGuardianFailure {
  readonly step: PrivateMacosGuardianFailureStep
  readonly cause:
    | 'OTHER'
    | 'ABORTED'
    | NonNullable<ReturnType<typeof causes.get>>
    | NonNullable<ReturnType<typeof filesystemCauses.get>>
}

function closedCause(error: unknown): PrivateMacosGuardianFailure['cause'] {
  try {
    if (error instanceof DOMException && error.name === 'AbortError') return 'ABORTED'
    if (!(error instanceof Error)) return 'OTHER'
    const cause = causes.get(error.message as Parameters<typeof causes.get>[0])
    if (cause !== undefined) return cause
    const code = (error as Error & { code?: unknown }).code
    if (error.name === 'AbortError' && code === 'ABORT_ERR') return 'ABORTED'
    return typeof code === 'string'
      ? (filesystemCauses.get(code as Parameters<typeof filesystemCauses.get>[0]) ?? 'OTHER')
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
    (record.cause !== 'OTHER' && !closedCauses.has(record.cause))
  )
    throw new Error('invalid macOS guardian response')
  return Object.freeze({ step: record.step, cause: record.cause })
}

/** Parse only the fixed code assembled from authenticated guardian failure fields. */
export function normalizePrivateMacosGuardianFailureCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  for (const step of failureSteps) {
    const prefix = `MACOS_GUARDIAN_${step.replaceAll('-', '_').toUpperCase()}_`
    if (!value.startsWith(prefix)) continue
    try {
      const failure = normalizePrivateMacosGuardianFailure({
        step,
        cause: value.slice(prefix.length),
      })
      if (failure !== null) return `${prefix}${failure.cause}`
    } catch {
      // A partial prefix cannot admit a new step, cause or private suffix.
    }
  }
  return undefined
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
