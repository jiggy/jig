export type Reference =
  | Readonly<{ kind: 'record'; viewId: string; collectionId: string; rowId: string }>
  | Readonly<{ kind: 'call'; operationId: string }>
  | Readonly<{ kind: 'artifact'; attachment: string; path: string }>
export type Value = string | number | boolean | null | Reference
export type Report = Readonly<{ kind: 'report'; text: string; references?: readonly Reference[] }>
export type Facts = Readonly<{
  kind: 'facts'
  items: readonly Readonly<{ label: string; value: Value }>[]
}>
export type ViewProgress = Readonly<{
  kind: 'progress'
  label: string
  completed: number
  total?: number
  unit?: string
}>
export type DetailBlock = Report | Facts | ViewProgress
export type Collection = Readonly<{
  kind: 'collection'
  id: string
  title: string
  columns: readonly Readonly<{
    key: string
    label: string
    type: 'text' | 'number' | 'boolean' | 'reference'
  }>[]
  rows: readonly Readonly<{
    id: string
    cells: Readonly<Record<string, Value>>
    details?: readonly DetailBlock[]
  }>[]
  total?: number
}>
export type Block = DetailBlock | Collection
export type Section = Readonly<{ title?: string; blocks: readonly Block[] }>
export type ViewSnapshot = Readonly<{
  title?: string
  summary: string
  sections: readonly Section[]
}>
export type ViewOptions = Readonly<{ title: string; landing?: true; operationId?: string }>
export type ViewItem = ViewSnapshot & ViewOptions & Readonly<{ kind: 'view'; id: string }>
export type RetireView = Readonly<{ kind: 'retire-view'; id: string }>

export const VIEW_LIMITS = Object.freeze({
  claimsPerSource: 16,
  claimsPerCommand: 64,
  viewsPerSource: 8,
  viewsPerCommand: 32,
  bytesPerSource: 131_072,
  bytesPerCommand: 524_288,
  sections: 8,
  blocks: 32,
  rows: 128,
  columns: 8,
  cells: 1024,
  details: 8,
  facts: 32,
  references: 8,
})

