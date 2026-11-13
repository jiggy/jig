import { describe, expect, test } from 'bun:test'
import {
  PrivateFiniteAcpPolicy,
  PrivateFiniteAcpPolicyError,
} from '../../src/internal/finite-acp-policy.js'
import { PRIVATE_FINITE_ACP_CHANNELS } from '../../src/internal/finite-acp-resource.js'
import type { JsonValue } from '../../src/json.js'

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const request = (id: number, method: string, params: unknown) =>
  bytes({ jsonrpc: '2.0', id, method, params })
const reply = (id: number, result: unknown) => bytes({ jsonrpc: '2.0', id, result })
const update = (payload: unknown) =>
  bytes({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId: 'owned-v2', update: payload },
  })

function admittedV2(maxTurns?: number): PrivateFiniteAcpPolicy {
  const policy = new PrivateFiniteAcpPolicy(maxTurns === undefined ? {} : { maxTurns })
  policy.fromAdapter(
    request(1, 'initialize', {
      protocolVersion: 2,
      capabilities: {},
      info: { name: 'jig-v2-client', version: '2' },
    }),
  )
  expect(
    policy.fromClient(
      reply(1, {
        protocolVersion: 2,
        capabilities: { session: {} },
        info: { name: 'selected-agent', version: '1' },
      }),
    ).toAdapter?.result,
  ).toEqual({
    protocolVersion: 2,
    capabilities: { session: {} },
    info: { name: 'jig-selected-native-agent', version: '2' },
  })
  policy.fromAdapter(request(2, 'session/new', { cwd: '/work' }))
  expect(policy.fromClient(reply(2, { sessionId: 'owned-v2' })).toAdapter?.result).toEqual({
    sessionId: 'owned-v2',
  })
  return policy
}
function prompt(policy: PrivateFiniteAcpPolicy): void {
  policy.fromAdapter(
    request(3, 'session/prompt', {
      sessionId: 'owned-v2',
      prompt: [{ type: 'text', text: 'Answer one question.' }],
    }),
  )
}

