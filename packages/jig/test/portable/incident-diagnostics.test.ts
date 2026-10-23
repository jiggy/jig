import { expect, test } from 'bun:test'
import { incidentWorkerDiagnostic } from '../fixtures/incident-diagnostics.js'

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
