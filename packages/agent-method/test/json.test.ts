import { describe, expect, test } from 'bun:test'

import {
  canonicalJson,
  decodeJson1,
  JSON_1_LIMITS,
  type JsonValue,
  validateJson1,
} from '../src/json.js'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('local complete JSON/1 codec', () => {
  test('decodes and canonicalizes portable scalars, magic names and Unicode', () => {
    const value = decodeJson1(bytes('{"__proto__":1,"z":-0,"a":[true,false,null,"😀",1.25]}'))
    expect(Object.getPrototypeOf(value)).toBeNull()
    expect(new TextDecoder().decode(canonicalJson(value))).toBe(
      '{"__proto__":1,"a":[true,false,null,"😀",1.25],"z":0}',
    )
    expect(decodeJson1(bytes('9007199254740991'))).toBe(Number.MAX_SAFE_INTEGER)
    expect(Object.is(decodeJson1(bytes('-0')), -0)).toBe(true)
  })

  test('rejects duplicate keys, non-JSON syntax and out-of-domain numbers', () => {
    for (const text of [
      '',
      '{"a":1,"\\u0061":2}',
      '01',
      '+1',
      '.1',
      '1.',
      '1e',
      'NaN',
      '1e400',
      '9007199254740993',
      '-9007199254740992',
      'true false',
      '[1,]',
      '{"a":1,}',
      '"\\ud800"',
      '"\\udc00"',
      '\ufeff{}',
    ]) {
      expect(() => decodeJson1(bytes(text))).toThrow()
    }
    expect(() => decodeJson1(Uint8Array.from([0x22, 0xc0, 0xaf, 0x22]))).toThrow('UTF-8')
  })

  test('rejects encoded document, depth, node, container, key, string and token overflow', () => {
    expect(() => decodeJson1(new Uint8Array(JSON_1_LIMITS.bytes + 1))).toThrow()
    expect(() => decodeJson1(bytes('['.repeat(128) + '0' + ']'.repeat(128)))).toThrow('depth')
    expect(() => validateJson1(Array(65_537).fill(0))).toThrow('array items')
    expect(() => validateJson1(Array.from({ length: 4 }, () => Array(65_536).fill(0)))).toThrow(
      'nodes',
    )
    expect(() => validateJson1({ ['a'.repeat(1025)]: 0 })).toThrow('string bytes')
    expect(() => validateJson1('a'.repeat(8_388_609))).toThrow('string bytes')
    expect(() => decodeJson1(bytes(`0.${'0'.repeat(128)}1`))).toThrow('number token')
    expect(() => validateJson1(['\0'.repeat(3_000_000)])).toThrow('encoded bytes')
  })

  test('checks ordinary host data without invoking accessors or serialization hooks', () => {
    let called = false
    const object = {
      get value() {
        called = true
        return 'unsafe'
      },
    }
    expect(() => validateJson1(object)).toThrow()
    expect(called).toBe(false)
    const cycle: JsonValue[] = []
    cycle.push(cycle)
    for (const value of [
      cycle,
      new Date(),
      new Map(),
      undefined,
      Infinity,
      NaN,
      '\udfff',
      new Array(1),
      { [Symbol('hidden')]: 1 },
    ]) {
      expect(() => validateJson1(value)).toThrow()
    }
  })
})
