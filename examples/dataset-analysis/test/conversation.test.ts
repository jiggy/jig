import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import {
  type ChannelEndpoint,
  type ChannelPair,
  type ChannelReceiver,
  type ChannelSender,
  type JsonObject,
  type JsonValue,
  OperationError,
  type RunContext,
  type RunResult,
} from '@jigging/flow'
import { analyze } from '../flows/analysis/analysis.ts'
import { readDataset } from '../flows/dataset/dataset.ts'
import { investigate, validateInput, verify } from '../flows/investigate/investigate.ts'
import fixture from '../input.json'

type Leaf = (run: Pick<RunContext, 'input' | 'channels' | 'signal'>) => Promise<RunResult>

test('self-contained Flow packages agree on both named descriptors', async () => {
  for (const name of ['sample-request', 'sample-celsius']) {
    const copies = await Promise.all(
      ['analysis', 'dataset', 'investigate'].map(async (flow) =>
        JSON.parse(
          await readFile(
            new URL(`../flows/${flow}/contracts/${name}.json`, import.meta.url),
            'utf8',
          ),
        ),
      ),
    )
    expect(copies[1]).toEqual(copies[0])
    expect(copies[2]).toEqual(copies[0])
    expect(copies[0].id).toBe(`https://example.org/dataset-analysis/${name}`)
    // ASCII identity validation belongs to application code, not unsupported
    // JSON Schema keywords. Installed review checks the actual Schema/1 profile.
    expect(copies[0].item.properties.sample).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 32,
    })
  }
})

// Application-only pipes model EOF, transferred rights and disposal. They do
// not establish the host's transport, admission, capacity or fencing guarantees.
function pipe(): ChannelPair & {
  transfer(endpoint: ChannelEndpoint): ChannelEndpoint
  owns(endpoint: ChannelEndpoint): boolean
  settled(): boolean
} {
  const queue: JsonValue[] = [],
    handles = new Map<ChannelEndpoint, { held: boolean }>()
  let ended = false,
    disposed = false
  let waiting: ((item: IteratorResult<JsonValue>) => void) | undefined
  const wake = (item: IteratorResult<JsonValue>) => {
    const resolve = waiting
    waiting = undefined
    resolve?.(item)
  }
  const handle = (direction: 'send' | 'receive'): ChannelEndpoint => {
    const state = { held: true }
    const check = () => {
      if (!state.held) throw new OperationError('PERMISSION_DENIED', 'Moved synthetic endpoint.')
    }
    const endpoint =
      direction === 'send'
        ? {
            direction,
            delivery: 'direct' as const,
            async send(value: JsonValue) {
              check()
              if (ended || disposed)
                throw new OperationError('DISCONNECTED', 'Synthetic receiver ended.')
              if (waiting) wake({ done: false, value })
              else queue.push(structuredClone(value))
            },
            async close() {
              check()
              ended = true
              wake({ done: true, value: undefined })
            },
          }
        : {
            direction,
            delivery: 'direct' as const,
            startSequence: 1,
            async next(): Promise<IteratorResult<JsonValue>> {
              check()
              if (queue.length && !disposed) return { done: false, value: queue.shift()! }
              if (ended || disposed) return { done: true, value: undefined }
              if (waiting) throw new Error('More than one pending synthetic read.')
              return new Promise((resolve) => {
                waiting = resolve
              })
            },
            async close() {
              check()
              disposed = true
              queue.length = 0
              wake({ done: true, value: undefined })
            },
            async return() {
              await this.close()
              return { done: true as const, value: undefined }
            },
            [Symbol.asyncIterator]() {
              return this
            },
          }
    handles.set(endpoint, state)
    return endpoint
  }
  return {
    send: handle('send') as ChannelSender,
    receive: handle('receive') as ChannelReceiver,
    owns: (endpoint) => handles.has(endpoint),
    settled: () => ended && disposed,
    transfer(endpoint) {
      const state = handles.get(endpoint)!
      if (!state.held) throw new Error('Duplicate synthetic transfer.')
      state.held = false
      return handle(endpoint.direction)
    },
  }
}

