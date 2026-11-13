import { describe, expect, spyOn, test } from 'bun:test'
import {
  type ChannelPair,
  type ChannelReceiver,
  type ChannelSender,
  type FlowCall,
  type JsonObject,
  type JsonValue,
  OperationError,
  type RunContext,
  type RunResult,
} from '@jigging/flow'
import { agentAcpFlow } from '../src/flow.js'
import { FiniteAcpFrames, fragmentFiniteAcpFrame } from '../src/transport.js'

const completed: RunResult = {
  outcome: 'done',
  output: { exitCode: 0, signal: null, cleanup: 'complete', stopReason: 'exited' },
}
const ready = {
  kind: 'ready',
  protocolVersion: 2,
  cwd: '/work',
  maxTurns: 3,
  configuration: [
    { configId: 'model', value: 'reviewed-model' },
    { configId: 'autoCompact', type: 'boolean', value: false },
  ],
  modeId: 'read-only',
}

/** Public endpoint test double, not an SDK/host/containment implementation. */
function pair(): ChannelPair & { fail(error: OperationError): void } {
  const items: JsonValue[] = []
  let ended = false
  let failure: OperationError | undefined
  let waiting:
    | {
        resolve(value: IteratorResult<JsonValue>): void
        reject(error: unknown): void
        remove(): void
      }
    | undefined
  const close = async () => {
    ended = true
    if (waiting) {
      const saved = waiting
      waiting = undefined
      saved.remove()
      saved.resolve({ done: true, value: undefined })
    }
  }
  const receive: ChannelReceiver = {
    direction: 'receive',
    delivery: 'direct',
    startSequence: 0,
    async next(options) {
      options?.signal?.throwIfAborted()
      if (failure) throw failure
      if (items.length) return { done: false, value: items.shift()! }
      if (ended) return { done: true, value: undefined }
      if (waiting) throw Error('concurrent test read')
      return new Promise((resolve, reject) => {
        const abort = () => {
          waiting = undefined
          reject(options?.signal?.reason)
        }
        options?.signal?.addEventListener('abort', abort, { once: true })
        waiting = {
          resolve,
          reject,
          remove: () => options?.signal?.removeEventListener('abort', abort),
        }
      })
    },
    close,
    [Symbol.asyncIterator]() {
      return this
    },
  }
  const send: ChannelSender = {
    direction: 'send',
    delivery: 'direct',
    async send(value, options) {
      options?.signal?.throwIfAborted()
      if (ended) throw new OperationError('CHANNEL_LOST', 'test peer closed')
      if (waiting) {
        const saved = waiting
        waiting = undefined
        saved.remove()
        saved.resolve({ done: false, value })
      } else items.push(value)
    },
    close,
  }
  return {
    send,
    receive,
    fail(error) {
      failure = error
      items.length = 0
      ended = true
      if (waiting) {
        const saved = waiting
        waiting = undefined
        saved.remove()
        saved.reject(error)
      }
    },
  }
}

type Frame = JsonObject
interface Options {
  readonly ready?: JsonObject
  readonly output?: string
  readonly stop?: string
  readonly result?: RunResult
  readonly input?: JsonValue
  readonly settings?: JsonObject
  readonly events?: ChannelSender
  readonly commands?: ChannelReceiver
  readonly replies?: ChannelSender
  readonly signal?: AbortSignal
  readonly emit?: (frame: Frame, send: ChannelSender, attempt: number) => Promise<boolean>
  readonly initialNativeFailure?: OperationError
  readonly settlementFailure?: (attempt: number) => OperationError | undefined
  readonly rejectAttempt?: (call: FlowCall, attempt: number) => void
  readonly selection?: readonly { readonly slot: string; readonly operationId: string }[]
  readonly disposeFailure?: Error
}

function fixture(options: Options = {}) {
  const frames: Frame[] = []
  const operations = new Map<string, string>()
  let calls = 0
  let cancelled = false
  let settled = false
  const channels: ReturnType<typeof pair>[] = []
  const frameSend = async (send: ChannelSender, value: JsonValue) => {
    for (const fragment of fragmentFiniteAcpFrame(JSON.stringify(value)))
      await send.send({ ...fragment })
  }
  const run = {
    input: options.input ?? {
      instructions: 'Answer.',
      guidance: [{ label: 'facts', text: 'Supplied guidance.' }],
      skills: [{ name: 'review', files: [{ path: 'SKILL.md', text: 'Selected Skill.' }] }],
    },
    settings: options.settings ?? {},
    attachments: {},
    channels: {
      ...(options.events ? { events: options.events } : {}),
      ...(options.commands ? { commands: options.commands } : {}),
      ...(options.replies ? { replies: options.replies } : {}),
    },
    scratch: '/scratch',
    deadlineUnixMs: Date.now() + 60_000,
    signal: options.signal ?? new AbortController().signal,
    async channel(settings: { contract: string }) {
      expect(settings.contract).toBe(
        channels.length % 2 === 0
          ? './contracts/finite-acp/requests.json'
          : './contracts/finite-acp/responses.json',
      )
      const value = pair()
      channels.push(value)
      if (options.disposeFailure && channels.length === 2)
        value.receive.close = async () => {
          throw options.disposeFailure
        }
      return value
    },
    async call(call: FlowCall, settings: { signal: AbortSignal }) {
      const signature = JSON.stringify({ slot: call.slot, input: call.input })
      const prior = operations.get(call.operationId)
      if (prior !== undefined && prior !== signature)
        throw new OperationError('OPERATION_CONFLICT', 'operationId was reused differently')
      operations.set(call.operationId, signature)
      const attempt = calls++
      const session = (run.input as JsonObject).session
      const candidate = options.selection?.[attempt] ?? { slot: 'native', operationId: 'native' }
      expect(call).toMatchObject({
        operationId: candidate.operationId,
        slot: candidate.slot,
        ...(options.rejectAttempt ? {} : { input: session === undefined ? null : { session } }),
      })
      expect(call.channels?.requests).toBe(channels[attempt * 2]!.receive)
      expect(call.channels?.responses).toBe(channels[attempt * 2 + 1]!.send)
      const receive = call.channels!.requests as ChannelReceiver
      const send = call.channels!.responses as ChannelSender
      const fragments = new FiniteAcpFrames('requests')
      settings.signal.addEventListener(
        'abort',
        () => {
          cancelled = true
        },
        { once: true },
      )
      try {
        options.rejectAttempt?.(call, attempt)
        if (attempt === 0 && options.initialNativeFailure) throw options.initialNativeFailure
        await send.send(options.ready ?? ready)
        for (;;) {
          const item = await receive.next({ signal: settings.signal })
          if (item.done) {
            fragments.finish()
            break
          }
          const data = fragments.accept(item.value)
          if (data === undefined) continue
          const frame = JSON.parse(data) as Frame
          frames.push(frame)
          if (await options.emit?.(frame, send, attempt)) continue
          let result: JsonValue = {}
          switch (frame.method) {
            case 'initialize':
              result = {
                protocolVersion: 2,
                capabilities: { session: {} },
                info: { name: 'flow-agent-acp', version: '2' },
              }
              break
            case 'session/new':
              result = { sessionId: 'owned-session', configOptions: [] }
              break
            case 'session/resume':
              result = { configOptions: [] }
              break
            case 'session/set_config_option': {
              const params = frame.params as JsonObject
              result = {
                configOptions: [
                  {
                    configId: params.configId!,
                    type: params.type ?? 'id',
                    currentValue: params.value!,
                  },
                ],
              }
              break
            }
            case 'session/prompt': {
              const sessionId = (frame.params as JsonObject).sessionId!
              await frameSend(send, {
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                  sessionId,
                  update: {
                    sessionUpdate: 'user_message',
                    messageId: 'accepted-user',
                  },
                },
              })
              await frameSend(send, {
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                  sessionId,
                  update: {
                    sessionUpdate: 'state_update',
                    state: 'running',
                  },
                },
              })
              await frameSend(send, {
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                  sessionId,
                  update: {
                    sessionUpdate: 'agent_message_chunk',
                    messageId: 'answer',
                    content: { type: 'text', text: options.output ?? 'The answer.' },
                  },
                },
              })
              await frameSend(send, {
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                  sessionId,
                  update: {
                    sessionUpdate: 'state_update',
                    state: 'idle',
                    stopReason: options.stop ?? 'end_turn',
                  },
                },
              })
              result = { messageId: 'accepted-user' }
              break
            }
            case 'session/close':
              result = {}
              break
          }
          await frameSend(send, { jsonrpc: '2.0', id: frame.id!, result })
        }
        const failure = options.settlementFailure?.(attempt)
        if (failure) throw failure
        return options.result ?? completed
      } finally {
        settled = true
        await send.close()
      }
    },
  } as unknown as RunContext
  return {
    run,
    frames,
    stats: () => ({ calls, cancelled, settled }),
    frameSend,
    failResponses: (error: OperationError) => channels[1]!.fail(error),
    selection: options.selection,
  }
}

