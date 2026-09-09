import { expect, spyOn, test } from 'bun:test'
import {
  type ChannelBroadcast,
  type ChannelEndpoint,
  type ChannelPair,
  type ChannelReceiver,
  type ChannelSender,
  type JsonValue,
  OperationError,
  type RunContext,
  type RunResult,
} from '@jigging/flow'
import { formatProgress, monitor } from '../flows/monitor/monitor.ts'
import { monitoredRepair, recordPhases } from '../flows/project/monitoring.ts'
import { input, syntheticRepair } from './fixture.ts'

// Application-only pipes simulate transfer, EOF, and disposal. They do not
// establish host fencing, wire bounds, or native-client behavior.
function pipe(delivery: 'direct' | 'broadcast' = 'direct'): ChannelPair & {
  owns(endpoint: ChannelEndpoint): boolean
  transfer(endpoint: ChannelEndpoint): ChannelEndpoint
  readonly disconnectedTransfers: number
} {
  const queue: JsonValue[] = []
  let disconnectedTransfers = 0
  let ended = false,
    released = false
  let pending: ((value: IteratorResult<JsonValue>) => void) | undefined
  const handles = new Map<ChannelEndpoint, { held: boolean }>()
  const endpoint = (direction: 'send' | 'receive'): ChannelEndpoint => {
    const state = { held: true }
    const check = () => {
      if (!state.held) throw new OperationError('PERMISSION_DENIED', 'Moved endpoint.')
    }
    const handle =
      direction === 'send'
        ? {
            direction,
            delivery,
            async send(value: JsonValue) {
              check()
              if (ended || released) throw new OperationError('DISCONNECTED', 'Reader stopped.')
              if (pending) {
                const resolve = pending
                pending = undefined
                resolve({ done: false, value })
              } else queue.push(value)
            },
            async close() {
              check()
              ended = true
              if (pending) {
                pending({ done: true, value: undefined })
                pending = undefined
              }
            },
          }
        : {
            direction,
            delivery,
            startSequence: 1,
            async next(): Promise<IteratorResult<JsonValue>> {
              check()
              if (queue.length && !released) return { done: false, value: queue.shift()! }
              if (ended || released) return { done: true, value: undefined }
              return new Promise((resolve) => {
                pending = resolve
              })
            },
            async close() {
              check()
              released = true
              queue.length = 0
              if (pending) {
                pending({ done: true, value: undefined })
                pending = undefined
              }
            },
            async return() {
              await this.close()
              return { done: true as const, value: undefined }
            },
            [Symbol.asyncIterator]() {
              return this
            },
          }
    handles.set(handle, state)
    return handle
  }
  return {
    owns: (value) => handles.has(value),
    send: endpoint('send') as ChannelSender,
    receive: endpoint('receive') as ChannelReceiver,
    get disconnectedTransfers() {
      return disconnectedTransfers
    },
    transfer(value) {
      const state = handles.get(value)!
      if (!state.held) throw new Error('Synthetic duplicate transfer.')
      state.held = false
      if (value.direction === 'send' && released) disconnectedTransfers++
      return endpoint(value.direction)
    },
  }
}

