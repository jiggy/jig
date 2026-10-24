import { closeSync, openSync, writeSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { normalizePrivateMacosGuardianFailureCode } from './macos-guardian-diagnostics.js'
import type { PrivateRootExecutionFailurePhase } from './root-run-controller.js'

const PROFILE_ENVIRONMENT_KEY = 'JIG_PRIVATE_PROFILE_FILE'
const MAX_SPANS = 512
const MAX_RECORD_BYTES = 192
const MAX_FAILURES = 8

const failurePhases = {
  planning: true,
  materialization: true,
  support: true,
  projection: true,
  sealing: true,
  channels: true,
  admission: true,
  protocol: true,
  'child-settlement': true,
  fence: true,
  settlement: true,
  'child-flow-allocation': true,
  'child-flow-preparation': true,
  'child-flow-sealing': true,
  'child-flow-admission': true,
  'child-flow-protocol': true,
  'child-flow-settlement': true,
  'child-flow-cleanup': true,
  'contained-effect-preparation': true,
  'contained-effect-sealing': true,
  'contained-effect-admission': true,
  'contained-effect-collection': true,
  'contained-effect-settlement': true,
  'contained-effect-cleanup': true,
  'child-contained-effect-preparation': true,
  'child-contained-effect-sealing': true,
  'child-contained-effect-admission': true,
  'child-contained-effect-collection': true,
  'child-contained-effect-settlement': true,
  'child-contained-effect-cleanup': true,
  'finite-acp-preparation': true,
  'finite-acp-sealing': true,
  'finite-acp-admission': true,
  'finite-acp-protocol': true,
  'finite-acp-settlement': true,
  'finite-acp-cleanup': true,
  'child-finite-acp-preparation': true,
  'child-finite-acp-sealing': true,
  'child-finite-acp-admission': true,
  'child-finite-acp-protocol': true,
  'child-finite-acp-settlement': true,
  'child-finite-acp-cleanup': true,
  'project-plan': true,
  'project-apply': true,
} as const satisfies Record<
  PrivateRootExecutionFailurePhase | 'project-plan' | 'project-apply',
  true
>

const failureCauses = new Set([
  'OTHER',
  'ENOENT',
  'EEXIST',
  'EBUSY',
  'ENOTEMPTY',
  'EIO',
  'EACCES',
  'EPERM',
  'ENOSPC',
  'EROFS',
  'EAGAIN',
  'EMFILE',
  'ENFILE',
  'ENOMEM',
  'EBADF',
  'EINVAL',
  'EPIPE',
  'ECONNRESET',
  'ABORT_ERR',
  'EXECUTION_PREPARATION_DEADLINE',
  'PROJECT_EVALUATOR_SUPPORT',
  'PROJECT_EVALUATOR_LAUNCH',
  'PROJECT_EVALUATOR_COMPILE',
  'PROJECT_EVALUATOR_IMPORT',
  'PROJECT_EVALUATOR_PROTOCOL',
  'PROJECT_EVALUATOR_DEADLINE',
  'PROJECT_EVALUATOR_INTERRUPTED',
  'PROJECT_EVALUATOR_CLEANUP',
  'PROJECT_EVALUATOR_ENVELOPE',
  'PROJECT_EVALUATOR_MEMORY_LIMIT',
  'PROJECT_EVALUATOR_PROCESS_LIMIT',
  'PROJECT_BUSY',
  'PROJECT_CLOSED',
  'PROJECT_UNSAFE',
  'PACKAGE_BUN_INPUT_LIMIT',
  'PACKAGE_BUN_LOCK_INVALID',
  'PACKAGE_BUN_LOCK_VERSION_UNSUPPORTED',
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
  'PACKAGE_BUN_PROJECT_DEADLINE',
  'PACKAGE_BUN_PROJECT_COUNT_LIMIT',
  'PACKAGE_BUN_PROJECT_OUTPUT_LIMIT',
  'PACKAGE_BUN_RESOLUTION_PERMISSION_REQUIRED',
  'PACKAGE_BUN_STOP_CANCELLED',
  'PACKAGE_BUN_STOP_COORDINATOR_LOST',
  'PACKAGE_BUN_STOP_DEADLINE',
  'PACKAGE_BUN_STOP_CLOCK',
  'PACKAGE_BUN_STOP_PAYLOAD_EXIT',
  'PACKAGE_BUN_STOP_CORE_DUMP',
  'PACKAGE_BUN_STOP_SETUP_FAILED',
  'PACKAGE_BUN_STOP_RECOVERED',
  'PACKAGE_BUN_STOP_MEMORY_LIMIT',
  'PACKAGE_BUN_STOP_PROCESS_LIMIT',
  'PACKAGE_BUN_STOP_CPU_LIMIT',
  'PACKAGE_BUN_STOP_ACCOUNTING_FAILED',
  'PACKAGE_BUN_TERMINAL_MISSING',
  'PACKAGE_BUN_EXIT_NONZERO',
  'NATIVE_OUTPUT_COLLECTION_UNAVAILABLE',
  'NATIVE_OUTPUT_LOST_DURING_CLEANUP',
  'NATIVE_OUTPUT_NOT_CAPTURED',
  'OUTPUT_CAPTURE_DEADLINE',
  'OUTPUT_FILE_PROFILE',
  'NATIVE_OUTPUT_CLEANUP_FAILED',
  'MACOS_CONTROL_DEADLINE',
  'MACOS_GUARDIAN_BOOTSTRAP',
  'MACOS_GUARDIAN_CONNECTION_LOST',
  'MACOS_GUARDIAN_REMOVAL_UNCONFIRMED',
  'MACOS_GUARDIAN_JOB_PRESENT',
  'MACOS_RECOVERY_JOB_PRESENT',
  'MACOS_STORAGE_RECOVERY_UNCONFIRMED',
  'MACOS_VOLUME_BACKING_CHANGED',
  'MACOS_VOLUME_INFO',
  'MACOS_VOLUME_DETACH',
  'MACOS_GUARDIAN_UNEXPECTED_STATE',
  'MACOS_RECOVERY_UNEXPECTED_STATE',
  'MACOS_PREPARED_OWNER_MISMATCH',
  'MACOS_STARTUP_CANCELLED',
  'MACOS_GUARDIAN_BEFORE_READINESS',
])

export interface PrivateProfileFailureRecord {
  readonly kind: 'failure'
  readonly phase: keyof typeof failurePhases
  readonly cause: string
  readonly timeMs: number
}

function failurePhase(value: unknown): value is PrivateProfileFailureRecord['phase'] {
  return typeof value === 'string' && Object.hasOwn(failurePhases, value)
}

function failureCause(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return failureCauses.has(value) ? value : normalizePrivateMacosGuardianFailureCode(value)
}

/** Decode inert profile bytes without retaining arbitrary fields or invoking accessors. */
export function normalizePrivateProfileFailure(
  value: unknown,
): PrivateProfileFailureRecord | undefined {
  try {
    if (value === null || typeof value !== 'object') return undefined
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== null && prototype !== Object.prototype) return undefined
    const keys = Reflect.ownKeys(value)
    if (
      keys.length !== 4 ||
      !keys.every((key) => ['kind', 'phase', 'cause', 'timeMs'].includes(key as string))
    )
      return undefined
    const values: Record<string, unknown> = Object.create(null)
    for (const key of ['kind', 'phase', 'cause', 'timeMs']) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) return undefined
      values[key] = descriptor.value
    }
    const cause = failureCause(values.cause)
    if (
      values.kind !== 'failure' ||
      !failurePhase(values.phase) ||
      cause === undefined ||
      typeof values.timeMs !== 'number' ||
      !Number.isFinite(values.timeMs) ||
      values.timeMs < 0 ||
      values.timeMs > 86_400_000
    )
      return undefined
    const record = Object.freeze({
      kind: 'failure' as const,
      phase: values.phase,
      cause,
      timeMs: values.timeMs,
    })
    return Buffer.byteLength(JSON.stringify(record)) <= MAX_RECORD_BYTES ? record : undefined
  } catch {
    return undefined
  }
}