describe('v2 finite ACP host policy in explicit qualification mode', () => {
  test('wire-ready contract admits explicit v2 but refuses v1 and unknown versions', () => {
    const contract = PRIVATE_FINITE_ACP_CHANNELS.responses!.contract!
    const ready = {
      kind: 'ready',
      protocolVersion: 2,
      cwd: '/work',
      maxTurns: 1,
      configuration: [],
    } as unknown as JsonValue
    expect(() => contract.validate(ready)).not.toThrow()
    for (const version of [1, 3]) {
      const unsupported = {
        kind: 'ready',
        protocolVersion: version,
        cwd: '/work',
        maxTurns: 1,
        configuration: [],
      } as unknown as JsonValue
      expect(() => contract.validate(unsupported)).toThrow()
    }
  })

  test('requires matching insertion, fresh foreground and idle terminal state', () => {
    const policy = admittedV2()
    prompt(policy)
    expect(policy.turnActive).toBeTrue()
    expect(policy.fromClient(reply(3, { messageId: 'user-one' })).toAdapter?.result).toEqual({
      messageId: 'user-one',
    })
    expect(policy.turnActive).toBeTrue()
    expect(
      policy.fromClient(
        update({
          sessionUpdate: 'user_message',
          messageId: 'user-one',
          content: [{ type: 'text', text: 'Answer one question.' }],
        }),
      ).toAdapter?.params,
    ).toMatchObject({
      update: { sessionUpdate: 'user_message', messageId: 'user-one' },
    })
    expect(
      policy.fromClient(
        update({
          sessionUpdate: 'state_update',
          state: 'running',
        }),
      ).toAdapter?.params,
    ).toMatchObject({
      update: { sessionUpdate: 'state_update', state: 'running' },
    })
    expect(
      policy.fromClient(
        update({
          sessionUpdate: 'agent_message_chunk',
          messageId: 'answer',
          content: { type: 'text', text: 'done' },
        }),
      ).toAdapter?.params,
    ).toMatchObject({
      update: { sessionUpdate: 'agent_message_chunk', messageId: 'answer' },
    })
    expect(
      policy.fromClient(
        update({
          sessionUpdate: 'state_update',
          state: 'idle',
          stopReason: 'end_turn',
        }),
      ).toAdapter?.params,
    ).toMatchObject({
      update: { sessionUpdate: 'state_update', stopReason: 'end_turn' },
    })
    expect(policy.turnActive).toBeFalse()
    expect(policy.settledSessionId).toBe('owned-v2')
    policy.fromAdapter(request(4, 'session/close', { sessionId: 'owned-v2' }))
    expect(policy.fromClient(reply(4, {})).toAdapter?.result).toEqual({})
  })

  test('pre-acceptance updates cannot manufacture successful request completion', () => {
    const policy = admittedV2()
    prompt(policy)
    policy.fromClient(
      update({ sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' }),
    )
    expect(policy.turnActive).toBeTrue()
    policy.fromClient(update({ sessionUpdate: 'state_update', state: 'running' }))
    policy.fromClient(
      update({
        sessionUpdate: 'user_message',
        messageId: 'user-before-acceptance',
        content: [],
      }),
    )
    policy.fromClient(
      update({ sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' }),
    )
    expect(policy.turnActive).toBeTrue()
    policy.fromClient(reply(3, { messageId: 'user-before-acceptance' }))
    expect(policy.turnActive).toBeFalse()
    expect(policy.settledSessionId).toBe('owned-v2')
  })

  test('rejects whole-message content outside a foreground turn before projection', () => {
    const policy = admittedV2()
    expect(() =>
      policy.fromClient(
        update({
          sessionUpdate: 'agent_message',
          messageId: 'native-background',
          content: [{ type: 'text', text: { privatePath: '/private/native/state' } }],
        }),
      ),
    ).toThrow('ACP message arrived outside an active turn')
    expect(() => policy.assertSettled()).toThrow('closed after failure')
  })

  test('bounds whole-message output across two accepted foreground turns', () => {
    const policy = admittedV2(2)
    const text = 'x'.repeat(5 * 1_048_576)
    for (let i = 0; i < 2; i++) {
      const userId = `user-${i}`
      policy.fromAdapter(
        request(3 + i, 'session/prompt', {
          sessionId: 'owned-v2',
          prompt: [{ type: 'text', text: 'Continue.' }],
        }),
      )
      policy.fromClient(reply(3 + i, { messageId: userId }))
      policy.fromClient(update({ sessionUpdate: 'user_message', messageId: userId, content: [] }))
      policy.fromClient(update({ sessionUpdate: 'state_update', state: 'running' }))
      const message = update({
        sessionUpdate: 'agent_message',
        messageId: `answer-${i}`,
        content: [{ type: 'text', text }],
      })
      if (i === 0) {
        expect(() => policy.fromClient(message)).not.toThrow()
        policy.fromClient(
          update({ sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' }),
        )
        expect(policy.turnActive).toBeFalse()
      } else {
        expect(() => policy.fromClient(message)).toThrow('ACP v2 foreground protocol')
        expect(() => policy.assertSettled()).toThrow('closed after failure')
      }
    }
  })

  test('an error after insertion remains a failed native operation', () => {
    const policy = admittedV2()
    prompt(policy)
    policy.fromClient(reply(3, { messageId: 'user-id' }))
    policy.fromClient(update({ sessionUpdate: 'user_message', messageId: 'user-id', content: [] }))
    policy.fromClient(update({ sessionUpdate: 'state_update', state: 'running' }))
    expect(() =>
      policy.fromClient(
        update({
          sessionUpdate: 'state_update',
          state: 'idle',
          stopReason: 'error',
          error: { code: -32000, message: '/private/secret' },
        }),
      ),
    ).toThrow(PrivateFiniteAcpPolicyError)
    expect(() => policy.assertSettled()).toThrow('closed after failure')
  })

  test('reviewed v2 model and read-only mode are both confirmed through config options', () => {
    const policy = new PrivateFiniteAcpPolicy({
      configuration: [{ configId: 'model', value: 'selected-model' }],
      modeId: 'read-only',
    })
    policy.fromAdapter(
      request(1, 'initialize', {
        protocolVersion: 2,
        capabilities: {},
        info: { name: 'v2-client', version: '2' },
      }),
    )
    policy.fromClient(
      reply(1, {
        protocolVersion: 2,
        capabilities: { session: {} },
        info: { name: 'native', version: '2' },
      }),
    )
    policy.fromAdapter(request(2, 'session/new', { cwd: '/work' }))
    policy.fromClient(reply(2, { sessionId: 'owned-v2' }))
    for (const [id, configId, value] of [
      [4, 'model', 'selected-model'],
      [5, 'mode', 'read-only'],
    ] as const) {
      policy.fromAdapter(
        request(id, 'session/set_config_option', {
          sessionId: 'owned-v2',
          configId,
          type: 'id',
          value,
        }),
      )
      expect(
        policy.fromClient(
          reply(id, {
            configOptions: [{ configId, type: 'select', currentValue: value }],
          }),
        ).toAdapter?.result,
      ).toMatchObject({
        configOptions: [{ configId, currentValue: value }],
      })
    }
    prompt(policy)
    policy.fromClient(reply(3, { messageId: 'u' }))
    policy.fromClient(update({ sessionUpdate: 'user_message', messageId: 'u', content: [] }))
    policy.fromClient(update({ sessionUpdate: 'state_update', state: 'running' }))
    policy.fromClient(
      update({
        sessionUpdate: 'state_update',
        state: 'idle',
        stopReason: 'end_turn',
      }),
    )
    expect(policy.settledSessionId).toBe('owned-v2')
  })

  test('v2 refuses old-mode mutation and cross-version handshakes', () => {
    const policy = admittedV2()
    expect(() =>
      policy.fromAdapter(
        request(4, 'session/set_mode', {
          sessionId: 'owned-v2',
          modeId: 'read-only',
        }),
      ),
    ).toThrow('configuration options')
    const mismatch = new PrivateFiniteAcpPolicy()
    expect(() =>
      mismatch.fromAdapter(
        request(1, 'initialize', {
          protocolVersion: 1,
          clientCapabilities: {},
        }),
      ),
    ).toThrow(PrivateFiniteAcpPolicyError)
  })

  test('v2 accepts plan updates while waitingForCompletion is active', () => {
    const policy = admittedV2()
    prompt(policy)
    policy.fromClient(reply(3, { messageId: 'u' }))
    policy.fromClient(update({ sessionUpdate: 'user_message', messageId: 'u', content: [] }))
    policy.fromClient(update({ sessionUpdate: 'state_update', state: 'running' }))
    policy.fromClient(
      update({
        sessionUpdate: 'plan',
        entries: [{ content: 'step 1', priority: 'high', status: 'in_progress' }],
      }),
    )
    policy.fromClient(
      update({
        sessionUpdate: 'state_update',
        state: 'idle',
        stopReason: 'end_turn',
      }),
    )
    expect(policy.settledSessionId).toBe('owned-v2')
  })

  test('v2 policy tracks explicit pre-insertion rejection separately from post-acceptance state', () => {
    const rejectedPolicy = admittedV2()
    prompt(rejectedPolicy)
    expect(rejectedPolicy.hasExplicitPromptRejection).toBeFalse()
    expect(rejectedPolicy.hasAcceptedOrInsertedPrompt).toBeFalse()
    rejectedPolicy.fromClient(
      bytes({ jsonrpc: '2.0', id: 3, error: { code: -32603, message: 'rate limited' } }),
    )
    expect(rejectedPolicy.hasExplicitPromptRejection).toBeTrue()
    expect(rejectedPolicy.hasAcceptedOrInsertedPrompt).toBeFalse()

    const acceptedPolicy = admittedV2()
    prompt(acceptedPolicy)
    acceptedPolicy.fromClient(reply(3, { messageId: 'user-accepted' }))
    expect(acceptedPolicy.hasAcceptedOrInsertedPrompt).toBeTrue()
    expect(acceptedPolicy.hasExplicitPromptRejection).toBeFalse()
    expect(() =>
      acceptedPolicy.fromClient(
        update({
          sessionUpdate: 'session_info_update',
          _meta: {
            jetbrains: {
              air: {
                version: 1,
                sessionFailure: { category: 'limit', severity: 'error', httpStatusCode: 429 },
              },
            },
          },
        }),
      ),
    ).toThrow(PrivateFiniteAcpPolicyError)
    expect(acceptedPolicy.hasAcceptedOrInsertedPrompt).toBeTrue()
    expect(acceptedPolicy.hasExplicitPromptRejection).toBeFalse()
  })
})
