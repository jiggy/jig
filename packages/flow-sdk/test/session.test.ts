import { describe, expect, spyOn, test } from 'bun:test'

import { decodeJson, encodeJson } from '../src/json.ts'
import { RunSession } from '../src/session.ts'
import type { Transport } from '../src/transport.ts'
import {
  CapabilityError,
  OperationError,
  type ChannelReceiver,
  type JsonObject,
  type JsonValue,
} from '../src/types.ts'

class MemoryTransport implements Transport {
  readonly writes: Uint8Array[] = []
  private readonly chunks: Uint8Array[] = []
  private readonly readers: Array<(value: IteratorResult<Uint8Array>) => void> = []
  private readonly writeWaiters: Array<() => void> = []
  private stopped = false

  readonly input: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => ({
      next: () => this.nextChunk(),
    }),
  }

  async write(bytes: Uint8Array): Promise<void> {
    this.writes.push(bytes.slice())
    for (const waiter of this.writeWaiters.splice(0)) waiter()
  }

  async stopReading(): Promise<void> {
    this.stopped = true
    for (const reader of this.readers.splice(0)) reader({ done: true, value: undefined })
  }

  push(value: JsonObject): void {
    const frame = encodeJson(value)
    const line = new Uint8Array(frame.byteLength + 1)
    line.set(frame)
    line[frame.byteLength] = 0x0a
    this.pushRaw(line)
  }

  pushRaw(bytes: Uint8Array): void {
    const reader = this.readers.shift()
    if (reader) reader({ done: false, value: bytes })
    else this.chunks.push(bytes)
  }

  closeInput(): void {
    this.stopped = true
    for (const reader of this.readers.splice(0)) {
      reader({ done: true, value: undefined })
    }
  }

  async waitForWrites(count: number): Promise<void> {
    while (this.writes.length < count) {
      await new Promise<void>((resolve) => this.writeWaiters.push(resolve))
    }
  }

  message(index: number): Record<string, JsonValue> {
    const line = this.writes[index]
    if (!line) throw new Error(`missing write ${index}`)
    const value = decodeJson(line.subarray(0, line.byteLength - 1))
    if (value === null || Array.isArray(value) || typeof value !== 'object') {
      throw new Error('write was not an object')
    }
    return value as Record<string, JsonValue>
  }

  private nextChunk(): Promise<IteratorResult<Uint8Array>> {
    const chunk = this.chunks.shift()
    if (chunk) return Promise.resolve({ done: false, value: chunk })
    if (this.stopped) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve) => this.readers.push(resolve))
  }
}

class ControlledFirstWriteTransport extends MemoryTransport {
  private firstWrite = true
  private release!: () => void
  private reject!: (reason: unknown) => void
  private markStopped!: () => void
  private readonly settlement = new Promise<void>((resolve, reject) => {
    this.release = resolve
    this.reject = reject
  })
  private readonly stopObserved = new Promise<void>((resolve) => {
    this.markStopped = resolve
  })

  override async write(bytes: Uint8Array): Promise<void> {
    await super.write(bytes)
    if (!this.firstWrite) return
    this.firstWrite = false
    await this.settlement
  }

  resolveFirstWrite(): void {
    this.release()
  }

  rejectFirstWrite(reason: unknown): void {
    this.reject(reason)
  }

  override async stopReading(): Promise<void> {
    await super.stopReading()
    this.markStopped()
  }

  async waitForStop(): Promise<void> {
    await this.stopObserved
  }
}

class RejectingStopTransport extends MemoryTransport {
  override async stopReading(): Promise<void> {
    await super.stopReading()
    throw new Error('stdin shutdown failed')
  }
}

function rootRequest(id = 'host:1'): JsonObject {
  return {
    jsonrpc: '2.0',
    id,
    method: 'flow/run',
    params: {
      protocol: 'run/1',
      input: { subject: 'test' },
      settings: {},
      attachments: {},
      scratch: '/tmp/run',
      deadlineUnixMs: 4_000_000_000_000,
    },
  }
}

function channelRoot(channels: JsonObject): JsonObject {
  const request = rootRequest()
  return { ...request, params: { ...(request.params as JsonObject), channels } }
}

function grant(endpoint: string, direction: 'send' | 'receive'): JsonObject {
  return {
    endpoint,
    direction,
    delivery: 'direct',
    ...(direction === 'receive' ? { startSequence: 1 } : {}),
  }
}

function respond(transport: MemoryTransport, index: number, result: JsonValue): void {
  transport.push({ jsonrpc: '2.0', id: transport.message(index).id!, result })
}

function rejectOperation(transport: MemoryTransport, index: number, code: string): void {
  transport.push({
    jsonrpc: '2.0',
    id: transport.message(index).id!,
    error: { code: -32000, message: code, data: { code } },
  })
}

function broadcastGrant(
  endpoint: string,
  direction: 'send' | 'receive',
  startSequence = 1,
): JsonObject {
  return {
    endpoint,
    direction,
    delivery: 'broadcast',
    ...(direction === 'receive' ? { startSequence } : {}),
  }
}