describe('native request failure diagnostics', () => {
  test('pre-prompt native RPC rejection advances only after host attests fencing', async () => {
    const attested = new OperationError('EXECUTION_FAILED', 'native process fenced', {
      nativePrompt: { forwarding: 'not-forwarded', cleanup: 'confirmed', turnsSettled: 0 },
    })
    const selected = [
      { slot: 'native', operationId: 'native' },
      { slot: 'backup1', operationId: 'backup1' },
    ]
    const f = fixture({
      selection: selected,
      settlementFailure: (attempt) => (attempt === 0 ? attested : undefined),
      async emit(frame, send, attempt) {
        if (attempt !== 0 || frame.method !== 'session/new') return false
        await f.frameSend(send, {
          jsonrpc: '2.0',
          id: frame.id!,
          error: { code: -32603, message: 'private native error' },
        })
        return true
      },
    })
    expect(await agentAcpFlow(f.run, selected)).toMatchObject({
      outcome: 'done',
      output: { text: 'The answer.' },
    })
    expect(f.stats().calls).toBe(2)
    expect(f.frames.filter((frame) => frame.method === 'session/prompt')).toHaveLength(1)
  })
  test.each([
    'initialize',
    'session/new',
    'session/resume',
    'session/set_config_option',
    'session/prompt',
    'session/close',
  ])(
    'identifies %s without exposing native error text or sending further requests',
    async (method) => {
      const restoring = method === 'session/resume'
      const f = fixture({
        ...(restoring
          ? {
              input: {
                instructions: 'Continue.',
                session: { restore: '013579ab-cdef-4567-89ab-0123456789ab' },
              },
              ready: { ...ready, restoreSessionId: 'owned-session' },
            }
          : {}),
        async emit(frame, send) {
          if (frame.method !== method) return false
          await f.frameSend(send, {
            jsonrpc: '2.0',
            id: frame.id!,
            error: {
              code: -32603,
              message: '/private/native-state secret-token rejected private-model',
              data: { credential: 'secret-token', cause: 'untrusted native detail' },
            },
          })
          return true
        },
      })
      const failure = await agentAcpFlow(f.run).catch((error) => error)
      expect(failure).toBeInstanceOf(OperationError)
      expect(failure).toMatchObject({
        code: 'EXECUTION_FAILED',
        details: { nativeRequest: { method, code: -32603 } },
      })
      expect(failure.message).toContain(`native code -32603; ${method}`)
      expect(failure.message).toContain('Detailed client cause is unavailable')
      expect(JSON.stringify({ message: failure.message, details: failure.details })).not.toContain(
        'secret-token',
      )
      expect(f.frames.at(-1)?.method).toBe(method)
      expect(f.stats()).toEqual({
        calls: 1,
        cancelled: ['session/prompt', 'session/close'].includes(method),
        settled: true,
      })
    },
  )
})

test('closed native reasons are validated independently and never expose native data', async () => {
  const cases = [
    { data: { reason: 'managed-preferences-unavailable' }, known: true },
    { data: { reason: 'unknown' }, known: false },
    {
      data: { reason: 'managed-preferences-unavailable', credential: 'secret-token' },
      known: false,
    },
    { data: { reason: null }, known: false },
    { data: null, known: false },
    { data: ['managed-preferences-unavailable'], known: false },
    {
      data: 'failed to load configuration: Failed to synchronize managed preferences\n\nCheck secret-token',
      known: false,
    },
    { data: { reason: 'managed-preferences-unavailable' }, code: -32602, known: false },
    { data: { reason: 'managed-preferences-unavailable' }, method: 'initialize', known: false },
    { data: { reason: 'managed-preferences-unavailable' }, method: 'session/prompt', known: false },
  ]
  for (const value of cases) {
    const method = value.method ?? 'session/new',
      code = value.code ?? -32603
    const f = fixture({
      async emit(frame, send) {
        if (frame.method !== method) return false
        await f.frameSend(send, {
          jsonrpc: '2.0',
          id: frame.id!,
          error: {
            code,
            message: 'secret-token',
            data: value.data,
          },
        })
        return true
      },
    })
    const failure = await agentAcpFlow(f.run).catch((error) => error)
    expect(failure).toBeInstanceOf(OperationError)
    expect(failure).toMatchObject({
      code: 'EXECUTION_FAILED',
      details: {
        nativeRequest: {
          method,
          code,
          ...(value.known ? { reason: 'managed-preferences-unavailable' } : {}),
        },
      },
    })
    if (value.known) {
      expect(failure.message).toContain(
        'The native client reported a configuration failure: macOS managed preferences could not be synchronized.',
      )
      expect(failure.message).toContain(
        'Have the operator responsible for this Codex installation check its managed-preference configuration and availability.',
      )
      expect(failure.message).not.toContain('Detailed client cause is unavailable')
    } else {
      expect(failure.message).toContain('Detailed client cause is unavailable')
      expect(failure.message).not.toContain('operator responsible for this Codex installation')
      expect(failure.details.nativeRequest).not.toHaveProperty('reason')
    }
    expect(JSON.stringify({ message: failure.message, details: failure.details })).not.toContain(
      'secret-token',
    )
    expect(f.frames.at(-1)?.method).toBe(method)
    expect(f.stats()).toEqual({
      calls: 1,
      cancelled: ['session/prompt', 'session/close'].includes(method),
      settled: true,
    })
  }
})

