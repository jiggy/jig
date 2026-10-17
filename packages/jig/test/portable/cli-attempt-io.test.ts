import { describe, expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import { PrivateAttemptInput, PrivateAttemptInputError } from '../../src/cli-attempt-io.js'

describe('execution request input framing', () => {
  test('a complete request leaves the owner connection live until client closure', async () => {
    const stream = new PassThrough()
    const input = new PrivateAttemptInput(stream)
    try {
      stream.write('{"ticket":"synthetic-test-ticket"}\n')
      expect(await input.request).toEqual({ ticket: 'synthetic-test-ticket' })
      expect(input.closed.aborted).toBeFalse()
      const closed = new Promise<void>((resolve) =>
        input.closed.addEventListener('abort', () => resolve(), { once: true }),
      )
      stream.end()
      await closed
      expect(input.closed.reason).toMatchObject({ code: 'INPUT_CLOSED' })
    } finally {
      input.dispose()
      stream.destroy()
    }
  })

  test('fragmented UTF-8 and finite EOF input preserve the complete JSON value', async () => {
    const stream = new PassThrough()
    const input = new PrivateAttemptInput(stream)
    try {
      const bytes = Buffer.from('{"input":"🌊"}')
      for (const byte of bytes) stream.write(Buffer.from([byte]))
      stream.end()
      expect(await input.request).toEqual({ input: '🌊' })
      expect(input.closed.aborted).toBeTrue()
    } finally {
      input.dispose()
      stream.destroy()
    }
  })

  test('invalid, extra, duplicate-key and truncated requests expose no input values', async () => {
    for (const text of [
      '',
      '{"ticket":"synthetic-private-value"',
      '{"ticket":"a","ticket":"b"}\n',
      '{}\n{"ticket":"synthetic-private-value"}',
    ]) {
      const stream = new PassThrough()
      const input = new PrivateAttemptInput(stream)
      try {
        const observed = input.request.catch((error: unknown) => error)
        stream.end(text)
        const error = await observed
        expect(error).toBeInstanceOf(PrivateAttemptInputError)
        expect(error).toMatchObject({ code: 'INPUT_INVALID' })
        expect(String(error)).not.toContain('synthetic-private-value')
      } finally {
        input.dispose()
        stream.destroy()
      }
    }
  })

  test('late extra data revokes connection validity without replacing the parsed request', async () => {
    const stream = new PassThrough()
    const input = new PrivateAttemptInput(stream)
    try {
      stream.write('{}\n')
      expect(await input.request).toEqual({})
      stream.write('{"extra":true}')
      expect(input.closed.aborted).toBeTrue()
      expect(input.closed.reason).toMatchObject({ code: 'INPUT_INVALID' })
      expect(await input.request).toEqual({})
    } finally {
      input.dispose()
      stream.destroy()
    }
  })

  test('bounds input before buffering and keeps errors independent of stream errors', async () => {
    const stream = new PassThrough()
    const input = new PrivateAttemptInput(stream, { maxBytes: 4 })
    try {
      const rejected = input.request.catch((error: unknown) => error)
      stream.write('12345')
      expect(await rejected).toMatchObject({ code: 'INPUT_LIMIT' })
      expect(input.closed.aborted).toBeTrue()
    } finally {
      input.dispose()
      stream.destroy()
    }
    const failedStream = new PassThrough()
    const failed = new PrivateAttemptInput(failedStream)
    try {
      const rejected = failed.request.catch((error: unknown) => error)
      failedStream.destroy(new Error('synthetic-private-stream-error'))
      const error = await rejected
      expect(error).toMatchObject({ code: 'INPUT_CLOSED' })
      expect(String(error)).not.toContain('synthetic-private-stream-error')
    } finally {
      failed.dispose()
    }
  })

  test('timeout, cancellation and disposal settle pending readers and retire listeners', async () => {
    const stream = new PassThrough()
    const timed = new PrivateAttemptInput(stream, { timeoutMs: 5 })
    try {
      await expect(timed.request).rejects.toMatchObject({ code: 'INPUT_TIMEOUT' })
    } finally {
      timed.dispose()
    }
    expect(stream.listenerCount('data')).toBe(0)
    const controller = new AbortController()
    const cancelled = new PrivateAttemptInput(stream, { signal: controller.signal })
    const rejection = cancelled.request.catch((error: unknown) => error)
    controller.abort(new Error('synthetic-private-cancellation'))
    expect(await rejection).toMatchObject({ code: 'INPUT_CANCELLED' })
    cancelled.dispose()
    const disposed = new PrivateAttemptInput(stream)
    const disposal = disposed.request.catch((error: unknown) => error)
    disposed.dispose()
    disposed.dispose()
    expect(await disposal).toMatchObject({ code: 'INPUT_CANCELLED' })
    expect(stream.listenerCount('data')).toBe(0)
    stream.destroy()
  })
})
