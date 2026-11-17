import { field, describe, type Value } from './values.js'

/** Render only the progress blocks of an authored view payload, never its raw data. */
export function progressDescription(value: Value): string {
  const parts: string[] = []
  const visit = (item: Value) => {
    if (parts.length >= 4) return
    if (item.kind === 'array') for (const child of item.items) visit(child)
    if (item.kind !== 'object') return
    const kind = field(item, 'kind')
    if (kind.kind === 'literal' && kind.value === 'progress') {
      parts.push(describe(field(item, 'completed')) + '/' + describe(field(item, 'total')))
      return
    }
    for (const child of item.fields.values()) visit(child)
  }
  visit(value)
  return parts.length ? 'progress ' + parts.join(', ') : 'display effect unknown'
}
