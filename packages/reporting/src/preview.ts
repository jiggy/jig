import {
  canonicalReportingMessage,
  REPORTING_LIMITS,
  validateReportingMessage,
} from './validation.js'
import {
  type Collection,
  dataRecord,
  type MediaReference,
  safeCount,
  VIEW_LIMITS,
  validateReference,
} from './view.js'

export type CollectionPreview = Readonly<{
  collection: Collection
  shown: number
  total: number
  omitted: number
  complete?: MediaReference
}>

/** Select whole records explicitly, preserving a reported total and full-value reference. */
export function previewCollection(
  input: Collection,
  options: Readonly<{ limit?: number; complete?: MediaReference }> = {},
): CollectionPreview {
  const source = dataRecord(input, [
    'kind',
    'id',
    'title',
    'columns',
    'rows',
    'total',
    'presentation',
  ])
  const settings = dataRecord(options, ['limit', 'complete'])
  if (!Array.isArray(source.rows)) throw new TypeError('Collection rows must be an array')
  if (Reflect.ownKeys(source.rows).length !== source.rows.length + 1)
    throw new TypeError('Collection rows must contain only dense data items')
  for (let index = 0; index < source.rows.length; index++) {
    const property = Object.getOwnPropertyDescriptor(source.rows, String(index))
    if (!property || !('value' in property))
      throw new TypeError('Collection rows must contain data items')
  }
  const total = Object.hasOwn(source, 'total') ? safeCount(source.total) : source.rows.length
  if (total < source.rows.length) throw new TypeError('Collection total is less than supplied rows')
  const limit = settings.limit === undefined ? VIEW_LIMITS.rows : safeCount(settings.limit)
  const complete =
    settings.complete === undefined ? undefined : validateReference(settings.complete)
  if (complete && complete.kind !== 'artifact' && complete.kind !== 'input-artifact')
    throw new TypeError('Complete collection requires an artifact reference')
  const columns = source.columns
  const maximum = Math.min(
    source.rows.length,
    limit,
    VIEW_LIMITS.rows,
    Array.isArray(columns) && columns.length
      ? Math.floor(VIEW_LIMITS.cells / columns.length)
      : VIEW_LIMITS.rows,
  )
  let selected: Collection | undefined
  let low = 0,
    high = maximum
  while (low <= high) {
    const count = Math.floor((low + high) / 2)
    try {
      const value = validateReportingMessage({
        kind: 'view',
        id: 'preview',
        title: 'Preview',
        summary: 'Collection preview',
        sections: [{ blocks: [{ ...source, rows: source.rows.slice(0, count), total }] }],
      })
      const block = value.kind === 'view' ? value.sections[0]?.blocks[0] : undefined
      if (block?.kind !== 'collection')
        throw new TypeError('Collection preview requires a collection')
      if (
        new TextEncoder().encode(canonicalReportingMessage(block)).byteLength >
        REPORTING_LIMITS.itemBytes - 8192
      )
        throw new TypeError('Preview byte budget exceeded')
      selected = block
      low = count + 1
    } catch (error) {
      if (
        count === 0 ||
        !(error instanceof TypeError) ||
        !/Preview byte budget exceeded|Encoded reporting message exceeds/.test(error.message)
      )
        throw error
      high = count - 1
    }
  }
  if (!selected) throw new TypeError('Collection cannot fit the preview profile')
  return Object.freeze({
    collection: selected,
    shown: selected.rows.length,
    total,
    omitted: total - selected.rows.length,
    ...(complete ? { complete } : {}),
  })
}