function observedFailureCause(value: unknown): string {
  if (typeof value !== 'string') return 'OTHER'
  const separator = value.indexOf(':')
  const code = separator < 0 ? value : value.slice(separator + 1)
  return failureCause(code) ?? 'OTHER'
}

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
}

export type PrivateProfilePhase =
  | 'author-configuration-evaluation'
  | 'author-support-verification'
  | 'author-envelope-startup'
  | 'author-execution-settlement'
  | 'dependency-workspace-capture'
  | 'project-planning'
  | 'project-evaluation-review'
  | 'installed-host-opening'
  | 'project-session-opening'
  | 'dependency-preparation'
  | 'dependency-reuse'
  | 'root-submission-persistence'
  | 'linux-owner-state-initialization'
  | 'rootless-containment-startup'
  | 'flow-execution'
  | 'finite-acp-revalidation'
  | 'finite-acp-containment'
  | 'finite-acp-launch'
  | 'finite-acp-exchange'
  | 'finite-acp-release'
  | 'finite-acp-recovery'
  | 'contained-effect-planning'
  | 'contained-effect-allocation'
  | 'contained-effect-sealing'
  | 'contained-effect-launch'
  | 'contained-effect-collection'
  | 'contained-effect-settlement'
  | 'package-materialization-copy'
  | 'package-materialization-freeze'
  | 'package-materialization-verification'
  | 'macos-guardian-preparation'
  | 'macos-guardian-admission'
  | 'operation-owner-settlement'
  | 'root-fence'
  | 'root-settlement'
  | 'root-package-release'
  | 'root-owner-release'
  | 'project-session-close'
  | 'result-open'
  | 'result-authenticate'
  | 'result-retention'
  | 'result-observe'
  | 'result-checkpoint'
  | 'result-finish'
  | 'result-dispose'

