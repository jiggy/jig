import { expect, test } from 'bun:test'
import { type JsonObject, OperationError } from '@jigging/flow'
import { preserveRequestDiagnostic } from '../src/native-request-failure.js'

// Ordinary error data tests only. Native fencing and cleanup are independently
// exercised by Jig's root-agent-native-diagnostics host integration.
test.each([
  { code: 'EXECUTION_FAILED', forwarding: 'not-forwarded', cleanup: 'confirmed', preserve: true },
  {
    code: 'EXECUTION_FAILED',
    forwarding: 'not-forwarded',
    cleanup: 'unconfirmed',
    preserve: false,
  },
  { code: 'EXECUTION_FAILED', forwarding: 'attempted', cleanup: 'confirmed', preserve: false },
  { code: 'UNCERTAIN', forwarding: 'not-forwarded', cleanup: 'confirmed', preserve: false },
  { code: 'CANCELLED', forwarding: 'not-forwarded', cleanup: 'confirmed', preserve: false },
  { code: 'DEADLINE_EXCEEDED', forwarding: 'not-forwarded', cleanup: 'confirmed', preserve: false },
] as const)('request diagnostic combination respects settlement precedence: %j', (entry) => {
  const request = new OperationError('EXECUTION_FAILED', 'Validated request failure', {
    nativeRequest: {
      method: 'session/new',
      code: -32603,
      reason: 'managed-preferences-unavailable',
    },
  })
  const settlement = new OperationError(entry.code, 'Host settlement failure', {
    nativePrompt: { forwarding: entry.forwarding, cleanup: entry.cleanup, turnsSettled: 0 },
  })
  const result = preserveRequestDiagnostic(request, settlement)
  if (entry.preserve) {
    expect(result).toBeInstanceOf(OperationError)
    expect((result as OperationError).code).toBe(settlement.code)
    expect((result as OperationError).details).toEqual({
      ...(request.details as JsonObject),
      ...(settlement.details as JsonObject),
    })
    expect((result as Error).message).toBe(request.message)
  } else expect(result).toBe(settlement)
})
