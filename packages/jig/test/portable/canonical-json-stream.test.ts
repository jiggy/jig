import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  privateCanonicalJsonChunks,
  privateUtf8StringChunks,
} from '../../src/internal/canonical-json-stream.js'
import { canonicalJson, decodeJson1, JSON_1_LIMITS, type JsonValue } from '../../src/json.js'

test('streamed canonical packets preserve ordering, escaping, numbers and scalar boundaries', () => {
  const value: JsonValue = {
    '\u20ac': 1e-7,
    '\ud83d\ude00': -0,
    a: [true, null, '"\\\b\t\n\f\r\u0000é中😀', 'x'.repeat(65_529) + '\u0000'],
  }
  const chunks = [...privateCanonicalJsonChunks(value, true)].map((chunk) => Buffer.from(chunk))
  // Borrowed views are consumed before advancing, as a socket/file writer does.
  const owned: Buffer[] = []
  for (const chunk of privateCanonicalJsonChunks(value, true)) {
    expect(chunk.byteLength).toBeLessThanOrEqual(65_536)
    owned.push(Buffer.from(chunk))
  }
  const result = Buffer.concat(owned)
  expect(result.subarray(0, -1)).toEqual(Buffer.from(canonicalJson(value)))
  expect(result.at(-1)).toBe(10)
  expect(decodeJson1(result)).toEqual({ ...value, '\ud83d\ude00': 0 })
  // A fully advanced generator zeroes its borrowed backing.
  expect(chunks.every((chunk) => chunk.every((byte) => byte === 0))).toBe(true)
})
test('full JSON/0 publication exposes bounded borrowed storage and keeps the portable byte ceiling', () => {
  const value = {
    a: 'a'.repeat(JSON_1_LIMITS.stringBytes),
    b: 'b'.repeat(JSON_1_LIMITS.stringBytes - 17),
  }
  const digest = createHash('sha256').update(canonicalJson(value)).digest('hex')
  const actual = createHash('sha256')
  let total = 0
  let backing: ArrayBufferLike | undefined
  for (const chunk of privateCanonicalJsonChunks(value)) {
    expect(chunk.byteLength).toBeGreaterThan(0)
    expect(chunk.byteLength).toBeLessThanOrEqual(65_536)
    backing ??= chunk.buffer
    expect(chunk.buffer).toBe(backing)
    expect(chunk.buffer.byteLength).toBe(65_536)
    actual.update(chunk)
    total += chunk.byteLength
  }
  expect(total).toBe(JSON_1_LIMITS.bytes - 2)
  expect(actual.digest('hex')).toBe(digest)
  expect(() => privateCanonicalJsonChunks({ ...value, c: 'too large' }).next()).toThrow(
    'maximum encoded bytes',
  )
})
test('invalid values fail before a first byte and early close zeroes borrowed contents', () => {
  expect(() => privateCanonicalJsonChunks({ a: '\ud800' }).next()).toThrow('surrogate')
  const stream = privateCanonicalJsonChunks({ a: 'secret'.repeat(20_000) })
  const first = stream.next().value!
  expect(first.some((byte) => byte !== 0)).toBe(true)
  stream.return(undefined)
  expect(first.every((byte) => byte === 0)).toBe(true)
})
test('checkpoint text encodes scalar pairs across chunk edges without a complete byte copy', () => {
  const text = 'x'.repeat(16_383) + '😀' + '中\n'.repeat(32_000)
  const chunks: Buffer[] = []
  for (const chunk of privateUtf8StringChunks(text)) {
    expect(chunk.byteLength).toBeLessThanOrEqual(65_536)
    chunks.push(Buffer.from(chunk))
  }
  expect(Buffer.concat(chunks).toString('utf8')).toBe(text)
})
