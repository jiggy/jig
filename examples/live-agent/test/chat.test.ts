import { describe, expect, spyOn, test } from 'bun:test'
import {
  OperationError,
  type ChannelReceiver,
  type ChannelSender,
  type JsonValue,
  type RunContext,
} from '@jigging/flow'
import { chat } from '../flows/chat/chat.ts'

const text = (value: string): JsonValue => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text: value },
})

function fixture(
  options: {
    input?: JsonValue
    updates?: JsonValue[]
    observationError?: unknown
    executionError?: unknown
    outputError?: unknown
    connectOutput?: boolean
    outcome?: string
  } = {},
) {
  const published: JsonValue[] = []
  let closed = false
  let calls = 0
  const iterator = (async function* () {
    for (const update of options.updates ?? [
      text('hello'),
      { sessionUpdate: 'plan', entries: [] },
      text('world'),
    ])
      yield update
    if (options.observationError) throw options.observationError
  })()
  const receive = Object.assign(iterator, {
    direction: 'receive',
    delivery: 'direct',
    startSequence: 1,
    async close() {
      closed = true
      await iterator.return(undefined)
    },
  }) as ChannelReceiver
  const send: ChannelSender = {
    direction: 'send',
    delivery: 'direct',
    async send(value) {
      if (options.outputError) throw options.outputError
      published.push(value)
    },
    async close() {},
  }
  const run = {
    input: options.input === undefined ? { instructions: 'say hello' } : options.input,
    channels: options.connectOutput ? { progress: send } : {},
    async channel() {
      return { send, receive }
    },
    async callCapability(call: { channels: { events: ChannelSender } }) {
      expect(call.channels.events).toBe(send)
      calls += 1
      if (options.executionError) throw options.executionError
      return { outcome: options.outcome ?? 'completed', text: 'actual answer' }
    },
  } as unknown as RunContext
  return { run, published, closed: () => closed, calls: () => calls }
}

describe('live Agent application', () => {
  test('prints public text but not plan records and preserves the execution result', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => {})
    try {
      const sample = fixture()
      const result = await chat(sample.run)
      expect(log.mock.calls).toEqual([['hello'], ['world']])
      expect(result).toEqual({
        outcome: 'done',
        output: {
          result: { outcome: 'completed', text: 'actual answer' },
          progress: { complete: true, suppressed: false, displayed: 2 },
        },
      })
      expect(sample.calls()).toBe(1)
    } finally {
      log.mockRestore()
    }
  })

  test('publishes through the selected root channel without duplicate console output', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => {})
    try {
      const sample = fixture({ connectOutput: true })
      await chat(sample.run)
      expect(sample.published).toEqual(['hello', 'world'])
      expect(log).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })

  test('suppresses progress without rewriting the Agent answer', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => {})
    try {
      const sample = fixture({
        connectOutput: true,
        input: { instructions: 'say hello', suppress: true },
      })
      const result = await chat(sample.run)
      expect(sample.published).toEqual([])
      expect(log).not.toHaveBeenCalled()
      expect(result.output).toMatchObject({
        result: { text: 'actual answer' },
        progress: { suppressed: true, displayed: 0 },
      })
    } finally {
      log.mockRestore()
    }
  })

  test('reports incomplete observation while retaining a completed Agent result', async () => {
    const sample = fixture({ connectOutput: true, observationError: new OperationError('LAGGED') })
    expect(await chat(sample.run)).toMatchObject({
      outcome: 'done',
      output: { progress: { complete: false }, result: { outcome: 'completed' } },
    })
  })

  test('stops publishing after an optional output failure but drains the Agent feed', async () => {
    const sample = fixture({ connectOutput: true, outputError: new OperationError('DISCONNECTED') })
    expect(await chat(sample.run)).toMatchObject({
      outcome: 'done',
      output: { progress: { complete: false, displayed: 0 } },
    })
  })

  test('preserves Agent failure and disposes a feed whose producer may not have started', async () => {
    const failure = new OperationError('UNAVAILABLE')
    const sample = fixture({ connectOutput: true, executionError: failure })
    await expect(chat(sample.run)).rejects.toBe(failure)
    expect(sample.closed()).toBe(true)
    expect(sample.calls()).toBe(1)
  })

  test('does not recover root cancellation as incomplete progress', async () => {
    const failure = new OperationError('CANCELLED')
    const sample = fixture({ connectOutput: true, observationError: failure })
    await expect(chat(sample.run)).rejects.toBe(failure)
  })

  test('retains a non-completed Agent outcome independently of progress', async () => {
    const sample = fixture({ connectOutput: true, outcome: 'limit' })
    expect(await chat(sample.run)).toMatchObject({
      outcome: 'limit',
      output: { result: { outcome: 'limit' } },
    })
  })

  test('rejects invalid inputs before creating any Agent work', async () => {
    for (const input of [null, { instructions: '' }, { instructions: 'valid', suppress: 'yes' }]) {
      const sample = fixture({ input })
      await expect(chat(sample.run)).rejects.toThrow(TypeError)
      expect(sample.calls()).toBe(0)
    }
  })
})