// Fan-out here checks application wiring only. Broker tests establish actual
// capacity isolation, sequence accounting, and per-subscriber schema failures.
function broadcast(): ChannelBroadcast & {
  owns(endpoint: ChannelEndpoint): boolean
  transfer(endpoint: ChannelEndpoint): ChannelEndpoint
} {
  const readers: ReturnType<typeof pipe>[] = []
  const writers = new Map<ChannelEndpoint, { held: boolean }>()
  let ended = false
  const writer = (): ChannelSender => {
    const state = { held: true }
    const check = () => {
      if (!state.held) throw new OperationError('PERMISSION_DENIED', 'Moved endpoint.')
    }
    const send: ChannelSender = {
      direction: 'send',
      delivery: 'broadcast',
      async send(value) {
        check()
        if (ended) throw new OperationError('DISCONNECTED', 'Source sealed.')
        for (const reader of readers) {
          try {
            await reader.send.send(value)
          } catch (error) {
            if (!(error instanceof OperationError) || error.code !== 'DISCONNECTED') throw error
          }
        }
      },
      async close() {
        check()
        ended = true
        for (const reader of readers) await reader.send.close()
      },
    }
    writers.set(send, state)
    return send
  }
  return {
    send: writer(),
    async subscribe() {
      if (ended) throw new OperationError('DISCONNECTED', 'Source sealed.')
      const reader = pipe('broadcast')
      readers.push(reader)
      return reader.receive
    },
    owns: (value) => writers.has(value) || readers.some((reader) => reader.owns(value)),
    transfer(value) {
      if (value.direction === 'receive')
        return readers.find((reader) => reader.owns(value))!.transfer(value)
      const state = writers.get(value)!
      if (!state.held) throw new Error('Synthetic duplicate transfer.')
      state.held = false
      return writer()
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function application(
  options: {
    rejectMonitor?: boolean
    rejectRepair?: boolean
    delayWorkerAdmission?: boolean
    worker?: (channels: RunContext['channels'], signal: AbortSignal) => Promise<RunResult>
    afterMonitor?: () => Promise<void>
    settings?: RunContext['settings']
    output?: ChannelSender
  } = {},
) {
  const pairs: (ReturnType<typeof pipe> | ReturnType<typeof broadcast>)[] = []
  const calls: string[] = [],
    texts: string[] = []
  const stop = new AbortController()
  let active = 0,
    peak = 0
  const root: Pick<RunContext, 'channel' | 'channels' | 'signal' | 'runChildFlow'> = {
    signal: stop.signal,
    channels: {
      progress: options.output ?? {
        direction: 'send',
        delivery: 'direct',
        close: async () => {},
        send: async (value) => {
          texts.push(value as string)
        },
      },
    },
    channel: (async (options) => {
      const pair = options?.delivery === 'broadcast' ? broadcast() : pipe()
      pairs.push(pair)
      return pair
    }) as RunContext['channel'],
    runChildFlow: async (call, request) => {
      calls.push(call.slot)
      if (call.slot === 'monitor' && options.rejectMonitor)
        throw new OperationError('UNAVAILABLE', 'Synthetic monitor admission rejection.')
      if (call.slot === 'repair' && options.rejectRepair)
        throw new OperationError('UNAVAILABLE', 'Synthetic repair admission rejection.')
      if (call.slot === 'repair' && options.delayWorkerAdmission) await Bun.sleep(1)
      expect(call.slot === 'monitor' ? call.input : undefined).toEqual(
        call.slot === 'monitor' ? {} : undefined,
      )
      const channels: Record<string, ChannelEndpoint> = {}
      for (const [name, handle] of Object.entries(call.channels ?? {})) {
        const owner = pairs.find((pair) => pair.owns(handle))!
        channels[name] = owner.transfer(handle)
      }
      active++
      peak = Math.max(peak, active)
      const signal = request!.signal!
      const cancel = () => {
        for (const handle of Object.values(channels)) void handle.close()
      }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        if (call.slot === 'monitor') {
          const result = await monitor({ channels, settings: options.settings ?? {}, signal })
          await options.afterMonitor?.()
          signal.throwIfAborted()
          return result
        }
        return options.worker
          ? await options.worker(channels, signal)
          : (await syntheticRepair({ channels })).result
      } finally {
        for (const handle of Object.values(channels)) await handle.close()
        signal.removeEventListener('abort', cancel)
        active--
      }
    },
  }
  return {
    root,
    calls,
    texts,
    stop,
    pairs,
    get active() {
      return active
    },
    get peak() {
      return peak
    },
  }
}

test('single repair wires two children, forwards selected text and preserves independent evidence', async () => {
  const app = application()
  const log = spyOn(console, 'log').mockImplementation(() => {})
  let retained: RunResult | undefined
  try {
    const result = await monitoredRepair(app.root, input as any, async (value) => {
      retained = value
    })
    expect(app.calls).toEqual(['monitor', 'repair'])
    expect(app.peak).toBe(2)
    expect(app.active).toBe(0)
    expect(result.outcome).toBe('done')
    expect(result.output).toMatchObject({
      ...(retained!.output as object),
      monitoring: { complete: true, displayed: 4 },
      recording: {
        complete: true,
        startSequence: 1,
        records: [
          { phase: 'baseline', attempt: 0 },
          { phase: 'proposal', attempt: 1 },
          { phase: 'check', attempt: 1 },
          { phase: 'finished', attempt: 1 },
        ],
      },
    })
    expect(app.texts).toEqual([
      'Reproducing the defect with the fixed checks.',
      'Requesting repair proposal 1 of 2.',
      'Checking candidate 1 against the unchanged acceptance cases.',
      'Repair method finished; the execution result determines its outcome.',
    ])
    expect(log).not.toHaveBeenCalled()
  } finally {
    log.mockRestore()
  }
})

test('the unchanged repair works with a compact, filtered monitor presentation', async () => {
  const app = application({ settings: { style: 'compact', phases: ['proposal', 'check'] } })
  const result = await monitoredRepair(app.root, input as any, async () => {})
  expect(result.outcome).toBe('done')
  expect(app.texts).toEqual(['proposal 1', 'check 1'])
  expect((result.output as any).recording.records).toHaveLength(4)
})

test('ordinary diagnostics need no output port or Log capability', async () => {
  const app = application({ settings: { phases: ['baseline'] } })
  const log = spyOn(console, 'log').mockImplementation(() => {})
  try {
    await monitoredRepair({ ...app.root, channels: {} }, input as any, async () => {})
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('Reproducing the defect with the fixed checks.')
  } finally {
    log.mockRestore()
  }
})

test('rejected monitor admission cannot strand a reader or discard a passed patch', async () => {
  const app = application({ rejectMonitor: true, delayWorkerAdmission: true })
  let retained = 0
  const result = await monitoredRepair(app.root, input as any, async () => {
    retained++
  })
  expect(result.outcome).toBe('done')
  expect(result.output).toMatchObject({ monitoring: { complete: false, displayed: 0 } })
  expect(retained).toBe(1)
  expect(result.output).toMatchObject({ recording: { complete: true } })
  expect((result.output as any).recording.records).toHaveLength(4)
  expect(app.active).toBe(0)
})

test('checkpoint retention does not wait for the monitor terminal result', async () => {
  const retained = deferred<void>(),
    releaseMonitor = deferred<void>()
  const app = application({ afterMonitor: () => releaseMonitor.promise })
  const work = monitoredRepair(app.root, input as any, async () => {
    retained.resolve()
  })
  await retained.promise
  expect(app.active).toBe(1)
  releaseMonitor.resolve()
  expect((await work).outcome).toBe('done')
})

test('rejected repair admission disposes the independent recorder and settles the monitor', async () => {
  const app = application({ rejectRepair: true })
  await expect(
    monitoredRepair(app.root, input as any, async () => {
      throw new Error('must not retain')
    }),
  ).rejects.toThrow('Synthetic repair admission rejection.')
  expect(app.active).toBe(0)
})

test('failed repair and failed checkpoint abort and join the optional monitor', async () => {
  for (const where of ['repair', 'checkpoint']) {
    const failure = new OperationError('EXECUTION_FAILED', `Synthetic ${where} failure.`)
    const app = application(
      where === 'repair'
        ? {
            worker: async () => {
              throw failure
            },
          }
        : {},
    )
    await expect(
      monitoredRepair(app.root, input as any, async () => {
        if (where === 'checkpoint') throw failure
      }),
    ).rejects.toBe(failure)
    expect(app.active).toBe(0)
  }
})

test('root cancellation settles both branches and never returns a passed repair', async () => {
  const started = deferred<void>()
  const app = application({
    worker: async (_channels, signal) => {
      started.resolve()
      await new Promise<void>((_, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new OperationError('CANCELLED', 'Stopped.')),
          { once: true },
        )
      })
      throw new Error('unreachable')
    },
  })
  const work = monitoredRepair(app.root, input as any, async () => {
    throw new Error('must not retain')
  })
  const outcome = work.then(
    () => undefined,
    (error: unknown) => error,
  )
  await started.promise
  app.stop.abort()
  expect(await outcome).toBeDefined()
  expect(app.active).toBe(0)
})

