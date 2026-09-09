import { describe, expect, test } from 'bun:test'
import type { JsonValue } from '../src/json.js'
import {
  type ChannelGrant,
  ChannelBroker,
  type ResolvedChannelContract,
} from '../src/run/channels.js'

describe('finite direct channel broker', () => {
  test('an unused writer can move after observer disposal without reviving delivery', async () => {
    for (const required of [true, false]) {
      const broker = new ChannelBroker()
      const root = broker.participant('root')
      const monitor = broker.participant('monitor')
      const worker = broker.participant('worker')
      const pair = await root.create({ schema: { type: 'string' } })
      root.transfer(
        monitor,
        { progress: pair.receive.endpoint },
        {
          progress: { direction: 'receive', schema: { type: 'string' } },
        },
      )
      monitor.release(pair.receive.endpoint)
      monitor.finalize(true)
      const granted = root.transfer(
        worker,
        { progress: pair.send.endpoint },
        {
          progress: { direction: 'send', required, schema: { type: 'string' } },
        },
      )
      await expect(
        worker.send(granted.progress!.endpoint, 'no longer observed'),
      ).rejects.toMatchObject({ code: 'DISCONNECTED' })
      expect(() => worker.close(granted.progress!.endpoint)).toThrow('receiver was released')
      await expect(root.send(pair.send.endpoint, 'old owner')).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      })
      worker.finalize(true)
      root.finalize(true)
    }
  })

  test('disposed receivers and failed or ownerless sources cannot gain new holders', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root')
    const child = broker.participant('child')
    const pair = await root.create()
    root.release(pair.receive.endpoint)
    expect(() =>
      root.transfer(
        child,
        { port: pair.receive.endpoint },
        {
          port: { direction: 'receive' },
        },
      ),
    ).toThrow()
    root.failWriter(pair.send.endpoint, 'CANCELLED', 'source failed')
    expect(() =>
      root.transfer(
        child,
        { port: pair.send.endpoint },
        {
          port: { direction: 'send' },
        },
      ),
    ).toThrow('no longer available')
    const owned = await child.create()
    child.transfer(root, { port: owned.send.endpoint }, { port: { direction: 'send' } })
    child.finalize(false)
    const other = broker.participant('other')
    expect(() =>
      root.transfer(other, { port: owned.send.endpoint }, { port: { direction: 'send' } }),
    ).toThrow('participant stopped')
    root.finalize(false)
  })

  test('owner revocation prevents late asynchronous contract resolution allocating new sources', async () => {
    let resolve!: (contract: ResolvedChannelContract) => void
    const owner = new ChannelBroker().participant('root', {
      resolveContract: () =>
        new Promise((done) => {
          resolve = done
        }),
    })
    const creation = owner.create({ contract: './events.json' }).catch((error) => error)
    owner.abort('CANCELLED')
    resolve(named('https://example.org/events'))
    expect(await creation).toMatchObject({ code: 'CANCELLED' })
    await expect(owner.create()).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(() => owner.finalize(true)).toThrow('participant stopped')
  })

  test('creator termination revokes sealed undrained intervals held elsewhere', async () => {
    const broker = new ChannelBroker()
    const creator = broker.participant('creator')
    const receiver = broker.participant('receiver')
    const pair = await creator.create()
    creator.transfer(
      receiver,
      { input: pair.receive.endpoint },
      { input: { direction: 'receive' } },
    )
    await creator.send(pair.send.endpoint, 'queued')
    creator.close(pair.send.endpoint)
    creator.finalize(true)
    await expect(receiver.next(pair.receive.endpoint)).rejects.toMatchObject({
      code: 'OWNER_CLOSED',
    })
    receiver.finalize(true)
  })

  test('opposite ends in one atomic mapping must also agree with each other', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root')
    const child = broker.participant('child')
    const pair = await root.create()
    expect(() =>
      root.transfer(
        child,
        { input: pair.receive.endpoint, output: pair.send.endpoint },
        {
          input: { direction: 'receive', schema: { type: 'string' } },
          output: { direction: 'send', schema: { type: 'number' } },
        },
      ),
    ).toThrow('schema differs')
    await root.send(pair.send.endpoint, null)
    expect(await root.next(pair.receive.endpoint)).toMatchObject({ item: { value: null } })
    root.release(pair.receive.endpoint)
    root.finalize(true)
  })

  test('asynchronous contract resolution rechecks ownership and cancelled allocation remains disposed', async () => {
    let resolve!: (contract: ResolvedChannelContract) => void
    const broker = new ChannelBroker()
    const owner = broker.participant('root', {
      resolveContract: () =>
        new Promise((done) => {
          resolve = done
        }),
    })
    const controller = new AbortController()
    const creating = owner
      .request('channel/create', { contract: './events.json' }, controller.signal)
      .catch((error) => error)
    controller.abort()
    resolve(named('https://example.org/events'))
    expect(await creating).toMatchObject({ code: 'CANCELLED' })
    owner.finalize(true)
  })

  test('cross-root transfers cannot create communication authority', async () => {
    const left = new ChannelBroker().participant('left')
    const right = new ChannelBroker().participant('right')
    const pair = await left.create()
    expect(() =>
      left.transfer(right, { events: pair.send.endpoint }, { events: { direction: 'send' } }),
    ).toThrow('different root')
    left.finalize(true)
    right.finalize(true)
  })

  test('snapshots values, orders data, and reports a separate clean end', async () => {
    const owner = new ChannelBroker().participant('root')
    const pair = await owner.create()
    const value = { text: 'before' }
    await owner.send(pair.send.endpoint, value)
    value.text = 'after'
    owner.close(pair.send.endpoint)
    expect(await owner.next(pair.receive.endpoint)).toEqual({
      item: { sequence: 1, value: { text: 'before' } },
    })
    expect(await owner.next(pair.receive.endpoint)).toEqual({ end: { lastSequence: 1 } })
    expect(owner.release(pair.receive.endpoint)).toEqual({ status: 'ended', lastSequence: 1 })
    owner.finalize(true)
  })

  test('forged, duplicate, locally used, or already moved rights cannot be transferred', async () => {
    const broker = new ChannelBroker()
    const parent = broker.participant('root')
    const child = broker.participant('child')
    const pair = await parent.create()
    expect(() => parent.transfer(child, { a: 'fake' }, { a: { direction: 'send' } })).toThrow(
      'not held',
    )
    expect(() =>
      parent.transfer(
        child,
        { a: pair.send.endpoint, b: pair.send.endpoint },
        { a: { direction: 'send' }, b: { direction: 'send' } },
      ),
    ).toThrow('only before')
    const grants = parent.transfer(
      child,
      { out: pair.send.endpoint },
      { out: { direction: 'send' } },
    )
    expect(grants.out).toEqual(pair.send)
    await expect(parent.send(pair.send.endpoint, null)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    })
    await child.send(pair.send.endpoint, 1)
    expect(() =>
      child.transfer(parent, { out: pair.send.endpoint }, { out: { direction: 'send' } }),
    ).toThrow('only before')
    broker.abort()
  })

  test('a rejected mapping changes neither rights nor queued prefix constraints', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root')
    const child = broker.participant('child')
    const pair = await root.create()
    await root.send(pair.send.endpoint, 'already accepted')
    expect(() =>
      root.transfer(
        child,
        { input: pair.receive.endpoint },
        { input: { direction: 'receive', schema: { type: 'number' } } },
      ),
    ).toThrow('schema')
    expect(await root.next(pair.receive.endpoint)).toMatchObject({
      item: { value: 'already accepted' },
    })
    await root.send(pair.send.endpoint, 'still allowed')
    root.release(pair.receive.endpoint)
    root.finalize(true)
  })

  test('named meaning is exact and transferred writers must declare it', async () => {
    const contract = named('https://example.org/events')
    const broker = new ChannelBroker()
    const root = broker.participant('root', { resolveContract: () => contract })
    const child = broker.participant('child')
    const pair = await root.create({ contract: './events.json' })
    expect(pair.receive.contract).toEqual(contract.identity)
    expect(() =>
      root.transfer(child, { a: pair.send.endpoint }, { a: { direction: 'send' } }),
    ).toThrow('must declare')
    expect(() =>
      root.transfer(
        child,
        { a: pair.receive.endpoint },
        { a: { direction: 'receive', contract: named('https://example.org/other') } },
      ),
    ).toThrow('identity')
    root.transfer(child, { a: pair.send.endpoint }, { a: { direction: 'send', contract } })
    broker.abort()
  })

  test('late receiver constraints validate pending unaccepted messages when admitted', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root')
    const child = broker.participant('child')
    const pair = await root.create()
    for (let i = 0; i < 16; i++) await root.send(pair.send.endpoint, i)
    const blocked = root.send(pair.send.endpoint, 'invalid').catch((error) => error)
    const grants = root.transfer(
      child,
      { a: pair.receive.endpoint },
      { a: { direction: 'receive', schema: { type: 'number' } } },
    )
    await child.next(grants.a!.endpoint)
    await expect(child.next(grants.a!.endpoint)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(await blocked).toMatchObject({ code: 'INVALID_INPUT' })
    broker.abort()
  })

  test('direct credit includes in-flight data and pending sends cancel without sequence gaps', async () => {
    const owner = new ChannelBroker().participant('root')
    const pair = await owner.create()
    for (let i = 0; i < 16; i++) await owner.send(pair.send.endpoint, i)
    const controller = new AbortController()
    const cancelled = owner
      .send(pair.send.endpoint, 'never accepted', controller.signal)
      .catch((error) => error)
    await owner.next(pair.receive.endpoint)
    controller.abort()
    expect(await cancelled).toMatchObject({ code: 'CANCELLED' })
    let settled = false
    const pending = owner.send(pair.send.endpoint, 'last').then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    await owner.next(pair.receive.endpoint)
    await pending
    owner.close(pair.send.endpoint)
    let last: JsonValue = null
    do {
      last = await owner.next(pair.receive.endpoint)
    } while ('item' in (last as object))
    expect(last).toEqual({ end: { lastSequence: 17 } })
    owner.finalize(true)
  })

  test('release unblocks pending sends and reports failure already known at the host', async () => {
    const owner = new ChannelBroker().participant('root')
    const pair = await owner.create()
    const reading = owner.next(pair.receive.endpoint).catch((error) => error)
    owner.failWriter(pair.send.endpoint, 'LAGGED', 'native ingress overflowed')
    expect(await reading).toMatchObject({ code: 'LAGGED' })
    expect(owner.release(pair.receive.endpoint)).toEqual({ status: 'failed', code: 'LAGGED' })
    expect(owner.release(pair.receive.endpoint)).toEqual({ status: 'failed', code: 'LAGGED' })
    owner.finalize(true)
  })

  test('cancelling a pending read disposes the receiver without cancelling its producer', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root')
    const producer = broker.participant('producer')
    const pair = await root.create()
    root.transfer(producer, { events: pair.send.endpoint }, { events: { direction: 'send' } })
    const controller = new AbortController()
    const reading = root.next(pair.receive.endpoint, controller.signal).catch((error) => error)
    controller.abort()
    expect(await reading).toMatchObject({ code: 'CANCELLED' })
    expect(root.release(pair.receive.endpoint)).toEqual({ status: 'released' })
    await expect(producer.send(pair.send.endpoint, 1)).rejects.toMatchObject({
      code: 'DISCONNECTED',
    })
    expect(producer.finalized).toBe(false)
    producer.finalize(true)
    root.finalize(true)
  })

  test('source/schema limits fail the source before accepting an invalid item', async () => {
    const owner = new ChannelBroker().participant('root')
    const pair = await owner.create({ schema: { type: 'number' } })
    await expect(owner.send(pair.send.endpoint, 'wrong')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(owner.next(pair.receive.endpoint)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const oversized = await owner.create()
    await expect(owner.send(oversized.send.endpoint, 'x'.repeat(65536))).rejects.toMatchObject({
      code: 'RESOURCE_EXHAUSTED',
    })
    expect(owner.release(oversized.receive.endpoint)).toMatchObject({
      status: 'failed',
      code: 'RESOURCE_EXHAUSTED',
    })
    owner.finalize(true)
  })

  test('direct allocation budgets do not recycle after disposal', async () => {
    const owner = new ChannelBroker().participant('root')
    for (let i = 0; i < 16; i++) {
      const pair = await owner.create()
      owner.release(pair.receive.endpoint)
    }
    await expect(owner.create()).rejects.toThrow('allocation limit')
    owner.finalize(true)
  })

  test('root pending sends are bounded and settlement remains available', async () => {
    const owner = new ChannelBroker().participant('root')
    const pair = await owner.create()
    for (let i = 0; i < 16; i++) await owner.send(pair.send.endpoint, i)
    const pending = Array.from({ length: 16 }, () =>
      owner.send(pair.send.endpoint, 1).catch((error) => error),
    )
    await expect(owner.send(pair.send.endpoint, 2)).rejects.toMatchObject({
      code: 'RESOURCE_EXHAUSTED',
    })
    expect(() => owner.close(pair.send.endpoint)).toThrow('unaccepted')
    owner.release(pair.receive.endpoint)
    for (const result of await Promise.all(pending))
      expect(result).toMatchObject({ code: 'DISCONNECTED' })
    owner.finalize(true)
  })

  test('retained offered receivers refuse success and abort writers before implicit sealing', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root')
    const sink = broker.participant('sink')
    const input = await root.create()
    const output = await root.create()
    await root.send(input.send.endpoint, 1)
    root.transfer(sink, { events: output.receive.endpoint }, { events: { direction: 'receive' } })
    expect(() => root.finalize(true)).toThrow('active unfinished')
    await expect(sink.next(output.receive.endpoint)).rejects.toMatchObject({ code: 'OWNER_CLOSED' })
  })

  test('explicitly sealed intervals drain after producer failure, but unsealed ones fail', async () => {
    const broker = new ChannelBroker()
    const root = broker.participant('root')
    const producer = broker.participant('producer')
    const sealed = await root.create()
    const open = await root.create()
    root.transfer(
      producer,
      { sealed: sealed.send.endpoint, open: open.send.endpoint },
      { sealed: { direction: 'send' }, open: { direction: 'send' } },
    )
    await producer.send(sealed.send.endpoint, 1)
    producer.close(sealed.send.endpoint)
    producer.finalize(false)
    expect(await root.next(sealed.receive.endpoint)).toEqual({ item: { sequence: 1, value: 1 } })
    expect(await root.next(sealed.receive.endpoint)).toEqual({ end: { lastSequence: 1 } })
    await expect(root.next(open.receive.endpoint)).rejects.toMatchObject({ code: 'OWNER_CLOSED' })
    root.finalize(true)
  })

  test('whole root revocation wins over an uncommitted EOF, not already committed EOF', async () => {
    const broker = new ChannelBroker()
    const owner = broker.participant('root')
    const pair = await owner.create()
    owner.close(pair.send.endpoint)
    broker.abort('CANCELLED')
    await expect(owner.next(pair.receive.endpoint)).rejects.toMatchObject({ code: 'CANCELLED' })
    const other = new ChannelBroker()
    const participant = other.participant('other')
    const end = await participant.create()
    participant.close(end.send.endpoint)
    const committed = participant.next(end.receive.endpoint)
    other.abort('CANCELLED')
    expect(await committed).toEqual({ end: { lastSequence: 0 } })
  })
})

function named(id: string): ResolvedChannelContract {
  return {
    identity: { id, version: '1.0.0', digest: `sha256:${'a'.repeat(64)}` },
    schema: true,
    validate: () => undefined,
  }
}
