import type { JsonObject, JsonValue } from '../../json.js'
import { literal, unknown, type Value } from './values.js'

/** Project guarantees from the validated schema without choosing an example input. */
export function inputFromContract(schema: JsonValue | undefined, depth = 0): Value {
  if (!record(schema) || depth >= 4) return unknown
  if (schema.type === 'object') {
    const properties = schema.properties
    const required = new Set(Array.isArray(schema.required) ? schema.required : [])
    const fields = new Map<string, Value>()
    const optionalIntegers = new Map<string, Extract<Value, { kind: 'integer-range' }>>()
    for (const [name, property] of record(properties)
      ? Object.entries(properties).slice(0, 32)
      : []) {
      if (required.has(name)) fields.set(name, inputFromContract(property, depth + 1))
      else {
        // Reading a missing own property of a JSON object can still reach its prototype.
        const value = integerRange(property)
        if (value && !Object.hasOwn(Object.prototype, name))
          optionalIntegers.set(name, { ...value, optional: true })
      }
    }
    return {
      kind: 'object',
      fields,
      open: true,
      ...(optionalIntegers.size ? { optionalIntegers } : {}),
    }
  }
  const choices = schema.enum
  if (
    Array.isArray(choices) &&
    choices.length > 0 &&
    choices.length <= 8 &&
    choices.every((choice): choice is string => typeof choice === 'string')
  )
    return choices.length === 1 ? literal(choices[0]!) : { kind: 'input-string', choices }
  if (schema.type === 'string') return { kind: 'input-string' }
  return integerRange(schema) ?? unknown
}

function record(schema: JsonValue | undefined): schema is JsonObject {
  return schema !== null && typeof schema === 'object' && !Array.isArray(schema)
}

function integerRange(schema: JsonValue | undefined) {
  if (!record(schema) || schema.type !== 'integer') return undefined
  const { minimum, maximum } = schema
  if (
    typeof minimum !== 'number' ||
    typeof maximum !== 'number' ||
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    minimum > maximum
  )
    return undefined
  return { kind: 'integer-range' as const, minimum, maximum }
}