test('optional output loss marks presentation incomplete without repeating Agent work', async () => {
  let sends = 0
  const app = application({
    output: {
      direction: 'send',
      delivery: 'direct',
      close: async () => {},
      send: async () => {
        sends++
        throw new OperationError('DISCONNECTED', 'Synthetic display loss.')
      },
    },
  })
  const result = await monitoredRepair(app.root, input as any, async () => {})
  expect(result.outcome).toBe('done')
  expect(result.output).toMatchObject({ monitoring: { complete: false, displayed: 0 } })
  expect(sends).toBe(1)
  expect((result.output as any).attempts).toHaveLength(1)
  expect(result.output).toMatchObject({ recording: { complete: true } })
})

test('phase-only progress is bounded, omits source and does not change failed repair evidence', async () => {
  const values: JsonValue[] = []
  const result = await syntheticRepair({
    success: false,
    channels: {
      progress: {
        direction: 'send',
        delivery: 'direct',
        close: async () => {},
        send: async (value) => {
          values.push(value)
        },
      },
    },
  })
  expect(result.result.outcome).toBe('blocked')
  expect(result.agents).toBe(2)
  expect(values).toHaveLength(6)
  expect(values.at(-1)).toEqual({ phase: 'finished', attempt: 2 })
  for (const value of values)
    expect(Object.keys(value as object).sort()).toEqual(['attempt', 'phase'])
})

