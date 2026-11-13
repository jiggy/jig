import { describe, expect, test } from 'bun:test'
import {
  PrivateAcpV2Foreground,
  PrivateAcpV2ForegroundError,
} from '../../src/internal/finite-acp-v2-foreground.js'

const user = (messageId: string) => ({ sessionUpdate: 'user_message', messageId, content: [] })
const running = { sessionUpdate: 'state_update', state: 'running' }
const idle = (stopReason: string) => ({
  sessionUpdate: 'state_update',
  state: 'idle',
  stopReason,
})
const chunk = (messageId: string, text: string) => ({
  sessionUpdate: 'agent_message_chunk',
  messageId,
  content: { type: 'text', text },
})

describe('ACP v2 foreground completion authority', () => {
  test('RPC acceptance alone cannot settle work', () => {
    const turn = new PrivateAcpV2Foreground()
    turn.begin()
    turn.accept({ messageId: 'user-1' })
    expect(turn.acceptedMessageId).toBe('user-1')
    expect(() => turn.settle()).toThrow(PrivateAcpV2ForegroundError)
    turn.update(user('user-1'))
    turn.update(running)
    expect(() => turn.settle()).toThrow()
    turn.update(chunk('agent-1', 'ready'))
    turn.update(idle('end_turn'))
    expect(turn.settle()).toEqual({
      userMessageId: 'user-1',
      stopReason: 'end_turn',
      text: 'ready',
    })
    expect(turn.waitingForCompletion).toBeFalse()
  })

  test('notification ordering before prompt acceptance is preserved', () => {
    const turn = new PrivateAcpV2Foreground()
    turn.begin()
    turn.update(running)
    turn.update(user('inserted'))
    turn.update(chunk('answer', 'done'))
    turn.update(idle('end_turn'))
    expect(() => turn.settle()).toThrow()
    turn.accept({ messageId: 'inserted' })
    expect(turn.settle().text).toBe('done')
  })

  test('idle snapshots without fresh running state cannot forge completion', () => {
    const turn = new PrivateAcpV2Foreground()
    turn.begin()
    turn.update(idle('end_turn'))
    turn.accept({ messageId: 'first' })
    turn.update(user('first'))
    expect(() => turn.settle()).toThrow()
    turn.update(running)
    turn.update(idle('end_turn'))
    expect(turn.settle().stopReason).toBe('end_turn')
  })

  test('a foreign user message cannot acknowledge the accepted prompt', () => {
    const turn = new PrivateAcpV2Foreground()
    turn.begin()
    turn.update(user('old-user'))
    turn.accept({ messageId: 'new-user' })
    turn.update(running)
    turn.update(idle('end_turn'))
    expect(() => turn.settle()).toThrow()
    turn.update(user('new-user'))
    expect(turn.settle().userMessageId).toBe('new-user')
  })

  test('post-insertion failure is distinct from pre-insertion rejection', () => {
    for (const reason of ['cancelled', 'error']) {
      const turn = new PrivateAcpV2Foreground()
      turn.begin()
      turn.accept({ messageId: 'u' })
      turn.update(user('u'))
      turn.update(running)
      turn.update(idle(reason))
      expect(() => turn.settle()).toThrow(
        reason === 'error' ? 'failed after insertion' : 'cancelled',
      )
    }
    const refused = new PrivateAcpV2Foreground()
    refused.begin()
    refused.reject({ code: -32000, message: 'auth required' })
    expect(refused.waitingForCompletion).toBeFalse()
    refused.begin()
    refused.accept({ messageId: 'new' })
    refused.update(user('new'))
    refused.update(running)
    refused.update(idle('refusal'))
    expect(refused.settle().stopReason).toBe('refusal')
  })

  test('rejecting after a user-message update is a protocol violation', () => {
    const turn = new PrivateAcpV2Foreground()
    turn.begin()
    turn.update(user('seen'))
    expect(() => turn.reject({ code: -32603, message: 'failed' })).toThrow('conflicts')
  })

  test('v2 whole-message upsert replaces previous chunks and later chunks append', () => {
    const turn = new PrivateAcpV2Foreground()
    turn.begin()
    turn.accept({ messageId: 'u' })
    turn.update(user('u'))
    turn.update(running)
    turn.update(chunk('a', 'outdated'))
    turn.update({
      sessionUpdate: 'agent_message',
      messageId: 'a',
      content: [{ type: 'text', text: 'correct' }],
    })
    turn.update(chunk('a', 'ed'))
    turn.update({
      sessionUpdate: 'agent_message',
      messageId: 'b',
      content: [{ type: 'text', text: ' next' }],
    })
    turn.update(idle('end_turn'))
    expect(turn.settle().text).toBe('corrected next')
  })

  test('unrelated updates and repeated terminal snapshots do not change proof', () => {
    const turn = new PrivateAcpV2Foreground()
    turn.begin()
    turn.accept({ messageId: 'u' })
    turn.update(user('u'))
    turn.update({ sessionUpdate: 'usage_update', tokens: 100 })
    turn.update({ sessionUpdate: 'plan_update', planId: 'p' })
    turn.update(running)
    turn.update(chunk('a', 'ok'))
    turn.update(idle('end_turn'))
    turn.update(idle('end_turn'))
    expect(() => turn.update(idle('error'))).toThrow('Conflicting ACP v2 terminal')
    expect(turn.settle().stopReason).toBe('end_turn')
    expect(() => turn.update(idle('error'))).toThrow('Conflicting ACP v2 terminal')
    turn.begin()
    expect(() => turn.accept({ messageId: 'u' })).toThrow('reused')
  })

  test('unknown completion reasons, nontext patches and excessive cumulative output fail closed', () => {
    const turn = new PrivateAcpV2Foreground()
    turn.begin()
    turn.accept({ messageId: 'u' })
    turn.update(user('u'))
    turn.update(running)
    expect(() => turn.update(idle('invented-success'))).toThrow('known reason')

    const malformed = new PrivateAcpV2Foreground()
    malformed.begin()
    malformed.accept({ messageId: 'u' })
    expect(() =>
      malformed.update({
        sessionUpdate: 'agent_message',
        messageId: 'a',
        content: [{ type: 'image', data: 'not public text' }],
      }),
    ).toThrow('non-text')

    const large = new PrivateAcpV2Foreground()
    large.begin()
    large.accept({ messageId: 'u' })
    expect(() => large.update(chunk('a', 'x'.repeat(8_388_609)))).toThrow('capacity')
  })
})