interface PrivateProfileSpan {
  readonly spanId: number
  readonly phase: PrivateProfilePhase
  readonly startMs: number
}

/**
 * Bounded local trace for maintainer diagnostics. It records fixed phase names
 * and monotonic times, plus closed host failure codes before shutdown. It is
 * not fsynced durability, runtime telemetry or a package API.
 */
export class PrivateProfileCapture {
  readonly #fd: number
  readonly #startedAtMs = performance.now()
  #recordCount = 0
  #failureCount = 0
  #nextSpanId = 1
  #truncated = false
  #closed = false

  constructor(path: string) {
    if (!isAbsolute(path) || path.length > 4096 || path.includes('\0')) {
      throw new TypeError('private profile destination is invalid')
    }
    this.#fd = openSync(path, 'wx', 0o600)
    const header = {
      kind: 'header',
      protocol: 'jig-startup-profile/1',
      pid: process.pid,
      timeOriginMs: performance.timeOrigin,
    }
    try {
      this.#write(JSON.stringify(header))
    } catch (error) {
      closeSync(this.#fd)
      throw error
    }
  }

  start(phase: PrivateProfilePhase): PrivateProfileSpan | undefined {
    if (this.#closed || this.#nextSpanId > MAX_SPANS) {
      this.#truncated = true
      return undefined
    }
    const span = { spanId: this.#nextSpanId++, phase, startMs: elapsed(this.#startedAtMs) }
    this.#record(
      JSON.stringify({ kind: 'start', spanId: span.spanId, phase, timeMs: span.startMs }),
    )
    return span
  }

  end(span: PrivateProfileSpan, outcome: 'returned' | 'failed'): void {
    if (this.#closed) return
    this.#record(
      JSON.stringify({
        kind: 'end',
        spanId: span.spanId,
        phase: span.phase,
        timeMs: elapsed(this.#startedAtMs),
        outcome,
      }),
    )
  }

  instant(phase: PrivateProfilePhase): void {
    if (this.#closed) return
    const timeMs = elapsed(this.#startedAtMs)
    this.#record(JSON.stringify({ kind: 'instant', phase, timeMs }))
  }

  failure(phase: unknown, causes: unknown): void {
    if (this.#closed || !failurePhase(phase)) return
    let count = 1
    let observations: unknown[] | undefined
    try {
      if (Array.isArray(causes)) {
        const length = ownData(causes, 'length')
        if (typeof length === 'number' && Number.isSafeInteger(length) && length > 0) {
          count = Math.min(length, MAX_FAILURES + 1)
          observations = causes
        }
      }
    } catch {
      // Unreadable evidence records only the known host phase and OTHER.
    }
    for (let index = 0; index < count; index++) {
      if (this.#failureCount >= MAX_FAILURES) {
        this.#truncated = true
        return
      }
      let cause = 'OTHER'
      try {
        if (observations !== undefined)
          cause = observedFailureCause(ownData(observations, String(index)))
      } catch {
        // Optional observations cannot invoke or expose arbitrary evidence.
      }
      this.#failureCount++
      const record = normalizePrivateProfileFailure({
        kind: 'failure',
        phase,
        cause,
        timeMs: elapsed(this.#startedAtMs),
      })
      if (record !== undefined) this.#record(JSON.stringify(record))
    }
  }

  finish(): void {
    if (this.#closed) return
    this.#closed = true
    try {
      if (this.#truncated) {
        this.#write(JSON.stringify({ kind: 'truncated', phaseLimit: MAX_SPANS }))
      }
    } finally {
      closeSync(this.#fd)
    }
  }

  discard(): void {
    if (this.#closed) return
    this.#closed = true
    closeSync(this.#fd)
  }

  #record(event: string): void {
    if (this.#recordCount >= MAX_SPANS * 2 || Buffer.byteLength(event) > MAX_RECORD_BYTES) {
      this.#truncated = true
      return
    }
    this.#recordCount++
    // Retain partial diagnostics before a process can die. This is not fsynced
    // durability, and an unmatched start is never a completed operation.
    this.#write(event)
  }

  #write(event: string): void {
    const bytes = Buffer.from(`${event}\n`)
    let offset = 0
    while (offset < bytes.length) {
      const written = writeSync(this.#fd, bytes, offset, bytes.length - offset)
      if (written === 0) throw new Error('private profile write made no progress')
      offset += written
    }
  }
}

let configuredPath = process.env[PROFILE_ENVIRONMENT_KEY]
let activeCapture: PrivateProfileCapture | undefined

/** The private destination is excluded from operator/resource configuration. */
export function privateProfileOperatorEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  const copy = { ...environment }
  delete copy[PROFILE_ENVIRONMENT_KEY]
  return Object.freeze(copy)
}

/** Called after host-envelope entry, or for non-executing attempt result observation. */
export function privateProfileActivate(): void {
  if (configuredPath === undefined || activeCapture !== undefined) return
  const path = configuredPath
  delete process.env[PROFILE_ENVIRONMENT_KEY]
  configuredPath = undefined
  try {
    activeCapture = new PrivateProfileCapture(path)
  } catch {
    try {
      writeSync(
        2,
        '\nWarning: local startup profile capture could not be opened; continuing without it.\n',
      )
    } catch {
      // Optional diagnostics cannot prevent a Run from proceeding.
    }
  }
}

export async function privateProfileSpan<T>(
  phase: PrivateProfilePhase,
  operation: () => Promise<T>,
): Promise<T> {
  const capture = activeCapture
  if (capture === undefined) return operation()
  let span: PrivateProfileSpan | undefined
  try {
    span = capture.start(phase)
  } catch {
    discardProfileCapture(capture)
  }
  if (span === undefined) return operation()
  let outcome: 'returned' | 'failed' = 'returned'
  try {
    return await operation()
  } catch (error) {
    outcome = 'failed'
    throw error
  } finally {
    try {
      capture.end(span, outcome)
    } catch {
      discardProfileCapture(capture)
    }
  }
}

/** Synchronous reads retain their original scheduling and exact failure identity. */
export function privateProfileSyncSpan<T>(phase: PrivateProfilePhase, operation: () => T): T {
  const capture = activeCapture
  if (capture === undefined) return operation()
  let span: PrivateProfileSpan | undefined
  try {
    span = capture.start(phase)
  } catch {
    discardProfileCapture(capture)
  }
  if (span === undefined) return operation()
  let outcome: 'returned' | 'failed' = 'returned'
  try {
    return operation()
  } catch (error) {
    outcome = 'failed'
    throw error
  } finally {
    try {
      capture.end(span, outcome)
    } catch {
      discardProfileCapture(capture)
    }
  }
}

export function privateProfileInstant(phase: PrivateProfilePhase): void {
  const capture = activeCapture
  if (capture === undefined) return
  try {
    capture.instant(phase)
  } catch {
    discardProfileCapture(capture)
  }
}

/** Do not install failure observers when the operator has not activated this sink. */
export function privateProfileFailureSink(): typeof privateProfileFailure | undefined {
  return activeCapture === undefined ? undefined : privateProfileFailure
}

export function privateProfileFailure(phase: unknown, causes: unknown): void {
  const capture = activeCapture
  if (capture === undefined) return
  try {
    capture.failure(phase, causes)
  } catch {
    discardProfileCapture(capture)
  }
}

/** Tracing failure never replaces the Run's own outcome. */
export function privateProfileFinish(): void {
  try {
    activeCapture?.finish()
  } catch {
    try {
      writeSync(2, '\nWarning: local startup profile capture was incomplete.\n')
    } catch {
      // The profile is optional diagnostics and cannot change Run ownership.
    }
  } finally {
    activeCapture = undefined
  }
}

function discardProfileCapture(capture: PrivateProfileCapture): void {
  if (activeCapture !== capture) return
  activeCapture = undefined
  try {
    capture.discard()
  } catch {
    // A failed optional trace cannot replace execution or cleanup outcomes.
  }
}

function elapsed(startedAtMs: number): number {
  return Math.round((performance.now() - startedAtMs) * 1000) / 1000
}