describe('ordinary session retention and restoration', () => {
  test.each(['active', 'settled'])(
    'notice display during %s does not enter answers or selected public events',
    async (phase) => {
      const warning = spyOn(console, 'warn').mockImplementation(() => {})
      const updates: JsonValue[] = []
      const f = fixture({
        events: {
          direction: 'send',
          delivery: 'direct',
          send: async (value) => {
            updates.push(value)
          },
          close: async () => {},
        },
        async emit(frame, send) {
          if (frame.method === 'session/prompt') {
            if (phase === 'settled') {
              await f.frameSend(send, {
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                  sessionId: 'owned-session',
                  update: {
                    sessionUpdate: 'user_message',
                    messageId: 'accepted-user',
                  },
                },
              })
              await f.frameSend(send, {
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                  sessionId: 'owned-session',
                  update: {
                    sessionUpdate: 'state_update',
                    state: 'running',
                  },
                },
              })
              await f.frameSend(send, {
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                  sessionId: 'owned-session',
                  update: {
                    sessionUpdate: 'agent_message_chunk',
                    messageId: 'answer',
                    content: { type: 'text', text: 'The answer.' },
                  },
                },
              })
              await f.frameSend(send, {
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                  sessionId: 'owned-session',
                  update: {
                    sessionUpdate: 'state_update',
                    state: 'idle',
                    stopReason: 'end_turn',
                  },
                },
              })
              await f.frameSend(send, {
                jsonrpc: '2.0',
                id: frame.id!,
                result: { messageId: 'accepted-user' },
              })
            }
            await f.frameSend(send, {
              jsonrpc: '2.0',
              method: 'session/update',
              params: {
                sessionId: 'owned-session',
                update: {
                  sessionUpdate: 'session_info_update',
                  _meta: { notice: { code: 'NATIVE_WARNING' } },
                },
              },
            })
            return phase === 'settled'
          }
          return false
        },
      })
      try {
        expect(await agentAcpFlow(f.run)).toEqual({
          outcome: 'done',
          output: { text: 'The answer.' },
        })
        expect(warning).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(updates)).not.toContain('NATIVE_WARNING')
        expect(f.stats().settled).toBe(true)
      } finally {
        warning.mockRestore()
      }
    },
  )
  const reference = '013579ab-cdef-4567-89ab-0123456789ab'
  const retained = { status: 'retained', reference }
  const result = (session: JsonValue, stopReason = 'exited'): RunResult => ({
    outcome: 'done',
    output: { ...(completed.output as JsonObject), stopReason, session },
  })

  test('relays requested retention after resource settlement without changing the answer', async () => {
    for (const [session, stop] of [
      [retained, 'exited'],
      [{ status: 'unavailable', reason: 'not-cleanly-closed' }, 'closed'],
    ] as const) {
      const f = fixture({
        input: { instructions: 'Answer.', session: { retain: true } },
        result: result(session, stop),
      })
      expect(await agentAcpFlow(f.run)).toEqual({
        outcome: 'done',
        output: { text: 'The answer.', session },
      })
      expect(f.stats().settled).toBe(true)
      expect(f.frames.map((frame) => frame.method)).not.toContain('session/resume')
    }
  })

  test('resumes only the host-owned identity and reapplies every reviewed configuration before prompting', async () => {
    const f = fixture({
      input: { instructions: 'Continue.', session: { restore: reference } },
      ready: { ...ready, restoreSessionId: 'restored-native-session' },
      result: result(retained),
    })
    expect(await agentAcpFlow(f.run)).toEqual({
      outcome: 'done',
      output: { text: 'The answer.', session: retained },
    })
    expect(f.frames.map((frame) => frame.method)).toEqual([
      'initialize',
      'session/resume',
      'session/set_config_option',
      'session/set_config_option',
      'session/set_config_option',
      'session/prompt',
      'session/close',
    ])
    expect(f.frames[1]!.params).toEqual({
      sessionId: 'restored-native-session',
      cwd: '/work',
      mcpServers: [],
    })
    for (const frame of f.frames.slice(2))
      expect(frame.params).toMatchObject({ sessionId: 'restored-native-session' })
    expect(JSON.stringify(f.frames)).not.toContain(reference)
  })

  test('rejects mismatched ready metadata and missing resume capability without a fresh-session fallback', async () => {
    for (const mode of ['missing-id', 'unexpected-id', 'unsupported', 'new-id']) {
      const f = fixture({
        input: {
          instructions: 'Answer.',
          ...(mode === 'unexpected-id' ? {} : { session: { restore: reference } }),
        },
        ready: mode === 'missing-id' ? ready : { ...ready, restoreSessionId: 'owned-session' },
        async emit(frame, send) {
          if (mode === 'unsupported' && frame.method === 'initialize') {
            await f.frameSend(send, {
              jsonrpc: '2.0',
              id: frame.id!,
              result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: {} } },
            })
            return true
          }
          if (mode === 'new-id' && frame.method === 'session/resume') {
            await f.frameSend(send, {
              jsonrpc: '2.0',
              id: frame.id!,
              result: { sessionId: 'replacement' },
            })
            return true
          }
          return false
        },
      })
      await expect(agentAcpFlow(f.run)).rejects.toMatchObject({ code: 'INVALID_RESULT' })
      expect(
        f.frames.some((frame) =>
          ['session/new', 'session/prompt'].includes(frame.method as string),
        ),
      ).toBe(false)
      expect(f.stats().settled).toBe(true)
    }
  })

  test('rejects missing, unsolicited, malformed or unclean retained receipts', async () => {
    for (const native of [
      completed,
      result(null),
      result({ status: 'retained' }),
      result({ status: 'retained', reference: 'private/path' }),
      result({ status: 'retained', reference: `${reference}\n` }),
      result({ status: 'unavailable', reference }),
      result({ status: 'unavailable' }),
      result({ status: 'unavailable', reason: 'unknown' }),
      result(retained, 'closed'),
    ]) {
      const f = fixture({
        input: { instructions: 'Answer.', session: { retain: true } },
        result: native,
      })
      await expect(agentAcpFlow(f.run)).rejects.toMatchObject({ code: 'INVALID_RESULT' })
      expect(f.stats().settled).toBe(true)
    }
    const unsolicited = fixture({ result: result(retained) })
    await expect(agentAcpFlow(unsolicited.run)).rejects.toMatchObject({ code: 'INVALID_RESULT' })
    const malformed = fixture({ input: { instructions: 'Answer.', session: { retain: false } } })
    await expect(agentAcpFlow(malformed.run)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(malformed.stats().calls).toBe(0)
  })

  test('returns the receipt only after conversation close and rejects mid-conversation session intent', async () => {
    const commands = pair(),
      replies = pair()
    const f = fixture({
      input: { instructions: 'Answer.', conversation: true, session: { retain: true } },
      commands: commands.receive,
      replies: replies.send,
      result: result(retained),
    })
    const work = agentAcpFlow(f.run)
    expect((await replies.receive.next()).value).toEqual({
      type: 'result',
      turn: 0,
      result: { outcome: 'done', output: { text: 'The answer.' } },
    })
    await commands.send.send({
      type: 'prompt',
      turn: 1,
      input: { instructions: 'Continue.', session: { retain: true } },
    })
    expect((await replies.receive.next()).value).toMatchObject({
      type: 'rejected',
      command: 'prompt',
      code: 'INVALID_INPUT',
    })
    await commands.send.send({ type: 'close', turn: 0 })
    await commands.send.close()
    expect((await replies.receive.next()).value).toMatchObject({
      type: 'accepted',
      command: 'close',
    })
    expect(await work).toEqual({ outcome: 'done', output: { turns: 1, session: retained } })
  })
})

describe('ordinary continuing Agent', () => {
  test('continues, rejects stale control, interrupts and settles before another turn', async () => {
    const commands = pair(),
      replies = pair(),
      events = pair()
    let prompts = 0
    const held: JsonValue = null
    const f = fixture({
      input: { instructions: 'Initial context.', conversation: true },
      commands: commands.receive,
      replies: replies.send,
      events: events.send,
      async emit(frame, send) {
        if (frame.method === 'session/prompt' && ++prompts === 2) {
          await f.frameSend(send, {
            jsonrpc: '2.0',
            id: frame.id!,
            result: { messageId: 'turn-1-msg' },
          })
          await f.frameSend(send, {
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'owned-session',
              update: { sessionUpdate: 'user_message', messageId: 'turn-1-msg' },
            },
          })
          await f.frameSend(send, {
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'owned-session',
              update: { sessionUpdate: 'state_update', state: 'running' },
            },
          })
          return true
        }
        if (frame.method === 'session/cancel') {
          await f.frameSend(send, {
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'owned-session',
              update: { sessionUpdate: 'state_update', state: 'idle', stopReason: 'cancelled' },
            },
          })
          return true
        }
        return false
      },
    })
    const work = agentAcpFlow(f.run)
    expect((await replies.receive.next()).value).toMatchObject({
      type: 'result',
      turn: 0,
      result: { outcome: 'done' },
    })
    expect((await events.receive.next()).value).toMatchObject({ turn: 0 })
    await commands.send.send({ type: 'prompt', turn: 1, input: { instructions: 'Continue.' } })
    expect((await replies.receive.next()).value).toMatchObject({
      type: 'accepted',
      command: 'prompt',
      turn: 1,
    })
    await commands.send.send({ type: 'interrupt', turn: 0 })
    expect((await replies.receive.next()).value).toMatchObject({
      type: 'rejected',
      code: 'STALE_TURN',
    })
    await commands.send.send({ type: 'prompt', turn: 2, input: { instructions: 'Too early.' } })
    expect((await replies.receive.next()).value).toMatchObject({ type: 'rejected', code: 'BUSY' })
    await commands.send.send({ type: 'interrupt', turn: 1 })
    expect((await replies.receive.next()).value).toMatchObject({
      type: 'accepted',
      command: 'interrupt',
    })
    expect((await replies.receive.next()).value).toEqual({ type: 'cancelled', turn: 1 })
    await commands.send.send({ type: 'prompt', turn: 2, input: { instructions: 'Now continue.' } })
    expect((await replies.receive.next()).value).toMatchObject({
      type: 'accepted',
      command: 'prompt',
    })
    expect((await replies.receive.next()).value).toMatchObject({
      type: 'result',
      turn: 2,
      result: { output: { text: 'The answer.' } },
    })
    await commands.send.send({
      type: 'prompt',
      turn: 3,
      input: { instructions: 'Beyond allowance.' },
    })
    expect((await replies.receive.next()).value).toMatchObject({
      type: 'rejected',
      code: 'TURN_LIMIT',
    })
    await commands.send.send({ type: 'close', turn: 2 })
    await commands.send.close()
    expect((await replies.receive.next()).value).toMatchObject({
      type: 'accepted',
      command: 'close',
    })
    expect(await work).toEqual({ outcome: 'done', output: { turns: 3 } })
    expect(f.frames.filter((frame) => frame.method === 'session/new')).toHaveLength(1)
    expect(f.frames.filter((frame) => frame.method === 'session/prompt')).toHaveLength(3)
    expect(f.stats().settled).toBe(true)
  })

  test('losing control is not a clean conversation end', async () => {
    const commands = pair(),
      replies = pair()
    const f = fixture({
      input: { instructions: 'Answer.', conversation: true },
      commands: commands.receive,
      replies: replies.send,
    })
    const work = agentAcpFlow(f.run).then(
      () => undefined,
      (error) => error,
    )
    await replies.receive.next()
    await commands.send.close()
    expect(await work).toMatchObject({ code: 'DISCONNECTED' })
    expect(f.stats()).toMatchObject({ cancelled: true, settled: true })
  })

  test('rejects incomplete conversational wiring before native dispatch', async () => {
    const f = fixture({
      input: { instructions: 'Answer.', conversation: true },
      commands: pair().receive,
    })
    await expect(agentAcpFlow(f.run)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(f.stats().calls).toBe(0)
  })
})

