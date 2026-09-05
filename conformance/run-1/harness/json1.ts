const MAX_FRAME_BYTES = 16_777_216
const MAX_DEPTH = 128
const MAX_NODES = 262_144
const MAX_CONTAINER_ITEMS = 65_536
const MAX_STRING_BYTES = 8_388_608
const MAX_NAME_BYTES = 1_024
const MAX_NUMBER_BYTES = 128

const utf8 = new TextEncoder()
const fatalUtf8 = new TextDecoder('utf-8', { fatal: true })

export class Json1Error extends Error {}

export function parseFrame(frame: Uint8Array): unknown {
  if (frame.byteLength === 0 || frame.at(-1) !== 0x0a) {
    throw new Json1Error('frame is not LF-terminated')
  }

  const payload = frame.subarray(0, -1)
  if (payload.byteLength === 0) {
    throw new Json1Error('empty frame')
  }
  if (payload.byteLength > MAX_FRAME_BYTES) {
    throw new Json1Error('oversized frame')
  }
  if (payload[0] === 0xef && payload[1] === 0xbb && payload[2] === 0xbf) {
    throw new Json1Error('UTF-8 BOM is forbidden')
  }
  if (payload.includes(0x0a)) {
    throw new Json1Error('frame contains an earlier LF delimiter')
  }

  let text: string
  try {
    text = fatalUtf8.decode(payload)
  } catch {
    throw new Json1Error('invalid UTF-8')
  }

  return new Parser(text).parse()
}

class Parser {
  private index = 0
  private nodes = 0

  constructor(private readonly source: string) {}

  parse(): unknown {
    this.skipSpace()
    const value = this.value(1)
    this.skipSpace()
    if (this.index !== this.source.length) {
      throw new Json1Error('trailing JSON data')
    }
    return value
  }

  private value(depth: number): unknown {
    if (depth > MAX_DEPTH) {
      throw new Json1Error('JSON/1 depth limit exceeded')
    }
    this.nodes += 1
    if (this.nodes > MAX_NODES) {
      throw new Json1Error('JSON/1 node limit exceeded')
    }

    const token = this.source[this.index]
    if (token === '{') return this.object(depth)
    if (token === '[') return this.array(depth)
    if (token === '"') return this.string(false)
    if (token === 't') return this.literal('true', true)
    if (token === 'f') return this.literal('false', false)
    if (token === 'n') return this.literal('null', null)
    if (token === '-' || (token >= '0' && token <= '9')) {
      return this.number()
    }
    throw new Json1Error('invalid JSON value')
  }

  private object(depth: number): Record<string, unknown> {
    this.index += 1
    this.skipSpace()
    const result: Record<string, unknown> = Object.create(null)
    const names = new Set<string>()
    let count = 0

    if (this.take('}')) return result
    while (true) {
      if (this.source[this.index] !== '"') {
        throw new Json1Error('object member name must be a string')
      }
      const name = this.string(true)
      if (names.has(name)) throw new Json1Error('duplicate object member')
      names.add(name)
      count += 1
      if (count > MAX_CONTAINER_ITEMS) {
        throw new Json1Error('object member limit exceeded')
      }
      this.skipSpace()
      if (!this.take(':')) throw new Json1Error('missing object colon')
      this.skipSpace()
      result[name] = this.value(depth + 1)
      this.skipSpace()
      if (this.take('}')) return result
      if (!this.take(',')) throw new Json1Error('missing object comma')
      this.skipSpace()
    }
  }

  private array(depth: number): unknown[] {
    this.index += 1
    this.skipSpace()
    const result: unknown[] = []
    if (this.take(']')) return result

    while (true) {
      if (result.length >= MAX_CONTAINER_ITEMS) {
        throw new Json1Error('array item limit exceeded')
      }
      result.push(this.value(depth + 1))
      this.skipSpace()
      if (this.take(']')) return result
      if (!this.take(',')) throw new Json1Error('missing array comma')
      this.skipSpace()
    }
  }

  private string(memberName: boolean): string {
    const start = this.index
    this.index += 1
    let escaped = false

    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index)
      if (!escaped && code === 0x22) {
        this.index += 1
        const token = this.source.slice(start, this.index)
        let value: string
        try {
          value = JSON.parse(token)
        } catch {
          throw new Json1Error('invalid JSON string')
        }
        assertScalarString(value)
        const bytes = utf8.encode(value).byteLength
        const limit = memberName ? MAX_NAME_BYTES : MAX_STRING_BYTES
        if (bytes > limit) throw new Json1Error('JSON/1 string limit exceeded')
        return value
      }
      if (!escaped && code < 0x20) {
        throw new Json1Error('unescaped control character')
      }
      if (!escaped && code === 0x5c) {
        escaped = true
      } else {
        escaped = false
      }
      this.index += 1
    }
    throw new Json1Error('unterminated JSON string')
  }

  private number(): number {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      this.source.slice(this.index),
    )
    if (!match) throw new Json1Error('invalid JSON number')
    const token = match[0]
    if (utf8.encode(token).byteLength > MAX_NUMBER_BYTES) {
      throw new Json1Error('number token limit exceeded')
    }
    this.index += token.length
    const value = Number(token)
    if (!Number.isFinite(value)) throw new Json1Error('non-finite number')
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Json1Error('unsafe integral number')
    }
    return value
  }

  private literal<T>(source: string, value: T): T {
    if (!this.source.startsWith(source, this.index)) {
      throw new Json1Error('invalid JSON literal')
    }
    this.index += source.length
    return value
  }

  private skipSpace(): void {
    while (/^[\u0009\u000a\u000d\u0020]$/.test(this.source[this.index] ?? '')) {
      this.index += 1
    }
  }

  private take(character: string): boolean {
    if (this.source[this.index] !== character) return false
    this.index += 1
    return true
  }
}

function assertScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Json1Error('lone high surrogate')
      }
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Json1Error('lone low surrogate')
    }
  }
}
