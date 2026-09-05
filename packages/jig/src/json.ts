export type JsonScalar = null | boolean | number | string

export type JsonValue = JsonScalar | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type JsonObject = Readonly<Record<string, JsonValue>>

export const JSON_1_LIMITS = Object.freeze({
  bytes: 16_777_216,
  depth: 128,
  nodes: 262_144,
  containerEntries: 65_536,
  stringBytes: 8_388_608,
  memberNameBytes: 1_024,
  numberTokenBytes: 128,
})

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

export class Json1Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Json1Error'
  }
}

class Parser {
  private position = 0
  private nodes = 0

  constructor(private readonly source: string) {}

  parse(): JsonValue {
    this.skipWhitespace()
    const value = this.parseValue(1)
    this.skipWhitespace()
    if (this.position !== this.source.length) this.fail('unexpected trailing characters')
    return value
  }

  private parseValue(depth: number): JsonValue {
    if (depth > JSON_1_LIMITS.depth) this.fail('maximum value depth exceeded')
    this.nodes += 1
    if (this.nodes > JSON_1_LIMITS.nodes) this.fail('maximum value nodes exceeded')

    const char = this.source[this.position]
    if (char === '"') return this.parseString(false)
    if (char === '{') return this.parseObject(depth)
    if (char === '[') return this.parseArray(depth)
    if (char === 't') return this.parseLiteral('true', true)
    if (char === 'f') return this.parseLiteral('false', false)
    if (char === 'n') return this.parseLiteral('null', null)
    if (char === '-' || (char !== undefined && char >= '0' && char <= '9')) {
      return this.parseNumber()
    }
    return this.fail('expected a JSON value')
  }

  private parseObject(depth: number): JsonObject {
    this.position += 1
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
    const keys = new Set<string>()
    this.skipWhitespace()
    if (this.consume('}')) return result

    let members = 0
    while (true) {
      if (this.source[this.position] !== '"') this.fail('expected an object member name')
      const key = this.parseString(true)
      if (keys.has(key)) this.fail(`duplicate object member ${key}`)
      keys.add(key)
      members += 1
      if (members > JSON_1_LIMITS.containerEntries) {
        this.fail('maximum object members exceeded')
      }
      this.skipWhitespace()
      if (!this.consume(':')) this.fail("expected ':' after member name")
      this.skipWhitespace()
      result[key] = this.parseValue(depth + 1)
      this.skipWhitespace()
      if (this.consume('}')) return result
      if (!this.consume(',')) this.fail("expected ',' or '}'")
      this.skipWhitespace()
    }
  }

  private parseArray(depth: number): readonly JsonValue[] {
    this.position += 1
    const result: JsonValue[] = []
    this.skipWhitespace()
    if (this.consume(']')) return result
    while (true) {
      if (result.length >= JSON_1_LIMITS.containerEntries) {
        this.fail('maximum array items exceeded')
      }
      result.push(this.parseValue(depth + 1))
      this.skipWhitespace()
      if (this.consume(']')) return result
      if (!this.consume(',')) this.fail("expected ',' or ']'")
      this.skipWhitespace()
    }
  }

  private parseString(memberName: boolean): string {
    this.position += 1
    const parts: string[] = []
    let segmentStart = this.position
    while (this.position < this.source.length) {
      const char = this.source[this.position]
      this.position += 1
      if (char === '"') {
        parts.push(this.source.slice(segmentStart, this.position - 1))
        const value = parts.join('')
        const limit = memberName ? JSON_1_LIMITS.memberNameBytes : JSON_1_LIMITS.stringBytes
        if (encoder.encode(value).byteLength > limit) this.fail('maximum string bytes exceeded')
        return value
      }
      if (char === '\\') {
        parts.push(this.source.slice(segmentStart, this.position - 1))
        parts.push(this.parseEscape())
        segmentStart = this.position
        continue
      }
      if (char === undefined || char.charCodeAt(0) <= 0x1f) {
        this.fail('invalid character in string')
      }
      const code = char.charCodeAt(0)
      if (code >= 0xd800 && code <= 0xdfff) {
        const next = this.source[this.position]
        if (
          code > 0xdbff ||
          next === undefined ||
          next.charCodeAt(0) < 0xdc00 ||
          next.charCodeAt(0) > 0xdfff
        )
          this.fail('lone Unicode surrogate')
        this.position += 1
      }
    }
    return this.fail('unterminated string')
  }

