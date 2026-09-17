import { describe, expect, test } from 'bun:test'

import {
  PRIVATE_FINITE_ACP_LIMITS as LIMITS,
  PrivateFiniteAcpPolicy,
  PrivateFiniteAcpPolicyError,
  type PrivateFiniteAcpConfiguration,
} from '../src/internal/finite-acp-policy.js'

const encoder = new TextEncoder()
const bytes = (value: unknown): Uint8Array => encoder.encode(JSON.stringify(value))
const request = (id: string | number, method: string, params: unknown) =>
  bytes({ jsonrpc: '2.0', id, method, params })
const reply = (id: string | number, result: unknown) => bytes({ jsonrpc: '2.0', id, result })
const notification = (method: string, params: unknown) => bytes({ jsonrpc: '2.0', method, params })

function initialize(policy: PrivateFiniteAcpPolicy, close = true): void {
  policy.fromAdapter(
    request(1, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'ordinary-flow', version: '1' },
    }),
  )
  policy.fromClient(
    reply(1, {
      protocolVersion: 1,
      agentCapabilities: close ? { sessionCapabilities: { close: {} } } : {},
    }),
  )
}

function session(
  configuration: PrivateFiniteAcpConfiguration = {},
  close = true,
): PrivateFiniteAcpPolicy {
  const policy = new PrivateFiniteAcpPolicy(configuration)
  initialize(policy, close)
  policy.fromAdapter(request(2, 'session/new', { cwd: '/work', mcpServers: [] }))
  policy.fromClient(reply(2, { sessionId: 'owned-session' }))
  return policy
}

function prompt(policy: PrivateFiniteAcpPolicy, text = 'Answer once.'): void {
  policy.fromAdapter(
    request(10, 'session/prompt', { sessionId: 'owned-session', prompt: [{ type: 'text', text }] }),
  )
}

const update = (value: unknown, sessionId = 'owned-session'): Uint8Array =>
  notification('session/update', { sessionId, update: value })

function deniesAndCloses(policy: PrivateFiniteAcpPolicy, action: () => unknown): void {
  expect(action).toThrow(PrivateFiniteAcpPolicyError)
  expect(() => policy.fromAdapter(request(99, 'initialize', { protocolVersion: 1 }))).toThrow(
    'closed after failure',
  )
  expect(() => policy.assertSettled()).toThrow('closed after failure')
}

