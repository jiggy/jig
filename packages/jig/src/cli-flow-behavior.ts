import type {
  BehaviorGuard,
  BehaviorReport,
  BehaviorReturn,
  BehaviorStep,
  SourceSite,
} from './internal/flow-behavior/model.js'

type Route = BehaviorReport['scopes'][number]['routes'][number]
type Scope = BehaviorReport['scopes'][number]

const directions = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu
const controls = /[\p{Cc}\u2028\u2029]/gu

function text(value: string): string {
  return value
    .replace(
      directions,
      (character) =>
        '[U+' + character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') + ']',
    )
    .replace(controls, ' ')
    .replace(/[\\`*_{}[\]<>()|#!]/g, '\\$&')
}

function diagramText(value: string): string {
  return value
    .replace(controls, ' ')
    .replace(directions, '')
    .replace(/[&"<>#|]/g, (ch) => '&#' + ch.charCodeAt(0) + ';')
}

function site(location: SourceSite): string {
  return location.path + ':' + location.line
}

function result(facts: BehaviorReturn, includeArtifacts = false): string {
  return [
    facts.outcome,
    ...facts.fields
      .filter(([, value]) => value.length <= 27)
      .slice(0, 2)
      .map(([field, value]) => field + ' = ' + value),
    ...(includeArtifacts ? facts.artifacts.map((name) => 'offers ' + name) : []),
  ].join(' · ')
}

function label(step: Exclude<BehaviorStep, { kind: 'condition' }>): string {
  switch (step.kind) {
    case 'call':
      if (step.completion === 'if-failed') return step.slot + ' failed'
      if (step.completion === 'if-returned')
        return step.slot + ' if admitted ' + (step.returned?.outcome ?? 'result')
      return step.slot + ' returns ' + (step.returned ? result(step.returned) : step.result)
    case 'effect':
      return 'Attempts ' + step.operation + ' · ' + step.detail
    case 'gap':
      return step.detail
    case 'end':
      return step.returned ? 'Returns ' + result(step.returned, true) : step.detail
  }
}

function writesFile(step: BehaviorStep): step is Extract<BehaviorStep, { kind: 'effect' }> {
  return step.kind === 'effect' && step.operation === 'writeFile'
}

function diagram(routes: readonly Route[]): string[] {
  const nodes = new Map<string, number>()
  const lines = ['flowchart TD', '  n0["Start"]']
  for (const route of routes) {
    let previous = 0
    let pending: BehaviorGuard[] = []
    for (const step of route) {
      if (step.kind === 'condition') {
        if (step.unresolved) pending.push(step)
        continue
      }
      if (step.kind !== 'call' && step.kind !== 'end' && !writesFile(step)) continue
      const guards = step.kind === 'call' ? [...pending, ...(step.guards ?? [])] : pending
      pending = []
      const first = guards[0]
      const edge = first
        ? 'Unresolved check at ' +
          site(first.site) +
          ' · assume ' +
          first.taken +
          (guards.length > 1 ? ' · +' + (guards.length - 1) + ' checks' : '')
        : ''
      // Include the projected guards in the prefix identity. Sharing a node cannot
      // splice a continuation onto a route with a different preceding check.
      const key = JSON.stringify([previous, step, guards])
      let id = nodes.get(key)
      if (id === undefined) {
        id = nodes.size + 1
        if (id > 32) return []
        nodes.set(key, id)
        const arrow = edge ? '-->|"' + diagramText(edge) + '"|' : '-->'
        lines.push(`  n${previous} ${arrow} n${id}["${diagramText(label(step))}"]`)
      }
      previous = id
    }
  }
  return ['```mermaid', ...lines, '```', '']
}

function progress(route: Route, target: string): string {
  const stated = route.flatMap((step) =>
    step.kind === 'effect' && step.owner === target && step.operation === 'view update'
      ? [step.detail]
      : [],
  )
  return stated.at(-1) ?? '—'
}

function selectRoutes(scope: Scope): Route[] {
  const distinct = new Map<string, Route>()
  for (const route of scope.routes) {
    const key = JSON.stringify([
      route.filter((step) => step.kind === 'call' || step.kind === 'end' || writesFile(step)),
      progress(route, scope.target),
    ])
    if (!distinct.has(key)) distinct.set(key, route)
  }
  const group = [...distinct.values()]
  const returned = group.filter((route) => {
    const terminal = route.at(-1)
    return terminal?.kind === 'end' && terminal.completion === 'return'
  })
  const exceptional = group.filter((route) => !returned.includes(route))
  return [...returned.slice(0, 4), ...exceptional.slice(0, 2)]
}

function consequences(scope: Scope, routes: readonly Route[]): string[] {
  const rows = [
    '### Consequences',
    '',
    '| Result or stop | Calls | Last progress requested here | File writes attempted |',
    '| --- | --- | --- | --- |',
  ]
  const summaries = new Set<string>()
  for (const route of routes) {
    const terminal = route.at(-1)
    const calls = route.flatMap((step) =>
      step.kind === 'call' ? [step.slot + (step.completion === 'if-failed' ? ' failed' : '')] : [],
    )
    const writes = route.filter((step) => step.kind === 'effect' && writesFile(step))
    const values = [
      terminal && terminal.kind !== 'condition' ? label(terminal) : 'Unknown',
      calls.join(' → ') || '—',
      progress(route, scope.target),
      writes.map((write) => write.detail).join(' · ') || '—',
    ]
    summaries.add('| ' + values.map(text).join(' | ') + ' |')
  }
  return [...rows, ...summaries, '']
}

function evidence(routes: readonly Route[]): string[] {
  const checks = new Set<string>()
  const effects = new Set<string>()
  const handoffs = new Set<string>()
  for (const route of routes)
    for (const step of route) {
      if (step.kind === 'condition')
        checks.add(text(step.code) + ' (' + text(site(step.site)) + ')')
      if (step.kind === 'effect')
        effects.add(text(label(step)) + ' (' + text(site(step.site)) + ')')
      if (step.kind === 'call') {
        handoffs.add(
          text(step.slot + ' → ' + step.target + ' · ' + step.result) +
            ' (' +
            text(site(step.site)) +
            ')',
        )
        for (const guard of step.guards ?? [])
          checks.add(text(guard.code) + ' (' + text(site(guard.site)) + ')')
        for (const fact of step.assumptions ?? [])
          handoffs.add(
            text(fact.slot + ' depends on ' + fact.detail) + ' (' + text(site(fact.site)) + ')',
          )
      }
    }
  const lines: string[] = []
  for (const [title, entries] of [
    ['Handoffs', handoffs],
    ['Source checks', checks],
    ['Reported and file effects', effects],
  ] as const) {
    if (entries.size) {
      lines.push('#### ' + title, '', ...[...entries].slice(0, 12).map((entry) => '- ' + entry))
      if (entries.size > 12) lines.push('- ' + (entries.size - 12) + ' additional entries omitted.')
      lines.push('')
    }
  }
  return lines
}

function alternatives(scope: Scope): string[] {
  const summaries = new Set<string>()
  for (const route of scope.alternatives) {
    const choice = route.find(
      (step) =>
        step.kind === 'call' && step.assumptions?.some((item) => item.kind !== 'opaque-return'),
    )
    if (choice?.kind !== 'call') continue
    const facts = choice.assumptions?.filter((item) => item.kind !== 'opaque-return') ?? []
    const end = route.at(-1)
    const follow = route
      .slice(route.indexOf(choice) + 1)
      .flatMap((step) => (step.kind === 'call' ? [step.slot] : []))
    const writes = route.filter((step) => step.kind === 'effect' && writesFile(step))
    summaries.add(
      '- ' +
        facts
          .map((fact) => text(fact.slot + ' ' + fact.detail) + ' (' + text(site(fact.site)) + ')')
          .join(' · ') +
        ' → ' +
        text(end && end.kind !== 'condition' ? label(end) : 'Unknown') +
        (follow.length ? ' · later calls ' + text(follow.join(' → ')) : '') +
        (writes.length ? ' · ' + text(writes.map(label).join(' · ')) : ''),
    )
  }
  if (!summaries.size) return []
  const lines = ['### Contract and failure alternatives', '', ...[...summaries].slice(0, 8)]
  if (summaries.size > 8)
    lines.push('- ' + (summaries.size - 8) + ' additional continuations omitted.')
  return [...lines, '']
}

export function renderFlowBehavior(report: BehaviorReport): string {
  const lines = [
    '# Source behavior',
    '',
    'Captured working tree (unapproved). Revision ' + text(report.revision) + '.',
    '',
  ]
  if (report.unavailable !== undefined) return [...lines, text(report.unavailable), ''].join('\n')
  const { focus, inventory, scopes } = report
  const selected = scopes.find((scope) => scope.target === focus)
  if (selected) {
    lines.push('## ' + text(selected.target), '')
    const routes = selectRoutes(selected)
    if (routes.length) {
      lines.push(...consequences(selected, routes))
      lines.push(
        'Routes depend on the shown checks, completion of intervening operations, and admission of child results.',
        '',
      )
      const graph = diagram(routes)
      lines.push(
        ...(graph.length
          ? graph
          : ['Diagram exceeds the size limit. See the consequences above.', '']),
      )
      if (selected.routes.length > routes.length)
        lines.push(
          `${selected.routes.length - routes.length} additional analyzed variants are represented by the same consequences or omitted.`,
          '',
        )
    }
    lines.push(...alternatives(selected))
    if (selected.gaps.length) {
      lines.push('### Coverage gaps', '')
      for (const gap of selected.gaps)
        lines.push('- ' + text(gap.reason) + ' (' + text(site(gap)) + ')')
      lines.push('')
    }
    lines.push(...evidence(routes))
    const callers = scopes.filter(
      (scope) =>
        scope.target !== focus &&
        scope.routes.some((route) =>
          route.some((step) => step.kind === 'call' && step.target === focus),
        ),
    )
    if (callers.length) {
      lines.push('## Caller continuations', '')
      for (const caller of callers) {
        const routes = selectRoutes({
          ...caller,
          routes: caller.routes.filter((route) =>
            route.some((step) => step.kind === 'call' && step.target === focus),
          ),
        }).slice(0, 3)
        lines.push('### ' + text(caller.target), '', ...consequences(caller, routes))
      }
    }
  }
  lines.push('## Configured targets and declared boundaries', '')
  if (!inventory.length) lines.push('The captured project has no configured targets.', '')
  const implementation = inventory.find((target) => target.id === focus)?.implementation
  const shared = inventory.filter(
    (target) => target.id !== focus && target.implementation === implementation,
  )
  if (shared.length)
    lines.push(
      'Other configured uses of this implementation: ' + brief(shared.map((target) => target.id)),
      '',
    )
  for (const target of inventory) {
    const facts = ['outcomes ' + brief(target.outcomes)]
    const routes = [...target.slots].map(([slot, to]) => slot + ' → ' + to)
    if (routes.length) facts.push(brief(routes))
    const ports = Object.entries(target.attachments ?? {})
    if (ports.length)
      facts.push('attachments ' + brief(ports.map(([name, mode]) => name + ' (' + mode + ')')))
    if (target.artifactResults?.length)
      facts.push('artifact results ' + brief(target.artifactResults))
    const settings = JSON.stringify(target.settings)
    if (settings !== '{}')
      facts.push(
        'settings ' +
          (Buffer.byteLength(settings) <= 512 ? text(settings) : '(details in topology)'),
      )
    lines.push(
      '- ' + text(target.id + ' uses ' + target.implementation) + ' · ' + facts.join(' · '),
    )
  }
  if (inventory.some((target) => target.id !== focus))
    lines.push('', 'Supply an exact target to inspect its behavior and callers.')
  return lines.join('\n') + '\n'
}

function brief(items: readonly string[]): string {
  return (
    items.slice(0, 8).map(text).join(', ') +
    (items.length > 8 ? `, plus ${items.length - 8} more` : '')
  )
}
