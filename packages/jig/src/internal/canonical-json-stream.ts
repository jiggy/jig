import { type JsonValue, validateJson1 } from '../json.js'
import { PRIVATE_CAPTURE_CHUNK_BYTES } from './file-input-policy.js'

type Token = { readonly text: string; readonly quoted: boolean }
const SHORT_ESCAPE: Readonly<Record<number, number>> = { 8: 98, 9: 116, 10: 110, 12: 102, 13: 114 }

/** Canonical JSON/0 using one borrowed 64 KiB buffer. Finish the write before
 * advancing; the next iteration overwrites the previous view. Validation runs
 * before the first byte, and close/throw zeroes the buffer. */
export function* privateCanonicalJsonChunks(
  value: JsonValue,
  newline = false,
): Generator<Uint8Array> {
  validateJson1(value)
  const buffer = Buffer.alloc(PRIVATE_CAPTURE_CHUNK_BYTES)
  let offset = 0
  try {
    for (const token of tokens(value)) {
      if (token.quoted) buffer[offset++] = 34
      for (let index = 0; index < token.text.length; index++) {
        // One Unicode scalar or JSON escape needs at most six bytes.
        if (offset > buffer.length - 6) {
          yield buffer.subarray(0, offset)
          offset = 0
        }
        const code = token.text.charCodeAt(index)
        if (token.quoted && (code === 34 || code === 92)) {
          buffer[offset++] = 92
          buffer[offset++] = code
        } else if (token.quoted && code < 32) {
          buffer[offset++] = 92
          const escape = SHORT_ESCAPE[code]
          if (escape !== undefined) buffer[offset++] = escape
          else {
            buffer[offset++] = 117
            buffer[offset++] = 48
            buffer[offset++] = 48
            buffer[offset++] = '0123456789abcdef'.charCodeAt(code >> 4)
            buffer[offset++] = '0123456789abcdef'.charCodeAt(code & 15)
          }
        } else if (code < 128) buffer[offset++] = code
        else if (code < 2048) {
          buffer[offset++] = 0xc0 | (code >> 6)
          buffer[offset++] = 0x80 | (code & 63)
        } else if (code >= 0xd800 && code <= 0xdbff) {
          const scalar = 0x10000 + ((code - 0xd800) << 10) + token.text.charCodeAt(++index) - 0xdc00
          buffer[offset++] = 0xf0 | (scalar >> 18)
          buffer[offset++] = 0x80 | ((scalar >> 12) & 63)
          buffer[offset++] = 0x80 | ((scalar >> 6) & 63)
          buffer[offset++] = 0x80 | (scalar & 63)
        } else {
          buffer[offset++] = 0xe0 | (code >> 12)
          buffer[offset++] = 0x80 | ((code >> 6) & 63)
          buffer[offset++] = 0x80 | (code & 63)
        }
      }
      if (token.quoted) {
        if (offset === buffer.length) {
          yield buffer.subarray(0, offset)
          offset = 0
        }
        buffer[offset++] = 34
      }
      if (offset > buffer.length - 6) {
        yield buffer.subarray(0, offset)
        offset = 0
      }
    }
    if (newline) buffer[offset++] = 10
    if (offset !== 0) yield buffer.subarray(0, offset)
  } finally {
    buffer.fill(0)
  }
}

function* tokens(value: JsonValue): Generator<Token> {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    yield { text: Object.is(value, -0) ? '0' : JSON.stringify(value), quoted: false }
    return
  }
  if (typeof value === 'string') {
    yield { text: value, quoted: true }
    return
  }
  if (Array.isArray(value)) {
    yield { text: '[', quoted: false }
    for (let index = 0; index < value.length; index++) {
      if (index !== 0) yield { text: ',', quoted: false }
      yield* tokens(value[index]!)
    }
    yield { text: ']', quoted: false }
    return
  }
  yield { text: '{', quoted: false }
  const record = value as Record<string, JsonValue>
  const keys = Object.keys(record).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  for (let index = 0; index < keys.length; index++) {
    if (index !== 0) yield { text: ',', quoted: false }
    const key = keys[index]!
    yield { text: key, quoted: true }
    yield { text: ':', quoted: false }
    yield* tokens(record[key]!)
  }
  yield { text: '}', quoted: false }
}

/** Borrow bounded UTF-8 bytes from an already validated immutable JSON string.
 * Checkpoint text uses this path instead of allocating a full encoded copy. */
export function* privateUtf8StringChunks(text: string): Generator<Uint8Array> {
  const buffer = Buffer.alloc(PRIVATE_CAPTURE_CHUNK_BYTES)
  const encoder = new TextEncoder()
  try {
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + 16_384, text.length)
      const last = text.charCodeAt(end - 1)
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--
      const part = text.slice(start, end)
      const encoded = encoder.encodeInto(part, buffer)
      if (encoded.read !== part.length) throw new Error('bounded UTF-8 encoder made no progress')
      yield buffer.subarray(0, encoded.written)
      start = end
    }
  } finally {
    buffer.fill(0)
  }
}