  private parseEscape(): string {
    const escape = this.source[this.position]
    this.position += 1
    switch (escape) {
      case '"':
      case '\\':
      case '/':
        return escape
      case 'b':
        return '\b'
      case 'f':
        return '\f'
      case 'n':
        return '\n'
      case 'r':
        return '\r'
      case 't':
        return '\t'
      case 'u': {
        const first = this.parseHexCodeUnit()
        if (first >= 0xd800 && first <= 0xdbff) {
          if (this.source.slice(this.position, this.position + 2) !== '\\u') {
            this.fail('high surrogate without low surrogate')
          }
          this.position += 2
          const second = this.parseHexCodeUnit()
          if (second < 0xdc00 || second > 0xdfff) {
            this.fail('high surrogate without low surrogate')
          }
          return String.fromCharCode(first, second)
        }
        if (first >= 0xdc00 && first <= 0xdfff) this.fail('lone low surrogate')
        return String.fromCharCode(first)
      }
      default:
        return this.fail('invalid string escape')
    }
  }

  private parseHexCodeUnit(): number {
    const token = this.source.slice(this.position, this.position + 4)
    if (!/^[0-9A-Fa-f]{4}$/.test(token)) this.fail('invalid Unicode escape')
    this.position += 4
    return Number.parseInt(token, 16)
  }

  private parseNumber(): number {
    const start = this.position
    this.consume('-')
    if (this.consume('0')) {
      const next = this.source[this.position]
      if (next !== undefined && next >= '0' && next <= '9') {
        this.fail('leading zero in number')
      }
    } else {
      if (!this.consumeDigit('1', '9')) this.fail('invalid number')
      while (this.consumeDigit('0', '9')) {}
    }
    if (this.consume('.')) {
      if (!this.consumeDigit('0', '9')) this.fail('fraction requires a digit')
      while (this.consumeDigit('0', '9')) {}
    }
    const exponent = this.source[this.position]
    if (exponent === 'e' || exponent === 'E') {
      this.position += 1
      const sign = this.source[this.position]
      if (sign === '+' || sign === '-') this.position += 1
      if (!this.consumeDigit('0', '9')) this.fail('exponent requires a digit')
      while (this.consumeDigit('0', '9')) {}
    }
    const token = this.source.slice(start, this.position)
    if (token.length > JSON_1_LIMITS.numberTokenBytes) {
      this.fail('maximum number token bytes exceeded')
    }
    const value = Number(token)
    if (!Number.isFinite(value)) this.fail('non-finite number')
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      this.fail('integral number outside safe range')
    }
    return value
  }

  private parseLiteral<T extends JsonValue>(token: string, value: T): T {
    if (this.source.slice(this.position, this.position + token.length) !== token) {
      this.fail(`invalid literal ${token}`)
    }
    this.position += token.length
    return value
  }

  private consume(expected: string): boolean {
    if (this.source[this.position] !== expected) return false
    this.position += 1
    return true
  }

  private consumeDigit(minimum: string, maximum: string): boolean {
    const char = this.source[this.position]
    if (char === undefined || char < minimum || char > maximum) return false
    this.position += 1
    return true
  }

  private skipWhitespace(): void {
    while (true) {
      const char = this.source[this.position]
      if (char !== ' ' && char !== '\n' && char !== '\r' && char !== '\t') return
      this.position += 1
    }
  }

  private fail(message: string): never {
    throw new Json1Error(`${message} at character ${this.position}`)
  }
}

