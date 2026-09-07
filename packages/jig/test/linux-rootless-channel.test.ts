import { expect, test } from 'bun:test'
import { readPrivateSupervisorMessage } from '../src/internal/linux-rootless-backend.js'

test('supervisor exit does not discard a terminal already buffered on its control channel', async () => {
  const message = { type: 'terminal', fenced: true }
  const iterator = {
    async next() {
      await Bun.sleep(1)
      return { done: false as const, value: message }
    },
  }
  expect(
    await readPrivateSupervisorMessage(iterator, Promise.resolve({ code: 0, signal: null })),
  ).toEqual(message)
})

test('an exhausted control channel never fabricates a supervisor terminal', async () => {
  const iterator = {
    async next() {
      return { done: true as const, value: undefined }
    },
  }
  await expect(
    readPrivateSupervisorMessage(iterator, Promise.resolve({ code: 0, signal: null })),
  ).rejects.toThrow()
})

test('an exited supervisor with a stuck channel has bounded uncertainty', async () => {
  const iterator = { next: () => new Promise<IteratorResult<unknown>>(() => {}) }
  await expect(
    readPrivateSupervisorMessage(iterator, Promise.resolve({ code: 0, signal: null })),
  ).rejects.toThrow('final channel drain timed out')
})
