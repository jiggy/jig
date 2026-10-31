import { OperationError, type OperationErrorCode } from '@jigging/flow'

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
const helperMessages = new Set([
  'Agent replies ended before accepted conversation close',
  'Agent reply has an unexpected turn',
  'Agent sent an out-of-order turn result',
  'Agent sent an unexpected control reply',
  'Application left a live Agent turn unfinished',
  'Agent omitted matching conversation settlement',
])
const nativePhases = [
  ['starting the native client', 'start-client'],
  ['exchanging native messages', 'exchange-messages'],
  ['collecting authorized session state', 'collect-session'],
  ['fencing and cleanup', 'fence-cleanup'],
] as const
const nativeReasons = [
  ['', 'unclassified'],
  [
    ' The native client reported a session failure; private details were withheld.',
    'native-session',
  ],
  [' The finite ACP exchange violated its validated protocol.', 'protocol'],
] as const
const nativeMethods = new Set([
  'initialize',
  'session/new',
  'session/resume',
  'session/set_config_option',
  'session/set_mode',
  'session/prompt',
])
const nativeCategories = new Set(['connection', 'access', 'limit', 'request', 'service', 'unknown'])

function ownValue(value: unknown, key: PropertyKey): unknown {
  if (value === null || typeof value !== 'object') return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function exactRecord(value: unknown, keys: readonly string[]): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const actual = Reflect.ownKeys(value)
  return (
    actual.length === keys.length &&
    actual.every(
      (key) =>
        typeof key === 'string' &&
        keys.includes(key) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'),
    )
  )
}

function nativeFailure(message: unknown) {
  if (message === 'the native provider did not prove an ordinary or controlled terminal')
    return { phase: 'terminal', reason: 'unproved-terminal' }
  for (const [text, phase] of nativePhases) {
    for (const [suffix, reason] of nativeReasons) {
      if (
        message ===
        `Finite ACP dispatch may have occurred but no result was proved while ${text}.${suffix}`
      )
        return { phase, reason }
    }
  }
  return undefined
}

function nativeRequest(details: unknown) {
  if (!exactRecord(details, ['nativeRequest'])) return undefined
  const request = ownValue(details, 'nativeRequest')
  const withReason = exactRecord(request, ['method', 'code', 'reason'])
  if (!withReason && !exactRecord(request, ['method', 'code'])) return undefined
  const method = ownValue(request, 'method')
  const code = ownValue(request, 'code')
  if (
    typeof method !== 'string' ||
    !nativeMethods.has(method) ||
    typeof code !== 'number' ||
    !Number.isSafeInteger(code)
  )
    return undefined
  if (!withReason) return { method, code }
  if (
    method !== 'session/new' ||
    code !== -32603 ||
    ownValue(request, 'reason') !== 'managed-preferences-unavailable'
  )
    return undefined
  return { method, code, reason: 'managed-preferences-unavailable' }
}

function nativeSession(details: unknown) {
  try {
    if (!exactRecord(details, ['nativeSession'])) return undefined
    const session = ownValue(details, 'nativeSession')
    if (
      !exactRecord(session, ['category']) &&
      !exactRecord(session, ['category', 'httpStatusCode'])
    )
      return undefined
    const category = ownValue(session, 'category')
    if (typeof category !== 'string' || !nativeCategories.has(category)) return undefined
    const status = ownValue(session, 'httpStatusCode')
    return {
      category,
      ...(typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
        ? { httpStatusCode: status }
        : {}),
    }
  } catch {
    return undefined
  }
}

function projectError(error: unknown) {
  try {
    if (error instanceof OperationError) {
      const selected = ownValue(error, 'code')
      const code =
        typeof selected === 'string' && Object.hasOwn(operationCodes, selected) ? selected : 'other'
      const projection = { kind: 'operation', code }
      try {
        if (code === 'UNCERTAIN') {
          const native = nativeFailure(ownValue(error, 'message'))
          if (native !== undefined) {
            const session =
              native.reason === 'native-session'
                ? nativeSession(ownValue(error, 'details'))
                : undefined
            return {
              ...projection,
              native: { ...native, ...session },
            }
          }
        }
        if (code === 'EXECUTION_FAILED') {
          const request = nativeRequest(ownValue(error, 'details'))
          if (request !== undefined) return { ...projection, nativeRequest: request }
        }
      } catch {
        // Optional facts must never replace the original operation code.
      }
      return projection
    }
    const message = error instanceof Error ? ownValue(error, 'message') : undefined
    return {
      kind: 'helper',
      cause: typeof message === 'string' && helperMessages.has(message) ? message : 'unclassified',
    }
  } catch {
    return { kind: 'helper', cause: 'unclassified' }
  }
}

/** Closed observations of existing errors, without arbitrary messages or host proof. */
export function nativeConversationErrorDiagnostic(error: unknown) {
  try {
    const causes = ownValue(error, 'errors')
    const count = ownValue(causes, 'length')
    if (
      Array.isArray(causes) &&
      typeof count === 'number' &&
      Number.isSafeInteger(count) &&
      count >= 0
    ) {
      const errors = []
      for (let index = 0; index < Math.min(count, 8); index++)
        errors.push(projectError(ownValue(causes, String(index))))
      return { errorCount: count, errorsTruncated: count > 8, errors }
    }
  } catch {
    // Revoked proxies and malformed observations cannot replace the failure.
  }
  return { errorCount: null, errorsTruncated: false, errors: [] }
}
