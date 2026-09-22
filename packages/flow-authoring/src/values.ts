import { fail } from './errors.js'

export function channelReference(path: string): boolean {
  return (
    typeof path === 'string' &&
    Buffer.byteLength(path) <= 1026 &&
    Buffer.from(path).toString('utf8') === path &&
    path.startsWith('./') &&
    path.endsWith('.json') &&
    path.slice(2).split('/').length <= 64 &&
    path
      .slice(2)
      .split('/')
      .every(
        (part) =>
          part.length > 0 &&
          Buffer.byteLength(part) <= 255 &&
          !/[\\\u0000-\u001f\u007f]/.test(part) &&
          part !== '.' &&
          part !== '..',
      )
  )
}

export function checkText(text: string, maxBytes: number): void {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maxBytes) {
    fail('VALUE_LIMIT', 'Text exceeds the authoring byte limit.')
  }
  for (const character of text) {
    const cp = character.codePointAt(0)!
    if (cp >= 0xd800 && cp <= 0xdfff)
      fail('VALUE_INVALID', 'Text contains an isolated Unicode surrogate.')
  }
}

export function encode(value: unknown): string {
  let nodes = 0
  function check(v: unknown, depth: number): void {
    if (++nodes > 262144 || depth > 128) fail('VALUE_LIMIT', 'Output exceeds JSON/1 value limits.')
    if (v === null || typeof v === 'boolean') return
    if (typeof v === 'string') {
      checkText(v, 8388608)
      return
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v))) {
        fail('VALUE_INVALID', 'Output contains a non-JSON/1 number.')
      }
      return
    }
    if (typeof v !== 'object') fail('VALUE_INVALID', 'Output is not a JSON/1 value.')
    if (Array.isArray(v)) {
      if (v.length > 65536) fail('VALUE_LIMIT', 'Output array exceeds JSON/1 limits.')
      for (const member of v) check(member, depth + 1)
    } else {
      const entries = Object.entries(v)
      if (entries.length > 65536) fail('VALUE_LIMIT', 'Output object exceeds JSON/1 limits.')
      for (const [key, member] of entries) {
        checkText(key, 1024)
        check(member, depth + 1)
      }
    }
  }
  check(value, 1)
  const result = JSON.stringify(value, null, 2) + '\n'
  checkText(result, 262144)
  return result
}
