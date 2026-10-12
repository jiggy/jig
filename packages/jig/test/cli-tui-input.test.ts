import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { PrivateTuiInput } from '../src/cli-tui-input.js'

class Input extends EventEmitter {
  isRaw = false
  readableFlowing = false
  changes: boolean[] = []
  paused = true
  isPaused() {
    return this.paused
  }
  setRawMode(raw: boolean) {
    this.changes.push(raw)
    this.isRaw = raw
    return this
  }
  pause() {
    this.paused = true
    this.readableFlowing = false
    return this
  }
  resume() {
    this.paused = false
    this.readableFlowing = true
    return this
  }
}

test('TUI input captures before entry, forwards owned bytes and restores exactly once on EOF', () => {
  const input = new Input(),
    received: Uint8Array[] = []
  let closed = 0,
    cancelled = 0,
    failures = 0
  const owner = new PrivateTuiInput(
    input as any,
    (bytes) => received.push(bytes),
    () => closed++,
    () => cancelled++,
    () => failures++,
  )
  owner.capture()
  input.isRaw = true
  input.resume()
  owner.start()
  const data = Buffer.from('j\u001b[B')
  input.emit('data', data)
  expect(received).toEqual([data])
  input.emit('end')
  owner.leave()
  expect(input.isRaw).toBeFalse()
  expect(input.paused).toBeTrue()
  expect(input.changes).toEqual([true, false])
  expect(input.listenerCount('data')).toBe(0)
  expect(input.listenerCount('end')).toBe(0)
  expect(input.listenerCount('close')).toBe(0)
  expect(input.listenerCount('error')).toBe(0)
  expect([closed, cancelled, failures]).toEqual([1, 0, 0])
})

test('host settlement fences a stale renderer interrupt intent without changing cancellation', async () => {
  const input = new Input()
  let closed = 0,
    cancelled = 0
  const owner = new PrivateTuiInput(
    input as any,
    () => {},
    () => closed++,
    () => cancelled++,
    () => {},
  )
  owner.start()
  const wait = owner.settled()
  owner.action('interrupt')
  await wait
  expect([closed, cancelled]).toEqual([1, 0])
  expect(input.isRaw).toBeFalse()
})

test('live interrupt and setup failure release the borrowed stream and leave presentation', () => {
  const input = new Input()
  let closed = 0,
    cancelled = 0
  const owner = new PrivateTuiInput(
    input as any,
    () => {},
    () => closed++,
    () => cancelled++,
    () => {},
  )
  owner.start()
  owner.action('interrupt')
  expect([closed, cancelled]).toEqual([1, 1])
  expect(input.isRaw).toBeFalse()
  const broken = new Input()
  broken.resume = () => {
    throw new Error('input lost')
  }
  const failed = new PrivateTuiInput(
    broken as any,
    () => {},
    () => closed++,
    () => cancelled++,
    () => {},
  )
  expect(() => failed.start()).toThrow('input lost')
  expect(broken.isRaw).toBeFalse()
  expect(broken.listenerCount('data')).toBe(0)
  expect(closed).toBe(2)
})
