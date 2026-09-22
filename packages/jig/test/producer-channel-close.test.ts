import { describe, expect, test } from 'bun:test'
import { ChannelBroker, CHANNEL_LIMITS } from '../src/run/channels.js'

describe('owned writer incomplete-delivery declaration', () => {
  test('rejects pending sends and wakes readers without failing producer or sibling work', async () => {
    const broker = new ChannelBroker()
    const owner = broker.participant('owner')
    const pair = await owner.create()
    for (let index = 0; index < CHANNEL_LIMITS.bufferedItems; index++)
      await owner.send(pair.send.endpoint, index)
    const pending = owner.send(pair.send.endpoint, 'pending').catch((error) => error)
    await owner.request('channel/close', { endpoint: pair.send.endpoint, error: 'LAGGED' })
    expect(await pending).toMatchObject({ code: 'LAGGED' })
    await expect(owner.next(pair.receive.endpoint)).rejects.toMatchObject({ code: 'LAGGED' })
    expect(owner.release(pair.receive.endpoint)).toMatchObject({ status: 'failed', code: 'LAGGED' })
    owner.close(pair.send.endpoint, 'LAGGED')
    const sibling = await owner.create()
    await owner.send(sibling.send.endpoint, 'healthy')
    expect(await owner.next(sibling.receive.endpoint)).toMatchObject({ item: { value: 'healthy' } })
    owner.close(sibling.send.endpoint)
    expect(await owner.next(sibling.receive.endpoint)).toMatchObject({ end: { lastSequence: 1 } })
    owner.finalize(true)
  })

  test('active broadcast readers share producer failure, independently of old receiver failures', async () => {
    const owner = new ChannelBroker().participant('owner')
    const source = await owner.create({ delivery: 'broadcast' })
    const a = owner.subscribe(source.source),
      b = owner.subscribe(source.source)
    const pending = owner.next(a.endpoint).catch((error) => error)
    owner.close(source.send.endpoint, 'LAGGED')
    expect(await pending).toMatchObject({ code: 'LAGGED' })
    await expect(owner.next(b.endpoint)).rejects.toMatchObject({ code: 'LAGGED' })
    owner.release(a.endpoint)
    owner.release(b.endpoint)
    owner.finalize(true)
  })

  test('a receiver or guessed foreign writer cannot change its source', async () => {
    const broker = new ChannelBroker(),
      owner = broker.participant('owner'),
      stranger = broker.participant('stranger')
    const pair = await owner.create()
    await expect(
      stranger.request('channel/close', { endpoint: pair.send.endpoint, error: 'LAGGED' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    await expect(
      owner.request('channel/close', { endpoint: pair.receive.endpoint, error: 'LAGGED' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    await owner.send(pair.send.endpoint, 'still-live')
    expect(await owner.next(pair.receive.endpoint)).toMatchObject({ item: { value: 'still-live' } })
    owner.close(pair.send.endpoint)
    expect(await owner.next(pair.receive.endpoint)).toMatchObject({ end: { lastSequence: 1 } })
    owner.finalize(true)
    stranger.finalize(true)
  })

  test('clean end cannot be retroactively failed, even before the receiver drains', async () => {
    const owner = new ChannelBroker().participant('owner'),
      pair = await owner.create()
    await owner.send(pair.send.endpoint, 'committed')
    owner.close(pair.send.endpoint)
    await expect(
      owner.request('channel/close', { endpoint: pair.send.endpoint, error: 'LAGGED' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(await owner.next(pair.receive.endpoint)).toMatchObject({ item: { value: 'committed' } })
    expect(await owner.next(pair.receive.endpoint)).toMatchObject({ end: { lastSequence: 1 } })
    owner.finalize(true)
  })

  test('late disposal preserves the cause while already committed reads remain valid', async () => {
    const owner = new ChannelBroker().participant('owner'),
      pair = await owner.create()
    await owner.send(pair.send.endpoint, 'accepted')
    const committed = owner.next(pair.receive.endpoint)
    owner.close(pair.send.endpoint, 'LAGGED')
    expect(await committed).toMatchObject({ item: { value: 'accepted' } })
    expect(owner.release(pair.receive.endpoint)).toMatchObject({ status: 'failed', code: 'LAGGED' })
    owner.finalize(true)
  })
})