/** Match the SDK's immediate caller-wait cancellation, not resource cleanup. */
function cancellableWait(run: RunContext): RunContext {
  return {
    ...run,
    call(call, options) {
      return new Promise((resolve, reject) => {
        const cancel = () => reject(new OperationError('CANCELLED', 'caller wait cancelled'))
        options?.signal?.addEventListener('abort', cancel, { once: true })
        void run
          .call(call, options)
          .then(resolve, reject)
          .finally(() => {
            options?.signal?.removeEventListener('abort', cancel)
          })
      })
    },
  }
}

describe('ordinary finite ACP Agent Flow', () => {
  test('retains a full 8 MiB answer through bounded text fragments', async () => {
    const output = '😀'.repeat(2_097_152)
    const consumer = fixture({ output })
    expect((await agentAcpFlow(consumer.run)).output).toEqual({ text: output })
    expect(consumer.stats()).toEqual({ calls: 1, cancelled: false, settled: true })
  })

  test('a wrong reply identity or private update fails essential transport without replay', async () => {
    for (const variant of ['id', 'session', 'private', 'partial']) {
      const consumer = fixture({
        emit: async (frame, send) => {
          if (frame.method !== 'session/prompt') return false
          if (variant === 'partial') {
            await send.send({ kind: 'data', text: '{', end: false })
            await send.close()
          } else {
            const value =
              variant === 'id'
                ? { jsonrpc: '2.0', id: 999, result: { stopReason: 'end_turn' } }
                : {
                    jsonrpc: '2.0',
                    method: 'session/update',
                    params: {
                      sessionId: variant === 'session' ? 'foreign' : 'owned-session',
                      update: {
                        sessionUpdate:
                          variant === 'private' ? 'agent_thought_chunk' : 'agent_message_chunk',
                        content: { type: 'text', text: 'not eligible' },
                      },
                    },
                  }
            for (const fragment of fragmentFiniteAcpFrame(JSON.stringify(value)))
              await send.send({ ...fragment })
          }
          return true
        },
      })
      await expect(agentAcpFlow(consumer.run)).rejects.toThrow()
      expect(consumer.stats()).toEqual({ calls: 1, cancelled: true, settled: true })
    }
  })
  test('prepares selected context, uses reviewed configuration, and independently checks a structured result', async () => {
    const responseSchema = {
      $schema: 'https://flow.jig.md/schemas/schema-0.json',
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    }
    const observed: JsonValue[] = []
    const events: ChannelSender = {
      direction: 'send',
      delivery: 'direct',
      async send(value) {
        observed.push(value)
      },
      async close() {},
    }
    const consumer = fixture({
      output: '{"answer":"checked"}',
      input: {
        instructions: 'Answer.',
        responseSchema,
        skills: [{ name: 'review', files: [{ path: 'SKILL.md', text: 'Selected Skill.' }] }],
      },
      events,
    })
    expect(await agentAcpFlow(consumer.run)).toEqual({
      outcome: 'done',
      output: { text: '{"answer":"checked"}', structured: { answer: 'checked' } },
    })
    expect(consumer.frames.map((f) => f.method)).toEqual([
      'initialize',
      'session/new',
      'session/set_config_option',
      'session/set_config_option',
      'session/set_config_option',
      'session/prompt',
      'session/close',
    ])
    const prompt = JSON.stringify(consumer.frames.find((f) => f.method === 'session/prompt'))
    expect(prompt).toContain('Selected Skill.')
    expect(prompt).toContain('matching this canonical FLOW Schema/0')
    expect(consumer.frames[2]!.params).toEqual({
      sessionId: 'owned-session',
      configId: 'model',
      type: 'id',
      value: 'reviewed-model',
    })
    expect(consumer.frames[3]!.params).toEqual({
      sessionId: 'owned-session',
      configId: 'autoCompact',
      type: 'boolean',
      value: false,
    })
    expect(observed).toHaveLength(1)
    expect(consumer.stats()).toEqual({ calls: 1, cancelled: false, settled: true })
  })

  test('accepts host-collected controlled closure without manufacturing exit zero', async () => {
    const consumer = fixture({
      result: {
        outcome: 'done',
        output: { exitCode: null, signal: 'SIGTERM', cleanup: 'complete', stopReason: 'closed' },
      },
    })
    expect((await agentAcpFlow(consumer.run)).outcome).toBe('done')
  })

  test('refusal and limits stay honest method outcomes; cancellation is not a method limit', async () => {
    for (const [stop, outcome] of [
      ['refusal', 'blocked'],
      ['max_tokens', 'limit'],
      ['max_turn_requests', 'limit'],
    ]) {
      const consumer = fixture({ stop })
      expect((await agentAcpFlow(consumer.run)).outcome).toBe(outcome)
    }
    const consumer = fixture({ stop: 'cancelled' })
    await expect(agentAcpFlow(consumer.run)).rejects.toThrow()
    expect(consumer.stats()).toEqual({ calls: 1, cancelled: true, settled: true })
  })

  test('an ACP stop and EOF cannot replace successful process evidence', async () => {
    for (const result of [
      {
        outcome: 'done',
        output: { exitCode: 2, signal: null, cleanup: 'complete', stopReason: 'exited' },
      },
      {
        outcome: 'done',
        output: { exitCode: 0, signal: null, cleanup: 'unknown', stopReason: 'exited' },
      },
      { outcome: 'blocked', output: {} },
    ]) {
      const consumer = fixture({ result })
      await expect(agentAcpFlow(consumer.run)).rejects.toThrow()
      expect(consumer.stats().settled).toBe(true)
    }
  })

  test('rejects settings and malformed instructions before resource dispatch', async () => {
    for (const options of [
      { settings: { model: 'unreviewed' } },
      { input: { instructions: 'Answer.', extra: 'unexpected' } },
      { input: { instructions: 42 } },
    ]) {
      const consumer = fixture(options)
      await expect(agentAcpFlow(consumer.run)).rejects.toThrow()
      expect(consumer.stats().calls).toBe(0)
    }
  })

  test('essential malformed framing cancels and waits for the resource, with no retry', async () => {
    const consumer = fixture({
      emit: async (frame, send) => {
        if (frame.method !== 'session/prompt') return false
        await send.send({ kind: 'data', text: '{', end: true })
        return true
      },
    })
    await expect(agentAcpFlow(cancellableWait(consumer.run))).rejects.toMatchObject({
      code: 'INVALID_RESULT',
    })
    expect(consumer.stats()).toEqual({ calls: 1, cancelled: true, settled: true })
  })

  test('terminal channel loss waits for the delayed resource failure without cancelling its result', async () => {
    for (const code of ['DISCONNECTED', 'LAGGED'] as const) {
      const failed = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const uncertain = new OperationError('UNCERTAIN', 'native dispatch did not settle normally')
      const consumer = fixture({
        emit: async (frame) => {
          if (frame.method !== 'session/prompt') return false
          consumer.failResponses(new OperationError(code))
          failed.resolve()
          await release.promise
          throw uncertain
        },
      })
      let returned = false
      const outcome = agentAcpFlow(cancellableWait(consumer.run))
        .then(
          (result) => ({ result }),
          (error: unknown) => ({ error }),
        )
        .finally(() => {
          returned = true
        })
      await failed.promise
      // Let the consumer handle the already-delivered channel failure while
      // independently owned cleanup is deliberately held at its final barrier.
      await new Promise((resolve) => setTimeout(resolve, 0))
      const before = { ...consumer.stats(), returned }
      release.resolve()
      expect(await outcome).toEqual({ error: uncertain })
      expect(before).toEqual({ calls: 1, cancelled: false, settled: false, returned: false })
      expect(consumer.stats().settled).toBe(true)
    }
  })

  test('root cancellation still interrupts a failed-channel settlement wait', async () => {
    const controller = new AbortController()
    const failed = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const consumer = fixture({
      signal: controller.signal,
      emit: async (frame) => {
        if (frame.method !== 'session/prompt') return false
        consumer.failResponses(new OperationError('DISCONNECTED'))
        failed.resolve()
        await release.promise
        throw new OperationError('UNCERTAIN')
      },
    })
    const cancellation = new OperationError('CANCELLED', 'operator cancelled during settlement')
    const outcome = agentAcpFlow(cancellableWait(consumer.run)).then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    )
    await failed.promise
    controller.abort(cancellation)
    release.resolve()
    expect(await outcome).toEqual({ error: cancellation })
    expect(consumer.stats()).toEqual({ calls: 1, cancelled: true, settled: true })
  })

  test('resource cancellation settles while an Agent reply is pending', async () => {
    const controller = new AbortController()
    const consumer = fixture({
      signal: controller.signal,
      emit: async (frame) => {
        if (frame.method !== 'session/prompt') return false
        controller.abort(new OperationError('CANCELLED', 'operator cancelled'))
        return true
      },
    })
    await expect(agentAcpFlow(consumer.run)).rejects.toThrow('operator cancelled')
    expect(consumer.stats().settled).toBe(true)
  })

  test('a late disposal failure remains visible after otherwise successful execution', async () => {
    const error = new OperationError('LAGGED', 'late essential loss')
    const consumer = fixture({ disposeFailure: error })
    await expect(agentAcpFlow(consumer.run)).rejects.toBe(error)
  })

  test('a settled invalid structured answer permits an explicit follow-up', async () => {
    const commands = pair(),
      replies = pair()
    const consumer = fixture({
      input: {
        instructions: 'Answer.',
        conversation: true,
        responseSchema: {
          $schema: 'https://flow.jig.md/schemas/schema-0.json',
          type: 'object',
          properties: { accepted: { type: 'string' } },
          required: ['accepted'],
          additionalProperties: false,
        },
      },
      commands: commands.receive,
      replies: replies.send,
    })
    const work = agentAcpFlow(consumer.run)
    expect((await replies.receive.next()).value).toMatchObject({
      type: 'error',
      turn: 0,
      code: 'INVALID_RESULT',
    })
    await commands.send.send({
      type: 'prompt',
      turn: 1,
      input: { instructions: 'Answer in plain text.' },
    })
    expect((await replies.receive.next()).value).toEqual({
      type: 'accepted',
      command: 'prompt',
      turn: 1,
    })
    expect((await replies.receive.next()).value).toMatchObject({
      type: 'result',
      turn: 1,
      result: { outcome: 'done' },
    })
    await commands.send.send({ type: 'close', turn: 1 })
    expect((await replies.receive.next()).value).toEqual({
      type: 'accepted',
      command: 'close',
      turn: 1,
    })
    await commands.send.close()
    expect(await work).toEqual({ outcome: 'done', output: { turns: 2 } })
    expect(consumer.stats()).toEqual({ calls: 1, cancelled: false, settled: true })
  })

  test('an oversized essential reply fails rather than truncating a successful answer', async () => {
    const commands = pair(),
      replies = pair()
    const consumer = fixture({
      input: { instructions: 'Answer.', conversation: true },
      output: 'x'.repeat(65_536),
      commands: commands.receive,
      replies: replies.send,
    })
    await expect(agentAcpFlow(consumer.run)).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' })
    expect(consumer.stats()).toEqual({ calls: 1, cancelled: true, settled: true })
  })

  test('accepted close requires bounded command-stream settlement', async () => {
    const commands = pair(),
      replies = pair()
    const consumer = fixture({
      input: { instructions: 'Answer.', conversation: true },
      commands: commands.receive,
      replies: replies.send,
    })
    const work = agentAcpFlow(consumer.run).catch((error) => error)
    expect((await replies.receive.next()).value).toMatchObject({ type: 'result', turn: 0 })
    await commands.send.send({ type: 'close', turn: 0 })
    expect((await replies.receive.next()).value).toMatchObject({
      type: 'accepted',
      command: 'close',
    })
    expect(await work).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
    expect(consumer.stats()).toEqual({ calls: 1, cancelled: true, settled: true })
  }, 10_000)

  test('root cancellation settles a conversation blocked delivering an essential reply', async () => {
    const controller = new AbortController(),
      commands = pair()
    const entered = Promise.withResolvers<void>()
    const replies: ChannelSender = {
      direction: 'send',
      delivery: 'direct',
      async close() {},
      async send(_value, options) {
        entered.resolve()
        await new Promise<void>((_resolve, reject) => {
          options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), {
            once: true,
          })
        })
      },
    }
    const consumer = fixture({
      input: { instructions: 'Answer.', conversation: true },
      commands: commands.receive,
      replies,
      signal: controller.signal,
    })
    const result = agentAcpFlow(consumer.run).catch((error) => error)
    await entered.promise
    const cancellation = new OperationError('CANCELLED', 'conversation cancelled')
    controller.abort(cancellation)
    expect(await result).toBe(cancellation)
    expect(consumer.stats()).toEqual({ calls: 1, cancelled: true, settled: true })
  })

  test('optional update failure drops its suffix but preserves complete execution text', async () => {
    const diagnostic = spyOn(console, 'error').mockImplementation(() => {})
    let sends = 0
    const events: ChannelSender = {
      direction: 'send',
      delivery: 'direct',
      async send() {
        sends++
        throw new OperationError('LAGGED')
      },
      async close() {},
    }
    try {
      const consumer = fixture({ events })
      expect(await agentAcpFlow(consumer.run)).toEqual({
        outcome: 'done',
        output: { text: 'The answer.' },
      })
      expect(sends).toBe(1)
      expect(diagnostic).toHaveBeenCalledWith(
        'Agent progress is incomplete; the execution result remains separate.',
      )
      expect(consumer.stats().cancelled).toBe(false)
    } finally {
      diagnostic.mockRestore()
    }
  })
})

