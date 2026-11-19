import ts from 'typescript-parser'
import type { ProgressFieldSource } from './model.js'
import type { SourceIndex } from './source.js'
import { constInitializer, shortText, unwrap } from './source-syntax.js'
import { describe, field, type Value } from './values.js'

const fields = ['completed', 'total'] as const
type ProgressSources = Partial<Record<(typeof fields)[number], ProgressFieldSource>>

/** Track field writes on evaluated objects without changing their abstract values. */
export class ReportingTrace {
  readonly #sources = new WeakMap<Value, ProgressSources>()

  property(
    before: Value,
    after: Value,
    field: string,
    expression: ts.Expression,
    source: SourceIndex,
  ): Value {
    const prior = this.#sources.get(before)
    if (field === 'completed' || field === 'total') {
      const value = unwrap(expression)
      const calculation =
        (ts.isIdentifier(value) && constInitializer(source.declaration(value))) || value
      this.#sources.set(after, {
        ...prior,
        [field]: { field, ...source.site(calculation), code: shortText(calculation) },
      })
    } else if (prior) this.#sources.set(after, prior)
    return after
  }

  spread(before: Value, after: Value, spread: Value): Value {
    if (spread.kind !== 'object' || spread.open) {
      const own = this.#sources.get(spread)
      if (own) this.#sources.set(after, own)
      return after
    }
    const prior = this.#sources.get(before)
    const own = this.#sources.get(spread)
    if (prior || own) {
      const merged: ProgressSources = {}
      for (const field of fields) {
        const origin = spread.fields.has(field) ? own?.[field] : prior?.[field]
        if (origin) merged[field] = origin
      }
      this.#sources.set(after, merged)
    }
    return after
  }

  /** Inspect progress blocks within an authored view payload, without exposing its raw data. */
  progress(value: Value): { detail: string; sources: ProgressFieldSource[] } {
    const parts: string[] = []
    let sources: ProgressFieldSource[] = []
    const visit = (item: Value) => {
      if (parts.length >= 4) return
      if (item.kind === 'array') for (const child of item.items) visit(child)
      if (item.kind !== 'object') return
      const kind = field(item, 'kind')
      if (kind.kind === 'literal' && kind.value === 'progress') {
        parts.push(describe(field(item, 'completed')) + '/' + describe(field(item, 'total')))
        const own = this.#sources.get(item)
        if (parts.length === 1 && own)
          sources = fields.flatMap((field) => (own[field] ? [own[field]] : []))
        return
      }
      for (const child of item.fields.values()) visit(child)
    }
    visit(value)
    return {
      detail: parts.length ? 'progress ' + parts.join(', ') : 'display effect unknown',
      sources: parts.length === 1 ? sources : [],
    }
  }
}
