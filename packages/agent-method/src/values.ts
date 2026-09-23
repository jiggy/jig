import { AgentMethodError, type AgentMethodErrorCode } from './errors.js'
import { canonicalJson, decodeJson1, type JsonValue } from './json.js'

export function ordinaryRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  return value as Record<string, unknown>
}

export function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sorted = [...expected].sort()
  return actual.length === sorted.length && actual.every((name, index) => name === sorted[index])
}

export function sessionReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  )
}

export function validSessionReceipt(value: unknown): boolean {
  const record = ordinaryRecord(value)
  return (
    record !== undefined &&
    ((exactKeys(record, ['status', 'reason']) &&
      record.status === 'unavailable' &&
      ['not-cleanly-closed', 'missing-history', 'unsupported-history', 'capacity'].includes(
        record.reason as string,
      )) ||
      (exactKeys(record, ['status', 'reference']) &&
        record.status === 'retained' &&
        sessionReference(record.reference)))
  )
}

export function snapshot(value: unknown, code: AgentMethodErrorCode): JsonValue {
  try {
    return decodeJson1(canonicalJson(value as JsonValue))
  } catch {
    throw new AgentMethodError(code, 'Agent method values must be ordinary bounded JSON/0 data')
  }
}

export function freezeJson<T extends JsonValue>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child)
    Object.freeze(value)
  }
  return value
}

export function compareUtf8(left: string, right: string): number {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!
  }
  return a.length - b.length
}

export function localName(name: unknown): name is string {
  return typeof name === 'string' && name.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}

export function skillPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    new TextEncoder().encode(path).byteLength <= 4096 &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  )
}
