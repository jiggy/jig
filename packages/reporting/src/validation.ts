import { operationId, type RetireView, scalarText, type ViewItem, validateView } from './view.js'

export type NoticeSeverity = 'info' | 'warning' | 'error'
export type Progress = Readonly<{ completed: number; total?: number; unit?: string }>
export type ReportingMessage =
  | Readonly<{ kind: 'notice'; text: string; severity?: NoticeSeverity }>
  | Readonly<{
      kind: 'activity'
      id: string
      label: string
      progress?: Progress
      detail?: string
      operationId?: string
    }>
  | Readonly<{ kind: 'clear'; id: string }>
  | ViewItem
  | RetireView

/** Canonical JSON for the closed profile and its descriptor (all keys are ASCII). */
export function canonicalReportingMessage(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalReportingMessage).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalReportingMessage((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`
  return JSON.stringify(value)
}

export const REPORTING_LIMITS = Object.freeze({
  itemBytes: 524_288,
  retainedItems: 16,
  retainedBytes: 4_194_304,
  attempts: 18_000,
  trafficBytes: 536_870_912,
  notices: 128,
  noticeBytes: 524_288,
  slots: 16,
  intervalMs: 200,
  sendWaitMs: 500,
  drainMs: 4000,
})

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Reporting message must be an object')
  const proto = Object.getPrototypeOf(value)
  if (proto !== null && proto !== Object.prototype)
    throw new TypeError('Reporting message must be a plain object')
  const copy: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (
      typeof key !== 'string' ||
      !fields.includes(key) ||
      !property?.enumerable ||
      !('value' in property)
    )
      throw new TypeError('Unknown or non-data reporting message field')
    copy[key] = property.value
  }
  return copy
}

function text(value: unknown, maximum: number, singleLine = false): string {
  if (
    typeof value !== 'string' ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  )
    throw new TypeError('Reporting message text must contain Unicode scalars')
  const length = [...value].length
  if (length < 1 || length > maximum || (singleLine && /[\r\n\u2028\u2029]/u.test(value)))
    throw new TypeError('Reporting message text exceeds its length or line limits')
  return value
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError('Reporting message count must be a safe nonnegative integer')
  return value
}

/** Validate unknown input and return a private immutable snapshot. */
export function validateReportingMessage(value: unknown): ReportingMessage {
  const root = record(value, [
    'kind',
    'text',
    'severity',
    'id',
    'label',
    'progress',
    'detail',
    'operationId',
    'title',
    'summary',
    'landing',
    'sections',
    'target',
  ])
  let result: ReportingMessage
  switch (root.kind) {
    case 'notice': {
      record(value, ['kind', 'text', 'severity'])
      if (
        Object.hasOwn(root, 'severity') &&
        !['info', 'warning', 'error'].includes(root.severity as string)
      )
        throw new TypeError('Unknown notice severity')
      result = Object.freeze({
        kind: 'notice',
        text: text(root.text, 4096),
        ...(Object.hasOwn(root, 'severity') ? { severity: root.severity as NoticeSeverity } : {}),
      })
      break
    }
    case 'clear': {
      record(value, ['kind', 'id'])
      result = Object.freeze({ kind: 'clear', id: text(root.id, 64, true) })
      break
    }
    case 'activity': {
      record(value, ['kind', 'id', 'label', 'progress', 'detail', 'operationId'])
      const base = {
        kind: 'activity' as const,
        id: text(root.id, 64, true),
        label: text(root.label, 256, true),
        ...(Object.hasOwn(root, 'detail') ? { detail: text(root.detail, 4096) } : {}),
        ...(Object.hasOwn(root, 'operationId')
          ? { operationId: operationId(root.operationId) }
          : {}),
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
    case 'view':
      result = validateView(value)
      break
    case 'retire-view': {
      record(value, ['kind', 'id'])
      result = Object.freeze({ kind: 'retire-view', id: scalarText(root.id, 64, true) })
      break
    }
    default:
      throw new TypeError('Unknown reporting message kind')
  }
  if (
    new TextEncoder().encode(canonicalReportingMessage(result)).byteLength >
    REPORTING_LIMITS.itemBytes
  )
    throw new TypeError('Encoded reporting message exceeds 512 KiB')
  return result
}

export type {
  DisplayBundle,
  DisplayBundleOptions,
  DisplayPublicationContext,
  DisplayPublicationView,
} from './bundle.js'
export {
  createDisplayBundle,
  DISPLAY_BUNDLE_LIMITS,
  decodeDisplayBundle,
  encodeDisplayBundle,
  validateDisplayBundle,
} from './bundle.js'
export type {
  Block,
  Collection,
  Content,
  DetailBlock,
  Facts,
  MediaReference,
  Reference,
  Report,
  ViewItem,
  ViewOptions,
  ViewSnapshot,
  ViewTarget,
} from './view.js'
export { VIEW_LIMITS } from './view.js'