describe('broadcast channels', () => {
  for (const confirmed of [false, true]) {
    test(`caught receiver disposal ${confirmed ? 'confirmed stream failure permits success' : 'RPC failure prevents success'}`, async () => {
      const transport = new MemoryTransport()
      const completion = new RunSession(transport, async (run) => {
        await (run.channels.progress as ChannelReceiver).close().catch(() => undefined)
        return { outcome: 'done', output: null }
      }).run()
      transport.push(channelRoot({ progress: broadcastGrant('r:1', 'receive') }))
      await transport.waitForWrites(1)
      if (confirmed) respond(transport, 0, { status: 'failed', code: 'LAGGED' })
      else rejectOperation(transport, 0, 'EXECUTION_FAILED')
      await completion
      if (confirmed) expect(transport.message(1).result).toEqual({ outcome: 'done', output: null })
      else expect(transport.message(1).error).toMatchObject({ data: { code: 'UNCERTAIN' } })
    })
  }

  test('a racing release cannot end before a committed read item', async () => {
    for (const releaseFirst of [false, true]) {
      const transport = new MemoryTransport()
      const controller = new AbortController()
      const completion = new RunSession(transport, async (run) => {
        const receiver = run.channels.progress as ChannelReceiver
        await receiver.next({ signal: controller.signal }).catch(() => undefined)
        await receiver.close().catch(() => undefined)
        return { outcome: 'done', output: null }
      })
        .run()
        .then(
          () => 'unexpected',
          (error) => (error as OperationError).code,
        )
      transport.push(channelRoot({ progress: broadcastGrant('r:1', 'receive', 3) }))
      await transport.waitForWrites(1)
      controller.abort()
      await transport.waitForWrites(3)
      const release = [1, 2].find((index) => transport.message(index).method === 'channel/release')!
      if (releaseFirst) respond(transport, release, { status: 'ended', lastSequence: 2 })
      respond(transport, 0, { item: { sequence: 3, value: 'committed' } })
      if (!releaseFirst) respond(transport, release, { status: 'ended', lastSequence: 2 })
      expect(await completion).toBe('PROTOCOL_ERROR')
    }
  })

  test('a release cannot end before the allocated subscription interval', async () => {
    const transport = new MemoryTransport()
    const completion = new RunSession(transport, async (run) => {
      await (run.channels.progress as ChannelReceiver).close().catch(() => undefined)
      return { outcome: 'done', output: null }
    })
      .run()
      .then(
        () => 'unexpected',
        (error) => (error as OperationError).code,
      )
    transport.push(channelRoot({ progress: broadcastGrant('r:1', 'receive', 5) }))
    await transport.waitForWrites(1)
    respond(transport, 0, { status: 'ended', lastSequence: 3 })
    expect(await completion).toBe('PROTOCOL_ERROR')
  })

  test('pre-cancelled subscription does not dispatch or allocate a receiver', async () => {
    const transport = new MemoryTransport()
    const controller = new AbortController()
    controller.abort()
    const completion = new RunSession(transport, async (run) => {
      const source = await run.channel({ delivery: 'broadcast' })
      await expect(source.subscribe({ signal: controller.signal })).rejects.toMatchObject({
        code: 'CANCELLED',
      })
      return { outcome: 'done', output: null }
    }).run()
    transport.push(rootRequest())
    await transport.waitForWrites(1)
    respond(transport, 0, { send: broadcastGrant('s:1', 'send'), source: 'source:1' })
    await completion
    expect(transport.writes.length).toBe(2)
    expect(transport.message(1).result).toEqual({ outcome: 'done', output: null })
  })

  for (const malformed of [
    { send: grant('s:1', 'send'), source: 'source:1' },
    { send: broadcastGrant('s:1', 'send'), receive: broadcastGrant('r:1', 'receive') },
    { send: broadcastGrant('s:1', 'send'), source: {} },
    { send: broadcastGrant('s:1', 'send'), source: 'x'.repeat(129) },
  ]) {
    test(`malformed broadcast creation fails the current transport: ${JSON.stringify(malformed)}`, async () => {
      const transport = new MemoryTransport()
      const completion = new RunSession(transport, async (run) => {
        await run.channel({ delivery: 'broadcast' }).catch(() => undefined)
        return { outcome: 'done', output: null }
      })
        .run()
        .then(
          () => 'unexpected',
          (error) => (error as OperationError).code,
        )
      transport.push(rootRequest())
      await transport.waitForWrites(1)
      respond(transport, 0, malformed)
      expect(await completion).toBe('PROTOCOL_ERROR')
    })
  }

  test('subscriptions remain creator-owned after the writer is offered and start at their granted suffix', async () => {
    const transport = new MemoryTransport()
    const completion = new RunSession(transport, async (run) => {
      const source = await run.channel({ delivery: 'broadcast' })
      expect(Object.keys(source)).toEqual(['send', 'subscribe'])
      expect(Object.isFrozen(source)).toBe(true)
      const work = run.callCapability({
        operationId: 'work',
        slot: 'worker',
        method: 'run',
        input: null,
        channels: { events: source.send },
      })
      const receive = await source.subscribe()
      expect(receive.startSequence).toBe(5)
      expect(Object.isFrozen(receive)).toBe(true)
      expect(await receive.next()).toEqual({ done: false, value: 'later' })
      expect(await receive.next()).toEqual({ done: true, value: undefined })
      return { outcome: 'done', output: await work }
    }).run()
    transport.push(rootRequest())
    await transport.waitForWrites(1)
    expect(transport.message(0).params).toEqual({ delivery: 'broadcast' })
    respond(transport, 0, { send: broadcastGrant('s:1', 'send'), source: 'source:1' })
    await transport.waitForWrites(3)
    expect(transport.message(1).params).toMatchObject({ channels: { events: 's:1' } })
    expect(transport.message(2).params).toEqual({ source: 'source:1' })
    respond(transport, 2, broadcastGrant('r:1', 'receive', 5))
    await transport.waitForWrites(4)
    respond(transport, 3, { item: { sequence: 5, value: 'later' } })
    await transport.waitForWrites(5)
    respond(transport, 4, { end: { lastSequence: 5 } })
    respond(transport, 1, { value: 'completed' })
    await completion
    expect(transport.message(5).result).toEqual({ outcome: 'done', output: 'completed' })
  })

  test('failed subscription creation is ordinary recoverable work', async () => {
    const transport = new MemoryTransport()
    const completion = new RunSession(transport, async (run) => {
      const source = await run.channel({ delivery: 'broadcast' })
      await expect(source.subscribe()).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' })
      const receive = await source.subscribe()
      await receive.close()
      return { outcome: 'done', output: null }
    }).run()
    transport.push(rootRequest())
    await transport.waitForWrites(1)
    respond(transport, 0, { send: broadcastGrant('s:1', 'send'), source: 'source:1' })
    await transport.waitForWrites(2)
    rejectOperation(transport, 1, 'RESOURCE_EXHAUSTED')
    await transport.waitForWrites(3)
    respond(transport, 2, broadcastGrant('r:1', 'receive'))
    await transport.waitForWrites(4)
    expect(transport.message(3).method).toBe('channel/release')
    respond(transport, 3, { status: 'released' })
    await completion
    expect(transport.message(4).result).toEqual({ outcome: 'done', output: null })
  })

  test('fresh subscriptions are active obligations even before their first read', async () => {
    const transport = new MemoryTransport()
    const completion = new RunSession(transport, async (run) => {
      const source = await run.channel({ delivery: 'broadcast' })
      await source.subscribe()
      return { outcome: 'done', output: null }
    }).run()
    transport.push(rootRequest())
    await transport.waitForWrites(1)
    respond(transport, 0, { send: broadcastGrant('s:1', 'send'), source: 'source:1' })
    await transport.waitForWrites(2)
    respond(transport, 1, broadcastGrant('r:1', 'receive'))
    await transport.waitForWrites(3)
    respond(transport, 2, { status: 'released' })
    await completion
    expect(transport.message(3).error).toMatchObject({ data: { code: 'EXECUTION_FAILED' } })
    expect(
      transport.writes.some((_, index) => transport.message(index).method === 'channel/close'),
    ).toBe(false)
  })

  for (const allocation of ['source', 'subscription'] as const) {
    for (const failedCleanup of [false, true]) {
      test(`cancelled ${allocation} allocation joins late cleanup${failedCleanup ? ' failure' : ''}`, async () => {
        const transport = new MemoryTransport()
        const controller = new AbortController()
        const completion = new RunSession(transport, async (run) => {
          const pending =
            allocation === 'source'
              ? run.channel({ delivery: 'broadcast' }, { signal: controller.signal })
              : (await run.channel({ delivery: 'broadcast' })).subscribe({
                  signal: controller.signal,
                })
          const outcome = pending.then(
            () => 'unexpected',
            (error) => (error as OperationError).code,
          )
          expect(await outcome).toBe('CANCELLED')
          return { outcome: 'done', output: null }
        }).run()
        transport.push(rootRequest())
        await transport.waitForWrites(1)
        const index = allocation === 'source' ? 0 : 1
        if (allocation === 'subscription') {
          respond(transport, 0, { send: broadcastGrant('s:1', 'send'), source: 'source:1' })
          await transport.waitForWrites(2)
        }
        controller.abort()
        await transport.waitForWrites(index + 2)
        expect(transport.message(index + 1).method).toBe('request/cancel')
        respond(
          transport,
          index,
          allocation === 'source'
            ? { send: broadcastGrant('s:1', 'send'), source: 'source:1' }
            : broadcastGrant('r:1', 'receive', 4),
        )
        await transport.waitForWrites(index + 3)
        expect(transport.message(index + 2).method).toBe(
          allocation === 'source' ? 'channel/close' : 'channel/release',
        )
        if (failedCleanup) rejectOperation(transport, index + 2, 'EXECUTION_FAILED')
        else respond(transport, index + 2, allocation === 'source' ? null : { status: 'released' })
        await completion
        const terminal = transport.message(index + 3)
        if (failedCleanup) expect(terminal.error).toMatchObject({ data: { code: 'UNCERTAIN' } })
        else expect(terminal.result).toEqual({ outcome: 'done', output: null })
      })
    }
  }

  test('source subscription authority is not transferable or serializable data', async () => {
    const transport = new MemoryTransport()
    const completion = new RunSession(transport, async (run) => {
      const source = await run.channel({ delivery: 'broadcast' })
      await expect(
        run.runChildFlow({
          operationId: 'child',
          slot: 'worker',
          input: null,
          channels: { source: source as never },
        }),
      ).rejects.toThrow(TypeError)
      await expect(
        run.callCapability({
          operationId: 'data',
          slot: 'worker',
          method: 'run',
          input: source as never,
        }),
      ).rejects.toThrow(TypeError)
      return { outcome: 'done', output: null }
    }).run()
    transport.push(rootRequest())
    await transport.waitForWrites(1)
    respond(transport, 0, { send: broadcastGrant('s:1', 'send'), source: 'source:1' })
    await completion
    expect(transport.writes.length).toBe(2)
    expect(transport.message(1).result).toEqual({ outcome: 'done', output: null })
  })

  test('a cancelled late subscription may settle with failed observation but confirmed disposal', async () => {
    const transport = new MemoryTransport()
    const controller = new AbortController()
    const completion = new RunSession(transport, async (run) => {
      const source = await run.channel({ delivery: 'broadcast' })
      const pending = source.subscribe({ signal: controller.signal }).then(
        () => 'unexpected',
        (error) => (error as OperationError).code,
      )
      expect(await pending).toBe('CANCELLED')
      return { outcome: 'done', output: null }
    }).run()
    transport.push(rootRequest())
    await transport.waitForWrites(1)
    respond(transport, 0, { send: broadcastGrant('s:1', 'send'), source: 'source:1' })
    await transport.waitForWrites(2)
    controller.abort()
    await transport.waitForWrites(3)
    respond(transport, 1, broadcastGrant('r:1', 'receive'))
    await transport.waitForWrites(4)
    expect(transport.message(3).method).toBe('channel/release')
    respond(transport, 3, { status: 'failed', code: 'LAGGED' })
    await completion
    expect(transport.message(4).result).toEqual({ outcome: 'done', output: null })
  })

  for (const malformed of [
    grant('r:1', 'receive'),
    broadcastGrant('s:2', 'send'),
    { ...broadcastGrant('r:1', 'receive'), startSequence: 0 },
    { receive: broadcastGrant('r:1', 'receive') },
    {
      ...broadcastGrant('r:1', 'receive'),
      contract: {
        id: 'https://example.test/events',
        version: '1.0.0',
        digest: `sha256:${'a'.repeat(64)}`,
      },
    },
  ]) {
    test(`malformed subscription grants fail the current transport: ${JSON.stringify(malformed)}`, async () => {
      const transport = new MemoryTransport()
      const completion = new RunSession(transport, async (run) => {
        const source = await run.channel({ delivery: 'broadcast' })
        await source.subscribe().catch(() => undefined)
        return { outcome: 'done', output: null }
      })
        .run()
        .then(
          () => 'unexpected',
          (error) => (error as OperationError).code,
        )
      transport.push(rootRequest())
      await transport.waitForWrites(1)
      respond(transport, 0, { send: broadcastGrant('s:1', 'send'), source: 'source:1' })
      await transport.waitForWrites(2)
      respond(transport, 1, malformed)
      expect(await completion).toBe('PROTOCOL_ERROR')
    })
  }
})

