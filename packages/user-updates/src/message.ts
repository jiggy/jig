import { createHash } from 'node:crypto'
import descriptor from './user-updates.json' with { type: 'json' }

export type Progress = Readonly<{ completed: number; total?: number; unit?: string }>
export type UserUpdate =
  | Readonly<{ kind: 'notice'; text: string }>
  | Readonly<{ kind: 'activity'; id: string; label: string; progress?: Progress }>
  | Readonly<{ kind: 'clear'; id: string }>

/** Canonical JSON for the closed profile and its descriptor (all keys are ASCII). */
export function canonicalUserUpdate(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalUserUpdate).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalUserUpdate((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`
  return JSON.stringify(value)
}

export const USER_UPDATES_CONTRACT = Object.freeze({
  id: descriptor.id,
  version: descriptor.version,
  digest: `sha256:${createHash('sha256').update('FLOW-Channel-Contract/0\0').update(canonicalUserUpdate(descriptor)).digest('hex')}`,
})

export const USER_UPDATES_LIMITS = Object.freeze({
  itemBytes: 32_768,
  retainedItems: 16,
  retainedBytes: 262_144,
  attempts: 4096,
  trafficBytes: 4_194_304,
  notices: 128,
  noticeBytes: 524_288,
  slots: 16,
  intervalMs: 200,
  sendWaitMs: 500,
  drainMs: 500,
})

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('User update must be an object')
  const proto = Object.getPrototypeOf(value)
  if (proto !== null && proto !== Object.prototype)
    throw new TypeError('User update must be a plain object')
  const copy: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (
      typeof key !== 'string' ||
      !fields.includes(key) ||
      !property?.enumerable ||
      !('value' in property)
    )
      throw new TypeError('Unknown or non-data user update field')
    copy[key] = property.value
  }
  return copy
}

function text(value: unknown, maximum: number, singleLine = false): string {
  if (
    typeof value !== 'string' ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  )
    throw new TypeError('User update text must contain Unicode scalars')
  const length = [...value].length
  if (length < 1 || length > maximum || (singleLine && /[\r\n\u2028\u2029]/u.test(value)))
    throw new TypeError('User update text exceeds its length or line limits')
  return value
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError('User update count must be a safe nonnegative integer')
  return value
}

/** Validate unknown input and return a private immutable snapshot. */
export function validateUserUpdate(value: unknown): UserUpdate {
  const root = record(value, ['kind', 'text', 'id', 'label', 'progress'])
  let result: UserUpdate
  switch (root.kind) {
    case 'notice': {
      record(value, ['kind', 'text'])
      result = Object.freeze({ kind: 'notice', text: text(root.text, 4096) })
      break
    }
    case 'clear': {
      record(value, ['kind', 'id'])
      result = Object.freeze({ kind: 'clear', id: text(root.id, 64) })
      break
    }
    case 'activity': {
      record(value, ['kind', 'id', 'label', 'progress'])
      const base = {
        kind: 'activity' as const,
        id: text(root.id, 64),
        label: text(root.label, 256, true),
      }
      if (Object.hasOwn(root, 'progress')) {
        const p = record(root.progress, ['completed', 'total', 'unit'])
        const completed = count(p.completed)
        const total = Object.hasOwn(p, 'total') ? count(p.total) : undefined
        if (total !== undefined && completed > total)
          throw new TypeError('Completed count exceeds total')
        const unit = Object.hasOwn(p, 'unit') ? text(p.unit, 32, true) : undefined
        result = Object.freeze({
          ...base,
          progress: Object.freeze({
            completed,
            ...(total === undefined ? {} : { total }),
            ...(unit === undefined ? {} : { unit }),
          }),
        })
      } else result = Object.freeze(base)
      break
    }
    default:
      throw new TypeError('Unknown user update kind')
  }
  if (Buffer.byteLength(canonicalUserUpdate(result)) > USER_UPDATES_LIMITS.itemBytes)
    throw new TypeError('Encoded user update exceeds 32 KiB')
  return result
}
