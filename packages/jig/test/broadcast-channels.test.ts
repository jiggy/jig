import { describe, expect, test } from 'bun:test'
import type { JsonValue } from '../src/json.js'
import {
  ChannelBroker,
  type ChannelParticipant,
  type ResolvedChannelContract,
} from '../src/run/channels.js'

describe('finite isolated broadcast channels', () => {
  test('creator retains subscription authority after its unused writer moves', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root')
    const worker = broker.participant('worker')
    const monitor = broker.participant('monitor')
    const source = await root.create({ delivery: 'broadcast' })
    expect(Object.keys(source).sort()).toEqual(['send', 'source'])
    const initial = root.subscribe(source.source)
    root.transfer(
      worker,
      { events: source.send.endpoint },
      { events: { direction: 'send', delivery: 'broadcast' } },
    )
    root.transfer(
      monitor,
      { events: initial.endpoint },
      { events: { direction: 'receive', delivery: 'broadcast' } },
    )
    expect(() => worker.subscribe(source.source)).toThrow('subscription authority')
    expect(() => monitor.subscribe(initial.endpoint)).toThrow('subscription authority')
    expect(() =>
      root.transfer(worker, { events: source.source }, { events: { direction: 'send' } }),
    ).toThrow('not held')
    await worker.send(source.send.endpoint, 'first')
    const suffix = root.subscribe(source.source)
    expect(suffix).toMatchObject({ direction: 'receive', delivery: 'broadcast', startSequence: 2 })
    await worker.send(source.send.endpoint, 'second')
    worker.close(source.send.endpoint)
    worker.finalize(true)
    expect(await drain(monitor, initial.endpoint)).toEqual(['first', 'second'])
    expect(await drain(root, suffix.endpoint)).toEqual(['second'])
    monitor.finalize(true)
    root.finalize(true)
  })

  test('publications without subscribers advance sequence without retaining replay', async () => {
    const owner = new ChannelBroker().participant('root')
    const source = await owner.create({ delivery: 'broadcast' })
    await owner.send(source.send.endpoint, 'not retained')
    const receiver = owner.subscribe(source.source)
    expect(receiver.startSequence).toBe(2)
    owner.close(source.send.endpoint)
    expect(await owner.next(receiver.endpoint)).toEqual({ end: { lastSequence: 1 } })
    expect(() => owner.subscribe(source.source)).toThrow('sealed')
    owner.finalize(true)
  })

  test('a beginning requirement rejects suffix binding without moving either mapped right', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root')
    const child = broker.participant('child')
    const source = await root.create({ delivery: 'broadcast' })
    await root.send(source.send.endpoint, 0)
    const suffix = root.subscribe(source.source)
    const other = await root.create()
    expect(() =>
      root.transfer(
        child,
        { other: other.send.endpoint, events: suffix.endpoint },
        {
          other: { direction: 'send' },
          events: { direction: 'receive' },
        },
      ),
    ).toThrow('beginning')
    await root.send(other.send.endpoint, 1)
    root.release(other.receive.endpoint)
    const grants = root.transfer(
      child,
      { events: suffix.endpoint },
      { events: { direction: 'receive', start: 'suffix' } },
    )
    expect(grants.events!.startSequence).toBe(2)
    root.close(source.send.endpoint)
    expect(await child.next(suffix.endpoint)).toEqual({ end: { lastSequence: 1 } })
    child.finalize(true)
    root.finalize(true)
  })

  test('one stalled subscription lags permanently while healthy listeners keep contiguous data', async () => {
    const owner = new ChannelBroker().participant('root')
    const source = await owner.create({ delivery: 'broadcast' })
    const slow = owner.subscribe(source.source)
    const healthy = owner.subscribe(source.source)
    for (let index = 1; index <= 20; index++) {
      await owner.send(source.send.endpoint, index)
      expect(await owner.next(healthy.endpoint)).toEqual({
        item: { sequence: index, value: index },
      })
    }
    owner.close(source.send.endpoint)
    await expect(owner.next(slow.endpoint)).rejects.toMatchObject({ code: 'LAGGED' })
    expect(owner.release(slow.endpoint)).toMatchObject({ status: 'failed', code: 'LAGGED' })
    expect(await owner.next(healthy.endpoint)).toEqual({ end: { lastSequence: 20 } })
    owner.finalize(true)
  })

  test('in-flight payload remains charged and subscriber bytes can lag before its item count', async () => {
    const owner = new ChannelBroker().participant('root')
    const source = await owner.create({ delivery: 'broadcast' })
    const receiver = owner.subscribe(source.source)
    const value = 'x'.repeat(60 * 1024)
    const committed = owner.next(receiver.endpoint)
    await owner.send(source.send.endpoint, value)
    expect(((await committed) as { item: { sequence: number } }).item.sequence).toBe(1)
    for (let index = 0; index < 4; index++) await owner.send(source.send.endpoint, value)
    await expect(owner.next(receiver.endpoint)).rejects.toMatchObject({ code: 'LAGGED' })
    owner.close(source.send.endpoint)
    owner.finalize(true)
  })

  test('receiver-specific validation fails only its subscription', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root')
    const child = broker.participant('child')
    const source = await root.create({ delivery: 'broadcast' })
    const typed = root.subscribe(source.source)
    const generic = root.subscribe(source.source)
    root.transfer(
      child,
      { events: typed.endpoint },
      { events: { direction: 'receive', schema: { type: 'string' } } },
    )
    await root.send(source.send.endpoint, 'valid')
    expect(await child.next(typed.endpoint)).toEqual({ item: { sequence: 1, value: 'valid' } })
    await root.send(source.send.endpoint, 42)
    await root.send(source.send.endpoint, 'later')
    root.close(source.send.endpoint)
    await expect(child.next(typed.endpoint)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(await drain(root, generic.endpoint)).toEqual(['valid', 42, 'later'])
    child.finalize(true)
    root.finalize(true)
  })

  test('staged writer and receiver schema admission is independent of map key ordering', async () => {
    for (const receiveFirst of [false, true]) {
      const broker = new ChannelBroker()
      const root = broker.participant('root')
      const child = broker.participant('child')
      const source = await root.create({ delivery: 'broadcast' })
      const receive = root.subscribe(source.source)
      const map = receiveFirst
        ? { receive: receive.endpoint, send: source.send.endpoint }
        : { send: source.send.endpoint, receive: receive.endpoint }
      expect(() =>
        root.transfer(child, map, {
          send: { direction: 'send', schema: { type: 'number' } },
          receive: { direction: 'receive', schema: { type: 'string' } },
        }),
      ).toThrow('schema differs')
      await root.send(source.send.endpoint, true)
      root.close(source.send.endpoint)
      expect(await drain(root, receive.endpoint)).toEqual([true])
      root.finalize(true)
    }
  })

  test('known writer and subscriber schema conflicts reject admission in either order', async () => {
    for (const receiverFirst of [false, true]) {
      const broker = new ChannelBroker()
      const root = broker.participant('root')
      const monitor = broker.participant('monitor')
      const worker = broker.participant('worker')
      const source = await root.create({ delivery: 'broadcast' })
      const receive = root.subscribe(source.source)
      const admitReceiver = () =>
        root.transfer(
          monitor,
          { events: receive.endpoint },
          {
            events: { direction: 'receive', schema: { type: 'string' } },
          },
        )
      const admitWriter = () =>
        root.transfer(
          worker,
          { events: source.send.endpoint },
          {
            events: { direction: 'send', schema: { type: 'number' } },
          },
        )
      if (receiverFirst) {
        admitReceiver()
        expect(admitWriter).toThrow('schema differs')
        monitor.release(receive.endpoint)
      } else {
        admitWriter()
        expect(admitReceiver).toThrow('schema differs')
        root.release(receive.endpoint)
      }
      worker.finalize(true)
      monitor.finalize(true)
      root.finalize(true)
    }
  })

  test('a disposed subscriber cannot veto a later writer admission', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root')
    const monitor = broker.participant('monitor')
    const worker = broker.participant('worker')
    const source = await root.create({ delivery: 'broadcast' })
    const receive = root.subscribe(source.source)
    root.transfer(
      monitor,
      { events: receive.endpoint },
      { events: { direction: 'receive', schema: { type: 'string' } } },
    )
    monitor.release(receive.endpoint)
    const healthy = root.subscribe(source.source)
    root.transfer(
      worker,
      { events: source.send.endpoint },
      { events: { direction: 'send', schema: { type: 'number' } } },
    )
    await worker.send(source.send.endpoint, 42)
    worker.close(source.send.endpoint)
    expect(await drain(root, healthy.endpoint)).toEqual([42])
    worker.finalize(true)
    monitor.finalize(true)
    root.finalize(true)
  })

  test('source bytes are bounded even when every publication has no subscribers', async () => {
    const owner = new ChannelBroker().participant('root')
    const source = await owner.create({ delivery: 'broadcast' })
    const exactly64KiB = 'x'.repeat(64 * 1024 - 2)
    for (let index = 0; index < 128; index++) await owner.send(source.send.endpoint, exactly64KiB)
    await expect(owner.send(source.send.endpoint, 0)).rejects.toMatchObject({
      code: 'RESOURCE_EXHAUSTED',
    })
    expect(() => owner.subscribe(source.source)).toThrow('lifetime byte limit')
    owner.finalize(true)
  })

  test('prefix validation rejects a subscriber binding without poisoning source or granting rights', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root')
    const child = broker.participant('child')
    const source = await root.create({ delivery: 'broadcast' })
    const receiver = root.subscribe(source.source)
    const second = root.subscribe(source.source)
    await root.send(source.send.endpoint, 42)
    expect(() =>
      root.transfer(
        child,
        { events: receiver.endpoint },
        { events: { direction: 'receive', schema: { type: 'string' } } },
      ),
    ).toThrow('schema')
    await root.send(source.send.endpoint, 43)
    root.close(source.send.endpoint)
    expect(await drain(root, receiver.endpoint)).toEqual([42, 43])
    expect(await drain(root, second.endpoint)).toEqual([42, 43])
    child.finalize(true)
    root.finalize(true)
  })

  test('source or admitted writer schemas fail all subscriptions before invalid acceptance', async () => {
    for (const writerConstraint of [false, true]) {
      const broker = new ChannelBroker()
      const root = broker.participant('root')
      const writer = writerConstraint ? broker.participant('writer') : root
      const source = await root.create({
        delivery: 'broadcast',
        ...(writerConstraint ? {} : { schema: { type: 'string' } }),
      })
      const first = root.subscribe(source.source)
      const second = root.subscribe(source.source)
      if (writerConstraint)
        root.transfer(
          writer,
          { events: source.send.endpoint },
          { events: { direction: 'send', schema: { type: 'string' } } },
        )
      await writer.send(source.send.endpoint, 'prefix')
      await expect(writer.send(source.send.endpoint, 42)).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      })
      for (const receiver of [first, second])
        await expect(root.next(receiver.endpoint)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
      if (writerConstraint) writer.finalize(true)
      root.finalize(true)
    }
  })

  test('subscriber disposal and cancellation do not disconnect a broadcast writer or its sibling', async () => {
    const owner = new ChannelBroker().participant('root')
    const source = await owner.create({ delivery: 'broadcast' })
    const cancelledReceiver = owner.subscribe(source.source)
    const healthy = owner.subscribe(source.source)
    const controller = new AbortController()
    const reading = owner
      .next(cancelledReceiver.endpoint, controller.signal)
      .catch((error) => error)
    controller.abort()
    expect(await reading).toMatchObject({ code: 'CANCELLED' })
    expect(owner.release(cancelledReceiver.endpoint)).toEqual({ status: 'released' })
    await owner.send(source.send.endpoint, 'still useful')
    owner.close(source.send.endpoint)
    expect(await drain(owner, healthy.endpoint)).toEqual(['still useful'])
    owner.finalize(true)
  })

  test('failed subscribers retain their first cause across producer failure and release', async () => {
    const owner = new ChannelBroker().participant('root')
    const source = await owner.create({ delivery: 'broadcast' })
    const lagged = owner.subscribe(source.source)
    for (let index = 0; index < 17; index++) await owner.send(source.send.endpoint, index)
    owner.failWriter(source.send.endpoint, 'CANCELLED', 'writer stopped')
    expect(owner.release(lagged.endpoint)).toMatchObject({ status: 'failed', code: 'LAGGED' })
    owner.finalize(true)
  })

  test('subscription activation requires explicit settlement even before any read', async () => {
    const owner = new ChannelBroker().participant('root')
    const source = await owner.create({ delivery: 'broadcast' })
    owner.subscribe(source.source)
    expect(() => owner.finalize(true)).toThrow('active unfinished')
  })

  test('source and receiver lifetime allocations are separate and never recycle', async () => {
    const owner = new ChannelBroker().participant('root')
    const source = await owner.create({ delivery: 'broadcast' })
    for (let index = 0; index < 16; index++) owner.release(owner.subscribe(source.source).endpoint)
    expect(() => owner.subscribe(source.source)).toThrow('allocation limit')
    await expect(owner.create()).rejects.toMatchObject({ code: 'RESOURCE_EXHAUSTED' })
    for (let index = 1; index < 16; index++) {
      const extra = await owner.create({ delivery: 'broadcast' })
      owner.close(extra.send.endpoint)
    }
    await expect(owner.create({ delivery: 'broadcast' })).rejects.toMatchObject({
      code: 'RESOURCE_EXHAUSTED',
    })
    owner.close(source.send.endpoint)
    owner.finalize(true)
  })

  test('a cancelled asynchronous allocation seals its unexposed writer without consuming a receiver', async () => {
    let resolve!: (contract: ResolvedChannelContract) => void
    const owner = new ChannelBroker().participant('root', {
      resolveContract: () =>
        new Promise((done) => {
          resolve = done
        }),
    })
    const controller = new AbortController()
    const creating = owner
      .request(
        'channel/create',
        { delivery: 'broadcast', contract: './contract.json' },
        controller.signal,
      )
      .catch((error) => error)
    controller.abort()
    resolve({
      identity: {
        id: 'https://example.org/events',
        version: '1.0.0',
        digest: `sha256:${'1'.repeat(64)}`,
      },
      schema: true,
      validate() {},
    })
    expect(await creating).toMatchObject({ code: 'CANCELLED' })
    const source = await owner.create({ delivery: 'broadcast' })
    for (let index = 0; index < 16; index++) owner.release(owner.subscribe(source.source).endpoint)
    owner.finalize(true)
  })

  test('source owner revocation preserves committed EOF but rejects every undrained subscriber', async () => {
    const broker = new ChannelBroker()
    const creator = broker.participant('creator')
    const peer = broker.participant('peer')
    const source = await creator.create({ delivery: 'broadcast' })
    const complete = creator.subscribe(source.source)
    const pending = creator.subscribe(source.source)
    creator.transfer(
      peer,
      { complete: complete.endpoint, pending: pending.endpoint },
      { complete: { direction: 'receive' }, pending: { direction: 'receive' } },
    )
    creator.close(source.send.endpoint)
    expect(await peer.next(complete.endpoint)).toEqual({ end: { lastSequence: 0 } })
    creator.finalize(true)
    expect(peer.release(complete.endpoint)).toEqual({ status: 'ended', lastSequence: 0 })
    await expect(peer.next(pending.endpoint)).rejects.toMatchObject({ code: 'OWNER_CLOSED' })
    peer.finalize(true)
  })

  test('wire subscribe is creator-scoped, closed-shaped, and cancellation allocates nothing', async () => {
    const broker = new ChannelBroker()
    const owner = broker.participant('root')
    const stranger = broker.participant('other')
    const source = await owner.create({ delivery: 'broadcast' })
    await expect(
      stranger.request('channel/subscribe', { source: source.source }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    await expect(
      owner.request('channel/subscribe', { source: source.source, unknown: true }),
    ).rejects.toBeInstanceOf(TypeError)
    const controller = new AbortController()
    controller.abort()
    await expect(
      owner.request('channel/subscribe', { source: source.source }, controller.signal),
    ).rejects.toMatchObject({ code: 'CANCELLED' })
    for (let index = 0; index < 16; index++) {
      const receiver = (await owner.request('channel/subscribe', { source: source.source })) as {
        endpoint: string
        delivery: string
        startSequence: number
      }
      expect(receiver).toMatchObject({ delivery: 'broadcast', startSequence: 1 })
      owner.release(receiver.endpoint)
    }
    owner.finalize(true)
  })
})

async function drain(owner: ChannelParticipant, endpoint: string): Promise<JsonValue[]> {
  const values: JsonValue[] = []
  for (;;) {
    const record = (await owner.next(endpoint)) as { item?: { value: JsonValue }; end?: unknown }
    if (record.end !== undefined) return values
    values.push(record.item!.value)
  }
}
