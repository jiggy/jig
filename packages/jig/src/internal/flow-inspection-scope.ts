import type { JsonValue } from '../json.js'
import { parseProjectEntrypoint } from '../project/entrypoint.js'
import { flowSelector } from '../project/package-selector.js'

export const record = (value: JsonValue | undefined): Record<string, JsonValue> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {}
export const list = (value: JsonValue | undefined): JsonValue[] =>
  Array.isArray(value) ? value : []

export type FlowContextOptions = Readonly<{ target?: string; packagePath?: string; all?: boolean }>

export function selectFlowContext(value: JsonValue, options: FlowContextOptions) {
  const snapshot = record(value)
  const targets = list(snapshot.targets).map(record)
  const byTarget = new Map(targets.map((item) => [String(item.target), item]))
  let entrypoint: string | undefined
  if (typeof snapshot.entrypoint === 'string') {
    const entry = parseProjectEntrypoint(snapshot.entrypoint).target
    entrypoint = entry.kind === 'binding' ? `binding:${entry.id}` : flowSelector(entry.path)
  }
  const { all, target, packagePath } = options
  if (Number(all === true) + Number(target !== undefined) + Number(packagePath !== undefined) > 1)
    throw new Error('Select only one inspection scope')
  const focus = all || packagePath !== undefined ? undefined : (target ?? entrypoint)
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
  const packageUses =
    packagePath === undefined
      ? []
      : targets.filter((item) => item.package === packagePath).map((item) => String(item.target))
  const selected =
    packagePath === undefined
      ? closure(focus === undefined ? byTarget.keys() : [focus, ...shared], adjacency)
      : new Set([...packageUses.flatMap((id) => reverse.get(id) ?? []), ...packageUses])
  if (options.target !== undefined) {
    const upstream = closure([options.target, ...shared], reverse)
    for (const caller of upstream) {
      selected.add(caller)
      // Show the caller's other slots without recursively expanding every peer.
      for (const peer of adjacency.get(caller) ?? []) selected.add(peer)
    }
  }
  const included =
    packagePath === undefined
      ? targets.filter((item) => selected.has(String(item.target)))
      : [...selected].map((id) => byTarget.get(id)!)
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
    packageUses,
    shared,
    boundaries,
    state,
    omitted: targets.length - included.length,
    omittedConnections: allEdges.length - edges.length,
  }
}
