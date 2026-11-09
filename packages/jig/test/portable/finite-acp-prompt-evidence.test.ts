import { describe, expect, test } from 'bun:test'
import {
  PrivateFiniteAcpTaskPromptEvidence,
  privateFiniteAcpMaySelectNextCandidate,
  privateFiniteAcpTaskPromptEvidence,
  privateFiniteAcpTaskPromptNotForwarded,
} from '../../src/internal/finite-acp-prompt-evidence.js'

describe('trusted task-prompt forwarding evidence', () => {
  const eligible = (error: unknown, changes: Record<string, boolean> = {}) =>
    privateFiniteAcpMaySelectNextCandidate({
      error,
      recovered: true,
      cancelled: false,
      deadlineExceeded: false,
      ...changes,
    })

  test('distinguishes native process startup from a task prompt write', () => {
    const tracker = new PrivateFiniteAcpTaskPromptEvidence()
    tracker.beforeNativeWrite('initialize')
    tracker.beforeNativeWrite('session/new')
    tracker.beforeNativeWrite('session/set_config_option')
    const error = new Error('ACP native startup failed')
    tracker.noteFailure(error)
    expect(privateFiniteAcpTaskPromptNotForwarded(error)).toBeTrue()
    expect(eligible(error)).toBeTrue()
    expect(privateFiniteAcpTaskPromptEvidence(error)).toEqual({
      forwarding: 'not-forwarded',
      turnsSettled: 0,
    })
  })

  test('attests zero-output first-turn rejection only after explicit pre-insertion rejection', () => {
    const tracker = new PrivateFiniteAcpTaskPromptEvidence()
    tracker.beforeNativeWrite('session/prompt')
    tracker.recordPreInsertionRejection()
    const rejection = new Error('rate limit reached')
    tracker.noteFailure(rejection, true)
    expect(privateFiniteAcpTaskPromptNotForwarded(rejection)).toBeFalse()
    expect(privateFiniteAcpTaskPromptEvidence(rejection)).toEqual({
      forwarding: 'rejected-without-output',
      turnsSettled: 0,
    })

    // Without explicit pre-insertion rejection, async session failures remain uncertain
    const trackerUnrejected = new PrivateFiniteAcpTaskPromptEvidence()
    trackerUnrejected.beforeNativeWrite('session/prompt')
    const asyncFailure = new Error('async session failure')
    trackerUnrejected.noteFailure(asyncFailure, true)
    expect(privateFiniteAcpTaskPromptEvidence(asyncFailure)).toBeUndefined()
    expect(eligible(asyncFailure)).toBeFalse()

    // Once accepted/inserted, zero-output session failures remain ineligible for replay
    const trackerAccepted = new PrivateFiniteAcpTaskPromptEvidence()
    trackerAccepted.beforeNativeWrite('session/prompt')
    trackerAccepted.recordPromptAccepted()
    const postAcceptError = new Error('limit reached after accept')
    trackerAccepted.noteFailure(postAcceptError, true)
    expect(privateFiniteAcpTaskPromptEvidence(postAcceptError)).toBeUndefined()
    expect(eligible(postAcceptError)).toBeFalse()

    // If output was already emitted, zero-output rejection cannot be attested
    const trackerWithOutput = new PrivateFiniteAcpTaskPromptEvidence()
    trackerWithOutput.beforeNativeWrite('session/prompt')
    trackerWithOutput.recordPreInsertionRejection()
    trackerWithOutput.recordOutput()
    const errorAfterOutput = new Error('crashed mid-turn')
    trackerWithOutput.noteFailure(errorAfterOutput, true)
    expect(privateFiniteAcpTaskPromptEvidence(errorAfterOutput)).toBeUndefined()

    // If turn 1 settled, turn 2 rejection cannot be attested as first-turn rejection
    const trackerTurn2 = new PrivateFiniteAcpTaskPromptEvidence()
    trackerTurn2.beforeNativeWrite('session/prompt')
    trackerTurn2.recordPromptAccepted()
    trackerTurn2.recordTurnSettled()
    trackerTurn2.beforeNativeWrite('session/prompt')
    trackerTurn2.recordPreInsertionRejection()
    const errorTurn2 = new Error('turn 2 limit')
    trackerTurn2.noteFailure(errorTurn2, true)
    expect(privateFiniteAcpTaskPromptEvidence(errorTurn2)).toBeUndefined()
    expect(privateFiniteAcpTaskPromptNotForwarded(errorTurn2)).toBeFalse()
    expect(eligible(errorTurn2)).toBeFalse()
  })

  test('never downgrades a failed or partly written task prompt into safe replay', () => {
    const tracker = new PrivateFiniteAcpTaskPromptEvidence()
    tracker.beforeNativeWrite('session/prompt')
    const error = new Error('write may have reached the native process')
    tracker.noteFailure(error, false)
    expect(privateFiniteAcpTaskPromptNotForwarded(error)).toBeFalse()
    expect(eligible(error)).toBeFalse()
  })

  test('never derives authority from a forged or copied error object', () => {
    const error = new Error('connection failure')
    ;(error as Error & { promptForwarding: string }).promptForwarding = 'not-forwarded'
    expect(eligible(error)).toBeFalse()
    const other = new Error('same message')
    const tracker = new PrivateFiniteAcpTaskPromptEvidence()
    tracker.noteFailure(other)
    expect(eligible({ ...other, promptForwarding: 'not-forwarded' })).toBeFalse()
    expect(eligible(new Error(other.message))).toBeFalse()
  })

  test('cleanup, cancellation and deadline are independent absolute vetoes', () => {
    const tracker = new PrivateFiniteAcpTaskPromptEvidence()
    const error = new Error('no task prompt')
    tracker.noteFailure(error)
    for (const changes of [
      { recovered: false },
      { cancelled: true },
      { deadlineExceeded: true },
      { recovered: false, cancelled: true },
    ])
      expect(eligible(error, changes)).toBeFalse()
    expect(eligible(error)).toBeTrue()
  })
})
