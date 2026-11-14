import { PRIVATE_FLOW_CONTEXT_LIMITS } from './internal/inspection-policy.js'
import type { JsonValue } from './json.js'
import { parseProjectEntrypoint } from './project/entrypoint.js'
import { flowSelector } from './project/package-selector.js'

const record = (value: JsonValue | undefined): Record<string, JsonValue> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {}
const list = (value: JsonValue | undefined): JsonValue[] => (Array.isArray(value) ? value : [])
const markdown = (value: string): string =>
  value.replace(/[\\`*_{}[\]<>()|#!]/g, '\\$&').replace(/[\p{Cc}\u2028\u2029]/gu, ' ')
const diagram = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\p{Cc}\u2028\u2029]/gu, ' ')
const targetKey = (target: string) => `target:${target}`
const resourceKey = (caller: string, slot: string) => `resource:${JSON.stringify([caller, slot])}`

function diagramIds(snapshot: Record<string, JsonValue>) {
  const names = new Map<string, string>()
  const slug = (name: string) => {
    const value = name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'node'
    return /^[A-Za-z]/.test(value) ? value : `node_${value}`
  }
  for (const item of list(snapshot.targets).map(record)) {
    const caller = String(item.target)
    names.set(targetKey(caller), slug(caller))
    for (const route of list(record(item.flow).routes).map(record)) {
      if (typeof route.target === 'string') names.set(targetKey(route.target), slug(route.target))
      else if (typeof route.resource === 'string')
        names.set(
          resourceKey(caller, String(route.slot)),
          slug(`resource_${caller}_${String(route.slot)}`),
        )
    }
  }
  const counts = new Map<string, number>()
  for (const name of names.values()) counts.set(name, (counts.get(name) ?? 0) + 1)
  // Slugs contain no double underscore, so exact collision suffixes cannot alias ordinary names.
  return new Map(
    [...names].map(([key, name]) => [
      key,
      counts.get(name) === 1 ? name : `${name}__${Buffer.from(key).toString('hex')}`,
    ]),
  )
}
export type FlowContextOptions = Readonly<{ target?: string }>

/** Configured topology only. No method interpretation or invocation history. */
export function renderFlowContext(value: JsonValue, options: FlowContextOptions = {}): string {
  const snapshot = record(value)
  if (snapshot.state === 'unreviewed' && snapshot.basis !== 'working-tree')
    return '# Configured topology\n\nNo locally approved revision. Use jig inspect --flow for current configuration.\n'
  const { included, edges, focus, state, omitted } = selectFlowContext(value, options)
  if (
    included.length > PRIVATE_FLOW_CONTEXT_LIMITS.targets ||
    edges.length > PRIVATE_FLOW_CONTEXT_LIMITS.connections
  )
    return '# Configured topology unavailable\n\nThe selected view exceeds fixed presentation bounds. Choose a smaller target. No graph was truncated.\n'
  const working = snapshot.basis === 'working-tree'
  const lines = [
    '# Configured topology',
    '',
    `Basis: ${working ? 'captured working tree (unapproved)' : 'last locally approved configuration'}. Revision ${markdown(String(snapshot.revision))}.`,
    'Arrows identify available caller slots and selected targets. They do not establish order, conditions, caller reactions, or execution.',
    ...(focus === undefined ? [] : [`Root: ${markdown(focus)}.`]),
    '',
  ]
  if (!working)
    lines.push(
      `Environment: ${markdown(state)}. Source freshness and execution readiness remain unchecked.`,
      '',
    )
  const graph = ['flowchart LR']
  const ids = diagramIds(snapshot)
  for (const item of included)
    graph.push(`    ${ids.get(targetKey(String(item.target)))}["${diagram(String(item.target))}"]`)
  for (const edge of edges) {
    const from = ids.get(targetKey(edge.from))
    if (typeof edge.target === 'string')
      graph.push(
        `    ${from} -->|"${diagram(String(edge.slot))}"| ${ids.get(targetKey(edge.target))}`,
      )
    else if (typeof edge.resource === 'string') {
      const id = ids.get(resourceKey(edge.from, String(edge.slot)))
      graph.push(
        `    ${id}["${diagram(edge.resource)}"]`,
        `    ${from} -->|"${diagram(String(edge.slot))}"| ${id}`,
      )
    }
  }
  lines.push('```mermaid', ...graph, '```', '')
  for (const item of included) {
    const flow = record(item.flow)
    const settings = record(flow.settings)
    if (Object.keys(settings).length) {
      const text = JSON.stringify(settings)
      lines.push(
        `${markdown(String(item.target))} uses ${markdown(String(item.package))}. Settings: ${Buffer.byteLength(text) > PRIVATE_FLOW_CONTEXT_LIMITS.inlineValueBytes ? '[omitted; use --json]' : markdown(text)}.`,
      )
    }
    const dependency = record(flow.installedDependency)
    if (dependency.version !== undefined)
      lines.push(
        `${markdown(String(item.target))}: installed dependency ${markdown(String(dependency.version))}; manifest and lock agreement unchecked.`,
      )
    const availability = record(item.availability)
    if (!working && availability.state === 'unavailable')
      lines.push(`${markdown(String(item.target))}: approved execution unavailable.`)
  }
  lines.push(
    '',
    `Scope: ${included.length} targets included; ${omitted} other targets outside this view.`,
    '',
  )
  return lines.join('\n')
}

function selectFlowContext(value: JsonValue, options: FlowContextOptions) {
  const snapshot = record(value)
  const targets = list(snapshot.targets).map(record)
  const byTarget = new Map(targets.map((item) => [String(item.target), item]))
  let focus = options.target
  if (focus === undefined && typeof snapshot.entrypoint === 'string') {
    const entry = parseProjectEntrypoint(snapshot.entrypoint).target
    focus = entry.kind === 'binding' ? `binding:${entry.id}` : flowSelector(entry.path)
  }
  if (focus !== undefined && !byTarget.has(focus)) throw new Error('Configured target is missing')
  const allEdges = targets.flatMap((item) =>
    list(record(item.flow).routes)
      .map(record)
      .map((route) => ({
        from: String(item.target),
        slot: route.slot,
        target: route.target,
        resource: route.resource,
      })),
  )
  const selected = new Set<string>(focus === undefined ? byTarget.keys() : [focus])
  const adjacency = new Map<string, string[]>()
  for (const edge of allEdges)
    if (typeof edge.target === 'string') {
      const next = adjacency.get(edge.from) ?? []
      next.push(edge.target)
      adjacency.set(edge.from, next)
    }
  const pending = [...selected]
  for (let index = 0; index < pending.length; index++)
    for (const next of adjacency.get(pending[index]!) ?? []) {
      if (!selected.has(next)) {
        selected.add(next)
        pending.push(next)
      }
    }
  const included = targets.filter((item) => selected.has(String(item.target)))
  const edges = allEdges.filter((edge) => selected.has(edge.from))
  const states = included.map((item) => item.state)
  const state = states.includes('review-required')
    ? 'review-required'
    : states.some((state) => state !== 'environment-matches')
      ? 'unchecked'
      : 'environment-matches'
  return { snapshot, included, edges, focus, state, omitted: targets.length - included.length }
}
export function flowContextRecord(value: JsonValue, options: FlowContextOptions): JsonValue {
  if (record(value).state === 'unreviewed' && record(value).basis !== 'working-tree') return value
  const selected = selectFlowContext(value, options)
  return {
    ...selected.snapshot,
    state: selected.state,
    scope: { target: selected.focus ?? null, omittedTargets: selected.omitted },
    targets: selected.included,
  }
}
