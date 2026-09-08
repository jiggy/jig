import { describe, expect, test } from 'bun:test'
import { Writable } from 'node:stream'
import { PrivateCliOutput } from '../src/internal/cli-output.js'

describe('bounded installed command output', () => {
  test('delivers bytes in order and flushes without cancelling healthy work', async () => {
    const chunks: string[] = []
    const stream = new Writable({
      write(chunk, _encoding, done) {
        chunks.push(chunk.toString())
        queueMicrotask(done)
      },
    })
    const stop = new AbortController()
    const output = new PrivateCliOutput(stream, stop)
    await Promise.all([output.write('first\n'), output.write('second\n')])
    await output.flush()
    expect(chunks).toEqual(['first\n', 'second\n'])
    expect(stop.signal.aborted).toBeFalse()
    stream.destroy()
  })

  test('stream errors cancel and settle every queued write with the original cause', async () => {
    let complete: ((error?: Error | null) => void) | undefined
    const stream = new Writable({
      write(_chunk, _encoding, done) {
        complete = done
      },
    })
    const stop = new AbortController()
    const output = new PrivateCliOutput(stream, stop)
    const first = output.write('first').catch((error) => error)
    const second = output.write('second').catch((error) => error)
    const cause = new Error('broken pipe')
    stream.emit('error', cause)
    expect(stop.signal.aborted).toBeTrue()
    expect(await first).toBe(cause)
    expect(await second).toBe(cause)
    await expect(output.flush()).rejects.toBe(cause)
    await expect(output.write('terminal')).rejects.toBe(cause)
    // Late stream callbacks cannot undo failure or settle a write twice.
    complete?.()
    await expect(output.flush()).rejects.toBe(cause)
    stream.destroy()
  })

  test('an asynchronous write rejection cancels work and rejects flush', async () => {
    const cause = new Error('write rejected')
    const stream = new Writable({
      write(_chunk, _encoding, done) {
        queueMicrotask(() => done(cause))
      },
    })
    const stop = new AbortController()
    const output = new PrivateCliOutput(stream, stop)
    await expect(output.write('record')).rejects.toBe(cause)
    expect(stop.signal.aborted).toBeTrue()
    await expect(output.flush()).rejects.toBe(cause)
    stream.destroy()
  })

  test('a synchronous writer exception cancels work', async () => {
    const cause = new Error('write threw')
    const stream = new Writable({
      write() {
        throw cause
      },
    })
    const stop = new AbortController()
    const output = new PrivateCliOutput(stream, stop)
    await expect(output.write('record')).rejects.toBe(cause)
    await expect(output.flush()).rejects.toBe(cause)
    expect(stop.signal.aborted).toBeTrue()
    stream.destroy()
  })

  test('retained byte overflow settles earlier blocked output and cancels work', async () => {
    const stream = new Writable({ write() {} })
    const stop = new AbortController()
    const output = new PrivateCliOutput(stream, stop)
    const pending = output.write('x'.repeat(20 * 1024 * 1024)).catch((error) => error)
    await expect(output.write('x')).rejects.toThrow('command output capacity exceeded')
    expect(await pending).toBeInstanceOf(Error)
    await expect(output.flush()).rejects.toThrow('command output capacity exceeded')
    expect(stop.signal.aborted).toBeTrue()
    stream.destroy()
  })

  test('tiny writes have a finite queue and empty output consumes no queue capacity', async () => {
    const stream = new Writable({ write() {} })
    const stop = new AbortController()
    const output = new PrivateCliOutput(stream, stop)
    await Promise.all(Array.from({ length: 300 }, () => output.write('')))
    const pending = Array.from({ length: 256 }, () => output.write('x').catch((error) => error))
    expect(stop.signal.aborted).toBeFalse()
    await expect(output.write('x')).rejects.toThrow('command output capacity exceeded')
    expect((await Promise.all(pending)).every((error) => error instanceof Error)).toBeTrue()
    await expect(output.flush()).rejects.toThrow('command output capacity exceeded')
    expect(stop.signal.aborted).toBeTrue()
    stream.destroy()
  })

  test('a blocked writer times out instead of holding cancellation indefinitely', async () => {
    const stream = new Writable({ write() {} })
    const stop = new AbortController()
    const output = new PrivateCliOutput(stream, stop)
    const pending = output.write('record')
    expect(stop.signal.aborted).toBeFalse()
    await expect(pending).rejects.toThrow('command output delivery timed out')
    expect(stop.signal.aborted).toBeTrue()
    await expect(output.flush()).rejects.toThrow('command output delivery timed out')
    stream.destroy()
  })
})