export function decodeJson1(bytes: Uint8Array): JsonValue {
  if (bytes.byteLength === 0) throw new Json1Error('empty JSON/1 document')
  if (bytes.byteLength > JSON_1_LIMITS.bytes) throw new Json1Error('maximum bytes exceeded')
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Json1Error('UTF-8 BOM is not allowed')
  }
  let text: string
  try {
    text = decoder.decode(bytes)
  } catch {
    throw new Json1Error('invalid UTF-8')
  }
  return new Parser(text).parse()
}

export function validateJson1(value: unknown): asserts value is JsonValue {
  visitJson(value, 1, { nodes: 0, encodedBytes: 0, active: new WeakSet<object>() }, false)
}

interface VisitState {
  nodes: number
  encodedBytes: number
  readonly active: WeakSet<object>
}

function visitJson(value: unknown, depth: number, state: VisitState, memberName: boolean): void {
  if (depth > JSON_1_LIMITS.depth) throw new Json1Error('maximum value depth exceeded')
  state.nodes += 1
  if (state.nodes > JSON_1_LIMITS.nodes) throw new Json1Error('maximum value nodes exceeded')
  if (value === null) {
    chargeEncodedBytes(state, 4)
    return
  }
  if (typeof value === 'boolean') {
    chargeEncodedBytes(state, value ? 4 : 5)
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Json1Error('non-finite number')
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Json1Error('integral number outside safe range')
    }
    chargeEncodedBytes(state, (Object.is(value, -0) ? '0' : JSON.stringify(value)).length)
    return
  }
  if (typeof value === 'string') {
    validateString(value, memberName ? JSON_1_LIMITS.memberNameBytes : JSON_1_LIMITS.stringBytes)
    chargeEncodedBytes(state, encodedJsonStringBytes(value))
    return
  }
  if (typeof value !== 'object') throw new Json1Error('value is not JSON/1')
  if (state.active.has(value)) throw new Json1Error('cyclic value')
  state.active.add(value)
  try {
    if (Array.isArray(value)) {
      if (value.length > JSON_1_LIMITS.containerEntries) {
        throw new Json1Error('maximum array items exceeded')
      }
      chargeEncodedBytes(state, 2 + Math.max(0, value.length - 1))
      for (const child of value) visitJson(child, depth + 1, state, false)
      return
    }
    const object = value as Record<string, unknown>
    const keys = Object.keys(object)
    if (keys.length > JSON_1_LIMITS.containerEntries) {
      throw new Json1Error('maximum object members exceeded')
    }
    chargeEncodedBytes(state, 2 + keys.length + Math.max(0, keys.length - 1))
    for (const key of keys) {
      validateString(key, JSON_1_LIMITS.memberNameBytes)
      chargeEncodedBytes(state, encodedJsonStringBytes(key))
      visitJson(object[key], depth + 1, state, false)
    }
  } finally {
    state.active.delete(value)
  }
}

function chargeEncodedBytes(state: VisitState, bytes: number): void {
  if (bytes > JSON_1_LIMITS.bytes - state.encodedBytes) {
    throw new Json1Error('maximum encoded bytes exceeded')
  }
  state.encodedBytes += bytes
}

function encodedJsonStringBytes(value: string): number {
  return encoder.encode(JSON.stringify(value)).byteLength
}

function validateString(value: string, byteLimit: number): void {
  if (encoder.encode(value).byteLength > byteLimit) {
    throw new Json1Error('maximum string bytes exceeded')
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Json1Error('lone Unicode surrogate')
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Json1Error('lone Unicode surrogate')
    }
  }
}

/** RFC 8785 canonical bytes for an already validated JSON/1 value. */
export function canonicalJson(value: JsonValue): Uint8Array {
  validateJson1(value)
  return encoder.encode(canonicalText(value))
}

function canonicalText(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') return Object.is(value, -0) ? '0' : JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalText).join(',')}]`
  const object = value as JsonObject
  const members = Object.keys(object)
    .sort(compareUtf16)
    .map((key) => `${JSON.stringify(key)}:${canonicalText(object[key]!)}`)
  return `{${members.join(',')}}`
}

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
