import type { BehaviorReport, BehaviorStep, SourceSite } from './internal/flow-behavior/model.js'

// All source-derived strings stay on one line and cannot introduce Markdown syntax.
function text(value: string): string {
  return value
    .replace(
      /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
      (character) =>
        '[U+' + character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') + ']',
    )
    .replace(/[\p{Cc}\u2028\u2029]/gu, ' ')
    .replace(/[\\`*_{}[\]<>()|#!]/g, '\\$&')
}

function location(site: SourceSite): string {
  return text(site.path) + ':' + site.line
}

function stepLabel(step: BehaviorStep): string {
  switch (step.kind) {
    case 'condition':
      return (step.taken ? 'If true: ' : 'If false: ') + step.code
    case 'call': {
      const choice =
        step.completion === 'source-return'
          ? 'source return'
          : step.completion === 'if-returned'
            ? 'if returned (contract or unknown)'
            : 'if failed'
      return step.slot + ' → ' + step.target + ' · ' + choice + ' · ' + step.result
    }
    case 'gap':
      return 'Partial coverage · ' + step.detail
    case 'effect':
      return 'Attempts ' + step.operation + ' · ' + step.detail
    case 'end':
      return step.completion === 'return' ? 'Returns · ' + step.detail : step.detail
  }
}

function diagram(routes: readonly (readonly BehaviorStep[])[]): string[] {
  const nodes = new Map<string, number>()
  const lines = ['flowchart TD', '  n0["Start"]']
  for (const route of routes) {
    const compact = route.filter(
      (step) =>
        step.kind === 'call' ||
        step.kind === 'end' ||
        (step.kind === 'effect' && step.operation === 'writeFile'),
    )
    let previous = 0
    for (const step of compact) {
      const key = JSON.stringify([previous, step])
      let id = nodes.get(key)
      if (id === undefined) {
        id = nodes.size + 1
        if (id > 32) return []
        nodes.set(key, id)
        const label = stepLabel(step)
          .replace(/[\p{Cc}\u2028\u2029]/gu, ' ')
          .replace(/[&"<>#]/g, (ch) => '&#' + ch.charCodeAt(0) + ';')
          .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '')
        lines.push(`  n${id}["${label}"]`, `  n${previous} --> n${id}`)
      }
      previous = id
    }
  }
  return ['```mermaid', ...lines, '```', '']
}

type ScopeRoute = BehaviorReport['scopes'][number]['routes'][number]

export function renderFlowBehavior(report: BehaviorReport): string {
  const lines = [
    '# Source behavior',
    '',
    'Basis: captured working tree (unapproved). Revision ' + text(report.revision) + '.',
    '',
    'Routes depend on their checks and on operations completing. Unresolved checks can leave extra routes visible.',
    'A child result must be admitted before its caller receives it.',
    '',
  ]
  if (report.unavailable !== undefined) return [...lines, text(report.unavailable), ''].join('\n')
  const { focus, inventory, scopes } = report
  if (focus !== undefined) {
    lines.push('Focus: ' + text(focus) + '.', '')
    const selected = inventory.find((target) => target.id === focus)
    const shared = inventory.filter(
      (t) => t.id !== focus && t.implementation === selected?.implementation,
    )
    if (shared.length)
      lines.push(
        'Other configured uses of this implementation: ' +
          shared.map((t) => text(t.id)).join(', ') +
          '.',
        '',
      )
  }
  lines.push('## Configured targets', '')
  if (inventory.length === 0) lines.push('The captured project has no configured targets.', '')
  for (const target of inventory) {
    const routes = [...target.slots].map(([slot, to]) => text(slot) + ' → ' + text(to)).join(', ')
    lines.push(
      '- ' +
        text(target.id) +
        ' uses ' +
        text(target.implementation) +
        (routes ? ' · ' + routes : ''),
    )
  }
  if (focus === undefined)
    lines.push('', 'Supply an exact target to inspect its behavior and callers.')
  if (scopes.length) {
    const brief = (items: string[]) =>
      items.slice(0, 8).map(text).join(', ') +
      (items.length > 8 ? `, plus ${items.length - 8} more` : '')
    lines.push('', '## Declared boundaries', '')
    for (const item of inventory.filter((t) => scopes.some((s) => s.target === t.id))) {
      const settings = JSON.stringify(item.settings)
      const facts = ['outcomes ' + brief([...item.outcomes])]
      const ports = Object.entries(item.attachments ?? {})
      if (ports.length)
        facts.push('attachments ' + brief(ports.map(([name, mode]) => name + ' (' + mode + ')')))
      if (item.artifactResults?.length)
        facts.push('artifact results ' + brief([...item.artifactResults]))
      if (settings !== '{}')
        facts.push(
          'settings ' +
            (Buffer.byteLength(settings) <= 512 ? text(settings) : '(details in topology)'),
        )
      lines.push('- ' + text(item.id) + ' · ' + facts.join(' · '))
    }
  }
  for (const scope of scopes) {
    lines.push('', '## ' + text(scope.target), '')
    const cap = scope.target === focus ? 8 : 3
    const key = (route: readonly BehaviorStep[]) =>
      JSON.stringify(
        route.filter(
          (step) =>
            step.kind === 'call' ||
            step.kind === 'end' ||
            (step.kind === 'effect' && step.operation === 'writeFile'),
        ),
      )
    const distinct = new Map<string, ScopeRoute>()
    for (const route of scope.routes) if (!distinct.has(key(route))) distinct.set(key(route), route)
    const paths = [...distinct.values()]
    const returned = (route: ScopeRoute) =>
      route.some((step) => step.kind === 'end' && step.completion === 'return')
    const ordered = [...paths.filter(returned), ...paths.filter((route) => !returned(route))]
    const shown = ordered.slice(0, cap)
    const progression = shown.filter(returned)
    if (scope.target === focus && shown.length > 0) {
      const graph = diagram(progression.length ? progression : shown)
      if (graph.length) {
        lines.push(
          'The diagram shows call results and attempted file writes from the main routes below.',
          '',
          ...graph,
        )
      } else
        lines.push(
          'The main routes exceed the diagram size limit. See the route details below.',
          '',
        )
    }
    for (const [index, route] of shown.entries()) {
      lines.push('### Route ' + (index + 1), '')
      for (const step of route) {
        lines.push('- ' + text(stepLabel(step)) + ' (' + location(step.site) + ')')
        if (step.kind === 'call') {
          const inherited =
            step.assumptions?.filter(
              (item) => item.site.path !== step.site.path || item.site.line !== step.site.line,
            ) ?? []
          for (const assumption of inherited)
            lines.push(
              '  - Depends on ' +
                text(assumption.slot + ': ' + assumption.detail) +
                ' (' +
                location(assumption.site) +
                ')',
            )
        }
      }
      lines.push('')
    }
    if (ordered.length > cap)
      lines.push(`${ordered.length - cap} main routes exceed this view's detail limit.`, '')
    if (scope.routes.length > paths.length)
      lines.push(
        `${scope.routes.length - paths.length} more analyzed variants share these call and completion sequences.`,
        '',
      )
    if (scope.alternatives.length) {
      lines.push('### Contract and failure alternatives', '')
      const summaries = new Set<string>()
      for (const route of scope.alternatives) {
        const choice = route.find(
          (step) =>
            step.kind === 'call' && step.assumptions?.some((item) => item.kind !== 'opaque-return'),
        )
        if (choice?.kind !== 'call') continue
        const facts = choice.assumptions?.filter((item) => item.kind !== 'opaque-return') ?? []
        const effects = route.filter(
          (step) => step.kind === 'effect' && step.operation === 'writeFile',
        )
        const end = route.at(-1)
        const following = route
          .slice(route.indexOf(choice) + 1)
          .filter((step) => step.kind === 'call')
        summaries.add(
          '- ' +
            facts
              .map(
                (item) => text(item.slot + ': ' + item.detail) + ' (' + location(item.site) + ')',
              )
              .join(', ') +
            (effects.length
              ? ' · ' + effects.map((step) => text(stepLabel(step))).join(', ')
              : '') +
            ' · later calls: ' +
            (following.map((step) => (step.kind === 'call' ? text(step.slot) : '')).join(' → ') ||
              'none shown') +
            (end ? ' · ' + text(stepLabel(end)) : ''),
        )
      }
      lines.push(...[...summaries].slice(0, 8))
      if (summaries.size > 8)
        lines.push(
          `${summaries.size - 8} other conditional continuations exceed this view's detail limit.`,
        )
      lines.push('')
    }
    for (const gap of scope.gaps)
      lines.push('- Unknown at ' + location(gap) + ' · ' + text(gap.reason))
  }
  return lines.join('\n') + '\n'
}
