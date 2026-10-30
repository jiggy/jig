import type { OperationErrorCode } from '@jigging/flow'

const operationCodes: Record<OperationErrorCode, true> = {
  CANCELLED: true,
  DEADLINE_EXCEEDED: true,
  OWNER_CLOSED: true,
  OPERATION_CONFLICT: true,
  UNAVAILABLE: true,
  PERMISSION_DENIED: true,
  RESOURCE_EXHAUSTED: true,
  INVALID_INPUT: true,
  INVALID_RESULT: true,
  UNCERTAIN: true,
  EXECUTION_FAILED: true,
  LAGGED: true,
  DISCONNECTED: true,
  PROTOCOL_ERROR: true,
  CHANNEL_LOST: true,
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function turnCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8
    ? value
    : null
}

/** Retained application observations only, never messages, context or host proof. */
export function incidentWorkerDiagnostic(value: unknown) {
  const result = record(value)
  const output = record(result.output)
  const failures = Array.isArray(output.failures) ? output.failures : []
  return {
    outcome: result.outcome === 'done' || result.outcome === 'blocked' ? result.outcome : 'unknown',
    requestedTurns: turnCount(output.requestedTurns),
    receivedTurns: Array.isArray(output.received) ? turnCount(output.received.length) : null,
    predecessorRecorded: output.predecessor !== null && output.predecessor !== undefined,
    failureCodes: failures
      .slice(0, 8)
      .map((code: unknown) =>
        typeof code === 'string' &&
        (code === 'INCOMPLETE_WORK' || Object.hasOwn(operationCodes, code))
          ? code
          : 'OTHER',
      ),
    failuresTruncated: failures.length > 8,
  }
}

function ownData(value: unknown, key: string): unknown {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

/** Root branch presence and public operation codes only; messages remain private. */
export function incidentBranchDiagnostic(value: unknown) {
  const role = ownData(value, 'role')
  const result = ownData(value, 'result')
  const failure = ownData(value, 'failure')
  let hasResult = false
  try {
    hasResult = result !== null && typeof result === 'object' && !Array.isArray(result)
  } catch {
    // A malformed observation cannot replace the original assertion failure.
  }
  return {
    role: role === 'draft' || role === 'independent' ? role : 'unknown',
    hasResult,
    failureCode:
      failure === undefined
        ? null
        : typeof failure === 'string' && Object.hasOwn(operationCodes, failure)
          ? failure
          : 'OTHER',
  }
}

