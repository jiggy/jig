import { describe, expect, spyOn, test } from 'bun:test'
import type { ChannelCloseOptions, ChannelSender, JsonValue } from '@jigging/flow'
import { OptionalUpdates } from '../src/updates.js'

describe('optional ordinary presentation relay', () => {
  test('healthy delivery preserves order and closes cleanly', async () => {
    const sent: JsonValue[] = []
    const ends: (ChannelCloseOptions | undefined)[] = []
    const sender: ChannelSender = {
      direction: 'send',
      delivery: 'direct',
      async send(value) {
        sent.push(value)
      },
      async close(options) {
        ends.push(options)
      },
    }
    const updates = new OptionalUpdates(sender, new AbortController().signal)
    updates.offer({ text: 'first' })
    updates.offer({ text: 'second' })
    await updates.finish()
    expect(sent).toEqual([{ text: 'first' }, { text: 'second' }])
    expect(ends).toEqual([undefined])
  })

  test('overflow aborts the blocked send, drops the suffix and declares LAGGED', async () => {
    const diagnostic = spyOn(console, 'error').mockImplementation(() => {})
    const ends: (ChannelCloseOptions | undefined)[] = []
    let sends = 0
    let aborted = false
    const sender: ChannelSender = {
      direction: 'send',
      delivery: 'direct',
      async send(_value, options) {
        sends++
        await new Promise<void>((_resolve, reject) =>
          options!.signal!.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(new Error('aborted'))
            },
            { once: true },
          ),
        )
      },
      async close(options) {
        ends.push(options)
      },
    }
    try {
      const updates = new OptionalUpdates(sender, new AbortController().signal)
      for (let index = 0; index < 20; index++) updates.offer({ index })
      await updates.finish()
      updates.offer({ later: 'must never resume' })
      expect(aborted).toBe(true)
      expect(sends).toBe(1)
      expect(ends).toEqual([{ error: 'LAGGED' }])
      expect(diagnostic).toHaveBeenCalledTimes(1)
    } finally {
      diagnostic.mockRestore()
    }
  })

  test('a blocked send has a finite wait without cancelling the Agent', async () => {
    const diagnostic = spyOn(console, 'error').mockImplementation(() => {})
    const owner = new AbortController()
    let end: ChannelCloseOptions | undefined
    const sender: ChannelSender = {
      direction: 'send',
      delivery: 'direct',
      async send(_value, options) {
        await new Promise<void>((_resolve, reject) =>
          options!.signal!.addEventListener('abort', () => reject(new Error('blocked')), {
            once: true,
          }),
        )
      },
      async close(options) {
        end = options
      },
    }
    try {
      const updates = new OptionalUpdates(sender, owner.signal)
      updates.offer({ text: 'bounded wait' })
      await updates.finish()
      expect(end).toEqual({ error: 'LAGGED' })
      expect(owner.signal.aborted).toBe(false)
    } finally {
      diagnostic.mockRestore()
    }
  })
})
