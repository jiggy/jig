import { describe, expect, spyOn, test } from 'bun:test'
import {
  OperationError,
  type ChannelPair,
  type ChannelReceiver,
  type ChannelSender,
  type FlowCall,
  type JsonObject,
  type JsonValue,
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
  protocolVersion: 1,
  cwd: '/work',
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
  readonly output?: string
  readonly stop?: string
  readonly result?: RunResult
  readonly input?: JsonValue
  readonly settings?: JsonObject
  readonly events?: ChannelSender
  readonly signal?: AbortSignal
  readonly emit?: (frame: Frame, send: ChannelSender) => Promise<boolean>
  readonly disposeFailure?: Error
}

function fixture(options: Options = {}) {
  const frames: Frame[] = []
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
    channels: options.events ? { events: options.events } : {},
    scratch: '/scratch',
    deadlineUnixMs: Date.now() + 60_000,
    signal: options.signal ?? new AbortController().signal,
    async channel(settings: { contract: string }) {
      expect(settings.contract).toBe(
        channels.length === 0
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
      calls++
      expect(call).toMatchObject({ operationId: 'native', slot: 'native', input: null })
      expect(call.channels?.requests).toBe(channels[0]!.receive)
      expect(call.channels?.responses).toBe(channels[1]!.send)
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
        await send.send(ready)
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
          if (await options.emit?.(frame, send)) continue
          let result: JsonValue = {}
          switch (frame.method) {
            case 'initialize':
              result = {
                protocolVersion: 1,
                agentCapabilities: { sessionCapabilities: { close: {} } },
              }
              break
            case 'session/new':
              result = { sessionId: 'owned-session' }
              break
            case 'session/set_config_option': {
              const params = frame.params as JsonObject
              result = { configOptions: [{ id: params.configId!, currentValue: params.value! }] }
              break
            }
            case 'session/prompt':
              await frameSend(send, {
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                  sessionId: 'owned-session',
                  update: {
                    sessionUpdate: 'agent_message_chunk',
                    content: { type: 'text', text: options.output ?? 'The answer.' },
                  },
                },
              })
              result = { stopReason: options.stop ?? 'end_turn' }
              break
          }
          await frameSend(send, { jsonrpc: '2.0', id: frame.id!, result })
        }
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
  }
}

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
      $schema: 'https://flow.jig.md/schemas/schema-1.json',
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
      'session/set_mode',
      'session/prompt',
    ])
    const prompt = JSON.stringify(consumer.frames.find((f) => f.method === 'session/prompt'))
    expect(prompt).toContain('Selected Skill.')
    expect(prompt).toContain('matching this canonical FLOW Schema/1')
    expect(consumer.frames[2]!.params).toEqual({
      sessionId: 'owned-session',
      configId: 'model',
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
