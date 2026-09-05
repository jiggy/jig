import { types as utilTypes } from 'node:util'

import { canonicalJson, decodeJson1, Json1Error, type JsonObject, type JsonValue } from '../json.js'

export function snapshotPrivateOrdinaryJson(
  value: unknown,
  label: string,
  invalid: (message: string) => Error,
): JsonValue {
  const ordinary = cloneOrdinaryJson(value, label, invalid, new Set())
  let cloned: JsonValue
  try {
    cloned = decodeJson1(canonicalJson(ordinary))
  } catch (error) {
    if (error instanceof Json1Error) throw invalid(`${label} is not valid JSON/1: ${error.message}`)
    throw error
  }
  deepFreeze(cloned)
  return cloned
}

function cloneOrdinaryJson(
  value: unknown,
  label: string,
  invalid: (message: string) => Error,
  ancestors: Set<object>,
): JsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    return value
  }
  if (typeof value !== 'object' || utilTypes.isProxy(value)) {
    throw invalid(`${label} must be ordinary JSON/1 data`)
  }
  if (ancestors.has(value)) {
    throw invalid(`${label} must not contain a cycle`)
  }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw invalid(`${label} must use ordinary arrays`)
      }
      const keys = Reflect.ownKeys(value)
      if (
        keys.length !== value.length + 1 ||
        keys.some(
          (key) =>
            typeof key !== 'string' || (key !== 'length' && !/^(?:0|[1-9][0-9]*)$/.test(key)),
        )
      ) {
        throw invalid(`${label} must not use sparse or extended arrays`)
      }
      const result: JsonValue[] = []
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
          throw invalid(`${label} must not use array accessors`)
        }
        result.push(cloneOrdinaryJson(descriptor.value, `${label}[${index}]`, invalid, ancestors))
      }
      return result
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalid(`${label} must use ordinary objects`)
    }
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        throw invalid(`${label} must not contain symbol properties`)
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
        throw invalid(`${label} must contain enumerable data properties`)
      }
      result[key] = cloneOrdinaryJson(descriptor.value, `${label}.${key}`, invalid, ancestors)
    }
    return result
  } finally {
    ancestors.delete(value)
  }
}

function deepFreeze(value: JsonValue): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return
  if (Array.isArray(value)) {
    for (const child of value) deepFreeze(child)
  } else {
    for (const child of Object.values(value as JsonObject)) deepFreeze(child)
  }
  Object.freeze(value)
}
