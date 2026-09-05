import { describe, expect, test } from 'bun:test'

import { decodeJson, encodeJson, JsonViolation } from '../src/json.ts'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

describe('FLOW JSON/1', () => {
  test('round-trips ordinary values', () => {
    const encoded = encodeJson({ answer: 42, nested: [true, null, '✓'] })
    expect(decodeJson(encoded)).toEqual({
      answer: 42,
      nested: [true, null, '✓'],
    })
  })

  test('rejects duplicate members before object construction', () => {
    expect(() => decodeJson(textEncoder.encode('{"x":1,"x":2}'))).toThrow(JsonViolation)
  })

  test('detects a raw UTF-8 BOM before decoder stripping', () => {
    expect(() =>
      decodeJson(new Uint8Array([0xef, 0xbb, 0xbf, ...textEncoder.encode('{}')])),
    ).toThrow(JsonViolation)
  })

  test('rejects unsafe integral numbers and escaped lone surrogates', () => {
    expect(() => decodeJson(textEncoder.encode('9007199254740992'))).toThrow(JsonViolation)
    expect(() => decodeJson(textEncoder.encode('"\\ud800"'))).toThrow(JsonViolation)
    expect(() => encodeJson('\ud800')).toThrow(JsonViolation)
  })

  test('rejects non-JSON JavaScript values instead of coercing them', () => {
    expect(() => encodeJson({ value: undefined } as never)).toThrow(JsonViolation)
    expect(() => encodeJson(new Date() as never)).toThrow(JsonViolation)
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(() => encodeJson(cyclic as never)).toThrow(JsonViolation)
  })

  test('normalizes negative zero through JSON encoding', () => {
    expect(textDecoder.decode(encodeJson(-0))).toBe('0')
  })

  test('preserves escaped text and supplementary Unicode', () => {
    const value = 'before\n😀\tafter'
    expect(decodeJson(encodeJson(value))).toBe(value)
  })
})
