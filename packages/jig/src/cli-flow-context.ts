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
    return '[value omitted: exceeds inline presentation bound; repeat this --flow request with --json]'
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
export type FlowContextOptions = Readonly<{
  target?: string
  impact?: boolean
  implementation?: boolean
  sources?: readonly string[]
}>

/** Read-only presentation of retained facts. No source evaluation or behavioral inference. */
export function renderFlowContext(value: JsonValue, options: FlowContextOptions = {}): string {
  const snapshot = record(value)
  if (snapshot.state === 'unreviewed' && snapshot.basis !== 'working-tree')
    return '# Application flow\n\nNo locally approved revision. Run `jig review` to prepare and review this project.\n'
  const { targets, edges, selected, callers, included, focus, state } = selectFlowContext(
    value,
    options,
  )
  const selectedEdges = edges.filter(
    (edge) =>
      selected.has(edge.from) &&
      (!options.impact || (typeof edge.target === 'string' && selected.has(edge.target))),
  )
  if (
    included.length > PRIVATE_FLOW_CONTEXT_LIMITS.targets ||
    selectedEdges.length > PRIVATE_FLOW_CONTEXT_LIMITS.connections
  )
    return '# Application flow unavailable\n\nThe selected view exceeds the fixed presentation bounds. Choose a smaller exact target with jig inspect --flow TARGET. No graph was truncated or workflow started.\n'
  const working = snapshot.basis === 'working-tree'
  const lines = [
    '# Application flow',
    '',
    working
      ? `Basis: captured working tree (unapproved). Revision ${markdown(String(snapshot.revision))}.`
      : `Basis: last locally approved configuration. Revision ${markdown(String(snapshot.revision))}.`,
    working
      ? 'Execution readiness is unchecked. No approval, dependency installation or workflow execution was performed.'
      : `Environment: ${markdown(state)}. Visible source freshness, launch readiness, and remote availability remain unchecked.`,
    'Configured connections describe potential calls. Order, conditions, payload construction, and feasibility require method source or explicit observations.',
    '',
    options.impact ? '## Potential impact' : '## Configured relationships',
    '',
  ]
  if (focus !== undefined)
    lines.splice(2, 0, `${options.target ? 'Focus' : 'Entrypoint'}: ${markdown(focus)}.`, '')
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
  lines.push('## Source for behavioral reading', '')
  const listedPackages = new Set<string>()
  const readingOrder = [...included].sort((a, b) =>
    a.target === focus ? -1 : b.target === focus ? 1 : 0,
  )
  for (const item of readingOrder) {
    const packageName = String(item.package)
    if (listedPackages.has(packageName)) continue
    listedPackages.add(packageName)
    const flow = record(item.flow)
    const contract = record(flow.contract)
    const peers = included.filter((t) => t.package === item.package)
    lines.push(
      `### ${peers.map((t) => markdown(String(t.target))).join(' · ')}`,
      '',
      `Implementation: ${markdown(packageName)}. Entrypoint: ${markdown(String(flow.entrypoint))}.`,
    )
    for (const peer of peers) {
      const settings = record(record(peer.flow).settings)
      if (Object.keys(settings).length)
        lines.push(`${markdown(String(peer.target))} settings: ${literal(settings)}.`)
      const available = record(peer.availability)
      if (!working && available.state === 'unavailable')
        lines.push(
          `Approved availability: unavailable${typeof available.code === 'string' ? ' (' + markdown(available.code) + ')' : ''}.`,
        )
    }
    if (typeof flow.description === 'string' && flow.description)
      lines.push(`Authored purpose: ${markdown(flow.description)}`)
    if (contract.operations !== undefined)
      lines.push(
        `Named operations: ${literal(Object.keys(record(contract.operations)))}. No default executable operation is supported in this profile.`,
      )
    if (flow.installedDependency !== undefined)
      lines.push(
        `Local installed dependency: ${literal(record(flow.installedDependency).version)}. Agreement with the manifest request and lock is unchecked.`,
        '',
      )
    const files = list(flow.files).map(record)
    const maximum = options.target === item.target ? PRIVATE_FLOW_CONTEXT_LIMITS.filesPerPackage : 8
    const implementationFiles = files.filter(
      (file) =>
        file.path === flow.entrypoint ||
        (typeof file.path === 'string' &&
          !file.path.startsWith('contracts/') &&
          /\.(?:[cm]?[jt]sx?|py|md)$/.test(file.path) &&
          !/(?:^|\/)(?:AGENTS|README|CHANGELOG)\.md$/.test(file.path)),
    )
    implementationFiles.sort((a, b) =>
      a.path === flow.entrypoint ? -1 : b.path === flow.entrypoint ? 1 : 0,
    )
    lines.push(
      'Read the entrypoint and follow its implementation imports:',
      ...implementationFiles.slice(0, maximum).map((file) => `- ${markdown(String(file.path))}`),
      '',
    )
    if (implementationFiles.length > maximum)
      lines.push(
        `${implementationFiles.length - maximum} implementation members omitted. Focus this target or use --json for the complete inventory.`,
        '',
      )
    lines.push(...sourceBlock(flow))
  }
  const declarations = record(snapshot.declarations)
  if (Array.isArray(declarations.files)) {
    const files = list(declarations.files).map(record)
    lines.push(
      '## Project sources',
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
    lines.push(...sourceBlock(declarations))
  }
  const omitted = targets.length - included.length
  lines.push(
    `Scope: ${included.length} targets included; ${omitted} other targets outside this view.`,
    'Connections outside the selected scope are omitted. Lists prioritize implementation files; --json retains complete inventories and contracts. Source paths identify captured members. Workspace files may differ. No invocation history or inferred caller reactions are supplied.',
    '',
  )
  return lines.join('\n')
}
function sourceBlock(value: Record<string, JsonValue>): string[] {
  const omitted = record(value.implementation).omittedMembers
  return [
    ...(typeof omitted === 'number'
      ? [
          `Implementation bundle: recognizable source and package-local JSON; ${omitted} other members excluded. This is not a complete dependency closure.`,
          '',
        ]
      : []),
    ...list(value.sources).flatMap((member) => sourceMemberBlock(record(member))),
  ]
}
function sourceMemberBlock(value: Record<string, JsonValue>): string[] {
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
  if (record(value).state === 'unreviewed' && record(value).basis !== 'working-tree') return value
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
