import type { JsonValue } from '../../json.js'
import type { BehaviorReturn } from './model.js'
import type { ErrorClass, LocalFunction } from './source.js'

export type FileHandleValue = { readonly kind: 'file-handle'; readonly path: string }

export type Value =
  | FileHandleValue
  | { readonly kind: 'file-stat' }
  | { readonly kind: 'file-bytes' | 'decoded-text' | 'strict-utf8-decoder' }
  | { readonly kind: 'unknown' | 'undefined' | 'context' | 'reporter' | 'report-view' }
  | { readonly kind: 'literal'; readonly value: string | number | boolean | null }
  | { readonly kind: 'object'; readonly fields: ReadonlyMap<string, Value>; readonly open?: true }
  | { readonly kind: 'array' | 'set'; readonly items: readonly Value[] }
  | { readonly kind: 'path'; readonly suffix: string }
  | { readonly kind: 'function'; readonly node: LocalFunction }
  | { readonly kind: 'error'; readonly type: ErrorClass; readonly message: Value }

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
  if (value.kind === 'error' && name === 'message') return value.message
  if (value.kind === 'object') return value.fields.get(name) ?? (value.open ? unknown : missing)
  if (value.kind === 'array' && name === 'length') return literal(value.items.length)
  if (value.kind === 'set' && name === 'size') return literal(value.items.length)
  if (value.kind === 'array' && /^(0|[1-9][0-9]*)$/.test(name))
    return value.items[Number(name)] ?? missing
  if (value.kind === 'literal' && typeof value.value === 'string' && name === 'length')
    return literal(value.value.length)
  return unknown
}

export function truth(value: Value): boolean | undefined {
  switch (value.kind) {
    case 'unknown':
    case 'decoded-text':
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

export function returnFacts(value: Value): BehaviorReturn {
  const output = field(value, 'output')
  const fields: [string, string][] = []
  if (output.kind === 'object')
    for (const [name, item] of [...output.fields].slice(0, 5))
      if (item.kind === 'literal' || item.kind === 'object') fields.push([name, describe(item)])
  const artifacts = field(value, 'artifactResults')
  return {
    outcome: describe(field(value, 'outcome')),
    fields,
    artifacts: artifacts.kind === 'object' ? [...artifacts.fields.keys()].slice(0, 5) : [],
  }
}

export function inputFacts(value: Value): string {
  if (value.kind !== 'object') return describe(value)
  const facts = [...value.fields].filter(([, field]) => field.kind !== 'unknown')
  const listed = facts
    .slice(0, 5)
    .map(
      ([name, field]) =>
        (name.length <= 72 ? name : name.slice(0, 69) + '…') + ' = ' + describe(field),
    )
  return (
    [
      ...listed,
      ...(value.open || value.fields.size > listed.length
        ? ['other fields unknown or omitted']
        : []),
    ].join(' · ') || 'empty object'
  )
}

export function resultText(value: Value): string {
  const { outcome, fields, artifacts } = returnFacts(value)
  return [
    'outcome ' + outcome,
    ...fields.map(([name, result]) => name + ' = ' + result),
    ...artifacts.map((name) => 'offers artifact ' + name),
  ].join(', ')
}
