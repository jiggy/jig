import { renderFlowOrientation } from './cli-flow-orientation.js'
import {
  type FlowContextOptions,
  list,
  record,
  selectFlowContext,
} from './internal/flow-inspection-scope.js'
import { PRIVATE_FLOW_CONTEXT_LIMITS } from './internal/inspection-policy.js'
import type { JsonValue } from './json.js'

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
/** Configured topology only. No method interpretation or invocation history. */
export function renderFlowContext(value: JsonValue, options: FlowContextOptions = {}): string {
  const snapshot = record(value)
  if (snapshot.state === 'unreviewed' && snapshot.basis !== 'working-tree')
    return '# Configured topology\n\nNo locally approved revision. Use jig inspect --flow for current configuration.\n'
  const { included, edges, focus, entrypoint, boundaries, state, omitted, omittedConnections } =
    selectFlowContext(value, options)
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
    ...((options.target !== undefined || options.all) && entrypoint !== undefined
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
  lines.push(
    ...renderFlowOrientation(
      included.flatMap((item) =>
        typeof item.package === 'string'
          ? [
              {
                id: String(item.target),
                implementation: item.package,
                settings: record(item.flow).settings ?? {},
              },
            ]
          : [],
      ),
      edges.flatMap((edge) => {
        const slot = String(edge.slot)
        if (typeof edge.target === 'string') return [{ from: edge.from, slot, to: edge.target }]
        if (typeof edge.resource === 'string')
          return [{ from: edge.from, slot, to: edge.resource, resource: true }]
        return []
      }),
      focus ?? entrypoint,
      { text: markdown, includeCallers: options.target !== undefined },
    ),
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
