import type { Readable } from 'node:stream'
import { decodeJson1, JSON_1_LIMITS, type JsonValue } from './json.js'

export type PrivateAttemptInputFailure =
  | 'INPUT_INVALID'
  | 'INPUT_LIMIT'
  | 'INPUT_TIMEOUT'
  | 'INPUT_CLOSED'
  | 'INPUT_CANCELLED'

/** Fixed diagnostics only: the input may contain a ticket or private source. */
export class PrivateAttemptInputError extends Error {
  constructor(readonly code: PrivateAttemptInputFailure) {
    super(
      {
        INPUT_INVALID: 'Expected exactly one bounded JSON request.',
        INPUT_LIMIT: 'The execution request exceeds its input limit.',
        INPUT_TIMEOUT: 'No complete execution request arrived before the input deadline.',
        INPUT_CLOSED: 'The execution client closed its input connection.',
        INPUT_CANCELLED: 'The execution request was interrupted.',
      }[code],
    )
    this.name = 'PrivateAttemptInputError'
  }
}

/**
 * Read the first request without consuming the lifetime of a submit connection.
 * A submit owner watches `closed`; an observer closing this connection owns no work.
 */
export class PrivateAttemptInput {
  readonly closed: AbortSignal
  readonly request: Promise<JsonValue>
  readonly #connection = new AbortController()
  readonly #chunks: Buffer[] = []
  readonly #stream: Readable
  readonly #limit: number
  readonly #signal: AbortSignal | undefined
  readonly #timer: ReturnType<typeof setTimeout>
  #bytes = 0
  #complete = false
  #disposed = false
  #resolve!: (value: JsonValue) => void
  #reject!: (error: PrivateAttemptInputError) => void

  constructor(
    stream: Readable,
    options: {
      readonly signal?: AbortSignal
      readonly maxBytes?: number
      readonly timeoutMs?: number
    } = {},
  ) {
    const maxBytes = options.maxBytes ?? JSON_1_LIMITS.bytes
    const timeoutMs = options.timeoutMs ?? 10_000
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > JSON_1_LIMITS.bytes ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1
    )
      throw new TypeError('invalid execution request input bounds')
    this.#stream = stream
    this.#limit = maxBytes
    this.#signal = options.signal
    this.closed = this.#connection.signal
    this.request = new Promise<JsonValue>((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
    })
    this.#timer = setTimeout(() => this.#fail('INPUT_TIMEOUT'), timeoutMs)
    stream.on('data', this.#data)
    stream.once('end', this.#end)
    stream.once('close', this.#close)
    stream.once('error', this.#error)
    options.signal?.addEventListener('abort', this.#abort, { once: true })
    if (options.signal?.aborted) this.#abort()
    else if (stream.destroyed || stream.readableEnded) this.#end()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    clearTimeout(this.#timer)
    this.#stream.off('data', this.#data)
    this.#stream.off('end', this.#end)
    this.#stream.off('close', this.#close)
    this.#stream.off('error', this.#error)
    this.#signal?.removeEventListener('abort', this.#abort)
    this.#stream.pause()
    this.#erase()
    this.#connection.abort(new PrivateAttemptInputError('INPUT_CANCELLED'))
    if (!this.#complete) {
      this.#complete = true
      this.#reject(new PrivateAttemptInputError('INPUT_CANCELLED'))
    }
  }

  #data = (value: Buffer | string): void => {
    if (this.#disposed || this.closed.aborted) return
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    this.#bytes += chunk.byteLength
    if (this.#bytes > this.#limit) {
      this.#fail('INPUT_LIMIT')
      return
    }
    if (this.#complete) {
      // Request framing is a single line, not an implicit control-message stream.
      if (chunk.some((byte) => byte !== 0x20 && byte !== 0x09 && byte !== 0x0d && byte !== 0x0a))
        this.#fail('INPUT_INVALID')
      return
    }
    const newline = chunk.indexOf(0x0a)
    if (newline < 0) {
      this.#chunks.push(Buffer.from(chunk))
      return
    }
    const remainder = chunk.subarray(newline + 1)
    if (
      remainder.some((byte) => byte !== 0x20 && byte !== 0x09 && byte !== 0x0d && byte !== 0x0a)
    ) {
      this.#fail('INPUT_INVALID')
      return
    }
    this.#chunks.push(Buffer.from(chunk.subarray(0, newline)))
    this.#parse()
  }

  #parse(): void {
    if (this.#complete || this.#disposed) return
    const bytes = Buffer.concat(this.#chunks)
    try {
      const value = decodeJson1(bytes)
      this.#complete = true
      clearTimeout(this.#timer)
      this.#resolve(value)
    } catch {
      this.#fail('INPUT_INVALID')
    } finally {
      bytes.fill(0)
      this.#erase()
    }
  }

  #end = (): void => {
    if (this.#disposed) return
    // Finite non-submit commands can terminate their only request with EOF.
    if (!this.#complete) this.#parse()
    this.#connection.abort(new PrivateAttemptInputError('INPUT_CLOSED'))
  }

  #close = (): void => {
    if (!this.#disposed && !this.#complete) this.#fail('INPUT_CLOSED')
    else if (!this.#disposed) this.#connection.abort(new PrivateAttemptInputError('INPUT_CLOSED'))
  }

  #error = (): void => this.#fail('INPUT_CLOSED')
  #abort = (): void => this.#fail('INPUT_CANCELLED')

  #fail(code: PrivateAttemptInputFailure): void {
    const error = new PrivateAttemptInputError(code)
    if (!this.#complete) {
      this.#complete = true
      this.#reject(error)
    }
    clearTimeout(this.#timer)
    this.#erase()
    this.#connection.abort(error)
  }

  #erase(): void {
    for (const chunk of this.#chunks) chunk.fill(0)
    this.#chunks.length = 0
  }
}
