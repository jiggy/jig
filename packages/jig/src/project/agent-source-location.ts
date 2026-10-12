export interface PrivateAgentSourceLocation {
  readonly path: string
  readonly line?: number
  readonly column?: number
  readonly kind: 'client-literal' | 'selection-context' | 'unlocated'
}

interface Token {
  readonly kind: 'word' | 'string' | 'number' | 'punctuation'
  readonly value?: string | undefined
  readonly offset: number
  readonly line: number
  readonly column: number
}

interface Source {
  readonly text: string
  readonly tokens: readonly Token[]
  readonly closes: ReadonlyMap<number, number>
}

interface Property {
  readonly start: number
  readonly end: number
}

const MAX_TOKENS = 32768
const MAX_DEPTH = 64
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** Inspect captured bytes only. The caller supplies normalized selected slot clients. */
export function privateAgentSourceLocations(
  path: string,
  bytes: Uint8Array,
  expectedAcpSlotClients: Readonly<Record<string, string>>,
): Readonly<Record<string, PrivateAgentSourceLocation>> {
  const result: Record<string, PrivateAgentSourceLocation> = Object.create(null)
  for (const slot of Object.keys(expectedAcpSlotClients)) result[slot] = unlocated(path)
  const source = scan(bytes, false)
  if (source === undefined) return Object.freeze(result)
  const { tokens, closes } = source
  const defaults: number[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    if (word(tokens[index], 'export') && word(tokens[index + 1], 'default')) defaults.push(index)
    if (closes.has(index)) index = closes.get(index)!
  }
  if (defaults.length !== 1) return Object.freeze(result)
  const declaration = defaults[0]!
  const call = declaration + 3
  if (!word(tokens[declaration + 2], 'defineBinding') || !punctuation(tokens[call], '('))
    return Object.freeze(result)
  const end = closes.get(call)
  const bindingStart = call + 1
  const bindingEnd = closes.get(bindingStart)
  if (end === undefined || bindingEnd === undefined) return Object.freeze(result)
  const binding = properties(source, bindingStart, bindingEnd)
  const slotsProperty = binding?.get('slots')
  if (slotsProperty === undefined) return Object.freeze(result)
  const slots = properties(source, slotsProperty.start, slotsProperty.end)
  if (slots === undefined) return Object.freeze(result)

  // Even context must originate in a call to the ordinary trusted import. A local
  // lookalike can ignore this argument, so uncertain module prefixes stay unlocated.
  const prefix = tokens.slice(0, declaration)
  const importSemicolon = punctuation(prefix.at(-1), ';')
  if (importSemicolon) prefix.pop()
  const imported =
    prefix.length === 6 &&
    word(prefix[0], 'import') &&
    punctuation(prefix[1], '{') &&
    word(prefix[2], 'defineBinding') &&
    punctuation(prefix[3], '}') &&
    word(prefix[4], 'from') &&
    prefix[5]?.kind === 'string' &&
    prefix[5].value === '@jigging/jig' &&
    (importSemicolon ||
      /[\r\n\u2028\u2029]/.test(
        source.text.slice(
          prefix[5].offset + prefix[5].value.length + 2,
          tokens[declaration]!.offset,
        ),
      ))
  if (!imported) return Object.freeze(result)
  const singleArgument =
    bindingEnd + 1 === end || (bindingEnd + 2 === end && punctuation(tokens[bindingEnd + 1], ','))
  const complete =
    end + 1 === tokens.length || (end + 2 === tokens.length && punctuation(tokens[end + 1], ';'))
  if (!singleArgument || !complete) return Object.freeze(result)
  const proven = literal(source, bindingStart, bindingEnd)

  for (const [slot, expectedClient] of Object.entries(expectedAcpSlotClients)) {
    const selection = slots.get(slot)
    if (selection === undefined) continue
    result[slot] = located(path, source, selection.start, 'selection-context')
    if (!proven) continue
    const policy = properties(source, selection.start, selection.end)
    const kind = policy?.get('kind')
    const client = policy?.get('client')
    if (
      kind !== undefined &&
      stringValue(source, kind) === 'acp' &&
      client !== undefined &&
      stringValue(source, client) === expectedClient
    )
      result[slot] = located(path, source, client.start, 'client-literal')
  }
  return Object.freeze(result)
}

/** Locate a named policy's client in captured valid JSON, rejecting duplicate keys. */
export function privateAgentGrantSourceLocation(
  path: string,
  bytes: Uint8Array,
  expectedClient: string,
): PrivateAgentSourceLocation {
  const source = scan(bytes, true)
  if (source === undefined) return unlocated(path)
  try {
    const value = JSON.parse(source.text)
    if (value?.kind !== 'acp' || value.client !== expectedClient) return unlocated(path)
  } catch {
    return unlocated(path)
  }
  const policy = properties(source, 0, source.tokens.length - 1)
  const client = policy?.get('client')
  if (client === undefined || !literal(source, 0, source.tokens.length - 1)) return unlocated(path)
  return located(path, source, client.start, 'client-literal')
}

function unlocated(path: string): PrivateAgentSourceLocation {
  return Object.freeze({ path, kind: 'unlocated' })
}

function located(
  path: string,
  source: Source,
  index: number,
  kind: 'client-literal' | 'selection-context',
): PrivateAgentSourceLocation {
  const { line, column } = source.tokens[index]!
  return Object.freeze({ path, line, column, kind })
}

function stringValue(source: Source, property: Property): string | undefined {
  const token = source.tokens[property.start]
  return property.start === property.end && token?.kind === 'string' ? token.value : undefined
}