describe('direct channels', () => {
  test('a local read-capacity rejection leaves the receiver usable', async () => {
    const transport = new MemoryTransport()
    const completion = new RunSession(transport, async (run) => {
      const calls = Array.from({ length: 63 }, (_, index) =>
        run.callCapability({
          operationId: `work:${index}`,
          slot: 'agent',
          method: 'run',
          input: null,
        }),
      )
      const receiver = run.channels.progress as ChannelReceiver
      await expect(receiver.next()).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' })
      await calls[0]
      expect(await receiver.next()).toEqual({ done: true, value: undefined })
      await Promise.all(calls)
      return { outcome: 'done', output: null }
    }).run()
    transport.push(channelRoot({ progress: grant('r:1', 'receive') }))
    await transport.waitForWrites(63)
    respond(transport, 0, { value: null })
    await transport.waitForWrites(64)
    expect(transport.message(63).method).toBe('channel/next')
    respond(transport, 63, { end: { lastSequence: 0 } })
    for (let index = 1; index < 63; index += 1) respond(transport, index, { value: null })
    await completion
    expect(transport.message(64).result).toEqual({ outcome: 'done', output: null })
  })

  test('reserves disposal capacity while ordinary work saturates admission', async () => {
    const transport = new MemoryTransport()
    const completion = new RunSession(transport, async (run) => {
      const calls = Array.from({ length: 63 }, (_, index) =>
        run.callCapability({
          operationId: `work:${index}`,
          slot: 'agent',
          method: 'run',
          input: null,
        }),
      )
      await expect(
        run.callCapability({ operationId: 'overflow', slot: 'agent', method: 'run', input: null }),
      ).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' })
      await (run.channels.progress as ChannelReceiver).close()
      await Promise.all(calls)
      return { outcome: 'done', output: null }
    }).run()
    transport.push(channelRoot({ progress: grant('r:1', 'receive') }))
    await transport.waitForWrites(64)
    expect(transport.message(63).method).toBe('channel/release')
    respond(transport, 63, { status: 'released' })
    for (let index = 0; index < 63; index += 1) respond(transport, index, { value: null })
    await completion
    expect(transport.message(64).result).toEqual({ outcome: 'done', output: null })
  })

  test('breaking iteration releases observation without cancelling execution', async () => {
    const transport = new MemoryTransport()
    const completion = new RunSession(transport, async (run) => {
      const work = run.callCapability({
        operationId: 'work',
        slot: 'agent',
        method: 'run',
        input: null,
      })
      for await (const _ of run.channels.progress as ChannelReceiver) break
      return { outcome: 'done', output: await work }
    }).run()
    transport.push(channelRoot({ progress: grant('r:1', 'receive') }))
    await transport.waitForWrites(2)
    respond(transport, 1, { item: { sequence: 1, value: 'enough' } })
    await transport.waitForWrites(3)
    expect(transport.message(2).method).toBe('channel/release')
    respond(transport, 2, { status: 'released' })
    respond(transport, 0, { value: 'answer' })
    await completion
    expect(transport.message(3).result).toEqual({ outcome: 'done', output: 'answer' })
  })

  test('pre-cancelled read does not dispose or consume its receiver', async () => {
    const transport = new MemoryTransport()
    const abort = new AbortController()
    abort.abort()
    const completion = new RunSession(transport, async (run) => {
      const receiver = run.channels.progress as ChannelReceiver
      await expect(receiver.next({ signal: abort.signal })).rejects.toMatchObject({
        code: 'CANCELLED',
      })
      expect(await receiver.next()).toEqual({ done: true, value: undefined })
      return { outcome: 'done', output: null }
    }).run()
    transport.push(channelRoot({ progress: grant('r:1', 'receive') }))
    await transport.waitForWrites(1)
    expect(transport.message(0).method).toBe('channel/next')
    respond(transport, 0, { end: { lastSequence: 0 } })
    await completion
    expect(transport.writes.length).toBe(2)
  })

  test('reads filtered updates while an ordinary capability result remains separate', async () => {
    const transport = new MemoryTransport()
    const completion = new RunSession(transport, async (run) => {
      const pair = await run.channel()
      const work = run.callCapability({
        operationId: 'agent:1',
        slot: 'agent',
        method: 'run',
        input: null,
        channels: { events: pair.send },
      })
      const selected: JsonValue[] = []
      for await (const value of pair.receive) if (value !== 'private') selected.push(value)
      return { outcome: 'done', output: { selected, result: await work } }
    }).run()
    transport.push(rootRequest())
    await transport.waitForWrites(1)
    expect(transport.message(0).method).toBe('channel/create')
    respond(transport, 0, {
      send: grant('channel:send', 'send'),
      receive: grant('channel:receive', 'receive'),
    })
    await transport.waitForWrites(3)
    expect(transport.message(1).params).toMatchObject({ channels: { events: 'channel:send' } })
    expect(transport.message(2).method).toBe('channel/next')
    respond(transport, 2, { item: { sequence: 1, value: 'private' } })
    await transport.waitForWrites(4)
    respond(transport, 3, { item: { sequence: 2, value: 'public' } })
    await transport.waitForWrites(5)
    respond(transport, 4, { end: { lastSequence: 2 } })
    await Promise.resolve()
    expect(transport.writes.length).toBe(5)
    respond(transport, 1, { value: { outcome: 'completed' } })
    await completion
    expect(transport.message(5).result).toEqual({
      outcome: 'done',
      output: { selected: ['public'], result: { outcome: 'completed' } },
    })
  })

  test('caught observer failure does not replace a successful execution result', async () => {
    const transport = new MemoryTransport()
    const completion = new RunSession(transport, async (run) => {
      const work = run.callCapability({
        operationId: 'work',
        slot: 'agent',
        method: 'run',
        input: null,
      })
      let incomplete = false
      try {
        for await (const _ of run.channels.progress as ChannelReceiver) {
        }
      } catch (error) {
        if (!(error instanceof OperationError) || error.code !== 'LAGGED') throw error
        incomplete = true
      }
      return { outcome: 'done', output: { incomplete, result: await work } }
    }).run()
    transport.push(channelRoot({ progress: grant('r:1', 'receive') }))
    await transport.waitForWrites(2)
    rejectOperation(transport, 1, 'LAGGED')
    respond(transport, 0, { value: 'answer' })
    await completion
    expect(transport.message(2).result).toEqual({
      outcome: 'done',
      output: { incomplete: true, result: 'answer' },
    })
  })

  test('close joins cancelled read settlement and exposes a late failure once', async () => {
    const transport = new MemoryTransport()
    const abort = new AbortController()
    let closed = false
    const completion = new RunSession(transport, async (run) => {
      const receiver = run.channels.progress as ChannelReceiver
      await expect(receiver.next({ signal: abort.signal })).rejects.toMatchObject({
        code: 'CANCELLED',
      })
      await expect(receiver.close()).rejects.toMatchObject({ code: 'LAGGED' })
      closed = true
      await receiver.close()
      return { outcome: 'done', output: 'incomplete' }
    }).run()
    transport.push(channelRoot({ progress: grant('r:1', 'receive') }))
    await transport.waitForWrites(1)
    abort.abort()
    await transport.waitForWrites(3)
    const release = [1, 2].find((index) => transport.message(index).method === 'channel/release')!
    respond(transport, release, { status: 'failed', code: 'LAGGED' })
    await Promise.resolve()
    expect(closed).toBe(false)
    rejectOperation(transport, 0, 'LAGGED')
    await completion
    expect(closed).toBe(true)
    expect(transport.message(3).result).toEqual({ outcome: 'done', output: 'incomplete' })
  })

  test('a racing release cannot contradict an observed channel end', async () => {
    for (const releaseFirst of [false, true]) {
      const transport = new MemoryTransport()
      const abort = new AbortController()
      const completion = new RunSession(transport, async (run) => {
        const receiver = run.channels.progress as ChannelReceiver
        await expect(receiver.next({ signal: abort.signal })).rejects.toMatchObject({
          code: 'CANCELLED',
        })
        try {
          await receiver.close()
        } catch {
          // A contradictory transport response remains fatal even if caught.
        }
        return { outcome: 'done', output: null }
      }).run()
      transport.push(channelRoot({ progress: grant('r:1', 'receive') }))
      await transport.waitForWrites(1)
      abort.abort()
      await transport.waitForWrites(3)
      const release = [1, 2].find((index) => transport.message(index).method === 'channel/release')!
      if (releaseFirst) {
        respond(transport, release, { status: 'ended', lastSequence: 1 })
        respond(transport, 0, { end: { lastSequence: 0 } })
      } else {
        respond(transport, 0, { end: { lastSequence: 0 } })
        respond(transport, release, { status: 'ended', lastSequence: 1 })
      }
      const failure = await completion.then(
        () => null,
        (error) => error,
      )
      expect(failure).toMatchObject({ code: 'PROTOCOL_ERROR' })
      expect(
        transport.writes.some((_, index) => Object.hasOwn(transport.message(index), 'result')),
      ).toBe(false)
    }
  })

  test('aborting a close waiter preserves settlement and later failure exposure', async () => {
    const transport = new MemoryTransport()
    const abort = new AbortController()
    const completion = new RunSession(transport, async (run) => {
      const receiver = run.channels.progress as ChannelReceiver
      await expect(receiver.close({ signal: abort.signal })).rejects.toMatchObject({
        code: 'CANCELLED',
      })
      await expect(receiver.close()).rejects.toMatchObject({ code: 'DISCONNECTED' })
      await receiver.close()
      return { outcome: 'done', output: null }
    }).run()
    transport.push(channelRoot({ progress: grant('r:1', 'receive') }))
    await transport.waitForWrites(1)
    abort.abort()
    respond(transport, 0, { status: 'failed', code: 'DISCONNECTED' })
    await completion
    expect(transport.writes.length).toBe(2)
  })

  test('cancelled allocation retains and disposes a late grant before terminal', async () => {
    const transport = new MemoryTransport()
    const abort = new AbortController()
    const completion = new RunSession(transport, async (run) => {
      await expect(run.channel({}, { signal: abort.signal })).rejects.toMatchObject({
        code: 'CANCELLED',
      })
      return { outcome: 'done', output: null }
    }).run()
    transport.push(rootRequest())
    await transport.waitForWrites(1)
    abort.abort()
    await transport.waitForWrites(2)
    respond(transport, 0, { send: grant('s:1', 'send'), receive: grant('r:1', 'receive') })
    await transport.waitForWrites(3)
    expect(transport.message(2).method).toBe('channel/release')
    respond(transport, 2, { status: 'released' })
    await completion
    expect(transport.message(3).result).toEqual({ outcome: 'done', output: null })
  })

  test('abandoning a connected receiver refuses success even after disposal', async () => {
    const transport = new MemoryTransport()
    const completion = new RunSession(transport, async () => ({
      outcome: 'done',
      output: null,
    })).run()
    transport.push(channelRoot({ progress: grant('r:1', 'receive'), output: grant('s:1', 'send') }))
    await transport.waitForWrites(1)
    expect(transport.message(0).method).toBe('channel/release')
    respond(transport, 0, { status: 'released' })
    await completion
    expect(transport.message(1).error).toMatchObject({ data: { code: 'EXECUTION_FAILED' } })
    expect(
      transport.writes.some((_, index) => transport.message(index).method === 'channel/close'),
    ).toBe(false)
  })

  test('handler failure never explicitly seals its inherited writer', async () => {
    const transport = new MemoryTransport()
    const completion = new RunSession(transport, async () => {
      throw new OperationError('INVALID_INPUT', 'bad input')
    }).run()
    transport.push(channelRoot({ output: grant('s:1', 'send') }))
    await completion
    expect(transport.writes.length).toBe(1)
    expect(transport.message(0).error).toMatchObject({ data: { code: 'INVALID_INPUT' } })
  })

  test('unused inherited endpoint can be forwarded without claiming local consumption', async () => {
    const transport = new MemoryTransport()
    const completion = new RunSession(transport, async (run) =>
      run.runChildFlow({
        operationId: 'monitor',
        slot: 'monitor',
        input: null,
        channels: { events: run.channels.progress! },
      }),
    ).run()
    transport.push(channelRoot({ progress: grant('r:1', 'receive') }))
    await transport.waitForWrites(1)
    expect(transport.message(0).params).toMatchObject({ channels: { events: 'r:1' } })
    respond(transport, 0, { outcome: 'done', output: null })
    await completion
    expect(transport.writes.length).toBe(2)
  })

  test('rejects malformed channel sequence as current transport failure', async () => {
    const transport = new MemoryTransport()
    const completion = new RunSession(transport, async (run) => {
      try {
        await (run.channels.progress as ChannelReceiver).next()
      } catch {}
      return { outcome: 'done', output: null }
    }).run()
    transport.push(channelRoot({ progress: grant('r:1', 'receive') }))
    await transport.waitForWrites(1)
    respond(transport, 0, { item: { sequence: 2, value: 'gap' } })
    await expect(completion).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' })
  })
})