test.each([
  null,
  { code: 'secret', message: 'private' },
  { code: 0.5, message: 'private' },
  { code: 1 },
  { code: 1, message: 42 },
  { code: 1, message: 'private', extra: true },
])('independently rejects malformed native errors %j', async (error) => {
  const f = fixture({
    async emit(frame, send) {
      if (frame.method !== 'session/new') return false
      await f.frameSend(send, { jsonrpc: '2.0', id: frame.id!, error } as any)
      return true
    },
  })
  const failure = await agentAcpFlow(f.run).catch((error) => error)
  expect(failure).toBeInstanceOf(OperationError)
  expect(failure.code).toBe('INVALID_RESULT')
  expect(failure.message).not.toContain('private')
  expect(f.frames.at(-1)?.method).toBe('session/new')
})

describe('ACP v2 native method qualification', () => {
  const v2Ready = {
    kind: 'ready',
    protocolVersion: 2,
    cwd: '/work',
    maxTurns: 1,
    configuration: [{ configId: 'model', value: 'reviewed-model' }],
    modeId: 'read-only',
  }
  const notification = (update: JsonObject) => ({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId: 'owned-session', update },
  })
  const make = (reason: string, firstFailure?: OperationError, events?: ChannelSender) => {
    const f = fixture({
      ready: v2Ready,
      ...(events === undefined ? {} : { events }),
      ...(firstFailure === undefined
        ? {}
        : {
            initialNativeFailure: firstFailure,
            selection: [
              { slot: 'primary', operationId: 'primary-native' },
              { slot: 'backup', operationId: 'backup-native' },
            ],
          }),
      async emit(frame, send) {
        let result: JsonValue
        if (frame.method === 'initialize') {
          expect(frame.params).toMatchObject({ protocolVersion: 2, capabilities: {} })
          result = {
            protocolVersion: 2,
            capabilities: { session: {} },
            info: { name: 'qualified-agent', version: '2' },
          }
        } else if (frame.method === 'session/new') {
          result = { sessionId: 'owned-session', configOptions: [] }
        } else if (frame.method === 'session/set_config_option') {
          const params = frame.params as JsonObject
          expect(params.type).toBe('id')
          result = {
            configOptions: [
              {
                configId: params.configId!,
                type: 'select',
                currentValue: params.value!,
              },
            ],
          }
        } else if (frame.method === 'session/prompt') {
          // Insertion and foreground state are independent of RPC completion.
          await f.frameSend(
            send,
            notification({
              sessionUpdate: 'user_message',
              messageId: 'accepted-user',
            }),
          )
          await f.frameSend(
            send,
            notification({
              sessionUpdate: 'state_update',
              state: 'running',
            }),
          )
          await f.frameSend(
            send,
            notification({
              sessionUpdate: 'agent_message_chunk',
              messageId: 'answer',
              content: { type: 'text', text: 'outdated' },
            }),
          )
          await f.frameSend(
            send,
            notification({
              sessionUpdate: 'agent_message',
              messageId: 'answer',
              content: [{ type: 'text', text: 'correct' }],
            }),
          )
          await f.frameSend(
            send,
            notification({
              sessionUpdate: 'agent_message_chunk',
              messageId: 'answer',
              content: { type: 'text', text: 'ed' },
            }),
          )
          await f.frameSend(send, {
            jsonrpc: '2.0',
            id: frame.id!,
            result: { messageId: 'accepted-user' },
          })
          await f.frameSend(
            send,
            notification({
              sessionUpdate: 'state_update',
              state: 'idle',
              stopReason: reason,
              ...(reason === 'error'
                ? {
                    error: { code: -32603, message: '/private/secret-token' },
                  }
                : {}),
            }),
          )
          return true
        } else if (frame.method === 'session/close') {
          result = {}
        } else {
          throw new Error('ACP v2 must not call legacy operations: ' + frame.method)
        }
        await f.frameSend(send, { jsonrpc: '2.0', id: frame.id!, result })
        return true
      },
    })
    return f
  }

  test('falls back exactly once after host-attested pre-prompt failure', async () => {
    const first = new OperationError('EXECUTION_FAILED', 'native setup failed', {
      nativePrompt: { forwarding: 'not-forwarded', cleanup: 'confirmed', turnsSettled: 0 },
    })
    const f = make('end_turn', first)
    expect(await agentAcpFlow(f.run, f.selection)).toEqual({
      outcome: 'done',
      output: { text: 'corrected' },
    })
    expect(f.stats().calls).toBe(2)
    expect(f.frames.map((frame) => frame.method)).toEqual([
      'initialize',
      'session/new',
      'session/set_config_option',
      'session/set_config_option',
      'session/prompt',
      'session/close',
    ])
  })

  test('keeps the public events writer open until the backup settles', async () => {
    const first = new OperationError('EXECUTION_FAILED', 'native setup failed', {
      nativePrompt: { forwarding: 'not-forwarded', cleanup: 'confirmed', turnsSettled: 0 },
    })
    const observed: JsonValue[] = []
    let closes = 0
    const events: ChannelSender = {
      direction: 'send',
      delivery: 'direct',
      async send(value) {
        if (closes) throw new Error('Backup progress sent after events EOF')
        observed.push(value)
      },
      async close() {
        closes++
      },
    }
    const f = make('end_turn', first, events)
    expect(await agentAcpFlow(f.run, f.selection)).toEqual({
      outcome: 'done',
      output: { text: 'corrected' },
    })
    expect(f.stats().calls).toBe(2)
    expect(
      observed.some(
        (value) =>
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          value.sessionUpdate === 'agent_message_chunk',
      ),
    ).toBe(true)
    expect(closes).toBe(1)
  })

  test('an uncertain native failure without rejected-without-output never dispatches a backup', async () => {
    const first = new OperationError('UNCERTAIN', 'prompt may have executed', {
      nativePrompt: { forwarding: 'not-forwarded', cleanup: 'confirmed' },
    })
    const f = make('end_turn', first)
    const failure = await agentAcpFlow(f.run, f.selection).catch((error) => error)
    expect(failure).toBe(first)
    expect(f.stats().calls).toBe(1)
    expect(f.frames).toEqual([])
  })

  test('zero-output first-turn rejection respects afterRejectedPrompt policy', async () => {
    const rejectedFirst = new OperationError('UNCERTAIN', 'rate limit reached', {
      nativePrompt: {
        forwarding: 'rejected-without-output',
        cleanup: 'confirmed',
        turnsSettled: 0,
      },
      nativeSession: { category: 'limit', httpStatusCode: 429 },
    })

    // Default afterRejectedPrompt is 'stop' -> does not fail over
    const fDefault = make('end_turn', rejectedFirst)
    const failure = await agentAcpFlow(fDefault.run, fDefault.selection).catch((e) => e)
    expect(failure).toBe(rejectedFirst)
    expect(fDefault.stats().calls).toBe(1)

    // With afterRejectedPrompt: 'next-on-limit-or-service' -> fails over to backup
    const fPermit = make('end_turn', rejectedFirst)
    const runPermit = {
      ...fPermit.run,
      settings: { recovery: { afterRejectedPrompt: 'next-on-limit-or-service' } },
    }
    expect(await agentAcpFlow(runPermit as RunContext, fPermit.selection)).toEqual({
      outcome: 'done',
      output: { text: 'corrected' },
    })
    expect(fPermit.stats().calls).toBe(2)
  })

  test('unconfirmed cleanup never advances to backup candidate', async () => {
    const unconfirmed = new OperationError('EXECUTION_FAILED', 'process leaked', {
      nativePrompt: { forwarding: 'not-forwarded', cleanup: 'unconfirmed', turnsSettled: 0 },
    })
    const f = make('end_turn', unconfirmed)
    const failure = await agentAcpFlow(f.run, f.selection).catch((e) => e)
    expect(failure).toBe(unconfirmed)
    expect(f.stats().calls).toBe(1)
  })

  test('unbound backup slot returning UNAVAILABLE rethrows the original error', async () => {
    const first = new OperationError('EXECUTION_FAILED', 'native setup failed', {
      nativePrompt: { forwarding: 'not-forwarded', cleanup: 'confirmed', turnsSettled: 0 },
    })
    const f = fixture({
      initialNativeFailure: first,
      selection: [
        { slot: 'native', operationId: 'native' },
        { slot: 'backup1', operationId: 'backup1' },
      ],
    })
    // Simulate backup1 being unavailable
    const origCall = f.run.call.bind(f.run)
    f.run.call = async (call, opts) => {
      if (call.slot === 'backup1') {
        throw new OperationError('UNAVAILABLE', 'invocation slot is not admitted')
      }
      return origCall(call, opts)
    }
    const failure = await agentAcpFlow(f.run, f.selection).catch((e) => e)
    expect(failure).toBe(first)
  })

  test('accepted message, patches and terminal idle settle without a legacy prompt completion', async () => {
    const f = make('end_turn')
    expect(await agentAcpFlow(f.run)).toEqual({
      outcome: 'done',
      output: { text: 'corrected' },
    })
    expect(f.frames.map((frame) => frame.method)).toEqual([
      'initialize',
      'session/new',
      'session/set_config_option',
      'session/set_config_option',
      'session/prompt',
      'session/close',
    ])
    expect(f.stats()).toEqual({ calls: 1, cancelled: false, settled: true })
  })

  test('post-insertion error is not reclassified as successful acceptance', async () => {
    const f = make('error')
    const error = await agentAcpFlow(f.run).catch((cause) => cause)
    expect(error).toBeInstanceOf(OperationError)
    expect(error.code).toBe('EXECUTION_FAILED')
    expect(JSON.stringify({ message: error.message, details: error.details })).not.toContain(
      'secret-token',
    )
    expect(f.frames.some((frame) => frame.method === 'session/close')).toBeFalse()
  })

  test('beforePrompt: stop suppresses failover even on host-attested pre-prompt failure', async () => {
    const firstFailure = new OperationError('EXECUTION_FAILED', 'native setup failed', {
      nativePrompt: { forwarding: 'not-forwarded', cleanup: 'confirmed', turnsSettled: 0 },
    })
    const f = make('end_turn', firstFailure)
    const run = { ...f.run, settings: { recovery: { beforePrompt: 'stop' } } }
    const failure = await agentAcpFlow(run as RunContext, f.selection).catch((e) => e)
    expect(failure).toBe(firstFailure)
    expect(f.stats().calls).toBe(1)
  })

  test('HTTP 502 and 504 trigger next-on-limit-or-service recovery when rejected without output', async () => {
    for (const httpStatusCode of [502, 504]) {
      const rejected = new OperationError('UNCERTAIN', `gateway ${httpStatusCode}`, {
        nativePrompt: {
          forwarding: 'rejected-without-output',
          cleanup: 'confirmed',
          turnsSettled: 0,
        },
        nativeSession: { httpStatusCode },
      })
      const f = make('end_turn', rejected)
      const run = {
        ...f.run,
        settings: { recovery: { afterRejectedPrompt: 'next-on-limit-or-service' } },
      }
      expect(await agentAcpFlow(run as RunContext, f.selection)).toEqual({
        outcome: 'done',
        output: { text: 'corrected' },
      })
      expect(f.stats().calls).toBe(2)
    }
  })

  test('Turn 2 pre-prompt failure (turnsSettled > 0) does not replay Turn 0 on backup', async () => {
    const laterFailure = new OperationError('EXECUTION_FAILED', 'turn 2 aborted pre-prompt', {
      nativePrompt: { forwarding: 'not-forwarded', cleanup: 'confirmed', turnsSettled: 1 },
    })
    const f = make('end_turn', laterFailure)
    const failure = await agentAcpFlow(f.run, f.selection).catch((e) => e)
    expect(failure).toBe(laterFailure)
    expect(f.stats().calls).toBe(1)
  })

  test('skips unbound optional backup1 slot and succeeds on backup2', async () => {
    const first = new OperationError('EXECUTION_FAILED', 'native setup failed', {
      nativePrompt: { forwarding: 'not-forwarded', cleanup: 'confirmed', turnsSettled: 0 },
    })
    const calledSlots: string[] = []
    const f = fixture({
      ready: v2Ready,
      initialNativeFailure: first,
      selection: [
        { slot: 'native', operationId: 'native' },
        { slot: 'backup1', operationId: 'backup1' },
        { slot: 'backup2', operationId: 'backup2' },
      ],
      rejectAttempt(call) {
        calledSlots.push(call.slot)
        if (call.slot === 'backup1')
          throw new OperationError('UNAVAILABLE', 'invocation slot is not admitted')
      },
      async emit(frame, send) {
        if (frame.method === 'initialize') {
          await f.frameSend(send, {
            jsonrpc: '2.0',
            id: frame.id!,
            result: {
              protocolVersion: 2,
              capabilities: { session: {} },
              info: { name: 'b2', version: '2' },
            },
          })
          return true
        }
        if (frame.method === 'session/new') {
          await f.frameSend(send, {
            jsonrpc: '2.0',
            id: frame.id!,
            result: { sessionId: 'owned-session', configOptions: [] },
          })
          return true
        }
        if (frame.method === 'session/set_config_option') {
          const params = frame.params as JsonObject
          await f.frameSend(send, {
            jsonrpc: '2.0',
            id: frame.id!,
            result: {
              configOptions: [
                { configId: params.configId!, type: 'select', currentValue: params.value! },
              ],
            },
          })
          return true
        }
        if (frame.method === 'session/prompt') {
          await f.frameSend(send, notification({ sessionUpdate: 'user_message', messageId: 'u2' }))
          await f.frameSend(send, notification({ sessionUpdate: 'state_update', state: 'running' }))
          await f.frameSend(
            send,
            notification({
              sessionUpdate: 'agent_message',
              messageId: 'a2',
              content: [{ type: 'text', text: 'from-b2' }],
            }),
          )
          await f.frameSend(send, { jsonrpc: '2.0', id: frame.id!, result: { messageId: 'u2' } })
          await f.frameSend(
            send,
            notification({ sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' }),
          )
          return true
        }
        if (frame.method === 'session/close') {
          await f.frameSend(send, { jsonrpc: '2.0', id: frame.id!, result: {} })
          return true
        }
        return false
      },
    })
    expect(await agentAcpFlow(f.run, f.selection)).toEqual({
      outcome: 'done',
      output: { text: 'from-b2' },
    })
    expect(calledSlots).toEqual(['native', 'backup1', 'backup2'])
  })

  test('cross-client fallback strips unsupported { session } and retries candidate fresh', async () => {
    const first = new OperationError('EXECUTION_FAILED', 'native limit', {
      nativePrompt: { forwarding: 'not-forwarded', cleanup: 'confirmed', turnsSettled: 0 },
    })
    const seenInputs: JsonValue[] = []
    const f = fixture({
      ready: v2Ready,
      input: { instructions: 'Answer.', session: { retain: true } },
      selection: [
        { slot: 'native', operationId: 'native' },
        { slot: 'backup1', operationId: 'backup1' },
        { slot: 'backup1', operationId: 'backup1:fresh' },
      ],
      rejectAttempt(call, attempt) {
        seenInputs.push(call.input as JsonValue)
        if (attempt === 0) throw first
        if (attempt === 1)
          throw new OperationError(
            'UNAVAILABLE',
            'finite ACP session retention requires a reviewed grant',
          )
      },
      async emit(frame, send) {
        if (frame.method === 'initialize') {
          await f.frameSend(send, {
            jsonrpc: '2.0',
            id: frame.id!,
            result: {
              protocolVersion: 2,
              capabilities: { session: {} },
              info: { name: 'b1', version: '2' },
            },
          })
          return true
        }
        if (frame.method === 'session/new') {
          await f.frameSend(send, {
            jsonrpc: '2.0',
            id: frame.id!,
            result: { sessionId: 'owned-session', configOptions: [] },
          })
          return true
        }
        if (frame.method === 'session/set_config_option') {
          const params = frame.params as JsonObject
          await f.frameSend(send, {
            jsonrpc: '2.0',
            id: frame.id!,
            result: {
              configOptions: [
                { configId: params.configId!, type: 'select', currentValue: params.value! },
              ],
            },
          })
          return true
        }
        if (frame.method === 'session/prompt') {
          await f.frameSend(send, notification({ sessionUpdate: 'user_message', messageId: 'u1' }))
          await f.frameSend(send, notification({ sessionUpdate: 'state_update', state: 'running' }))
          await f.frameSend(
            send,
            notification({
              sessionUpdate: 'agent_message',
              messageId: 'a1',
              content: [{ type: 'text', text: 'fresh-backup' }],
            }),
          )
          await f.frameSend(send, { jsonrpc: '2.0', id: frame.id!, result: { messageId: 'u1' } })
          await f.frameSend(
            send,
            notification({ sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' }),
          )
          return true
        }
        if (frame.method === 'session/close') {
          await f.frameSend(send, { jsonrpc: '2.0', id: frame.id!, result: {} })
          return true
        }
        return false
      },
    })
    expect(
      await agentAcpFlow(f.run, [
        { slot: 'native', operationId: 'native' },
        { slot: 'backup1', operationId: 'backup1' },
      ]),
    ).toEqual({
      outcome: 'done',
      output: {
        text: 'fresh-backup',
        session: { status: 'unavailable', reason: 'unsupported-history' },
      },
    })
    expect(seenInputs).toEqual([{ session: { retain: true } }, { session: { retain: true } }, null])
  })

  test('sameClientSession: fresh strips session input on backup retry and reports unsupported-history', async () => {
    const first = new OperationError('EXECUTION_FAILED', 'native setup failed', {
      nativePrompt: { forwarding: 'not-forwarded', cleanup: 'confirmed', turnsSettled: 0 },
    })
    const seenInputs: JsonValue[] = []
    const reference = '013579ab-cdef-4567-89ab-0123456789ab'
    const f = fixture({
      ready: v2Ready,
      initialNativeFailure: first,
      input: { instructions: 'Answer.', session: { restore: reference } },
      settings: { recovery: { sameClientSession: 'fresh' } },
      result: {
        outcome: 'done',
        output: { stopReason: 'exited', exitCode: 0, signal: null, cleanup: 'complete' },
      },
      selection: [
        { slot: 'native', operationId: 'native' },
        { slot: 'backup1', operationId: 'backup1' },
      ],
      rejectAttempt(call) {
        seenInputs.push(call.input as JsonValue)
      },
      async emit(frame, send) {
        if (frame.method === 'initialize') {
          await f.frameSend(send, {
            jsonrpc: '2.0',
            id: frame.id!,
            result: {
              protocolVersion: 2,
              capabilities: { session: {} },
              info: { name: 'b1', version: '2' },
            },
          })
          return true
        }
        if (frame.method === 'session/new') {
          await f.frameSend(send, {
            jsonrpc: '2.0',
            id: frame.id!,
            result: { sessionId: 'owned-session', configOptions: [] },
          })
          return true
        }
        if (frame.method === 'session/set_config_option') {
          const params = frame.params as JsonObject
          await f.frameSend(send, {
            jsonrpc: '2.0',
            id: frame.id!,
            result: {
              configOptions: [
                { configId: params.configId!, type: 'select', currentValue: params.value! },
              ],
            },
          })
          return true
        }
        if (frame.method === 'session/prompt') {
          await f.frameSend(send, notification({ sessionUpdate: 'user_message', messageId: 'u1' }))
          await f.frameSend(send, notification({ sessionUpdate: 'state_update', state: 'running' }))
          await f.frameSend(
            send,
            notification({
              sessionUpdate: 'agent_message',
              messageId: 'a1',
              content: [{ type: 'text', text: 'backup-fresh' }],
            }),
          )
          await f.frameSend(send, { jsonrpc: '2.0', id: frame.id!, result: { messageId: 'u1' } })
          await f.frameSend(
            send,
            notification({ sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' }),
          )
          return true
        }
        if (frame.method === 'session/close') {
          await f.frameSend(send, { jsonrpc: '2.0', id: frame.id!, result: {} })
          return true
        }
        return false
      },
    })
    expect(await agentAcpFlow(f.run, f.selection)).toEqual({
      outcome: 'done',
      output: {
        text: 'backup-fresh',
        session: { status: 'unavailable', reason: 'unsupported-history' },
      },
    })
    expect(seenInputs).toEqual([{ session: { restore: reference } }, null])
  })

  test('resume-if-qualified keeps { restore } on failover: skips non-retaining backup1 and resumes on backup2 or fails', async () => {
    const first = new OperationError('EXECUTION_FAILED', 'native setup failed', {
      nativePrompt: { forwarding: 'not-forwarded', cleanup: 'confirmed', turnsSettled: 0 },
    })
    const seenCalls: Array<{ slot: string; input: JsonValue }> = []
    const reference = '013579ab-cdef-4567-89ab-0123456789ab'
    const successor = 'fedcba98-7654-4321-89ab-0123456789ab'
    const f = fixture({
      ready: { ...v2Ready, restoreSessionId: 'owned-session' },
      input: { instructions: 'Continue.', session: { restore: reference } },
      result: {
        outcome: 'done',
        output: {
          stopReason: 'exited',
          exitCode: 0,
          signal: null,
          cleanup: 'complete',
          session: { status: 'retained', reference: successor },
        },
      },
      selection: [
        { slot: 'native', operationId: 'native' },
        { slot: 'backup1', operationId: 'backup1' },
        { slot: 'backup2', operationId: 'backup2' },
      ],
      rejectAttempt(call) {
        seenCalls.push({ slot: call.slot, input: call.input as JsonValue })
        if (call.slot === 'native') throw first
        if (call.slot === 'backup1')
          throw new OperationError(
            'UNAVAILABLE',
            'this native client does not support retained sessions',
          )
      },
      async emit(frame, send) {
        if (frame.method === 'initialize') {
          await f.frameSend(send, {
            jsonrpc: '2.0',
            id: frame.id!,
            result: {
              protocolVersion: 2,
              capabilities: { session: {} },
              info: { name: 'b2', version: '2' },
            },
          })
          return true
        }
        if (frame.method === 'session/resume') {
          await f.frameSend(send, { jsonrpc: '2.0', id: frame.id!, result: { configOptions: [] } })
          return true
        }
        if (frame.method === 'session/set_config_option') {
          const params = frame.params as JsonObject
          await f.frameSend(send, {
            jsonrpc: '2.0',
            id: frame.id!,
            result: {
              configOptions: [
                { configId: params.configId!, type: 'select', currentValue: params.value! },
              ],
            },
          })
          return true
        }
        if (frame.method === 'session/prompt') {
          await f.frameSend(send, notification({ sessionUpdate: 'user_message', messageId: 'u1' }))
          await f.frameSend(send, notification({ sessionUpdate: 'state_update', state: 'running' }))
          await f.frameSend(
            send,
            notification({
              sessionUpdate: 'agent_message',
              messageId: 'a1',
              content: [{ type: 'text', text: 'resumed-on-b2' }],
            }),
          )
          await f.frameSend(send, { jsonrpc: '2.0', id: frame.id!, result: { messageId: 'u1' } })
          await f.frameSend(
            send,
            notification({ sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' }),
          )
          return true
        }
        if (frame.method === 'session/close') {
          await f.frameSend(send, { jsonrpc: '2.0', id: frame.id!, result: {} })
          return true
        }
        return false
      },
    })
    expect(await agentAcpFlow(f.run, f.selection)).toEqual({
      outcome: 'done',
      output: {
        text: 'resumed-on-b2',
        session: { status: 'retained', reference: successor },
      },
    })
    expect(seenCalls).toEqual([
      { slot: 'native', input: { session: { restore: reference } } },
      { slot: 'backup1', input: { session: { restore: reference } } },
      { slot: 'backup2', input: { session: { restore: reference } } },
    ])

    const failOnlySeen: JsonValue[] = []
    const failOnly = fixture({
      ready: { ...v2Ready, restoreSessionId: 'owned-session' },
      input: { instructions: 'Continue.', session: { restore: reference } },
      selection: [
        { slot: 'native', operationId: 'native' },
        { slot: 'backup1', operationId: 'backup1' },
      ],
      rejectAttempt(call) {
        failOnlySeen.push(call.input as JsonValue)
        if (call.slot === 'native') throw first
        throw new OperationError(
          'UNAVAILABLE',
          'finite ACP session retention requires a reviewed grant',
        )
      },
      async emit() {
        return false
      },
    })
    await expect(agentAcpFlow(failOnly.run, failOnly.selection)).rejects.toBe(first)
    expect(failOnlySeen).toEqual([
      { session: { restore: reference } },
      { session: { restore: reference } },
    ])
  })
})
