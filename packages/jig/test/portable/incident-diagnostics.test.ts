import { expect, test } from 'bun:test'
import {
  incidentBranchDiagnostic,
  incidentWorkerDiagnostic,
} from '../fixtures/incident-diagnostics.js'

test('incident diagnostics retain bounded public failure codes and turn observations', () => {
  expect(
    incidentWorkerDiagnostic({
      outcome: 'blocked',
      output: {
        requestedTurns: 2,
        received: [{}, {}],
        predecessor: null,
        failures: ['DEADLINE_EXCEEDED', 'INCOMPLETE_WORK'],
      },
    }),
  ).toEqual({
    outcome: 'blocked',
    requestedTurns: 2,
    receivedTurns: 2,
    predecessorRecorded: false,
    failureCodes: ['DEADLINE_EXCEEDED', 'INCOMPLETE_WORK'],
    failuresTruncated: false,
  })
})

test('incident diagnostics exclude messages, inputs, unknown codes and exception-shaped data', () => {
  const summary = incidentWorkerDiagnostic({
    outcome: 'PRIVATE-OUTCOME',
    ticket: 'PRIVATE-TICKET',
    output: {
      requestedTurns: 'PRIVATE-TURNS',
      received: [{ input: 'PRIVATE-INPUT' }],
      predecessor: { text: 'PRIVATE-SETTLEMENT' },
      failures: ['PRIVATE-CODE', 'constructor', { code: 'PRIVATE-OBJECT' }],
      failureDetails: [{ message: 'PRIVATE-MESSAGE', stack: 'PRIVATE-STACK' }],
    },
  })
  expect(JSON.stringify(summary)).not.toContain('PRIVATE')
  expect(summary.failureCodes).toEqual(['OTHER', 'OTHER', 'OTHER'])
  expect(summary.predecessorRecorded).toBe(true)
})

test('incident diagnostics bound malformed and oversized observations', () => {
  expect(incidentWorkerDiagnostic(null).outcome).toBe('unknown')
  const summary = incidentWorkerDiagnostic({
    output: {
      requestedTurns: Number.POSITIVE_INFINITY,
      received: new Array(9).fill({}),
      failures: new Array(20).fill('EXECUTION_FAILED'),
    },
  })
  expect(summary.requestedTurns).toBeNull()
  expect(summary.receivedTurns).toBeNull()
  expect(summary.failureCodes).toHaveLength(8)
  expect(summary.failuresTruncated).toBe(true)
})

test('incident branch diagnostics expose missing results without disclosing messages', () => {
  expect(
    incidentBranchDiagnostic({
      role: 'independent',
      failure: 'UNCERTAIN',
      message: 'PRIVATE-MESSAGE',
      causes: [{ stack: 'PRIVATE-STACK' }],
    }),
  ).toEqual({ role: 'independent', hasResult: false, failureCode: 'UNCERTAIN' })
  expect(
    incidentBranchDiagnostic({
      role: 'draft',
      result: { outcome: 'blocked', output: { context: 'PRIVATE-CONTEXT' } },
    }),
  ).toEqual({ role: 'draft', hasResult: true, failureCode: null })
})

test('incident branch diagnostics allow only public outer operation codes', () => {
  for (const failure of ['PRIVATE-CODE', 'constructor', 'INCOMPLETE_WORK', { code: 'UNCERTAIN' }]) {
    const summary = incidentBranchDiagnostic({
      role: 'PRIVATE-ROLE',
      failure,
      message: 'PRIVATE-MESSAGE',
    })
    expect(summary).toEqual({ role: 'unknown', hasResult: false, failureCode: 'OTHER' })
    expect(JSON.stringify(summary)).not.toContain('PRIVATE')
  }
})

test('incident branch diagnostics ignore inherited values and never invoke accessors', () => {
  const inherited = Object.create({
    role: 'independent',
    result: { outcome: 'done' },
    failure: 'EXECUTION_FAILED',
  })
  expect(incidentBranchDiagnostic(inherited)).toEqual({
    role: 'unknown',
    hasResult: false,
    failureCode: null,
  })
  let reads = 0
  const accessors = Object.create(null)
  for (const key of ['role', 'result', 'failure', 'message'])
    Object.defineProperty(accessors, key, {
      get() {
        reads++
        throw new Error('PRIVATE-GETTER')
      },
    })
  expect(incidentBranchDiagnostic(accessors)).toEqual({
    role: 'unknown',
    hasResult: false,
    failureCode: null,
  })
  expect(reads).toBe(0)
})

test('incident branch diagnostics preserve assertion failures for malformed observations', () => {
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  for (const value of [null, undefined, 'PRIVATE', [], revoked.proxy]) {
    expect(incidentBranchDiagnostic(value)).toEqual({
      role: 'unknown',
      hasResult: false,
      failureCode: null,
    })
  }
  expect(incidentBranchDiagnostic({ role: 'draft', result: [] }).hasResult).toBe(false)
  expect(incidentBranchDiagnostic({ role: 'draft', result: null }).hasResult).toBe(false)
})