function word(token: Token | undefined, value: string): boolean {
  return token?.kind === 'word' && token.value === value
}

function punctuation(token: Token | undefined, value: string): boolean {
  return token?.kind === 'punctuation' && token.value === value
}

function properties(source: Source, start: number, end: number): Map<string, Property> | undefined {
  if (!punctuation(source.tokens[start], '{') || source.closes.get(start) !== end) return undefined
  const parts = elements(source, start + 1, end)
  if (parts === undefined) return undefined
  const result = new Map<string, Property>()
  for (const part of parts) {
    const key = source.tokens[part.start]
    if (
      (key?.kind !== 'word' && key?.kind !== 'string') ||
      key.value === undefined ||
      key.value === '__proto__' ||
      result.has(key.value) ||
      !punctuation(source.tokens[part.start + 1], ':') ||
      part.start + 2 > part.end
    )
      return undefined
    result.set(key.value, { start: part.start + 2, end: part.end })
  }
  return result
}

function elements(source: Source, start: number, end: number): Property[] | undefined {
  const result: Property[] = []
  let beginning = start
  for (let index = start; index < end; index += 1) {
    if (punctuation(source.tokens[index], ',')) {
      if (index === beginning) return undefined
      result.push({ start: beginning, end: index - 1 })
      beginning = index + 1
    } else if (source.closes.has(index)) index = source.closes.get(index)!
  }
  if (beginning < end) result.push({ start: beginning, end: end - 1 })
  return result
}

function literal(source: Source, start: number, end: number): boolean {
  const token = source.tokens[start]
  if (start === end)
    return (
      (token?.kind === 'string' && token.value !== undefined) ||
      token?.kind === 'number' ||
      ['true', 'false', 'null'].some((value) => word(token, value))
    )
  if (punctuation(token, '-') && start + 1 === end) return source.tokens[end]?.kind === 'number'
  if (punctuation(token, '{')) {
    const object = properties(source, start, end)
    return (
      object !== undefined &&
      [...object.values()].every((part) => literal(source, part.start, part.end))
    )
  }
  if (punctuation(token, '[') && source.closes.get(start) === end) {
    const array = elements(source, start + 1, end)
    return array !== undefined && array.every((part) => literal(source, part.start, part.end))
  }
  return false
}

function scan(bytes: Uint8Array, json: boolean): Source | undefined {
  if (bytes.byteLength > (json ? 32768 : 1024 * 1024)) return undefined
  let text: string
  try {
    text = decoder.decode(bytes)
  } catch {
    return undefined
  }
  const tokens: Token[] = []
  const closes = new Map<number, number>()
  const stack: number[] = []
  const identifier = /[A-Za-z_$][A-Za-z0-9_$]*/y
  const number = /(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y
  let position = 0
  let line = 1
  let column = 1
  // One-based Unicode-scalar coordinates, computed once over bounded captured text.
  function coordinates(offset: number) {
    while (position < offset) {
      const code = text.codePointAt(position)!
      position += code > 0xffff ? 2 : 1
      if (code === 13) {
        if (text[position] === '\n') position += 1
        line += 1
        column = 1
      } else if (code === 10 || code === 0x2028 || code === 0x2029) {
        line += 1
        column = 1
      } else column += 1
    }
    return { line, column }
  }
  let index = 0
  while (index < text.length) {
    if (/\s/.test(text[index]!)) {
      index += 1
      continue
    }
    if (!json && text.startsWith('//', index)) {
      while (index < text.length && !/[\r\n\u2028\u2029]/.test(text[index]!)) index += 1
      continue
    }
    if (!json && text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2)
      if (end === -1) return undefined
      index = end + 2
      continue
    }
    const offset = index
    const location = coordinates(offset)
    const quote = text[index]
    let token: Token
    if (quote === '"' || quote === "'") {
      if (json && quote !== '"') return undefined
      let escaped = false
      index += 1
      while (index < text.length && text[index] !== quote) {
        if (text[index] === '\\') {
          escaped = true
          index += 2
        } else if (/[\r\n]/.test(text[index]!)) return undefined
        else index += 1
      }
      if (index >= text.length) return undefined
      index += 1
      let value: string | undefined
      try {
        value = json
          ? JSON.parse(text.slice(offset, index))
          : escaped
            ? undefined
            : text.slice(offset + 1, index - 1)
      } catch {
        return undefined
      }
      token = { kind: 'string', value, offset, ...location }
    } else {
      identifier.lastIndex = index
      number.lastIndex = index
      const name = identifier.exec(text)
      const numeric = name === null ? number.exec(text) : null
      if (name !== null || numeric !== null) {
        const value = (name ?? numeric)![0]
        token = { kind: name === null ? 'number' : 'word', value, offset, ...location }
        index += value.length
      } else {
        if (!'{}[]():,;.-+=>!?*'.includes(quote!)) return undefined
        token = { kind: 'punctuation', value: quote, offset, ...location }
        index += 1
      }
    }
    if (tokens.length >= MAX_TOKENS) return undefined
    const position = tokens.length
    tokens.push(token)
    if (token.kind !== 'punctuation') continue
    if ('{[('.includes(token.value!)) {
      stack.push(position)
      if (stack.length > MAX_DEPTH) return undefined
    } else if ('}])'.includes(token.value!)) {
      const opening = stack.pop()
      if (
        opening === undefined ||
        '{[('.indexOf(tokens[opening]!.value!) !== '}])'.indexOf(token.value!)
      )
        return undefined
      closes.set(opening, position)
    }
  }
  return stack.length === 0 ? { text, tokens, closes } : undefined
}