async function application(
  input: JsonValue,
  options: {
    analysis?: Leaf
    dataset?: Leaf
    reject?: 'analysis' | 'dataset'
    signal?: AbortSignal
  } = {},
) {
  const pairs: ReturnType<typeof pipe>[] = [],
    calls: { slot: string; input: JsonValue }[] = []
  const signal = options.signal ?? new AbortController().signal
  const run = {
    input,
    signal,
    async channel() {
      const value = pipe()
      pairs.push(value)
      return value
    },
    async runChildFlow(call, callOptions) {
      if (call.slot === options.reject)
        throw new OperationError('UNAVAILABLE', 'Synthetic rejected dispatch.')
      const childSignal = callOptions!.signal!
      if (childSignal.aborted)
        throw new OperationError('CANCELLED', 'Synthetic predispatch cancellation.')
      const channels = Object.fromEntries(
        Object.entries(call.channels!).map(([name, endpoint]) => [
          name,
          pairs.find((pair) => pair.owns(endpoint))!.transfer(endpoint),
        ]),
      )
      calls.push({ slot: call.slot, input: structuredClone(call.input) })
      const dispose = () => Promise.all(Object.values(channels).map((endpoint) => endpoint.close()))
      const abort = () => {
        void dispose()
      }
      childSignal.addEventListener('abort', abort, { once: true })
      try {
        return await (call.slot === 'analysis'
          ? (options.analysis ?? analyze)
          : (options.dataset ?? readDataset))({ input: call.input, signal: childSignal, channels })
      } catch (error) {
        if (childSignal.aborted)
          throw new OperationError('CANCELLED', 'Synthetic child cancellation.')
        throw error
      } finally {
        await dispose()
        childSignal.removeEventListener('abort', abort)
      }
    },
  } as Pick<RunContext, 'input' | 'signal' | 'channel' | 'runChildFlow'>
  const result = await investigate(run)
  expect(pairs.every((pair) => pair.settled())).toBe(true)
  return { result, calls }
}

test('two ongoing participants adapt their requests and the root independently verifies the finding', async () => {
  const { result, calls } = await application(fixture)
  expect(result.outcome).toBe('done')
  const output = result.output as JsonObject
  expect(output.crossing).toEqual({ sample: 's4', index: 4, celsius: 31 })
  expect(output.observations).toEqual([fixture.samples[4], fixture.samples[2], fixture.samples[3]])
  expect(output.verification).toEqual({ accepted: true })
  expect((output.children as JsonObject).dataset).toEqual({
    outcome: 'done',
    output: { served: ['s4', 's2', 's3'] },
  })
  expect(calls.find((call) => call.slot === 'analysis')!.input).toEqual({
    threshold: 30,
    samples: fixture.samples.map((item) => item.sample),
  })
  expect(calls.find((call) => call.slot === 'dataset')!.input).toEqual({ samples: fixture.samples })
})

for (const [threshold, index] of [
  [17, 0],
  [52, 7],
  [53, -1],
  [26, 3],
]) {
  test(`threshold ${threshold} returns the correct boundary, including absence`, async () => {
    const { result } = await application({ ...fixture, threshold })
    expect(result.outcome).toBe('done')
    expect((result.output as JsonObject).crossing).toEqual(
      index === -1 ? null : { ...fixture.samples[index!], index },
    )
  })
}

test('128 readings need at most eight requests, including repeated temperatures', async () => {
  for (const threshold of [-1, 0, 31, 63, 64]) {
    const samples = Array.from({ length: 128 }, (_, index) => ({
      sample: `s${index}`,
      celsius: Math.floor(index / 2),
    }))
    const { result } = await application({ threshold, samples })
    expect(result.outcome).toBe('done')
    expect(((result.output as JsonObject).observations as JsonValue[]).length).toBeLessThanOrEqual(
      8,
    )
  }
})

test('invalid original input is rejected before allocating channels', () => {
  for (const input of [
    null,
    { threshold: 1, samples: [] },
    { ...fixture, threshold: Infinity },
    { ...fixture, threshold: 9007199254740992 },
    { ...fixture, samples: [...fixture.samples].reverse() },
    { ...fixture, samples: [fixture.samples[0], fixture.samples[0]] },
    { ...fixture, samples: [{ sample: '../source', celsius: 1 }] },
    { ...fixture, samples: [{ sample: '🌡', celsius: 1 }] },
    {
      ...fixture,
      samples: Array.from({ length: 129 }, (_, index) => ({ sample: `s${index}`, celsius: index })),
    },
  ])
    expect(() => validateInput(input as JsonValue)).toThrow(TypeError)
  expect(
    validateInput({ threshold: -0, samples: [{ sample: 'one', celsius: 1.5 }] }).threshold === 0,
  ).toBe(true)
})

