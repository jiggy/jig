import type { JsonValue } from '../../json.js'
import type { LocalFunction } from './source.js'

export type Value =
  | { readonly kind: 'unknown' | 'undefined' | 'context' | 'reporter' | 'report-view' }
  | { readonly kind: 'literal'; readonly value: string | number | boolean | null }
  | { readonly kind: 'object'; readonly fields: ReadonlyMap<string, Value>; readonly open?: true }
  | { readonly kind: 'array'; readonly items: readonly Value[] }
  | { readonly kind: 'path'; readonly suffix: string }
  | { readonly kind: 'function'; readonly node: LocalFunction }

export const unknown: Value = { kind: 'unknown' }
export const missing: Value = { kind: 'undefined' }
export const literal = (value: string | number | boolean | null): Value => ({
  kind: 'literal',
  value,
})
export const object = (entries: Iterable<readonly [string, Value]>, open = false): Value => ({
  kind: 'object',
  fields: new Map(entries),
  ...(open ? { open: true as const } : {}),
})

export function fromJson(value: JsonValue): Value {
  if (value === null || typeof value !== 'object') return literal(value)
  if (Array.isArray(value)) return { kind: 'array', items: value.map(fromJson) }
  return object(Object.entries(value).map(([key, item]) => [key, fromJson(item)]))
}

export function toJson(value: Value): JsonValue | undefined {
  if (value.kind === 'literal')
    return typeof value.value === 'number' && !Number.isFinite(value.value)
      ? undefined
      : value.value
  if (value.kind === 'array') {
    const items = value.items.map(toJson)
    return items.some((item) => item === undefined) ? undefined : (items as JsonValue[])
  }
  if (value.kind !== 'object' || value.open) return undefined
  const entries = []
  for (const [key, field] of value.fields) {
    const item = toJson(field)
    if (item === undefined) return undefined
    entries.push([key, item] as const)
  }
  return Object.fromEntries(entries)
}

export function field(value: Value, name: string): Value {
  if (value.kind === 'object') return value.fields.get(name) ?? (value.open ? unknown : missing)
  if (value.kind === 'array' && name === 'length') return literal(value.items.length)
  if (value.kind === 'array' && /^(0|[1-9][0-9]*)$/.test(name))
    return value.items[Number(name)] ?? missing
  if (value.kind === 'literal' && typeof value.value === 'string' && name === 'length')
    return literal(value.value.length)
  return unknown
}

export function truth(value: Value): boolean | undefined {
  switch (value.kind) {
    case 'unknown':
      return undefined
    case 'undefined':
      return false
    case 'literal':
      return Boolean(value.value)
    default:
      return true
  }
}

export function describe(value: Value): string {
  if (value.kind === 'literal') {
    if (typeof value.value === 'string' && value.value.length > 80) return 'text'
    return JSON.stringify(value.value)
  }
  if (value.kind === 'path') return 'path ending in ' + JSON.stringify(value.suffix)
  if (value.kind === 'undefined') return 'undefined'
  if (value.kind === 'array') return 'array'
  return value.kind
}

export function resultText(value: Value): string {
  const outcome = field(value, 'outcome')
  const output = field(value, 'output')
  const facts = ['outcome ' + describe(outcome)]
  if (output.kind === 'object')
    for (const [name, item] of [...output.fields].slice(0, 5))
      if (item.kind === 'literal' || item.kind === 'object')
        facts.push(name + ' = ' + describe(item))
  const artifacts = field(value, 'artifactResults')
  if (artifacts.kind === 'object')
    for (const name of [...artifacts.fields.keys()].slice(0, 5))
      facts.push('offers artifact ' + name)
  return facts.join(', ')
}
