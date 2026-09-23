import { validateJson1, type JsonObject, type JsonValue } from '../json.js'

export function snapshotJsonObject(value: unknown, label: string): JsonObject {
  const snapshot = snapshotJson(value, label)
  validateJson1(snapshot)
  return expectJsonObject(snapshot, label)
}

export function expectJsonObject(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as JsonObject
}

export function snapshotJson(
  value: unknown,
  label: string,
  active: WeakSet<object> = new WeakSet<object>(),
): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new TypeError(`${label} contains an invalid JSON/0 number`)
    }
    return value
  }
  if (typeof value !== 'object') throw new TypeError(`${label} contains a non-JSON value`)
  if (active.has(value)) throw new TypeError(`${label} contains a cycle`)
  active.add(value)
  try {
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key === 'symbol')) {
      throw new TypeError(`${label} contains a symbol property`)
    }
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError(`${label} contains an array subclass`)
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
      if (lengthDescriptor === undefined || !('value' in lengthDescriptor)) {
        throw new TypeError(`${label} has an invalid array length`)
      }
      const length = lengthDescriptor.value as number
      if (keys.length !== length + 1) {
        throw new TypeError(`${label} contains a sparse or extended array`)
      }
      const output: JsonValue[] = []
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
          throw new TypeError(`${label} contains a sparse or accessor-backed array`)
        }
        output.push(snapshotJson(descriptor.value, label, active))
      }
      return Object.freeze(output)
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} contains a non-plain object`)
    }
    const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
        throw new TypeError(`${label} contains an accessor or hidden property`)
      }
      Object.defineProperty(output, key, {
        value: snapshotJson(descriptor.value, label, active),
        enumerable: true,
        writable: false,
        configurable: false,
      })
    }
    return Object.freeze(output)
  } finally {
    active.delete(value)
  }
}