test('invalid root input rejects before allocating channels or dispatching children', async () => {
  let allocated = false,
    dispatched = false
  await expect(
    investigate({
      input: { ...fixture, samples: [...fixture.samples].reverse() },
      signal: new AbortController().signal,
      channel: async () => {
        allocated = true
        throw new Error('Unexpected allocation.')
      },
      runChildFlow: async () => {
        dispatched = true
        throw new Error('Unexpected dispatch.')
      },
    } as Pick<RunContext, 'input' | 'signal' | 'channel' | 'runChildFlow'>),
  ).rejects.toThrow('Use unique ASCII sample identifiers and nondecreasing Celsius readings.')
  expect(allocated).toBe(false)
  expect(dispatched).toBe(false)
})

async function scriptedAnalysis(replies: (JsonValue | Error)[], disposalError?: Error) {
  const input = { threshold: 30, samples: fixture.samples.map((item) => item.sample) }
  const requests: JsonValue[] = []
  let requestClosed = false,
    replyClosed = false
  const receive = {
    direction: 'receive',
    delivery: 'direct',
    startSequence: 1,
    async next() {
      if (!replies.length) return { done: true, value: undefined }
      const value = replies.shift()!
      if (value instanceof Error) throw value
      return { done: false, value }
    },
    async close() {
      replyClosed = true
      if (disposalError) throw disposalError
    },
    [Symbol.asyncIterator]() {
      return this
    },
  } as ChannelReceiver
  const result = await analyze({
    input,
    signal: new AbortController().signal,
    channels: {
      requests: {
        direction: 'send',
        delivery: 'direct',
        async send(value) {
          requests.push(value)
        },
        async close() {
          requestClosed = true
        },
      },
      replies: receive,
    },
  })
  expect(requestClosed && replyClosed).toBe(true)
  return { result, requests }
}

test('duplicate, unexpected, missing and extra replies retain only the accepted prefix', async () => {
  for (const [values, problem, count] of [
    [[fixture.samples[4], fixture.samples[4]], 'unexpected-reply', 1],
    [[{ sample: 'wrong', celsius: 31 }], 'unexpected-reply', 0],
    [[fixture.samples[4]], 'missing-reply', 1],
    [
      [fixture.samples[4], fixture.samples[2], fixture.samples[3], fixture.samples[3]],
      'extra-reply',
      3,
    ],
    [[{ sample: 's4', celsius: null }], 'invalid-reply', 0],
  ] as const) {
    const { result } = await scriptedAnalysis([...values] as JsonValue[])
    expect(result.outcome).toBe('blocked')
    expect((result.output as JsonObject).problem).toBe(problem)
    expect((result.output as JsonObject).crossing).toBeNull()
    expect(((result.output as JsonObject).observations as JsonValue[]).length).toBe(count)
  }
})

test('channel-local owner loss retains observations but uncertainty stays fatal', async () => {
  const { result } = await scriptedAnalysis([
    fixture.samples[4]!,
    new OperationError('OWNER_CLOSED', 'Synthetic writer stopped.'),
  ])
  expect(result).toMatchObject({
    outcome: 'blocked',
    output: { problem: 'exchange-failed', observations: [fixture.samples[4]] },
  })
  await expect(
    scriptedAnalysis([new OperationError('UNCERTAIN', 'Synthetic ownership uncertainty.')]),
  ).rejects.toMatchObject({ code: 'UNCERTAIN' })
})

test('a rejected dispatch settles held rights and cancels its waiting sibling', async () => {
  for (const reject of ['analysis', 'dataset'] as const) {
    const { result } = await application(fixture, { reject })
    expect(result.outcome).toBe('blocked')
    expect((result.output as JsonObject).failures).toMatchObject({ [reject]: 'UNAVAILABLE' })
  }
})

