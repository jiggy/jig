import { PRIVATE_FLOW_CONTEXT_LIMITS } from './internal/inspection-policy.js'
import type { JsonValue } from './json.js'
import { parseProjectEntrypoint } from './project/entrypoint.js'
import { flowSelector } from './project/package-selector.js'

const record = (value: JsonValue | undefined): Record<string, JsonValue> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {}
const list = (value: JsonValue | undefined): JsonValue[] => (Array.isArray(value) ? value : [])
const literal = (value: JsonValue | undefined): string => {
  const text = JSON.stringify(value ?? null)
  if (Buffer.byteLength(text) > PRIVATE_FLOW_CONTEXT_LIMITS.inlineValueBytes)
    return '[value omitted: exceeds inline presentation bound; use jig inspect TARGET --json]'
  const fence = '`'.repeat(Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length)) + 1)
  return fence + ' ' + text + ' ' + fence
}
const markdown = (value: string): string =>
  value.replace(/[\\`*_{}[\]<>()|#!]/g, '\\$&').replace(/[\p{Cc}\u2028\u2029]/gu, ' ')
const diagram = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\p{Cc}\u2028\u2029]/gu, ' ')
export type FlowContextOptions = Readonly<{ target?: string; impact?: boolean; source?: string }>

/** Read-only presentation of retained facts. No source evaluation or behavioral inference. */
export function renderFlowContext(value: JsonValue, options: FlowContextOptions = {}): string {
  const snapshot = record(value)
  if (snapshot.state === 'unreviewed')
    return '# Application flow\n\nNo locally approved revision. Run `jig review` to prepare and review this project.\n'
  const { targets, edges, selected, callers, included, state } = selectFlowContext(value, options)
  const selectedEdges = edges.filter(
    (edge) =>
      selected.has(edge.from) &&
      (!options.impact || (typeof edge.target === 'string' && selected.has(edge.target))),
  )
  if (
    included.length > PRIVATE_FLOW_CONTEXT_LIMITS.targets ||
    selectedEdges.length > PRIVATE_FLOW_CONTEXT_LIMITS.connections
  )
    return '# Application flow unavailable\n\nThe selected view exceeds the fixed presentation bounds. Choose a smaller exact target with jig inspect --flow TARGET. No graph was truncated or work started.\n'
  const lines = [
    '# Application flow',
    '',
    `Basis: last locally approved configuration. Revision ${markdown(String(snapshot.revision))}.`,
    `Environment: ${markdown(state)}. Visible source freshness, launch readiness, and remote availability remain unchecked.`,
    'Configured connections describe potential calls. Order, conditions, payload construction, and feasibility require method source or explicit observations.',
    '',
    options.impact ? '## Potential impact' : '## Configured relationships',
    '',
  ]
  if (typeof snapshot.agentOverride === 'string')
    lines.splice(
      5,
      0,
      `Approved project review Agent choice: ${literal(snapshot.agentOverride)}. This review argument sets approved effective clients; captured declarations retain authored choices.`,
      '',
    )
  const ids = new Map(
    included.map((t, i) => [
      String(t.target),
      `${String(t.target).replace(/[^a-zA-Z0-9_]/g, '_')}_${i}`,
    ]),
  )
  const graph = ['flowchart LR']
  for (const item of included)
    graph.push(`    ${ids.get(String(item.target))}["${diagram(String(item.target))}"]`)
  let resourceIndex = 0
  for (const e of edges) {
    if (!selected.has(e.from)) continue
    if (typeof e.target === 'string' && selected.has(e.target))
      graph.push(`    ${ids.get(e.from)} -->|"${diagram(String(e.slot))}"| ${ids.get(e.target)}`)
    else if (!options.impact && typeof e.resource === 'string') {
      const id = `resource_${resourceIndex++}`
      graph.push(
        `    ${id}["${diagram(e.resource)}"]`,
        `    ${ids.get(e.from)} -->|"${diagram(String(e.slot))}"| ${id}`,
      )
    }
  }
  lines.push('```mermaid', ...graph, '```', '')
  if (callers.length)
    lines.push(
      'Callers of the selected target:',
      ...callers.map((e) => `- ${markdown(e.from)} through ${markdown(String(e.slot))}`),
      '',
    )
  lines.push('## Boundaries and source', '')
  const listedPackages = new Set<string>()
  for (const item of included) {
    const flow = record(item.flow)
    const contract = record(flow.contract)
    const outcomes = ['done', ...Object.keys(record(contract.outcomes))]
    lines.push(
      `### ${markdown(String(item.target))}`,
      '',
      `${markdown(String(item.package))} · ${markdown(String(item.state))}`,
    )
    const availability = record(item.availability)
    lines.push(
      `Approved availability: ${markdown(String(availability.state ?? 'unknown'))}${typeof availability.code === 'string' ? ' (' + markdown(availability.code) + ')' : ''}.`,
    )
    if (typeof flow.description === 'string' && flow.description)
      lines.push(`Authored purpose: ${markdown(flow.description)}`)
    lines.push(
      `Declared outcomes: ${outcomes.map(markdown).join(', ')}. Operational errors and uncertainty are separate.`,
      `Input: ${schemaSummary(contract.input)}. Result: ${schemaSummary(contract.result)}.`,
      `Settings: ${literal(flow.settings)}.`,
      `Declared file ports: ${literal(flow.attachments)}. Artifact results: ${literal(flow.artifactResults)}.`,
      `Channels: ${literal(Object.fromEntries(Object.entries(record(contract.channels)).map(([name, value]) => [name, { direction: record(value).direction ?? null, required: record(value).required !== false }])))}.`,
      `Captured package digest: ${markdown(String(flow.digest))}. Entrypoint: ${markdown(String(flow.entrypoint))}.`,
      '',
    )
    const peers = targets.filter((t) => t.target !== item.target && t.package === item.package)
    if (peers.length)
      lines.push(
        `Shared implementation: ${peers.map((t) => markdown(String(t.target))).join(', ')}.`,
        '',
      )
    const files = list(flow.files).map(record)
    const packageName = String(item.package)
    const maximum = options.target === item.target ? PRIVATE_FLOW_CONTEXT_LIMITS.filesPerPackage : 8
    if (!listedPackages.has(packageName) || options.target === item.target) {
      listedPackages.add(packageName)
      lines.push(
        'Captured files:',
        ...files
          .slice(0, maximum)
          .map((file) => `- ${markdown(String(file.path))} (${file.bytes} bytes)`),
        '',
      )
      if (files.length > maximum)
        lines.push(
          `${files.length - maximum} further members omitted. Focus this target with --flow or request --source FILE.`,
          '',
        )
    }
    lines.push(...sourceBlock(flow))
  }
  const declarations = record(snapshot.declarations)
  if (Array.isArray(declarations.files)) {
    const files = list(declarations.files).map(record)
    lines.push(
      '## Project declarations',
      '',
      ...files
        .slice(0, PRIVATE_FLOW_CONTEXT_LIMITS.filesPerPackage)
        .map((file) => '- ' + markdown(String(file.path))),
      '',
    )
    if (files.length > PRIVATE_FLOW_CONTEXT_LIMITS.filesPerPackage)
      lines.push(
        String(files.length - PRIVATE_FLOW_CONTEXT_LIMITS.filesPerPackage) +
          ' further project declaration members omitted.',
        '',
      )
    lines.push(
      'Captured declaration digest: ' + markdown(String(declarations.digest)) + '.',
      '',
      ...sourceBlock(declarations),
    )
  }
  const omitted = targets.length - included.length
  lines.push(
    `Scope: ${included.length} targets included; ${omitted} other approved targets outside this view.`,
    'Connections outside the selected scope are omitted. Source paths identify captured package members. Workspace files may differ. No invocation history or inferred caller reactions are supplied.',
    '',
  )
  return lines.join('\n')
}
function sourceBlock(value: Record<string, JsonValue>): string[] {
  if (typeof value.source !== 'string') return []
  const content = value.source.replace(/[\p{Cc}]/gu, (character) =>
    character === '\n' || character === '\t'
      ? character
      : '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'),
  )
  let longest = 2
  for (const match of content.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  const fence = '`'.repeat(longest + 1)
  return [
    `Captured source: ${markdown(String(value.sourcePath))}. Control characters except LF and TAB are escaped.`,
    '',
    fence + 'text',
    content,
    fence,
    '',
  ]
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
  if (focus !== undefined && !byTarget.has(focus)) throw new Error('Flow context target is missing')
  const edges = targets.flatMap((item) =>
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
  const expand = (reverse: boolean) => {
    const adjacency = new Map<string, string[]>()
    for (const edge of edges) {
      if (typeof edge.target !== 'string') continue
      const from = reverse ? edge.target : edge.from
      const to = reverse ? edge.from : edge.target
      const neighbours = adjacency.get(from) ?? []
      neighbours.push(to)
      adjacency.set(from, neighbours)
    }
    const pending = [...selected]
    for (let index = 0; index < pending.length; index++)
      for (const target of adjacency.get(pending[index]!) ?? []) {
        if (!selected.has(target)) {
          selected.add(target)
          pending.push(target)
        }
      }
  }
  if (options.impact) {
    const packages = new Set([...selected].map((t) => byTarget.get(t)?.package))
    for (const item of targets) if (packages.has(item.package)) selected.add(String(item.target))
    expand(true)
  } else expand(false)
  // Include immediate callers for a focused investigation without recursively expanding them.
  const callers = focus === undefined ? [] : edges.filter((e) => e.target === focus)
  const included = targets.filter((t) => selected.has(String(t.target)))
  const states = included.map((target) => target.state)
  const state = states.includes('review-required')
    ? 'review-required'
    : states.some((state) => state !== 'environment-matches')
      ? 'unchecked'
      : 'environment-matches'
  return { snapshot, targets, edges, selected, callers, included, focus, state }
}

export function flowContextRecord(value: JsonValue, options: FlowContextOptions): JsonValue {
  if (record(value).state === 'unreviewed') return value
  const selection = selectFlowContext(value, options)
  return {
    ...selection.snapshot,
    state: selection.state,
    scope: {
      target: selection.focus ?? null,
      impact: options.impact ?? false,
      omittedTargets: selection.targets.length - selection.included.length,
    },
    targets: selection.included,
  }
}

function schemaSummary(value: JsonValue | undefined): string {
  if (value === undefined) return 'unconstrained bounded JSON'
  if (typeof value === 'boolean') return String(value)
  const s = record(value)
  if (s.$ref !== undefined) return 'reference ' + literal(s.$ref)
  if (s.enum !== undefined) return 'declared enum ' + literal(s.enum)
  if (s.const !== undefined) return 'constant ' + literal(s.const)
  if (s.oneOf !== undefined) return list(s.oneOf).map(schemaSummary).join(' OR ')
  const properties = record(s.properties)
  if (properties.outcome !== undefined && properties.output !== undefined)
    return schemaSummary(properties.outcome) + ' => ' + schemaSummary(properties.output)
  const fields = Object.entries(properties).map(([name, value]) => {
    const field = record(value)
    return (
      markdown(name) +
      ': ' +
      (field.enum !== undefined
        ? 'enum ' + literal(field.enum)
        : field.$ref !== undefined
          ? 'ref ' + literal(field.$ref)
          : literal(field.type ?? 'schema'))
    )
  })
  return `${literal(s.type ?? 'schema')}${fields.length ? ' {' + fields.join(', ') + '}' : ''} (summary; read FLOW.contract.json for exact constraints)`
}