test('monitor enforces phase meaning as well as shape', () => {
  for (const value of [
    { phase: 'baseline', attempt: 1 },
    { phase: 'proposal', attempt: 0 },
    { phase: 'finished', attempt: 3 },
    { phase: 'invented', attempt: 0 },
    { phase: 'check', attempt: 1, source: 'private text' },
  ])
    expect(() => formatProgress(value, 'compact')).toThrow('Invalid repair phase')
})

test('recorder keeps bounded phase data and reports a late disposal failure honestly', async () => {
  const source = pipe()
  await source.send.send({ phase: 'baseline', attempt: 0 })
  await source.send.close()
  source.receive.close = async () => {
    throw new OperationError('LAGGED', 'Synthetic recorder disposal loss.')
  }
  expect(await recordPhases(source.receive, new AbortController().signal)).toEqual({
    complete: false,
    startSequence: 1,
    records: [{ phase: 'baseline', attempt: 0 }],
  })
})

test('recorder bounds retention and never copies unrelated data into its trace', async () => {
  for (const values of [
    Array.from({ length: 7 }, () => ({ phase: 'check', attempt: 1 })),
    [{ phase: 'check', attempt: 1, source: 'not progress' }],
  ]) {
    const source = pipe()
    for (const value of values) await source.send.send(value)
    await source.send.close()
    const result = await recordPhases(source.receive, new AbortController().signal)
    expect(result.complete).toBe(false)
    expect(result.records.length).toBeLessThanOrEqual(6)
    expect(JSON.stringify(result)).not.toContain('not progress')
  }
})

test('late receiver disposal failure reports incomplete monitoring, not repair failure', async () => {
  const source = pipe(),
    output = pipe()
  await source.send.close()
  source.receive.close = async () => {
    throw new OperationError('LAGGED', 'Synthetic late disposal cause.')
  }
  const result = await monitor({
    channels: { phases: source.receive, display: output.send },
    settings: {},
    signal: new AbortController().signal,
  })
  expect(result).toEqual({ outcome: 'blocked', output: { complete: false, displayed: 0 } })
})

test('uncertain optional delivery cannot be recovered as a successful repair', async () => {
  const app = application({
    output: {
      direction: 'send',
      delivery: 'direct',
      close: async () => {},
      send: async () => {
        throw new OperationError('UNCERTAIN', 'Synthetic uncertain ownership.')
      },
    },
  })
  await expect(monitoredRepair(app.root, input as any, async () => {})).rejects.toThrow()
  expect(app.active).toBe(0)
})
