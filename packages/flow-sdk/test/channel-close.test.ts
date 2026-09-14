import { describe, expect, test } from 'bun:test'
import { Channels, type ChannelMethod, type RequestHooks } from '../src/channels.js'
import {
  OperationError,
  type ChannelCloseOptions,
  type ChannelSender,
  type JsonObject,
  type JsonValue,
} from '../src/types.js'

function fixture() {
  const calls: {
    method: ChannelMethod
    params: JsonObject
    answer(value?: JsonValue, error?: unknown): void
  }[] = []
  const channels = new Channels(
    async (method, params, _options, hooks?: RequestHooks) =>
      new Promise((resolve, reject) => {
        calls.push({
          method,
          params,
          answer(value = null, error) {
            hooks?.settled?.(error === undefined ? { result: value } : { error }, true, true)
            if (error === undefined) resolve(value)
            else reject(error)
          },
        })
      }),
  )
  const sender = channels.incoming({
    output: { endpoint: 'write:1', direction: 'send', delivery: 'direct' },
  }).output as ChannelSender
  return { calls, sender, channels }
}

describe('producer-declared incomplete channel', () => {
  test('sends only the owned endpoint and closed error enum, retaining clean close syntax', async () => {
    for (const error of [undefined, 'LAGGED'] as const) {
      const { calls, sender } = fixture()
      const closing = sender.close(error ? { error } : undefined)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        method: 'channel/close',
        params: { endpoint: 'write:1', ...(error ? { error } : {}) },
      })
      calls[0]!.answer()
      await closing
      await sender.close(error ? { error } : undefined)
      expect(calls).toHaveLength(1)
    }
  })

  test('clean sealing cannot be rewritten, even while its acknowledgement is pending', async () => {
    const { calls, sender } = fixture()
    const clean = sender.close()
    await expect(sender.close({ error: 'LAGGED' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    calls[0]!.answer()
    await clean
    await expect(sender.close({ error: 'LAGGED' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(calls).toHaveLength(1)
  })

  test('abnormal close can reject pending sends without waiting for their acceptance', async () => {
    const { calls, sender } = fixture()
    const send = sender.send('pending').catch((error) => error)
    await expect(sender.close()).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const close = sender.close({ error: 'LAGGED' })
    expect(calls.map((call) => call.method)).toEqual(['channel/send', 'channel/close'])
    calls[1]!.answer()
    await close
    calls[0]!.answer(undefined, new OperationError('LAGGED'))
    expect(await send).toMatchObject({ code: 'LAGGED' })
    await expect(sender.send('later')).rejects.toMatchObject({ code: 'DISCONNECTED' })
  })

  test('cancelling the close waiter retains one abnormal-close operation', async () => {
    const { calls, sender } = fixture()
    const controller = new AbortController()
    const close = sender.close({ error: 'LAGGED', signal: controller.signal })
    controller.abort()
    await expect(close).rejects.toMatchObject({ code: 'CANCELLED' })
    calls[0]!.answer()
    await sender.close({ error: 'LAGGED' })
    expect(calls).toHaveLength(1)
  })

  test('rejects invented status, hidden data and accessors before sending', async () => {
    let getter = false
    for (const options of [
      { error: 'UNCERTAIN' },
      { error: undefined },
      { error: 'LAGGED', message: 'trusted' },
      {
        get error() {
          getter = true
          return 'LAGGED'
        },
      },
    ]) {
      const { calls, sender } = fixture()
      await expect(sender.close(options as ChannelCloseOptions)).rejects.toThrow()
      expect(calls).toHaveLength(0)
    }
    expect(getter).toBe(false)
  })
})
