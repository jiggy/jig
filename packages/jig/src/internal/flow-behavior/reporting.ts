import ts from 'typescript-parser'
import type { ProgressFieldSource } from './model.js'
import type { SourceIndex } from './source.js'
import {
  constInitializer,
  isLocalFunction,
  shortText,
  sourceNodes,
  unwrap,
} from './source-syntax.js'
import { describe, field, type Value } from './values.js'

const fields = ['completed', 'total'] as const
type ProgressSources = Partial<Record<(typeof fields)[number], ProgressFieldSource>>

function progressSource(
  source: SourceIndex,
  field: ProgressFieldSource['field'],
  expression: ts.Expression,
): ProgressFieldSource {
  const value = unwrap(expression)
  const calculation =
    (ts.isIdentifier(value) && constInitializer(source.declaration(value))) || value
  return { field, ...source.site(calculation), code: shortText(calculation) }
}

function authoredBlock(node: ts.ObjectLiteralExpression, source: SourceIndex) {
  const properties = new Map<string, ts.Expression>()
  for (const property of node.properties) {
    if (
      !(ts.isShorthandPropertyAssignment(property) || ts.isPropertyAssignment(property)) ||
      !(ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) ||
      properties.has(property.name.text)
    )
      return []
    properties.set(
      property.name.text,
      ts.isShorthandPropertyAssignment(property) ? property.name : unwrap(property.initializer),
    )
  }
  const kind = properties.get('kind')
  if (!kind || !ts.isStringLiteralLike(kind) || kind.text !== 'progress') return []
  return fields.flatMap((field) => {
    const expression = properties.get(field)
    return expression ? [progressSource(source, field, expression)] : []
  })
}

function withinReturnedExpression(node: ts.Node, root: ts.Node): boolean {
  if (ts.isExpression(root)) return true
  for (let parent = node.parent; parent && parent !== root; parent = parent.parent) {
    if (ts.isReturnStatement(parent)) return true
  }
  return false
}

/** Locate calculations in the authored payload and its local helpers, without claiming a value. */
function findAuthoredProgress(argument: ts.Expression, source: SourceIndex) {
  const pending: { node: ts.Node; depth: number }[] = [{ node: argument, depth: 0 }]
  const visited = new Set<ts.Node>()
  let remaining = 1024
  let fields: ProgressFieldSource[] = []
  for (const { node: root, depth } of pending) {
    if (visited.has(root)) continue
    visited.add(root)
    for (const node of sourceNodes(root, (node) => node === root || !ts.isFunctionLike(node))) {
      if (--remaining < 0) return []
      if (ts.isObjectLiteralExpression(node) && withinReturnedExpression(node, root)) {
        const block = authoredBlock(node, source)
        if (block.length) {
          if (fields.length) return []
          fields = block
        }
      }
      if (!ts.isCallExpression(node) || depth >= 3) continue
      const callee = unwrap(node.expression)
      if (!ts.isIdentifier(callee)) continue
      const declaration = source.declaration(callee)
      const declared =
        declaration && ts.isFunctionDeclaration(declaration)
          ? declaration
          : constInitializer(declaration)
      if (declared && isLocalFunction(declared) && declared.body)
        pending.push({ node: declared.body, depth: depth + 1 })
    }
  }
  return fields
}

/** Track field writes on evaluated objects without changing their abstract values. */
export class ReportingTrace {
  readonly #sources = new WeakMap<Value, ProgressSources>()
  readonly #authoredSources = new WeakMap<ts.Expression, readonly ProgressFieldSource[]>()

  authoredProgress(argument: ts.Expression, source: SourceIndex): readonly ProgressFieldSource[] {
    const prior = this.#authoredSources.get(argument)
    if (prior) return prior
    const fields = findAuthoredProgress(argument, source)
    this.#authoredSources.set(argument, fields)
    return fields
  }

  property(
    before: Value,
    after: Value,
    field: string,
    expression: ts.Expression,
    source: SourceIndex,
  ): Value {
    const prior = this.#sources.get(before)
    if (field === 'completed' || field === 'total') {
      this.#sources.set(after, {
        ...prior,
        [field]: progressSource(source, field, expression),
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
