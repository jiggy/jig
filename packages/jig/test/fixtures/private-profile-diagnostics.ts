import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { normalizePrivateProfileFailure } from '../../src/internal/private-profile.js'
import { hostTestTimingEnabled } from './host-test-timing.mjs'

const timingProfiles = new Map<string, number>()

/** Reuse the existing closed projection for successful opt-in timing observations. */
export async function reportHostTestProfile(
  suite: 'workspace' | 'foundation',
  kind: 'review' | 'run',
  path: string,
): Promise<void> {
  if (!hostTestTimingEnabled()) return
  const count = timingProfiles.get(suite) ?? 0
  if (count >= 12) return
  timingProfiles.set(suite, count + 1)
  try {
    const summary = JSON.parse(await profilePhaseSummary(path, kind))
    console.error(`host-test-profile ${JSON.stringify({ suite, kind, summary })}`)
  } catch {
    // Optional timing observations never replace command or cleanup assertions.
  }
}

export function reviewCommandEnvironment(
  command: string | undefined,
  destination: string,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const selected = { ...environment }
  delete selected.JIG_PRIVATE_PROFILE_FILE
  if (command === 'review') selected.JIG_PRIVATE_PROFILE_FILE = destination
  return selected
}

export async function profilePhaseSummary(path: string, kind: 'review' | 'run'): Promise<string> {
  const phases = new Set([
    'installed-host-opening',
    'project-session-opening',
    ...(kind === 'review'
      ? [
          'project-planning',
          'project-evaluation-review',
          'author-configuration-evaluation',
          'author-support-verification',
          'author-envelope-startup',
          'author-execution-settlement',
          'dependency-workspace-capture',
          'dependency-preparation',
          'dependency-reuse',
        ]
      : [
          'root-submission-persistence',
          'linux-owner-state-initialization',
          'rootless-containment-startup',
          'flow-execution',
          'contained-effect-planning',
          'contained-effect-allocation',
          'contained-effect-sealing',
          'contained-effect-launch',
          'contained-effect-collection',
          'contained-effect-settlement',
          'operation-owner-settlement',
          'root-fence',
          'root-settlement',
          'root-package-release',
          'root-owner-release',
        ]),
    'project-session-close',
    'package-materialization-copy',
    'package-materialization-freeze',
    'package-materialization-verification',
    'macos-guardian-preparation',
    'macos-guardian-admission',
  ])
  try {
    const file = await open(path, 'r')
    let text: string
    try {
      const bytes = Buffer.alloc(256 * 1024 + 1)
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
      if (bytesRead > 256 * 1024) return '{"status":"truncated","events":[]}'
      text = bytes.subarray(0, bytesRead).toString('utf8')
    } finally {
      await file.close()
    }
    const lines = text.trimEnd().split('\n')
    if (lines.length > 1026) return '{"status":"truncated","events":[]}'
    const events = []
    let truncated = false
    for (const line of lines) {
      const record = JSON.parse(line)
      if (record === null || typeof record !== 'object') return '{"status":"invalid","events":[]}'
      if (record.kind === 'failure') {
        const failure = normalizePrivateProfileFailure(record)
        if (failure === undefined) return '{"status":"invalid","events":[]}'
        events.push(failure)
        continue
      }
      if (record.kind === 'truncated') truncated = true
      if (!phases.has(record.phase)) continue
      if (
        !['start', 'end', 'instant'].includes(record.kind) ||
        !Number.isFinite(record.timeMs) ||
        record.timeMs < 0 ||
        record.timeMs > 86_400_000 ||
        (record.kind === 'end' && !['returned', 'failed'].includes(record.outcome))
      )
        return '{"status":"invalid","events":[]}'
      events.push({
        phase: record.phase,
        kind: record.kind,
        timeMs: record.timeMs,
        ...(record.kind === 'end' ? { outcome: record.outcome } : {}),
      })
    }
    // Keep the boundary, including failed ends, instead of an optimistic prefix.
    if (events.length > 40) truncated = true
    return JSON.stringify({
      status: truncated ? 'truncated' : 'captured',
      events: events.slice(-40),
    })
  } catch {
    // Optional trace observation must not replace the original command failure.
    return '{"status":"unavailable","events":[]}'
  }
}

function ownDiagnosticData(value: unknown, key: string): unknown {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const property = Object.getOwnPropertyDescriptor(value, key)
    return property && Object.hasOwn(property, 'value') ? property.value : undefined
  } catch {
    return undefined
  }
}

function diagnosticRecord(value: unknown): boolean {
  try {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  } catch {
    return false
  }
}

function evaluationLabel(value: unknown, allowed: readonly string[]): string | null {
  if (value === null) return null
  return typeof value === 'string' && allowed.includes(value) ? value : 'unknown'
}

/** Public evaluation facts only; never copy messages, streams, identities or invocation data. */
export function foundationEvaluationFailure(value: unknown) {
  const terminal = ownDiagnosticData(value, 'terminal')
  if (ownDiagnosticData(terminal, 'status') !== 'failed') return undefined
  const evaluation = ownDiagnosticData(ownDiagnosticData(terminal, 'details'), 'evaluation')
  if (!diagnosticRecord(evaluation)) return undefined
  const process = ownDiagnosticData(evaluation, 'process')
  const phases = ownDiagnosticData(evaluation, 'phases')
  const durationMs = ownDiagnosticData(process, 'durationMs')
  let phaseCount: number | null = null
  try {
    if (Array.isArray(phases)) {
      const length = Object.getOwnPropertyDescriptor(phases, 'length')?.value
      if (Number.isSafeInteger(length) && length >= 0 && length <= 3) phaseCount = length
    }
  } catch {}
  return {
    phase: evaluationLabel(ownDiagnosticData(evaluation, 'phase'), ['generate', 'compile', 'test']),
    stage:
      evaluationLabel(ownDiagnosticData(evaluation, 'stage'), [
        'setup',
        'preparation',
        'sealing',
        'admission',
        'collection',
        'settlement',
      ]) ?? 'unknown',
    limit: evaluationLabel(ownDiagnosticData(evaluation, 'limit'), [
      'phase',
      'evaluation',
      'enclosing',
      'unknown',
    ]),
    stopReason:
      process === null
        ? null
        : evaluationLabel(ownDiagnosticData(process, 'stopReason'), [
            'exited',
            'deadline',
            'cancelled',
          ]),
    durationMs:
      typeof durationMs === 'number' &&
      Number.isFinite(durationMs) &&
      durationMs >= 0 &&
      durationMs <= 86_400_000
        ? durationMs
        : null,
    cleanup: ownDiagnosticData(evaluation, 'cleanup') === 'complete' ? 'complete' : 'unknown',
    phaseCount,
    processCount: process === null ? 0 : diagnosticRecord(process) ? 1 : null,
  }
}

export async function foundationEvaluationFailureSummary(
  path: string,
): Promise<string | undefined> {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    let text: string
    try {
      const metadata = await file.stat()
      if (!metadata.isFile() || metadata.size > 256 * 1024) return undefined
      const bytes = Buffer.alloc(256 * 1024 + 1)
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
      if (bytesRead > 256 * 1024 || bytesRead !== metadata.size) return undefined
      text = bytes.subarray(0, bytesRead).toString('utf8')
    } finally {
      await file.close()
    }
    const summary = foundationEvaluationFailure(JSON.parse(text))
    return summary === undefined ? undefined : JSON.stringify(summary)
  } catch {
    // Optional observation must preserve the original command assertion.
    return undefined
  }
}
