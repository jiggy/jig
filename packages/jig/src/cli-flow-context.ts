import { PRIVATE_FLOW_CONTEXT_LIMITS } from './internal/inspection-policy.js'
import type { JsonValue } from './json.js'
import { parseProjectEntrypoint } from './project/entrypoint.js'
import { flowSelector } from './project/package-selector.js'

const record = (value: JsonValue | undefined): Record<string, JsonValue> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {}
const list = (value: JsonValue | undefined): JsonValue[] => (Array.isArray(value) ? value : [])
const visibleDirections = (value: string): string =>
  value.replace(
    /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    (character) => `[U+${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}]`,
  )
const markdown = (value: string): string =>
  visibleDirections(value)
    .replace(/[\\`*_{}[\]<>()|#!]/g, '\\$&')
    .replace(/[\p{Cc}\u2028\u2029]/gu, ' ')
const diagram = (value: string): string =>
  visibleDirections(value)
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
  const {
    included,
    edges,
    focus,
    entrypoint,
    shared,
    boundaries,
    state,
    omitted,
    omittedConnections,
  } = selectFlowContext(value, options)
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
    ...(focus === undefined
      ? []
      : [`${options.target === undefined ? 'Root' : 'Focus'}: ${markdown(focus)}.`]),
    ...(options.target !== undefined && entrypoint !== undefined
      ? [
          `Entrypoint: ${markdown(entrypoint)}${included.some((item) => item.target === entrypoint) ? '' : ' (outside this view)'}.`,
        ]
      : []),
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
  if (shared.length && focus !== undefined)
    lines.push(
      `Shared implementation with ${markdown(focus)}: ${shared.map(markdown).join(', ')}. These are separate configured uses, not calls between them.`,
      '',
    )
  for (const item of included) {
    const flow = record(item.flow)
    const settings = record(flow.settings)
    const implementation =
      typeof item.package === 'string' && String(item.target).startsWith('binding:')
        ? `${markdown(String(item.target))} uses ${markdown(item.package)}.`
        : undefined
    if (Object.keys(settings).length) {
      const text = JSON.stringify(settings)
      lines.push(
        `${implementation ?? markdown(String(item.target)) + '.'} Settings: ${Buffer.byteLength(text) > PRIVATE_FLOW_CONTEXT_LIMITS.inlineValueBytes ? '[omitted; use --json]' : markdown(text)}.`,
      )
    } else if (implementation !== undefined) lines.push(implementation)
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
    ...boundaries.map(
      (boundary) =>
        `${markdown(boundary.target)}: ${boundary.incoming} incoming and ${boundary.outgoing} outgoing configured connections outside this view.`,
    ),
    `Scope: ${included.length} targets included; ${omitted} other targets and ${omittedConnections} configured connections outside this view.`,
    '',
  )
  return lines.join('\n')
}

function selectFlowContext(value: JsonValue, options: FlowContextOptions) {
  const snapshot = record(value)
  const targets = list(snapshot.targets).map(record)
  const byTarget = new Map(targets.map((item) => [String(item.target), item]))
  let entrypoint: string | undefined
  if (typeof snapshot.entrypoint === 'string') {
    const entry = parseProjectEntrypoint(snapshot.entrypoint).target
    entrypoint = entry.kind === 'binding' ? `binding:${entry.id}` : flowSelector(entry.path)
  }
  const focus = options.target ?? entrypoint
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
  const adjacency = new Map<string, string[]>()
  const reverse = new Map<string, string[]>()
  for (const edge of allEdges)
    if (typeof edge.target === 'string') {
      const next = adjacency.get(edge.from) ?? []
      next.push(edge.target)
      adjacency.set(edge.from, next)
      const callers = reverse.get(edge.target) ?? []
      callers.push(edge.from)
      reverse.set(edge.target, callers)
    }
  const closure = (seeds: Iterable<string>, graph: Map<string, string[]>) => {
    const found = new Set(seeds)
    const pending = [...found]
    for (const current of pending)
      for (const next of graph.get(current) ?? []) {
        if (!found.has(next)) {
          found.add(next)
          pending.push(next)
        }
      }
    return found
  }
  const packageId = focus === undefined ? undefined : byTarget.get(focus)?.package
  const shared =
    options.target === undefined || typeof packageId !== 'string'
      ? []
      : targets
          .filter((item) => item.target !== focus && item.package === packageId)
          .map((item) => String(item.target))
          .sort()
  const seeds = focus === undefined ? byTarget.keys() : [focus, ...shared]
  const selected = closure(seeds, adjacency)
  if (options.target !== undefined) {
    const upstream = closure([options.target, ...shared], reverse)
    for (const caller of upstream) {
      selected.add(caller)
      // Show the caller's other slots without recursively expanding every peer.
      for (const peer of adjacency.get(caller) ?? []) selected.add(peer)
    }
  }
  const included = targets.filter((item) => selected.has(String(item.target)))
  const edges = allEdges.filter(
    (edge) =>
      selected.has(edge.from) && (typeof edge.target !== 'string' || selected.has(edge.target)),
  )
  const crossing = new Map<string, { target: string; incoming: number; outgoing: number }>()
  for (const edge of allEdges) {
    if (typeof edge.target !== 'string') continue
    const fromInside = selected.has(edge.from)
    const toInside = selected.has(edge.target)
    if (fromInside === toInside) continue
    const target = fromInside ? edge.from : edge.target
    const boundary = crossing.get(target) ?? { target, incoming: 0, outgoing: 0 }
    if (fromInside) boundary.outgoing++
    else boundary.incoming++
    crossing.set(target, boundary)
  }
  const boundaries = included.flatMap((item) => crossing.get(String(item.target)) ?? [])
  const states = included.map((item) => item.state)
  const state =
    snapshot.basis === 'working-tree'
      ? 'unreviewed'
      : states.includes('review-required')
        ? 'review-required'
        : states.some((state) => state !== 'environment-matches')
          ? 'unchecked'
          : 'environment-matches'
  return {
    snapshot,
    included,
    edges,
    focus,
    entrypoint,
    shared,
    boundaries,
    state,
    omitted: targets.length - included.length,
    omittedConnections: allEdges.length - edges.length,
  }
}
export function flowContextRecord(value: JsonValue, options: FlowContextOptions): JsonValue {
  if (record(value).state === 'unreviewed' && record(value).basis !== 'working-tree') return value
  const selected = selectFlowContext(value, options)
  return {
    ...selected.snapshot,
    state: selected.state,
    scope: {
      target: selected.focus ?? null,
      entrypoint: selected.entrypoint ?? null,
      sharedImplementation: selected.shared,
      boundaries: selected.boundaries,
      omittedTargets: selected.omitted,
      omittedConnections: selected.omittedConnections,
    },
    targets: selected.included,
  }
}