test('a late channel disposal error cannot turn an incomplete conversation into a finding', async () => {
  const { result } = await scriptedAnalysis(
    [fixture.samples[4]!, fixture.samples[2]!, fixture.samples[3]!],
    new OperationError('OWNER_CLOSED', 'Synthetic late terminal cause.'),
  )
  expect(result).toMatchObject({
    outcome: 'blocked',
    output: { crossing: null, problem: 'exchange-failed' },
  })
  expect(((result.output as JsonObject).observations as JsonValue[]).length).toBe(3)
})

test('uncertain disposal vetoes a recovered setup failure', async () => {
  let count = 0
  const first = pipe()
  first.send.close = async () => {
    throw new OperationError('UNCERTAIN', 'Synthetic failed ownership settlement.')
  }
  await expect(
    investigate({
      input: fixture,
      signal: new AbortController().signal,
      channel: async () => {
        if (++count === 1) return first
        throw new OperationError('UNAVAILABLE', 'Synthetic rejected channel creation.')
      },
      runChildFlow: async () => {
        throw new Error('No child may start after setup failure.')
      },
    } as Pick<RunContext, 'input' | 'signal' | 'channel' | 'runChildFlow'>),
  ).rejects.toMatchObject({ code: 'UNCERTAIN' })
})

test('an unsuccessful analysis result is retained before its waiting dataset is cancelled', async () => {
  const { result } = await application(fixture, {
    analysis: async () => ({
      outcome: 'blocked',
      output: { observations: [], problem: 'missing-reply' },
    }),
  })
  expect(result.outcome).toBe('blocked')
  expect((result.output as JsonObject).children).toMatchObject({
    analysis: { outcome: 'blocked', output: { problem: 'missing-reply' } },
  })
  expect((result.output as JsonObject).failures).toMatchObject({ dataset: 'CANCELLED' })
})

test('root cancellation is not converted into a blocked finding', async () => {
  const stop = new AbortController()
  const task = application(fixture, {
    signal: stop.signal,
    dataset: async (run) => {
      const reader = run.channels.requests as ChannelReceiver
      await reader.next()
      stop.abort()
      run.signal.throwIfAborted()
      throw new Error('Unreachable')
    },
  })
  await expect(task).rejects.toMatchObject({ name: 'AbortError' })
})

test('independent verification rejects fabricated findings, values, transcripts and child success', async () => {
  const { result } = await application(fixture)
  const original = (result.output as JsonObject).children as unknown as {
    analysis: RunResult
    dataset: RunResult
  }
  const input = validateInput(fixture)
  expect(verify(input, original)).toBe(true)
  const corruptions = [
    (children: typeof original) => {
      ;(children.analysis.output as JsonObject).crossing = null
    },
    (children: typeof original) => {
      ;((children.analysis.output as JsonObject).observations as JsonObject[])[0]!.celsius = 32
    },
    (children: typeof original) => {
      ;((children.analysis.output as JsonObject).observations as JsonValue[]).reverse()
    },
    (children: typeof original) => {
      ;(children.dataset.output as JsonObject).served = []
    },
    (children: typeof original) => {
      children.dataset = { ...children.dataset, outcome: 'blocked' }
    },
  ]
  for (const corrupt of corruptions) {
    const children = structuredClone(original)
    corrupt(children)
    expect(verify(input, children)).toBe(false)
  }
})

test('dataset rejects unknown, duplicate and over-budget requests', async () => {
  for (const [ids, problem, served] of [
    [['unknown'], 'unknown-sample', 0],
    [['s0', 's0'], 'duplicate-request', 1],
    [Array.from({ length: 9 }, (_, index) => `s${index}`), 'request-limit', 8],
  ] as const) {
    const requests = pipe(),
      replies = pipe()
    for (const sample of ids) await requests.send.send({ sample })
    await requests.send.close()
    const result = await readDataset({
      input: {
        samples: Array.from({ length: 9 }, (_, index) => ({ sample: `s${index}`, celsius: index })),
      },
      signal: new AbortController().signal,
      channels: { requests: requests.receive, replies: replies.send },
    })
    expect(result.outcome).toBe('blocked')
    expect((result.output as JsonObject).problem).toBe(problem)
    expect(((result.output as JsonObject).served as JsonValue[]).length).toBe(served)
    await replies.receive.close()
  }
})