describe('finite ACP authority policy', () => {
  test('resume names only the claimed session, never a fallback new session', () => {
    const policy = new PrivateFiniteAcpPolicy({ restoreSessionId: 'saved-session' })
    policy.fromAdapter(request(1, 'initialize', { protocolVersion: 1 }))
    policy.fromClient(
      reply(1, { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} } } }),
    )
    policy.fromAdapter(
      request(2, 'session/resume', { sessionId: 'saved-session', cwd: '/work', mcpServers: [] }),
    )
    expect(policy.fromClient(reply(2, { configOptions: [] }))).toEqual({
      toAdapter: { jsonrpc: '2.0', id: 2, result: {} },
    })
    policy.fromAdapter(
      request(3, 'session/prompt', {
        sessionId: 'saved-session',
        prompt: [{ type: 'text', text: 'Continue' }],
      }),
    )
    policy.fromClient(reply(3, { stopReason: 'end_turn' }))
    expect(policy.settledSessionId).toBe('saved-session')
    for (const method of ['session/new', 'session/resume']) {
      const other = new PrivateFiniteAcpPolicy({ restoreSessionId: 'saved-session' })
      other.fromAdapter(request(1, 'initialize', { protocolVersion: 1 }))
      other.fromClient(
        reply(1, {
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { resume: {} } },
        }),
      )
      expect(() =>
        other.fromAdapter(
          request(2, method, { sessionId: 'foreign', cwd: '/work', mcpServers: [] }),
        ),
      ).toThrow()
    }
    const noSupport = new PrivateFiniteAcpPolicy({ restoreSessionId: 'saved-session' })
    noSupport.fromAdapter(request(1, 'initialize', { protocolVersion: 1 }))
    expect(() => noSupport.fromClient(reply(1, { protocolVersion: 1 }))).toThrow('does not support')
    const ordinary = new PrivateFiniteAcpPolicy()
    initialize(ordinary)
    expect(() =>
      ordinary.fromAdapter(
        request(2, 'session/resume', { sessionId: 'saved-session', cwd: '/work', mcpServers: [] }),
      ),
    ).toThrow()
  })
  test('only an explicit turn allowance permits serial continuation, including after cancellation', () => {
    const policy = session({ maxTurns: 2 })
    prompt(policy)
    policy.fromAdapter(notification('session/cancel', { sessionId: 'owned-session' }))
    expect(policy.turnActive).toBe(true)
    policy.fromClient(reply(10, { stopReason: 'cancelled' }))
    expect(policy.turnActive).toBe(false)
    policy.assertSettled()
    policy.fromAdapter(
      request(11, 'session/prompt', {
        sessionId: 'owned-session',
        prompt: [{ type: 'text', text: 'Follow-up.' }],
      }),
    )
    expect(policy.turnActive).toBe(true)
    expect(() => policy.assertSettled()).toThrow()
  })

  test('aggregate turn allowance is consumed at dispatch and never replenished', () => {
    const policy = session({ maxTurns: 2 })
    for (const id of [10, 11]) {
      policy.fromAdapter(
        request(id, 'session/prompt', {
          sessionId: 'owned-session',
          prompt: [{ type: 'text', text: 'Next.' }],
        }),
      )
      policy.fromClient(reply(id, { stopReason: 'end_turn' }))
    }
    deniesAndCloses(policy, () =>
      policy.fromAdapter(
        request(12, 'session/prompt', {
          sessionId: 'owned-session',
          prompt: [{ type: 'text', text: 'Excess.' }],
        }),
      ),
    )
  })

  test('public answer text between turns is rejected rather than attributed to another turn', () => {
    const policy = session({ maxTurns: 2 })
    prompt(policy)
    policy.fromClient(reply(10, { stopReason: 'end_turn' }))
    deniesAndCloses(policy, () =>
      policy.fromClient(
        update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Late.' } }),
      ),
    )
  })

  test('one reviewed turn with exact configuration, mode, observations and close', () => {
    const policy = session({
      configuration: [{ configId: 'model', value: 'reviewed-model' }],
      modeId: 'read-only',
    })
    policy.fromAdapter(
      request(3, 'session/set_config_option', {
        sessionId: 'owned-session',
        configId: 'model',
        value: 'reviewed-model',
      }),
    )
    expect(
      policy.fromClient(
        reply(3, {
          configOptions: [
            { id: 'model', currentValue: 'reviewed-model', _meta: { private: 'hidden' } },
          ],
        }),
      ).toAdapter,
    ).toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: {
        configOptions: [
          {
            id: 'model',
            name: 'model',
            type: 'select',
            currentValue: 'reviewed-model',
            options: [{ value: 'reviewed-model', name: 'reviewed-model' }],
          },
        ],
      },
    })
    policy.fromAdapter(
      request(4, 'session/set_mode', { sessionId: 'owned-session', modeId: 'read-only' }),
    )
    policy.fromClient(reply(4, {}))
    prompt(policy)
    expect(
      policy.fromClient(
        update({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Useful answer.', _meta: { hidden: true } },
          _meta: { private: true },
        }),
      ),
    ).toEqual({
      toAdapter: {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'owned-session',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Useful answer.' },
          },
        },
      },
    })
    expect(
      policy.fromClient(reply(10, { stopReason: 'end_turn', _meta: { private: true } })),
    ).toEqual({ toAdapter: { jsonrpc: '2.0', id: 10, result: { stopReason: 'end_turn' } } })
    policy.assertSettled()
    policy.fromAdapter(request(11, 'session/close', { sessionId: 'owned-session' }))
    policy.fromClient(reply(11, {}))
    policy.assertSettled()
  })

  test('snapshots reviewed policy before caller mutation', () => {
    const configuration = {
      configuration: [{ configId: 'model', value: 'reviewed' }],
      modeId: 'read-only',
    }
    const policy = session(configuration)
    configuration.configuration[0]!.value = 'attacker'
    configuration.modeId = 'unrestricted'
    deniesAndCloses(policy, () =>
      policy.fromAdapter(
        request(3, 'session/set_config_option', {
          sessionId: 'owned-session',
          configId: 'model',
          value: 'attacker',
        }),
      ),
    )
  })

  test('rejects open, malformed, ambiguous or accessor-bearing policy without evaluating it', () => {
    for (const policy of [
      { extra: true },
      { configuration: null },
      { configuration: [{ configId: 'model', value: 'x', extra: true }] },
      {
        configuration: [
          { configId: 'model', value: 'x' },
          { configId: 'model', value: 'y' },
        ],
      },
      { configuration: [{ configId: 'flag', type: 'boolean', value: 'true' }] },
      { modeId: '' },
    ])
      expect(() => new PrivateFiniteAcpPolicy(policy as PrivateFiniteAcpConfiguration)).toThrow()
    let invoked = false
    const policy = Object.defineProperty({}, 'modeId', {
      enumerable: true,
      get() {
        invoked = true
        return 'dangerous'
      },
    })
    expect(() => new PrivateFiniteAcpPolicy(policy)).toThrow()
    expect(invoked).toBe(false)
  })

  test('exact boolean configuration is independent of peer metadata', () => {
    const policy = session({ configuration: [{ configId: 'fast', type: 'boolean', value: false }] })
    policy.fromAdapter(
      request(3, 'session/set_config_option', {
        sessionId: 'owned-session',
        configId: 'fast',
        type: 'boolean',
        value: false,
      }),
    )
    policy.fromClient(reply(3, { configOptions: [{ id: 'fast', currentValue: false }] }))
    prompt(policy)
    policy.fromClient(reply(10, { stopReason: 'refusal' }))
    policy.assertSettled() // Protocol accounting is not successful Agent work.
  })

  test.each([
    { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true } } },
    { protocolVersion: 1, clientCapabilities: { terminal: true } },
    { protocolVersion: 1, clientCapabilities: { auth: { _meta: { gateway: true } } } },
    { protocolVersion: 1, _meta: { arbitrary: true } },
    { protocolVersion: 2 },
  ])('rejects additional initialization authority: %j', (params) => {
    const policy = new PrivateFiniteAcpPolicy()
    deniesAndCloses(policy, () => policy.fromAdapter(request(1, 'initialize', params)))
  })

  test.each([
    { cwd: '/tmp/pi-agent', mcpServers: [] },
    { cwd: '/work', mcpServers: [{ name: 'evil', command: '/bin/sh', args: [] }] },
    { cwd: '/work', mcpServers: [], _meta: { claudeCode: { options: { tools: ['Bash'] } } } },
    { cwd: '/work', mcpServers: [], additionalDirectories: ['/tmp'] },
  ])('rejects changed session authority: %j', (params) => {
    const policy = new PrivateFiniteAcpPolicy()
    initialize(policy)
    deniesAndCloses(policy, () => policy.fromAdapter(request(2, 'session/new', params)))
  })

  test.each([
    'authenticate',
    'providers/set',
    'session/load',
    'session/fork',
    'session/resume',
    'session/steer',
    'session/goal',
    'unknown/method',
  ])('rejects %s without dispatch', (method) => {
    const policy = session()
    deniesAndCloses(policy, () =>
      policy.fromAdapter(request(3, method, { sessionId: 'owned-session' })),
    )
  })

  test('requires reviewed configuration and mode before prompting', () => {
    const policy = session({
      configuration: [{ configId: 'model', value: 'reviewed' }],
      modeId: 'read-only',
    })
    deniesAndCloses(policy, () => prompt(policy))
    const second = session({ modeId: 'read-only' })
    deniesAndCloses(second, () =>
      second.fromAdapter(
        request(3, 'session/set_mode', { sessionId: 'owned-session', modeId: 'unrestricted' }),
      ),
    )
  })

  test.each([
    { configOptions: [{ id: 'model', currentValue: 'different' }] },
    {
      configOptions: [
        { id: 'model', currentValue: 'reviewed' },
        { id: 'model', currentValue: 'different' },
      ],
    },
    { configOptions: [] },
  ])('peer responses cannot replace or ambiguously confirm policy: %j', (result) => {
    const policy = session({ configuration: [{ configId: 'model', value: 'reviewed' }] })
    policy.fromAdapter(
      request(3, 'session/set_config_option', {
        sessionId: 'owned-session',
        configId: 'model',
        value: 'reviewed',
      }),
    )
    deniesAndCloses(policy, () => policy.fromClient(reply(3, result)))
  })

  test.each(['', '/compact', ' \n/autocompact on', '\u2003/model other', 'hello\0world'])(
    'rejects forbidden text %j',
    (text) => {
      const policy = session()
      deniesAndCloses(policy, () => prompt(policy, text))
    },
  )

  test.each([
    [[{ type: 'resource_link', uri: 'file:///tmp/auth.json', name: 'secret' }]],
    [
      [
        { type: 'text', text: '/', _meta: {} },
        { type: 'text', text: 'compact' },
      ],
    ],
    [[{ type: 'text', text: 'Answer', annotations: { injected: true } }]],
  ])('rejects non-profile prompt content %j', (content) => {
    const policy = session()
    deniesAndCloses(policy, () =>
      policy.fromAdapter(
        request(10, 'session/prompt', { sessionId: 'owned-session', prompt: content }),
      ),
    )
  })

  test('prompt allowance stays consumed if the caller cannot write the accepted frame', () => {
    const policy = session()
    prompt(policy) // No transport writes occur in these tests.
    deniesAndCloses(policy, () =>
      policy.fromAdapter(
        request(11, 'session/prompt', {
          sessionId: 'owned-session',
          prompt: [{ type: 'text', text: 'retry' }],
        }),
      ),
    )
  })

  test('a completed prompt cannot authorize a second prompt or session', () => {
    for (const method of ['session/prompt', 'session/new']) {
      const policy = session()
      prompt(policy)
      policy.fromClient(reply(10, { stopReason: 'end_turn' }))
      deniesAndCloses(policy, () =>
        policy.fromAdapter(
          request(
            11,
            method,
            method === 'session/new'
              ? { cwd: '/work', mcpServers: [] }
              : { sessionId: 'owned-session', prompt: [{ type: 'text', text: 'again' }] },
          ),
        ),
      )
    }
  })

  test('duplicate request IDs stay unavailable after their response', () => {
    const policy = session()
    deniesAndCloses(policy, () =>
      policy.fromAdapter(
        request(1, 'session/prompt', {
          sessionId: 'owned-session',
          prompt: [{ type: 'text', text: 'answer' }],
        }),
      ),
    )
  })

  test('accepted adapter frames are deeply immutable and detached from input bytes', () => {
    const policy = new PrivateFiniteAcpPolicy()
    const data = request(1, 'initialize', { protocolVersion: 1, clientCapabilities: {} })
    const frame = policy.fromAdapter(data)
    data.fill(0)
    expect(Object.isFrozen(frame)).toBe(true)
    expect(Object.isFrozen(frame.params)).toBe(true)
    expect(frame.params).toEqual({ protocolVersion: 1, clientCapabilities: {} })
  })

  test.each([null, 1.5, '', 'x'.repeat(LIMITS.identifierBytes + 1)])(
    'rejects invalid request ID %#',
    (id) => {
      const policy = new PrivateFiniteAcpPolicy()
      deniesAndCloses(policy, () =>
        policy.fromAdapter(
          bytes({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: 1 } }),
        ),
      )
    },
  )

  test('bounds native session identity before retaining it', () => {
    const policy = new PrivateFiniteAcpPolicy()
    initialize(policy)
    policy.fromAdapter(request(2, 'session/new', { cwd: '/work', mcpServers: [] }))
    deniesAndCloses(policy, () =>
      policy.fromClient(reply(2, { sessionId: 'x'.repeat(LIMITS.identifierBytes + 1) })),
    )
  })

  test('only the correlated session/new response establishes owned identity', () => {
    const policy = new PrivateFiniteAcpPolicy()
    initialize(policy)
    policy.fromAdapter(request(2, 'session/new', { cwd: '/work', mcpServers: [] }))
    expect(
      policy.fromClient(
        update(
          { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'early' } },
          'forged',
        ),
      ),
    ).toEqual({})
    policy.fromClient(reply(2, { sessionId: 'owned-session' }))
    deniesAndCloses(policy, () =>
      policy.fromClient(update({ sessionUpdate: 'plan', entries: [] }, 'forged')),
    )
  })

  test.each(['session/prompt', 'session/cancel', 'session/close'])(
    'rejects foreign-session %s',
    (method) => {
      const policy = session()
      prompt(policy)
      policy.fromClient(reply(10, { stopReason: 'end_turn' }))
      deniesAndCloses(policy, () =>
        policy.fromAdapter(
          method === 'session/cancel'
            ? notification(method, { sessionId: 'foreign' })
            : request(12, method, {
                sessionId: 'foreign',
                ...(method === 'session/prompt'
                  ? { prompt: [{ type: 'text', text: 'answer' }] }
                  : {}),
              }),
        ),
      )
    },
  )

  test('permission identifiers only receive cancelled, even for a peer-named session', () => {
    const policy = session()
    prompt(policy)
    const denied = policy.fromClient(
      request('permission', 'session/request_permission', {
        sessionId: 'foreign',
        toolCall: { toolCallId: 'tool' },
        options: [
          { optionId: 'same', kind: 'allow_always' },
          { optionId: 'same', kind: 'reject_once' },
        ],
      }),
    )
    expect(denied).toEqual({
      toClient: { jsonrpc: '2.0', id: 'permission', result: { outcome: { outcome: 'cancelled' } } },
    })
    expect(Object.isFrozen(denied.toClient?.result)).toBe(true)
    policy.fromClient(reply(10, { stopReason: 'refusal' }))
    policy.assertSettled()
  })

  test('the adapter cannot forge a peer permission response', () => {
    const policy = session()
    prompt(policy)
    deniesAndCloses(policy, () =>
      policy.fromAdapter(
        reply('permission', { outcome: { outcome: 'selected', optionId: 'allow' } }),
      ),
    )
  })

  test('duplicate and excessive peer permission requests fail closed', () => {
    const policy = session()
    const packet = request('permission', 'session/request_permission', {})
    policy.fromClient(packet)
    deniesAndCloses(policy, () => policy.fromClient(packet))
    const second = session()
    for (let index = 0; index < LIMITS.permissions; index += 1)
      second.fromClient(request(index, 'session/request_permission', {}))
    deniesAndCloses(second, () =>
      second.fromClient(request(LIMITS.permissions, 'session/request_permission', {})),
    )
  })

  test('cancellation leaves the pending prompt owned until its response', () => {
    const policy = session()
    prompt(policy)
    expect(
      policy.fromAdapter(notification('session/cancel', { sessionId: 'owned-session' })).method,
    ).toBe('session/cancel')
    policy.fromClient(reply(10, { stopReason: 'cancelled' }))
    policy.assertSettled()
    const second = session()
    prompt(second)
    second.fromAdapter(notification('session/cancel', { sessionId: 'owned-session' }))
    deniesAndCloses(second, () => second.assertSettled())
  })

  test('native errors expose no raw diagnostic text or metadata', () => {
    const policy = session()
    prompt(policy)
    expect(
      policy.fromClient(
        bytes({
          jsonrpc: '2.0',
          id: 10,
          error: {
            code: -32603,
            message: 'secret-token /private/file',
            data: { authorization: 'secret-token' },
          },
        }),
      ),
    ).toEqual({
      toAdapter: {
        jsonrpc: '2.0',
        id: 10,
        error: { code: -32603, message: 'Native ACP request failed' },
      },
    })
    policy.assertSettled() // An error is settled protocol, not a successful outcome.
    deniesAndCloses(policy, () =>
      policy.fromAdapter(
        request(11, 'session/prompt', {
          sessionId: 'owned-session',
          prompt: [{ type: 'text', text: 'retry' }],
        }),
      ),
    )
  })

  test('unknown and duplicate native replies cannot change the pending request', () => {
    const policy = session()
    prompt(policy)
    deniesAndCloses(policy, () => policy.fromClient(reply(999, { stopReason: 'end_turn' })))
    const second = session()
    prompt(second)
    second.fromClient(reply(10, { stopReason: 'end_turn' }))
    deniesAndCloses(second, () => second.fromClient(reply(10, { stopReason: 'end_turn' })))
  })

  test('requires advertised close support and settles a pending close explicitly', () => {
    const policy = session({}, false)
    prompt(policy)
    policy.fromClient(reply(10, { stopReason: 'end_turn' }))
    deniesAndCloses(policy, () =>
      policy.fromAdapter(request(11, 'session/close', { sessionId: 'owned-session' })),
    )
    const second = session()
    prompt(second)
    second.fromClient(reply(10, { stopReason: 'end_turn' }))
    second.fromAdapter(request(11, 'session/close', { sessionId: 'owned-session' }))
    deniesAndCloses(second, () => second.assertSettled())
  })

  test('successful session creation is not a settled turn', () => {
    const policy = session()
    deniesAndCloses(policy, () => policy.assertSettled())
  })

  test('rejects duplicate JSON keys, malformed UTF-8, batches and unsafe values', () => {
    for (const packet of [
      encoder.encode(
        '{"jsonrpc":"2.0","id":1,"id":2,"method":"initialize","params":{"protocolVersion":1}}',
      ),
      new Uint8Array([0xff]),
      bytes([]),
      encoder.encode('{"jsonrpc":"2.0","id":9007199254740992}'),
      encoder.encode('{"jsonrpc":"2.0","id":"\\ud800"}'),
    ]) {
      const policy = new PrivateFiniteAcpPolicy()
      deniesAndCloses(policy, () => policy.fromAdapter(packet))
    }
  })

  test('bounds frame bytes before decoding and prompt bytes before forwarding', () => {
    const policy = new PrivateFiniteAcpPolicy()
    deniesAndCloses(policy, () => policy.fromAdapter(new Uint8Array(LIMITS.frameBytes + 1)))
    const second = session()
    deniesAndCloses(second, () => prompt(second, 'a'.repeat(LIMITS.promptBytes + 1)))
  })

  test('withheld updates still exhaust their finite observation allowance', () => {
    const policy = session()
    const packet = update({ sessionUpdate: 'usage_update', ignored: true })
    for (let index = 0; index < LIMITS.updates; index += 1)
      expect(policy.fromClient(packet)).toEqual({})
    deniesAndCloses(policy, () => policy.fromClient(packet))
  })

  test('exact prompt-byte limit works and the following outcome stays separate', () => {
    const policy = session()
    prompt(policy, 'a'.repeat(LIMITS.promptBytes))
    policy.fromClient(reply(10, { stopReason: 'max_tokens' }))
    policy.assertSettled()
  })

  test('aggregate text and wire byte limits include all consumed records', () => {
    const textPolicy = session()
    prompt(textPolicy)
    const text = 'x'.repeat(1024 * 1024)
    const textFrame = update({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
    })
    for (let index = 0; index < LIMITS.textBytes / text.length; index += 1)
      textPolicy.fromClient(textFrame)
    deniesAndCloses(textPolicy, () => textPolicy.fromClient(textFrame))

    const wirePolicy = session()
    const ignoredFrame = update({ sessionUpdate: 'usage_update', _meta: { ignored: text } })
    // Every frame is just over 1 MiB, so the 32nd exceeds the 32 MiB budget.
    for (let index = 0; index < 31; index += 1) wirePolicy.fromClient(ignoredFrame)
    deniesAndCloses(wirePolicy, () => wirePolicy.fromClient(ignoredFrame))
  })

  test.each(['fs/read_text_file', 'fs/write_text_file', 'terminal/create', 'session/cancel'])(
    'native peer cannot request ungranted client operation %s',
    (method) => {
      const policy = session()
      prompt(policy)
      deniesAndCloses(policy, () =>
        policy.fromClient(request('peer', method, { sessionId: 'owned-session' })),
      )
    },
  )

  test('plan projection retains public content only', () => {
    const policy = session()
    prompt(policy)
    expect(
      policy.fromClient(
        update({
          sessionUpdate: 'plan',
          entries: [
            { content: 'Check', priority: 'high', status: 'pending', _meta: { private: 'hidden' } },
          ],
          _meta: { private: 'hidden' },
        }),
      ),
    ).toEqual({
      toAdapter: {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'owned-session',
          update: {
            sessionUpdate: 'plan',
            entries: [{ content: 'Check', priority: 'high', status: 'pending' }],
          },
        },
      },
    })
  })

  test('native initialization cannot substitute protocol versions or adopt new client powers', () => {
    const policy = new PrivateFiniteAcpPolicy()
    policy.fromAdapter(request(1, 'initialize', { protocolVersion: 1 }))
    deniesAndCloses(policy, () => policy.fromClient(reply(1, { protocolVersion: 2 })))
    const second = new PrivateFiniteAcpPolicy()
    second.fromAdapter(request(1, 'initialize', { protocolVersion: 1 }))
    expect(
      second.fromClient(
        reply(1, {
          protocolVersion: 1,
          authMethods: [{ id: 'dangerous' }],
          _meta: { private: true },
          agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } },
        }),
      ),
    ).toEqual({
      toAdapter: { jsonrpc: '2.0', id: 1, result: { protocolVersion: 1, agentCapabilities: {} } },
    })
  })
})
