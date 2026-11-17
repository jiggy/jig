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
    let previous = 0
    for (const step of route) {
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

export function renderFlowBehavior(report: BehaviorReport): string {
  const lines = [
    '# Source behavior',
    '',
    'Basis: captured working tree (unapproved). Revision ' + text(report.revision) + '.',
    '',
    'Each route is conditional on the checks and operations shown. Source analysis may omit behavior.',
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
  for (const scope of scopes) {
    lines.push('', '## ' + text(scope.target), '')
    // Keep each captured variant intact, including its returned values and effects.
    // Joining suffixes would allow readers to walk from one variant into another.
    const cap = scope.target === focus ? 8 : 3
    const shown = scope.routes.slice(0, cap)
    if (scope.target === focus && shown.length > 0 && shown.length === scope.routes.length)
      lines.push(...diagram(shown))
    for (const [index, route] of shown.entries()) {
      lines.push('### Route ' + (index + 1), '')
      for (const step of route)
        lines.push('- ' + text(stepLabel(step)) + ' (' + location(step.site) + ')')
      lines.push('')
    }
    if (scope.routes.length > cap)
      lines.push(
        `${scope.routes.length - cap} analyzed routes exceed this view's detail limit.`,
        '',
      )
    for (const gap of scope.gaps)
      lines.push('- Unknown at ' + location(gap) + ' · ' + text(gap.reason))
  }
  return lines.join('\n') + '\n'
}
