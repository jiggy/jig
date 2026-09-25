import { closeSync, openSync, writeSync } from 'node:fs'
import { isAbsolute } from 'node:path'

const PROFILE_ENVIRONMENT_KEY = 'JIG_PRIVATE_PROFILE_FILE'
const MAX_SPANS = 512
const MAX_RECORD_BYTES = 192

export type PrivateProfilePhase =
  | 'author-configuration-evaluation'
  | 'project-planning'
  | 'installed-host-opening'
  | 'project-session-opening'
  | 'dependency-preparation'
  | 'dependency-reuse'
  | 'root-submission-persistence'
  | 'linux-owner-state-initialization'
  | 'rootless-containment-startup'
  | 'flow-execution'
  | 'operation-owner-settlement'
  | 'root-fence'
  | 'root-settlement'
  | 'project-session-close'

interface PrivateProfileSpan {
  readonly spanId: number
  readonly phase: PrivateProfilePhase
  readonly startMs: number
}

/**
 * Bounded local trace for maintainer diagnostics. It records fixed phase names
 * and monotonic times only; it is not runtime telemetry or a package API.
 */
export class PrivateProfileCapture {
  readonly #fd: number
  readonly #startedAtMs = performance.now()
  readonly #events: string[] = []
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
      writeSync(this.#fd, `${JSON.stringify(header)}\n`)
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
    this.#events.push(
      JSON.stringify({ kind: 'start', spanId: span.spanId, phase, timeMs: span.startMs }),
    )
    return span
  }

  end(span: PrivateProfileSpan, outcome: 'returned' | 'failed'): void {
    if (this.#closed) return
    this.#events.push(
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
    if (this.#closed || this.#events.length >= MAX_SPANS * 2) {
      this.#truncated = true
      return
    }
    const timeMs = elapsed(this.#startedAtMs)
    this.#events.push(JSON.stringify({ kind: 'instant', phase, timeMs }))
  }

  finish(): void {
    if (this.#closed) return
    this.#closed = true
    try {
      for (const event of this.#events) {
        if (Buffer.byteLength(event) > MAX_RECORD_BYTES) {
          this.#truncated = true
          continue
        }
        writeSync(this.#fd, `${event}\n`)
      }
      if (this.#truncated) {
        writeSync(this.#fd, `${JSON.stringify({ kind: 'truncated', phaseLimit: MAX_SPANS })}\n`)
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

/** Called only after Jig has entered its exact rootless host envelope. */
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

export function privateProfileInstant(phase: PrivateProfilePhase): void {
  const capture = activeCapture
  if (capture === undefined) return
  try {
    capture.instant(phase)
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
