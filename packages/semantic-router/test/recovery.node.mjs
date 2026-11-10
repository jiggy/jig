import assert from 'node:assert/strict'
import { test } from 'node:test'
import { draftFailureAction } from '../examples/recover-draft/flows/recovery/failure-policy.mjs'

// Ordinary error-code data exercises the pure policy only. Installed native
// tests own checkpoints, artifacts, execution, cancellation and acceptance.
test('only a failed local primary is eligible for recovery; uncertainty and cancellation propagate', () => {
  assert.equal(draftFailureAction('primary', 'EXECUTION_FAILED'), 'recover')
  for (const code of ['UNCERTAIN', 'CANCELLED', 'DEADLINE_EXCEEDED', 'UNAVAILABLE',
    'RESOURCE_EXHAUSTED', 'PROTOCOL_ERROR', 'INVALID_INPUT', 'INVALID_RESULT', 'UNKNOWN'])
    assert.equal(draftFailureAction('primary', code), 'propagate', code)
})

test('checkpoint unavailability and exhausted allowance remain distinct stopped decisions', () => {
  assert.equal(draftFailureAction('checkpoint', 'UNAVAILABLE'), 'unavailable')
  assert.equal(draftFailureAction('checkpoint', 'RESOURCE_EXHAUSTED'), 'limit')
  for (const code of ['UNCERTAIN', 'CANCELLED', 'DEADLINE_EXCEEDED', 'EXECUTION_FAILED',
    'PROTOCOL_ERROR', 'INVALID_INPUT', 'INVALID_RESULT', 'UNKNOWN'])
    assert.equal(draftFailureAction('checkpoint', code), 'propagate', code)
})
