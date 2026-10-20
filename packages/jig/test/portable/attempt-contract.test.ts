import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  AttemptContractError,
  type AttemptObservation,
  parseAttemptFrame,
} from '../../src/attempt-contract.js'
import { canonicalJson, type JsonValue } from '../../src/json.js'

const digest = `sha256:${'a'.repeat(64)}`
const diagnostics = { stderr: '', stderrBytes: 0, stderrTruncated: false }
const receipt = {
  runId: 'run',
  requestDigest: digest,
  acceptedAt: '2026-01-01T00:00:00Z',
  target: 'binding:test',
  approval: digest,
  artifactResults: [],
}
function success(output: JsonValue): AttemptObservation {
  return {
    identity: 'accepted',
    dispatch: 'confirmed',
    receipt,
    execution: 'terminal',
    terminal: {
      status: 'succeeded',
      outcome: 'done',
      resultDigest: `sha256:${createHash('sha256').update(canonicalJson(output)).digest('hex')}`,
      diagnostics,
    },
    cleanup: 'confirmed',
    retained: 'available',
  }
}
function result(observation: AttemptObservation, fields: object = {}) {
  return parseAttemptFrame('result', {
    protocolVersion: 1,
    operation: 'result',
    event: 'result',
    value: { observation, artifactResults: [], ...fields },
  })
}
function observe(operation: 'lookup' | 'cancel' | 'result', observation: unknown) {
  return parseAttemptFrame(operation, {
    protocolVersion: 1,
    operation,
    event: 'result',
    value:
      operation === 'lookup'
        ? observation
        : operation === 'cancel'
          ? { acknowledged: true, observation }
          : { observation, artifactResults: [] },
  })
}

describe('attempt machine contract consistency', () => {
  test('result verifies canonical output, including null and reordered object keys', () => {
    expect(() => result(success(null), { output: null })).not.toThrow()
    expect(() =>
      result(success({ a: 1, z: [true, null] }), { output: { z: [true, null], a: 1 } }),
    ).not.toThrow()
    expect(() => result(success({ a: 1 }), { output: { a: 2 } })).toThrow(AttemptContractError)
    expect(() => result(success([1, 2]), { output: [2, 1] })).toThrow(AttemptContractError)
    expect(() => result(success(null))).toThrow(AttemptContractError)
    expect(() =>
      result({ ...success(null), cleanup: 'unresolved' }, { output: null }),
    ).not.toThrow()
  })

  test('result does not attach output to non-success or unavailable retained bytes', () => {
    for (const retained of ['expired', 'unavailable'] as const) {
      const observation = { ...success(null), retained }
      expect(() => result(observation)).not.toThrow()
      expect(() => result(observation, { output: null })).toThrow(AttemptContractError)
    }
    const failed: AttemptObservation = {
      ...success(null),
      dispatch: 'possible',
      terminal: { status: 'failed', code: 'EXECUTION_FAILED', message: 'Failed', diagnostics },
    }
    expect(() => result(failed)).not.toThrow()
    expect(() => result(failed, { output: null })).toThrow(AttemptContractError)
    expect(() =>
      result({ identity: 'prepared', dispatch: 'not-dispatched' }, { output: null }),
    ).toThrow(AttemptContractError)
    expect(() =>
      result(
        {
          identity: 'accepted',
          dispatch: 'possible',
          receipt,
          execution: 'running',
          cleanup: 'pending',
          retained: 'unavailable',
        },
        { output: null },
      ),
    ).toThrow(AttemptContractError)
  })

  for (const operation of ['lookup', 'cancel', 'result'] as const) {
    test(`${operation} rejects contradictory lifecycle fields`, () => {
      const accepted = {
        identity: 'accepted',
        dispatch: 'possible',
        receipt,
        execution: 'accepted',
        cleanup: 'pending',
        retained: 'unavailable',
      }
      for (const observation of [
        { identity: 'accepted', dispatch: 'possible' },
        { identity: 'prepared', dispatch: 'possible' },
        { identity: 'unavailable', dispatch: 'not-dispatched' },
        { identity: 'retired', dispatch: 'confirmed' },
        { identity: 'prepared', dispatch: 'not-dispatched', receipt },
        { ...accepted, execution: 'terminal' },
        { ...accepted, terminal: success(null).terminal },
        { ...accepted, dispatch: 'confirmed' },
        { ...accepted, dispatch: 'not-dispatched' },
        { ...success(null), dispatch: 'possible', retained: 'unavailable' },
      ])
        expect(() => observe(operation, observation)).toThrow(AttemptContractError)
    })

    test(`${operation} preserves preparation, missing history, retention and cleanup distinctions`, () => {
      const observations: AttemptObservation[] = [
        { identity: 'prepared', dispatch: 'not-dispatched' },
        { identity: 'retired', dispatch: 'not-dispatched' },
        ...(['retired', 'unavailable'] as const).map((identity) => ({
          identity,
          dispatch: 'possible' as const,
          retained: 'unavailable' as const,
          reason: 'IDENTITY_UNAVAILABLE' as const,
        })),
        ...(['pending', 'confirmed', 'unresolved'] as const).map((cleanup) => ({
          ...success(null),
          cleanup,
          retained: 'unavailable' as const,
        })),
        {
          ...success(null),
          dispatch: 'not-dispatched',
          terminal: { status: 'lost', code: 'COORDINATOR_LOST', message: 'Lost' },
          retained: 'expired',
        },
        {
          identity: 'accepted',
          receipt,
          dispatch: 'possible',
          execution: 'uncertain',
          cleanup: 'unresolved',
          retained: 'expired',
          reason: 'CLEANUP_UNRESOLVED',
        },
      ]
      for (const observation of observations)
        expect(() => observe(operation, observation)).not.toThrow()
    })
  }
})