describe('RunSession', () => {
  test('handles one ordinary root Run', async () => {
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async (run) => {
      return {
        outcome: 'done',
        output: run.input,
      }
    })
    const completion = session.run()
    transport.push(rootRequest())
    await completion

    expect(transport.message(0)).toEqual({
      jsonrpc: '2.0',
      id: 'host:1',
      result: {
        outcome: 'done',
        output: { subject: 'test' },
      },
    })
  })

  test('completes when input closes after the root terminal frame is observable', async () => {
    const transport = new ControlledFirstWriteTransport()
    const session = new RunSession(transport, async (run) => ({
      outcome: 'done',
      output: run.input,
    }))
    const completion = session.run()
    transport.push(rootRequest())

    await transport.waitForWrites(1)
    expect(transport.message(0).result).toEqual({
      outcome: 'done',
      output: { subject: 'test' },
    })
    transport.closeInput()
    transport.resolveFirstWrite()

    await completion
  })

  test('fails when the observable root terminal write rejects', async () => {
    const transport = new ControlledFirstWriteTransport()
    const session = new RunSession(transport, async (run) => ({
      outcome: 'done',
      output: run.input,
    }))
    const completion = session.run()
    transport.push(rootRequest())

    await transport.waitForWrites(1)
    transport.rejectFirstWrite(new Error('stdout failed'))

    await expect(completion).rejects.toMatchObject({ code: 'CHANNEL_LOST' })
  })

  test('fails when input shutdown rejects after publishing the root terminal frame', async () => {
    const transport = new RejectingStopTransport()
    const session = new RunSession(transport, async (run) => ({
      outcome: 'done',
      output: run.input,
    }))
    const completion = session.run()
    transport.push(rootRequest())

    await expect(completion).rejects.toMatchObject({ code: 'CHANNEL_LOST' })
    expect(transport.writes).toHaveLength(1)
    expect(transport.message(0)).toEqual({
      jsonrpc: '2.0',
      id: 'host:1',
      result: {
        outcome: 'done',
        output: { subject: 'test' },
      },
    })
  })

  test('fails when an invalid-params terminal write rejects', async () => {
    const transport = new ControlledFirstWriteTransport()
    const session = new RunSession(transport, async () => ({
      outcome: 'done',
      output: null,
    }))
    const completion = session.run()
    transport.push({
      jsonrpc: '2.0',
      id: 'host:invalid',
      method: 'flow/run',
      params: {},
    })

    await transport.waitForWrites(1)
    transport.rejectFirstWrite(new Error('stdout failed'))

    await expect(completion).rejects.toMatchObject({ code: 'CHANNEL_LOST' })
  })

  test('fails when input closes before root terminal publication', async () => {
    const transport = new MemoryTransport()
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const session = new RunSession(transport, async (run) => {
      markStarted()
      await new Promise<void>((resolve) => {
        run.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      return { outcome: 'done', output: null }
    })
    const completion = session.run()
    transport.push(rootRequest())
    await started

    transport.closeInput()

    await expect(completion).rejects.toMatchObject({ code: 'CHANNEL_LOST' })
    expect(transport.writes).toHaveLength(0)
  })

  test('suppresses queued writes after a fatal protocol decision', async () => {
    const transport = new ControlledFirstWriteTransport()
    let markFatal!: () => void
    const fatal = new Promise<void>((resolve) => {
      markFatal = resolve
    })
    const session = new RunSession(transport, async (run) => {
      run.signal.addEventListener('abort', markFatal, { once: true })
      const calls = [
        run.callCapability({
          operationId: 'queued:1',
          slot: 'store',
          method: 'write',
          input: 1,
        }),
        run.callCapability({
          operationId: 'queued:2',
          slot: 'store',
          method: 'write',
          input: 2,
        }),
      ]
      await Promise.allSettled(calls)
      return { outcome: 'done', output: null }
    })
    const completion = session.run()
    transport.push(rootRequest())
    await transport.waitForWrites(1)

    transport.pushRaw(new TextEncoder().encode('{}\n'))
    await fatal
    transport.resolveFirstWrite()

    await expect(completion).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' })
    expect(transport.writes).toHaveLength(2)
    expect(transport.message(0).method).toBe('capability/call')
    expect(transport.message(1)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    })
  })

  test('suppresses a queued root response after a fatal protocol decision', async () => {
    const transport = new ControlledFirstWriteTransport()
    let markHandlerDone!: () => void
    const handlerDone = new Promise<void>((resolve) => {
      markHandlerDone = resolve
    })
    const session = new RunSession(transport, async (run) => {
      const output = await run.callCapability({
        operationId: 'before-root:1',
        slot: 'store',
        method: 'read',
        input: null,
      })
      markHandlerDone()
      return { outcome: 'done', output }
    })
    const completion = session.run()
    transport.push(rootRequest())
    await transport.waitForWrites(1)
    const request = transport.message(0)

    transport.push({
      jsonrpc: '2.0',
      id: request.id as string,
      result: { value: 'stored' },
    })
    await handlerDone
    // Let handleRoot enqueue its response behind the unresolved first write.
    await Promise.resolve()
    transport.pushRaw(new TextEncoder().encode('{}\n'))
    await transport.waitForStop()
    transport.resolveFirstWrite()

    await expect(completion).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' })
    expect(transport.writes).toHaveLength(2)
    expect(transport.message(0).method).toBe('capability/call')
    expect(transport.message(1)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    })
  })

  test('keeps the channel full-duplex while calls settle out of order', async () => {
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async (run) => {
      const child = run.runChildFlow({
        operationId: 'child:1',
        slot: 'research',
        intent: 'Research the subject.',
        input: run.input,
      })
      const effect = run.callCapability({
        operationId: 'effect:1',
        slot: 'store',
        method: 'write',
        input: { value: 1 },
      })
      return {
        outcome: 'done',
        output: { child: (await child).output, effect: await effect },
      }
    })
    const completion = session.run()
    transport.push(rootRequest())
    await transport.waitForWrites(2)

    const first = transport.message(0)
    const second = transport.message(1)
    expect(first.method).toBe('flow/run-child')
    expect(second.method).toBe('capability/call')
    transport.push({
      jsonrpc: '2.0',
      id: second.id as string,
      result: { value: { stored: true } },
    })
    transport.push({
      jsonrpc: '2.0',
      id: first.id as string,
      result: { outcome: 'done', output: { researched: true } },
    })
    await completion

    expect(transport.message(2).result).toEqual({
      outcome: 'done',
      output: {
        child: { researched: true },
        effect: { stored: true },
      },
    })
  })

  test('projects declared effect errors without exposing wire envelopes', async () => {
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async (run) => {
      try {
        await run.callCapability({
          operationId: 'read:1',
          slot: 'records',
          method: 'read',
          input: null,
        })
        throw new Error('expected an CapabilityError')
      } catch (error) {
        if (!(error instanceof CapabilityError)) throw error
        return {
          outcome: 'done',
          output: { name: error.errorName, data: error.data },
        }
      }
    })
    const completion = session.run()
    transport.push(rootRequest())
    await transport.waitForWrites(1)
    const request = transport.message(0)
    transport.push({
      jsonrpc: '2.0',
      id: request.id as string,
      result: { error: { name: 'not-found', data: { id: 7 } } },
    })
    await completion

    expect(transport.message(1).result).toEqual({
      outcome: 'done',
      output: { name: 'not-found', data: { id: 7 } },
    })
  })

  test('propagates root cancellation and returns a cancellation failure', async () => {
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async (run) => {
      await new Promise<void>((resolve) => {
        run.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      return { outcome: 'done', output: 'too late' }
    })
    const completion = session.run()
    transport.push(rootRequest())
    transport.push({
      jsonrpc: '2.0',
      method: 'request/cancel',
      params: { requestId: 'host:1' },
    })
    await completion

    const response = transport.message(0)
    expect(response.error).toEqual({
      code: -32000,
      message: 'Run was cancelled',
      data: { code: 'CANCELLED' },
    })
  })

  test('cannot report success while an unawaited outbound call is live', async () => {
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async (run) => {
      void run.callCapability({
        operationId: 'detached:1',
        slot: 'store',
        method: 'write',
        input: null,
      })
      return { outcome: 'done', output: null }
    })
    const completion = session.run()
    transport.push(rootRequest())
    await transport.waitForWrites(2)
    const request = transport.message(0)
    expect(transport.message(1)).toEqual({
      jsonrpc: '2.0',
      method: 'request/cancel',
      params: { requestId: request.id },
    })
    transport.push({
      jsonrpc: '2.0',
      id: request.id as string,
      error: {
        code: -32000,
        message: 'Owner closed',
        data: { code: 'OWNER_CLOSED' },
      },
    })
    await completion

    const root = transport.message(2)
    expect((root.error as Record<string, JsonValue>).data).toEqual({
      code: 'EXECUTION_FAILED',
    })
  })

  test('call cancellation rejects promptly but retains wire quiescence', async () => {
    const transport = new MemoryTransport()
    let rejected = false
    const session = new RunSession(transport, async (run) => {
      const controller = new AbortController()
      const child = run.runChildFlow(
        {
          operationId: 'cancel-race:1',
          slot: 'worker',
          input: null,
        },
        { signal: controller.signal },
      )
      controller.abort()
      try {
        await child
        throw new Error('expected cancellation')
      } catch (error) {
        if (!(error instanceof OperationError) || error.code !== 'CANCELLED') {
          throw error
        }
        rejected = true
      }
      return { outcome: 'done', output: 'cancelled-locally' }
    })
    const completion = session.run()
    transport.push(rootRequest())
    await transport.waitForWrites(2)
    const request = transport.message(0)
    expect(transport.message(1)).toEqual({
      jsonrpc: '2.0',
      method: 'request/cancel',
      params: { requestId: request.id },
    })
    expect(rejected).toBe(true)
    expect(transport.writes).toHaveLength(2)
    transport.push({
      jsonrpc: '2.0',
      id: request.id as string,
      result: { outcome: 'done', output: 'remote-result-was-tombstoned' },
    })
    await completion
    expect(transport.message(2).result).toEqual({
      outcome: 'done',
      output: 'cancelled-locally',
    })
  })

  test('already-aborted call signals reject both call kinds as CANCELLED without dispatch', async () => {
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async (run) => {
      const controller = new AbortController()
      controller.abort()

      const calls = [
        run.runChildFlow(
          {
            operationId: 'cancelled-flow:1',
            slot: 'worker',
            input: null,
          },
          { signal: controller.signal },
        ),
        run.callCapability(
          {
            operationId: 'cancelled-effect:1',
            slot: 'records',
            method: 'write',
            input: null,
          },
          { signal: controller.signal },
        ),
      ]

      const settlements = await Promise.allSettled(calls)
      for (const settlement of settlements) {
        expect(settlement.status).toBe('rejected')
        if (settlement.status !== 'rejected') throw new Error('expected cancellation')
        expect(settlement.reason).toBeInstanceOf(OperationError)
        expect((settlement.reason as OperationError).code).toBe('CANCELLED')
      }

      return { outcome: 'done', output: 'no-call-dispatched' }
    })
    const completion = session.run()
    transport.push(rootRequest())
    await completion

    expect(transport.writes).toHaveLength(1)
    expect(transport.message(0).result).toEqual({
      outcome: 'done',
      output: 'no-call-dispatched',
    })
  })

  test('already-aborted call signals take precedence over live-call capacity', async () => {
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async (run) => {
      const pending = Array.from({ length: 64 }, (_, index) =>
        run.callCapability({
          operationId: `capacity:${index}`,
          slot: 'records',
          method: 'write',
          input: null,
        }),
      )
      await transport.waitForWrites(64)

      const controller = new AbortController()
      controller.abort()
      await expect(
        run.callCapability(
          {
            operationId: 'capacity:cancelled',
            slot: 'records',
            method: 'write',
            input: null,
          },
          { signal: controller.signal },
        ),
      ).rejects.toMatchObject({ code: 'CANCELLED' })
      expect(transport.writes).toHaveLength(64)

      for (let index = 0; index < 64; index += 1) {
        const request = transport.message(index)
        transport.push({ jsonrpc: '2.0', id: request.id as string, result: { value: null } })
      }
      await Promise.all(pending)
      return { outcome: 'done', output: null }
    })

    const completion = session.run()
    transport.push(rootRequest())
    await completion
  })

  test('already-aborted call signals take precedence over lifetime capacity', async () => {
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async (run) => {
      const controller = new AbortController()
      controller.abort()
      await expect(
        run.callCapability(
          {
            operationId: 'lifetime:cancelled',
            slot: 'records',
            method: 'write',
            input: null,
          },
          { signal: controller.signal },
        ),
      ).rejects.toMatchObject({ code: 'CANCELLED' })
      return { outcome: 'done', output: null }
    })
    const internals = session as unknown as { usedComponentIds: Set<string> }
    for (let index = 0; index < 65_536; index += 1) {
      internals.usedComponentIds.add(`seed:${index}`)
    }

    const completion = session.run()
    transport.push(rootRequest())
    await completion
    expect(transport.writes).toHaveLength(1)
  })

  test('a cancellation-only catch preserves unrelated call failures', async () => {
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async (run) => {
      const controller = new AbortController()
      try {
        await run.callCapability(
          {
            operationId: 'write:permission-check',
            slot: 'records',
            method: 'write',
            input: null,
          },
          { signal: controller.signal },
        )
        throw new Error('expected an operational failure')
      } catch (error) {
        if (error instanceof OperationError && error.code === 'CANCELLED') {
          return { outcome: 'done', output: 'cancelled' }
        }
        throw error
      }
    })
    const completion = session.run()
    transport.push(rootRequest())
    await transport.waitForWrites(1)
    const request = transport.message(0)
    transport.push({
      jsonrpc: '2.0',
      id: request.id as string,
      error: {
        code: -32000,
        message: 'The records slot denied write access',
        data: { code: 'PERMISSION_DENIED' },
      },
    })
    await completion

    expect(transport.message(1).error).toEqual({
      code: -32000,
      message: 'The records slot denied write access',
      data: { code: 'PERMISSION_DENIED' },
    })
  })

  test('preserves an unhandled operational failure at the root', async () => {
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async () => {
      throw new OperationError('PERMISSION_DENIED', 'The records slot denied write access', {
        slot: 'records',
      })
    })
    const completion = session.run()
    transport.push(rootRequest())
    await completion
    expect(transport.message(0).error).toEqual({
      code: -32000,
      message: 'The records slot denied write access',
      data: {
        code: 'PERMISSION_DENIED',
        details: { slot: 'records' },
      },
    })
  })

  test('does not put an unknown operational code on the wire', async () => {
    const diagnostic = spyOn(console, 'error').mockImplementation(() => undefined)
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async () => {
      throw new OperationError('NOT_A_RUN_CODE' as never, 'invalid local code')
    })
    const completion = session.run()
    transport.push(rootRequest())
    await completion
    expect(transport.message(0).error).toEqual({
      code: -32000,
      message: 'Run execution failed',
      data: { code: 'EXECUTION_FAILED' },
    })
    diagnostic.mockRestore()
  })

  test('does not let malformed operational metadata corrupt the channel', async () => {
    const diagnostic = spyOn(console, 'error').mockImplementation(() => undefined)
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async () => {
      throw new OperationError('PERMISSION_DENIED', '\ud800')
    })
    const completion = session.run()
    transport.push(rootRequest())
    await completion
    expect(transport.message(0).error).toEqual({
      code: -32000,
      message: 'Run execution failed',
      data: { code: 'EXECUTION_FAILED' },
    })
    diagnostic.mockRestore()
  })

  test('keeps diagnostic failures out of the Run terminal decision', async () => {
    const diagnostic = spyOn(console, 'error').mockImplementation(() => {
      throw new Error('stderr unavailable')
    })
    try {
      const transport = new MemoryTransport()
      const session = new RunSession(transport, async () => {
        throw new Error('handler failed')
      })
      const completion = session.run()
      transport.push(rootRequest())
      await completion
      expect(transport.message(0).error).toEqual({
        code: -32000,
        message: 'Run execution failed',
        data: { code: 'EXECUTION_FAILED' },
      })
    } finally {
      diagnostic.mockRestore()
    }
  })

  test('snapshots outbound input before caller mutation', async () => {
    const transport = new MemoryTransport()
    const mutable = { value: 'before' }
    const session = new RunSession(transport, async (run) => {
      const effect = run.callCapability({
        operationId: 'snapshot:1',
        slot: 'store',
        method: 'write',
        input: mutable,
      })
      mutable.value = 'after'
      return { outcome: 'done', output: await effect }
    })
    const completion = session.run()
    transport.push(rootRequest())
    await transport.waitForWrites(1)
    const request = transport.message(0)
    expect((request.params as Record<string, JsonValue>).input).toEqual({
      value: 'before',
    })
    transport.push({
      jsonrpc: '2.0',
      id: request.id as string,
      result: { value: null },
    })
    await completion
  })

  test('maps invalid handler output to INVALID_RESULT', async () => {
    const diagnostic = spyOn(console, 'error').mockImplementation(() => undefined)
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async () => ({ outcome: 'done' }) as never)
    const completion = session.run()
    transport.push(rootRequest())
    await completion
    const response = transport.message(0)
    expect((response.error as Record<string, JsonValue>).data).toEqual({
      code: 'INVALID_RESULT',
    })
    diagnostic.mockRestore()
  })

  test('classifies a complete invalid JSON/1 frame as PROTOCOL_ERROR', async () => {
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async () => ({
      outcome: 'done',
      output: null,
    }))
    const completion = session.run()
    transport.pushRaw(new TextEncoder().encode('{"x":1,"x":2}\n'))
    await expect(completion).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' })
    expect(transport.message(0)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    })
  })

  test('reports a BOM as invalid JSON/1 before closing', async () => {
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async () => ({
      outcome: 'done',
      output: null,
    }))
    const completion = session.run()
    transport.pushRaw(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{}\n')]))
    await expect(completion).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' })
    expect(transport.message(0)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    })
  })

  test('silently closes invalid UTF-8 as PROTOCOL_ERROR', async () => {
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async () => ({
      outcome: 'done',
      output: null,
    }))
    const completion = session.run()
    transport.pushRaw(new Uint8Array([0xff, 0x0a]))
    await expect(completion).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' })
    expect(transport.writes).toHaveLength(0)
  })

  test('classifies an invalid envelope as PROTOCOL_ERROR', async () => {
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async () => ({
      outcome: 'done',
      output: null,
    }))
    const completion = session.run()
    transport.pushRaw(new TextEncoder().encode('{}\n'))
    await expect(completion).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' })
    expect(transport.message(0)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    })
  })

  test('silently closes an incomplete frame as PROTOCOL_ERROR', async () => {
    const transport = new MemoryTransport()
    const session = new RunSession(transport, async () => ({
      outcome: 'done',
      output: null,
    }))
    const completion = session.run()
    transport.pushRaw(new TextEncoder().encode('{"jsonrpc":"2.0"'))
    transport.closeInput()
    await expect(completion).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' })
    expect(transport.writes).toHaveLength(0)
  })

  test('treats invalid operation-error responses as fatal protocol violations', async () => {
    const invalidErrors: JsonObject[] = [
      {
        code: -32000,
        message: 'Missing data',
      },
      {
        code: -32000,
        message: 'Local code on the wire',
        data: { code: 'PROTOCOL_ERROR' },
      },
      {
        code: -32000,
        message: 'Another local code on the wire',
        data: { code: 'CHANNEL_LOST' },
      },
      {
        code: -32042,
        message: 'Unknown JSON-RPC code',
      },
      {
        code: -32601,
        message: 'Method not found',
      },
    ]

    for (const error of invalidErrors) {
      const transport = new MemoryTransport()
      const session = new RunSession(transport, async (run) => ({
        outcome: 'done',
        output: await run.callCapability({
          operationId: 'invalid-response:1',
          slot: 'store',
          method: 'write',
          input: null,
        }),
      }))
      const completion = session.run()
      transport.push(rootRequest())
      await transport.waitForWrites(1)
      const request = transport.message(0)
      transport.push({
        jsonrpc: '2.0',
        id: request.id as string,
        error,
      })
      await expect(completion).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' })
    }
  })

  test("rejects a pending call with the channel's protocol classification", async () => {
    const transport = new MemoryTransport()
    let resolveObserved!: (code: string) => void
    const observed = new Promise<string>((resolve) => {
      resolveObserved = resolve
    })
    const session = new RunSession(transport, async (run) => {
      try {
        await run.callCapability({
          operationId: 'peer-failure:1',
          slot: 'store',
          method: 'write',
          input: null,
        })
      } catch (error) {
        resolveObserved(error instanceof OperationError ? error.code : 'not-operation-error')
        throw error
      }
      return { outcome: 'done', output: null }
    })
    const completion = session.run()
    transport.push(rootRequest())
    await transport.waitForWrites(1)
    const request = transport.message(0)
    transport.push({
      jsonrpc: '2.0',
      id: request.id as string,
      error: {
        code: -32000,
        message: 'Local code on the wire',
        data: { code: 'PROTOCOL_ERROR' },
      },
    })
    await expect(completion).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' })
    expect(await observed).toBe('PROTOCOL_ERROR')
  })
})