export function dataRecord(value: unknown, fields?: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError('User update must be a plain object')
  const result: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (
      typeof key !== 'string' ||
      (fields && !fields.includes(key)) ||
      !property?.enumerable ||
      !('value' in property)
    )
      throw new TypeError('Unknown or non-data user update field')
    result[key] = property.value
  }
  return result
}
export function scalarText(
  value: unknown,
  maximum: number,
  singleLine = false,
  minimum = 1,
): string {
  if (
    typeof value !== 'string' ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  )
    throw new TypeError('User update text must contain Unicode scalars')
  const size = [...value].length
  if (size < minimum || size > maximum || (singleLine && /[\r\n\u2028\u2029]/u.test(value)))
    throw new TypeError('User update text exceeds its length or line limits')
  return value
}
export function safeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError('User update count must be a safe nonnegative integer')
  return value
}
export function operationId(value: unknown): string {
  const id = scalarText(value, 128, true)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(id)) throw new TypeError('Invalid operation ID')
  return id
}
function array(value: unknown, maximum: number, minimum = 0): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    throw new TypeError('User update array exceeds its limits')
  // Reject sparse arrays, accessors, symbols and extra properties before traversal.
  const keys = Reflect.ownKeys(value)
  if (keys.length !== value.length + 1)
    throw new TypeError('User update arrays must contain only items')
  for (let i = 0; i < value.length; i++) {
    const p = Object.getOwnPropertyDescriptor(value, String(i))
    if (!p || !('value' in p)) throw new TypeError('User update arrays must contain data items')
  }
  return value
}
export function validateReference(input: unknown): Reference {
  const r = dataRecord(input, [
    'kind',
    'viewId',
    'collectionId',
    'rowId',
    'operationId',
    'attachment',
    'path',
  ])
  if (r.kind === 'record') {
    dataRecord(input, ['kind', 'viewId', 'collectionId', 'rowId'])
    return Object.freeze({
      kind: 'record',
      viewId: scalarText(r.viewId, 64, true),
      collectionId: scalarText(r.collectionId, 64, true),
      rowId: scalarText(r.rowId, 64, true),
    })
  }
  if (r.kind === 'call') {
    dataRecord(input, ['kind', 'operationId'])
    return Object.freeze({ kind: 'call', operationId: operationId(r.operationId) })
  }
  if (r.kind === 'artifact') {
    dataRecord(input, ['kind', 'attachment', 'path'])
    const attachment = scalarText(r.attachment, 64, true)
    const path = scalarText(r.path, 512, true)
    const segments = path.split('/')
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(attachment) ||
      Buffer.byteLength(path) > 512 ||
      segments.length > 16 ||
      segments.some((s) => !s || s === '.' || s === '..' || s === '.jig') ||
      /[\\\p{Cc}]/u.test(path)
    )
      throw new TypeError('Invalid output artifact reference')
    return Object.freeze({ kind: 'artifact', attachment, path })
  }
  throw new TypeError('Unknown reference kind')
}
function validateValue(value: unknown): Value {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return scalarText(value, 4096, false, 0)
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value))
  )
    return value
  return validateReference(value)
}
type Budget = { blocks: number; rows: number; cells: number; collections: Set<string> }
function validateBlock(input: unknown, budget: Budget, detail = false): Block {
  if (++budget.blocks > VIEW_LIMITS.blocks) throw new TypeError('View block limit exceeded')
  const b = dataRecord(input, [
    'kind',
    'text',
    'references',
    'items',
    'label',
    'completed',
    'total',
    'unit',
    'id',
    'title',
    'columns',
    'rows',
  ])
  switch (b.kind) {
    case 'report': {
      dataRecord(input, ['kind', 'text', 'references'])
      return Object.freeze({
        kind: 'report',
        text: scalarText(b.text, 4096, false, 0),
        ...(Object.hasOwn(b, 'references')
          ? { references: Object.freeze(array(b.references, 8).map(validateReference)) }
          : {}),
      })
    }
    case 'facts': {
      dataRecord(input, ['kind', 'items'])
      return Object.freeze({
        kind: 'facts',
        items: Object.freeze(
          array(b.items, 32).map((item) => {
            const f = dataRecord(item, ['label', 'value'])
            if (!Object.hasOwn(f, 'value')) throw new TypeError('Missing fact value')
            return Object.freeze({
              label: scalarText(f.label, 128, true),
              value: validateValue(f.value),
            })
          }),
        ),
      })
    }
    case 'progress': {
      dataRecord(input, ['kind', 'label', 'completed', 'total', 'unit'])
      const completed = safeCount(b.completed)
      const total = Object.hasOwn(b, 'total') ? safeCount(b.total) : undefined
      if (total !== undefined && completed > total)
        throw new TypeError('Completed count exceeds total')
      return Object.freeze({
        kind: 'progress',
        label: scalarText(b.label, 128, true),
        completed,
        ...(total === undefined ? {} : { total }),
        ...(Object.hasOwn(b, 'unit') ? { unit: scalarText(b.unit, 32, true) } : {}),
      })
    }
    case 'collection': {
      if (detail) throw new TypeError('Row details cannot contain collections')
      dataRecord(input, ['kind', 'id', 'title', 'columns', 'rows', 'total'])
      const id = scalarText(b.id, 64, true)
      if (budget.collections.has(id)) throw new TypeError('Duplicate collection ID')
      budget.collections.add(id)
      const keys = new Set<string>()
      const columns = Object.freeze(
        array(b.columns, 8, 1).map((item) => {
          const c = dataRecord(item, ['key', 'label', 'type'])
          const key = scalarText(c.key, 64, true)
          if (
            keys.has(key) ||
            !['text', 'number', 'boolean', 'reference'].includes(c.type as string)
          )
            throw new TypeError('Invalid or duplicate column')
          keys.add(key)
          return Object.freeze({
            key,
            label: scalarText(c.label, 128, true),
            type: c.type as Collection['columns'][number]['type'],
          })
        }),
      )
      const ids = new Set<string>()
      const rows = Object.freeze(
        array(b.rows, 128).map((item) => {
          const r = dataRecord(item, ['id', 'cells', 'details'])
          const rowId = scalarText(r.id, 64, true)
          if (ids.has(rowId)) throw new TypeError('Duplicate row ID')
          ids.add(rowId)
          budget.rows++
          budget.cells += columns.length
          if (budget.rows > 128 || budget.cells > 1024)
            throw new TypeError('View row or cell limit exceeded')
          const cells = dataRecord(r.cells)
          if (Object.keys(cells).length !== columns.length)
            throw new TypeError('Row must contain exactly its column keys')
          const snapshot: Record<string, Value> = Object.create(null)
          for (const c of columns) {
            if (!Object.hasOwn(cells, c.key)) throw new TypeError('Missing column cell')
            const v = validateValue(cells[c.key])
            if (
              v !== null &&
              (c.type === 'reference'
                ? typeof v !== 'object'
                : typeof v !== (c.type === 'text' ? 'string' : c.type))
            )
              throw new TypeError('Cell does not match column type')
            snapshot[c.key] = v
          }
          return Object.freeze({
            id: rowId,
            cells: Object.freeze(snapshot),
            ...(Object.hasOwn(r, 'details')
              ? {
                  details: Object.freeze(
                    array(r.details, 8).map((d) => validateBlock(d, budget, true) as DetailBlock),
                  ),
                }
              : {}),
          })
        }),
      )
      const total = Object.hasOwn(b, 'total') ? safeCount(b.total) : undefined
      if (total !== undefined && total < rows.length)
        throw new TypeError('Collection total is less than supplied rows')
      return Object.freeze({
        kind: 'collection',
        id,
        title: scalarText(b.title, 128, true),
        columns,
        rows,
        ...(total === undefined ? {} : { total }),
      })
    }
    default:
      throw new TypeError('Unknown view block kind')
  }
}
export function validateView(input: unknown): ViewItem {
  const v = dataRecord(input, [
    'kind',
    'id',
    'title',
    'summary',
    'landing',
    'operationId',
    'sections',
  ])
  if (v.kind !== 'view' || (Object.hasOwn(v, 'landing') && v.landing !== true))
    throw new TypeError('Invalid view kind or landing hint')
  const budget: Budget = { blocks: 0, rows: 0, cells: 0, collections: new Set() }
  return Object.freeze({
    kind: 'view',
    id: scalarText(v.id, 64, true),
    title: scalarText(v.title, 128, true),
    summary: scalarText(v.summary, 1024),
    ...(Object.hasOwn(v, 'landing') ? { landing: true as const } : {}),
    ...(Object.hasOwn(v, 'operationId') ? { operationId: operationId(v.operationId) } : {}),
    sections: Object.freeze(
      array(v.sections, 8).map((item) => {
        const s = dataRecord(item, ['title', 'blocks'])
        return Object.freeze({
          ...(Object.hasOwn(s, 'title') ? { title: scalarText(s.title, 128, true) } : {}),
          blocks: Object.freeze(array(s.blocks, 32).map((b) => validateBlock(b, budget))),
        })
      }),
    ),
  })
}
