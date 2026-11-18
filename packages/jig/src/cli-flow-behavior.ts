import { createHash } from 'node:crypto'
import {
  isFileOperation,
  type BehaviorGuard,
  type BehaviorReport,
  type BehaviorReturn,
  type BehaviorStep,
  type BehaviorTarget,
  type SourceSite,
} from './internal/flow-behavior/model.js'

type Route = BehaviorReport['scopes'][number]['routes'][number]
type Scope = BehaviorReport['scopes'][number]
type Call = Extract<BehaviorStep, { kind: 'call' }>
type CallCase = { call: Call; after: readonly BehaviorStep[] }
type CallDetails = ReadonlyMap<string, ReadonlyMap<string, CallCase & { index: number }>>

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

function idFor(kind: string, value: string): string {
  return kind + '-' + createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function callAnchor(call: Call): string {
  const { path, line, column, identity } = call.site
  const key = JSON.stringify([call.caller, path, identity ?? [line, column], call.slot])
  const slot = call.slot
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .slice(0, 32)
  return idFor('call-' + slot, key)
}

function guardLabel(guard: BehaviorGuard): string {
  const code = guard.code.replace(/\s+/g, ' ')
  const short = code.length <= 72 ? code : code.slice(0, 69) + '…'
  return '(' + short + guardContext(guard) + ')'
}

function guardContext(guard: BehaviorGuard): string {
  return guard.enteringNumbers
    ? ' · before check: ' +
        guard.enteringNumbers.map(([name, value]) => name + ' = ' + value).join(', ')
    : ''
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
    case 'repeat':
      return step.count === undefined
        ? 'Iterate over ' + step.collection + ' · count unknown'
        : 'Iterate over ' + step.collection + ' · up to ' + step.count + ' times'
    case 'end':
      if (step.completion === 'rejected') return 'Jig would reject this result · ' + step.detail
      return step.returned ? 'Returns ' + result(step.returned, true) : step.detail
  }
}

function writesFile(step: BehaviorStep): step is Extract<BehaviorStep, { kind: 'effect' }> {
  return step.kind === 'effect' && step.operation === 'writeFile'
}

type ChartStep = Exclude<BehaviorStep, { kind: 'condition' }>
type ChartNode = {
  readonly step?: ChartStep
  readonly edges: Map<
    string,
    { readonly guards: readonly BehaviorGuard[]; readonly node: ChartNode }
  >
}

function diagramBody(routes: readonly Route[], prefix: string, start: string): string[] {
  const root: ChartNode = { edges: new Map() }
  for (const route of routes) {
    let previous = root
    let pending: BehaviorGuard[] = []
    for (const step of route) {
      if (step.kind === 'condition') {
        if (step.unresolved) pending.push(step)
        continue
      }
      if (
        step.kind !== 'call' &&
        step.kind !== 'end' &&
        step.kind !== 'repeat' &&
        !isFileOperation(step)
      )
        continue
      let guards = pending
      let fact: ChartStep = step
      if ('guards' in step && step.guards) {
        const { guards: inherited, ...rest } = step
        guards = [...pending, ...inherited]
        fact = rest
      }
      pending = []
      const key = JSON.stringify([fact, guards], withoutChildPath)
      let link = previous.edges.get(key)
      if (!link) {
        link = { guards, node: { step: fact, edges: new Map() } }
        previous.edges.set(key, link)
      }
      previous = link.node
    }
  }

  // A join is valid only when every remaining displayed transition agrees.
  // Comparing the whole suffix prevents a shared call from mixing continuations.
  const shared = new Map<string, string>()
  type Link = { readonly guards: readonly BehaviorGuard[]; readonly target: string }
  const nodes = new Map<string, { readonly title: string; readonly links: readonly Link[] }>()
  function fold(node: ChartNode): string {
    const links = [...node.edges.values()].map(({ guards, node }) => ({
      guards,
      target: fold(node),
    }))
    const ordered = [...links].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    const key = JSON.stringify([node.step, ordered], withoutChildPath)
    const existing = shared.get(key)
    if (existing !== undefined) return existing
    const stable = JSON.stringify([node.step, ordered], (name, value) =>
      name === 'line' || name === 'column' ? undefined : withoutChildPath(name, value),
    )
    const base =
      node.step === undefined ? prefix + '0' : prefix + 's_' + idFor('node', stable).slice(5)
    let id = base
    for (let count = 2; nodes.has(id); count++) id = base + '_' + count
    shared.set(key, id)
    nodes.set(id, { title: node.step === undefined ? start : label(node.step), links })
    return id
  }
  const first = fold(root)
  if (nodes.size > 33) return []
  const lines = [`  ${first}["${diagramText(start)}"]`]
  const visited = new Set<string>()
  function output(id: string): void {
    if (visited.has(id)) return
    visited.add(id)
    const links = nodes.get(id)?.links ?? []
    for (const { guards, target } of links) {
      // A check common to each outgoing edge cannot explain their different destinations.
      const guard =
        guards.find((candidate, index) =>
          links.some((link) => JSON.stringify(link.guards[index]) !== JSON.stringify(candidate)),
        ) ?? guards[0]
      const edge = guard
        ? 'Unresolved check at ' +
          site(guard.site) +
          ' · assume ' +
          guard.taken +
          ' ' +
          guardLabel(guard) +
          (guards.length > 1 ? ' · +' + (guards.length - 1) + ' checks' : '')
        : ''
      const arrow = edge ? '-->|"' + diagramText(edge) + '"|' : '-->'
      lines.push(`  ${id} ${arrow} ${target}["${diagramText(nodes.get(target)!.title)}"]`)
      output(target)
    }
  }
  output(first)
  return lines
}

function diagram(routes: readonly Route[]): string[] {
  const body = diagramBody(routes, 'n', 'Start')
  return body.length ? ['```mermaid', 'flowchart TD', ...body, '```', ''] : []
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
    const key = JSON.stringify(
      [
        route.filter(
          (step) =>
            step.kind === 'call' ||
            step.kind === 'end' ||
            step.kind === 'repeat' ||
            isFileOperation(step),
        ),
        progress(route, scope.target),
      ],
      withoutChildPath,
    )
    if (!distinct.has(key)) distinct.set(key, route)
  }
  const group = [...distinct.values()]
  const returned = group.filter((route) => {
    const terminal = route.at(-1)
    return terminal?.kind === 'end' && terminal.completion === 'return'
  })
  const exceptional = group.filter((route) => !returned.includes(route))
  const readSequence = (route: Route) =>
    route.some((step) => isFileOperation(step) && step.operation !== 'writeFile')
  const partial = exceptional.find((route) => {
    const terminal = route.at(-1)
    return terminal?.kind === 'end' && terminal.completion === 'unknown' && readSequence(route)
  })
  const refusal =
    partial &&
    exceptional.find((route) => {
      const terminal = route.at(-1)
      return (
        terminal?.kind === 'end' &&
        terminal.completion === 'throw' &&
        terminal.detail !== 'Throws' &&
        readSequence(route)
      )
    })
  const stops = new Set([
    ...(partial ? [partial] : []),
    ...(refusal ? [refusal] : []),
    ...exceptional,
  ])
  return [...returned.slice(0, 4), ...[...stops].slice(0, 2)]
}

function withoutChildPath(key: string, value: unknown): unknown {
  return key === 'childPath' ? undefined : value
}

function continuation(route: Route, at: number, call: Call): BehaviorStep[] {
  const after: BehaviorStep[] = []
  for (const step of route.slice(at + 1)) {
    if (step.kind === 'call' || step.kind === 'end') {
      after.push(step)
      break
    }
    if (
      after.length < 3 &&
      (step.kind === 'condition' || (isFileOperation(step) && step.owner === call.caller))
    )
      after.push(step)
  }
  return after
}

function caseKey(call: Call, after: readonly BehaviorStep[]): string {
  const steps = after.map((step) =>
    step.kind === 'call' ? [step.caller, step.slot, step.target, step.site] : step,
  )
  return JSON.stringify([call.childPath, call.result, steps])
}

const callCaseLimit = 4

function callDetails(routes: readonly Route[]): { shown: CallDetails; omitted: number } {
  const entries = new Map<string, Map<string, CallCase & { index: number }>>()
  const omitted = new Set<string>()
  for (const route of routes)
    for (const [index, call] of route.entries()) {
      if (call.kind !== 'call') continue
      const anchor = callAnchor(call)
      let cases = entries.get(anchor)
      if (cases === undefined) {
        if (entries.size >= 8) {
          omitted.add(anchor)
          continue
        }
        cases = new Map()
        entries.set(anchor, cases)
      }
      const after = continuation(route, index, call)
      const key = caseKey(call, after)
      if (!cases.has(key)) cases.set(key, { call, after, index: cases.size + 1 })
    }
  return { shown: entries, omitted: omitted.size }
}

function consequences(scope: Scope, routes: readonly Route[], details?: CallDetails): string[] {
  const hasReads = routes.some((route) =>
    route.some((step) => isFileOperation(step) && step.operation !== 'writeFile'),
  )
  const rows = [
    '### Consequences',
    '',
    '| Result or stop | Calls | Last progress requested here | ' +
      (hasReads ? 'File operations attempted' : 'File writes attempted') +
      ' |',
    '| --- | --- | --- | --- |',
  ]
  const summaries = new Set<string>()
  for (const route of routes) {
    const terminal = route.at(-1)
    const calls = route.flatMap((step, index) => {
      if (step.kind !== 'call') return []
      const title = text(step.slot + (step.completion === 'if-failed' ? ' failed' : ''))
      const anchor = callAnchor(step)
      const cases = details?.get(anchor)
      const match = cases?.get(caseKey(step, continuation(route, index, step)))
      if (match && match.index <= callCaseLimit)
        return ['[' + title + '](#' + anchor + '-path-' + match.index + ')']
      return [cases ? '[' + title + '](#' + anchor + ')' : title]
    })
    const fileOperations = hasReads
      ? route.filter(isFileOperation).map((step) => step.operation + ' · ' + step.detail)
      : route.filter(writesFile).map((step) => step.detail)
    const values = [
      terminal && terminal.kind !== 'condition' ? text(label(terminal)) : 'Unknown',
      calls.join(' → ') || '—',
      text(progress(route, scope.target)),
      text(fileOperations.join(' → ')) || '—',
    ]
    summaries.add('| ' + values.join(' | ') + ' |')
  }
  return [...rows, ...summaries, '']
}

function detailLine(step: BehaviorStep): string {
  return text(
    (step.kind === 'condition'
      ? (step.unresolved ? 'Assume ' : 'Check ') + guardLabel(step) + ' is ' + step.taken
      : step.kind === 'call'
        ? label(step) + ' · ' + step.target
        : label(step)) +
      ' (' +
      site(step.site) +
      ')',
  )
}

function renderCallDetails(
  report: BehaviorReport,
  details: CallDetails,
  omitted: number,
  application = false,
): string[] {
  if (!details.size) return []
  const lines = [application ? '#### Calls in context' : '## Calls in context', '']
  const targets = new Set(report.inventory.map((target) => target.id))
  for (const [anchor, variants] of details) {
    const cases = [...variants.values()]
    const first = cases[0]
    if (!first) continue
    const { call } = first
    lines.push(
      '<a id="' + anchor + '"></a>',
      (application ? '##### ' : '### ') + text(call.slot + ' in ' + call.caller),
      '',
      text(
        call.target +
          ' · ' +
          site(call.site) +
          (call.site.column === undefined ? '' : ':' + call.site.column),
      ),
      '',
    )
    if (application && targets.has(call.target))
      lines.push('[Configured child](#' + idFor('target', call.target) + ')', '')
    for (const { call, after, index } of cases.slice(0, callCaseLimit)) {
      const path = call.childPath === undefined ? undefined : report.childPaths[call.childPath]
      lines.push('- <a id="' + anchor + '-path-' + index + '"></a>**' + text(label(call)) + '**')
      if (path) {
        lines.push('  - Input from this caller · ' + text(path.input))
        const steps = path.steps.filter(
          (step) =>
            step.kind !== 'effect' || step.operation === 'writeFile' || step.operation === 'notice',
        )
        const shown = steps.length > 6 ? [...steps.slice(0, 4), ...steps.slice(-2)] : steps
        if (steps.length)
          lines.push(
            '  - Child path · ' +
              shown.map(detailLine).join(' → ') +
              (shown.length < steps.length
                ? ' · ' + (steps.length - shown.length) + ' intermediate steps omitted'
                : ''),
          )
        else lines.push('  - Child path unavailable · ' + text(call.result))
      } else lines.push('  - Child path exceeds the retained analysis allowance.')
      if (after.length)
        lines.push(
          '  - Back in ' +
            text(call.caller) +
            ' · ' +
            after
              .map((step) =>
                step.kind === 'call'
                  ? text('Call ' + step.slot + ' → ' + step.target + ' (' + site(step.site) + ')')
                  : detailLine(step),
              )
              .join(' → '),
        )
    }
    if (cases.length > callCaseLimit)
      lines.push('- ' + (cases.length - callCaseLimit) + ' additional call paths omitted.')
    lines.push('')
  }
  if (omitted)
    lines.push(omitted + ' additional call sites exceed the contextual detail limit.', '')
  return lines
}

function evidence(routes: readonly Route[]): string[] {
  const checks = new Set<string>()
  const effects = new Set<string>()
  const handoffs = new Set<string>()
  for (const route of routes)
    for (const step of route) {
      if (step.kind === 'condition')
        checks.add(text(step.code + guardContext(step)) + ' (' + text(site(step.site)) + ')')
      if (step.kind === 'effect')
        effects.add(text(label(step)) + ' (' + text(site(step.site)) + ')')
      if (step.kind === 'call' || step.kind === 'effect')
        for (const guard of step.guards ?? [])
          checks.add(text(guard.code + guardContext(guard)) + ' (' + text(site(guard.site)) + ')')
      if (step.kind === 'call') {
        handoffs.add(
          text(step.slot + ' → ' + step.target + ' · ' + step.result) +
            ' (' +
            text(site(step.site)) +
            ')',
        )
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

function contractChecks(scope: Scope): string[] {
  const problems = new Set<string>()
  for (const route of [...scope.routes, ...scope.alternatives]) {
    const step = route.at(-1)
    if (step?.kind !== 'end' || step.completion !== 'rejected') continue
    problems.add(
      '- ' +
        text(step.detail) +
        ' (' +
        text(site(step.site)) +
        ')' +
        (step.contractPath ? ' · contract ' + text(step.contractPath) : ''),
    )
  }
  if (!problems.size) return []
  const lines = ['### Result contract checks', '', ...[...problems].slice(0, 8)]
  if (problems.size > 8) lines.push('- ' + (problems.size - 8) + ' additional refusals omitted.')
  return [...lines, '']
}

function otherResults(routes: readonly Route[], shown: readonly Route[]): string[] {
  const displayed = new Set(
    shown
      .map((route) => route.at(-1))
      .flatMap((step) =>
        step?.kind === 'end' && step.completion === 'return' ? [label(step)] : [],
      ),
  )
  const additional = new Map<string, SourceSite>()
  for (const route of routes) {
    const step = route.at(-1)
    if (step?.kind !== 'end' || step.completion !== 'return' || !step.returned) continue
    const title = label(step)
    if (!displayed.has(title) && !additional.has(title)) additional.set(title, step.site)
  }
  if (!additional.size) return []
  const lines = ['### Other analyzed results', '']
  for (const [title, source] of [...additional].slice(0, 8))
    lines.push('- ' + text(title) + ' (' + text(site(source)) + ')')
  if (additional.size > 8) lines.push('- ' + (additional.size - 8) + ' additional results omitted.')
  return [...lines, '']
}

function authoredHandoffs(scope: Scope, linkedTargets?: ReadonlySet<string>): string[] {
  if (!scope.authoredHandoffs?.length) return []
  const lines = [
    '#### Authored handoffs beyond analyzed routes',
    '',
    'These call sites use the configured slots below. Reachability, order, and results remain unresolved.',
    '',
  ]
  for (const handoff of scope.authoredHandoffs) {
    const target = linkedTargets?.has(handoff.target)
      ? `[${text(handoff.target)}](#${idFor('target', handoff.target)})`
      : text(handoff.target)
    lines.push(
      '- ' +
        text(handoff.slot) +
        ' → ' +
        target +
        ' (' +
        text(site(handoff.site)) +
        ')' +
        (handoff.intent ? ' · ' + text(handoff.intent) : ''),
    )
    for (const guard of handoff.guards)
      lines.push(
        '  - Enclosing branch takes ' +
          text(guard.code) +
          ' as ' +
          guard.taken +
          ' (' +
          text(site(guard.site)) +
          ')',
      )
    for (const check of handoff.exitChecks)
      lines.push(
        '  - Later result check ' +
          text(check.code) +
          ' · ' +
          check.taken +
          ' branch ends with ' +
          check.exit +
          ' (' +
          text(site(check.site)) +
          ')',
      )
  }
  if (scope.authoredHandoffsOmitted)
    lines.push('- ' + scope.authoredHandoffsOmitted + ' additional authored handoffs omitted.')
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
  if (focus === undefined) return [...lines, ...applicationMap(report)].join('\n') + '\n'
  const selected = scopes.find((scope) => scope.target === focus)
  if (selected) {
    lines.push('## ' + text(selected.target), '')
    lines.push(...contractChecks(selected))
    const routes = selectRoutes(selected)
    const details = callDetails([...routes, ...selected.alternatives])
    if (routes.length) {
      lines.push(...consequences(selected, routes, details.shown))
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
    lines.push(
      ...otherResults(selected.routes, routes),
      ...alternatives(selected),
      ...authoredHandoffs(selected),
    )
    if (selected.gaps.length) {
      lines.push('### Coverage gaps', '')
      for (const gap of selected.gaps)
        lines.push('- ' + text(gap.reason) + ' (' + text(site(gap)) + ')')
      lines.push('')
    }
    lines.push(...evidence(routes))
    lines.push(...renderCallDetails(report, details.shown, details.omitted))
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
    lines.push(
      '- ' + text(target.id + ' uses ' + target.implementation) + ' · ' + boundaryFacts(target),
    )
  }
  if (inventory.some((target) => target.id !== focus))
    lines.push('', 'Supply an exact target to inspect its behavior and callers.')
  return lines.join('\n') + '\n'
}

function boundaryFacts(target: BehaviorTarget): string {
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
      'settings ' + (Buffer.byteLength(settings) <= 512 ? text(settings) : '(details in topology)'),
    )
  return facts.join(' · ')
}

function applicationMap(report: BehaviorReport): string[] {
  const lines = [
    '<a id="application-overview"></a>',
    '## Application overview',
    '',
    'Use the configured target links to follow the same routes in each Flow chart.',
    'Source routes are conditional. Contract and failure alternatives appear beside their configured use.',
    'Run results supply observed execution.',
    '',
  ]
  if (!report.inventory.length)
    return [...lines, 'The captured project has no configured targets.', '']
  const groups = new Map<string, BehaviorTarget[]>()
  const linkedTargets = new Set(report.inventory.map((target) => target.id))
  const scopes = new Map(report.scopes.map((scope) => [scope.target, scope]))
  const selections = new Map(report.scopes.map((scope) => [scope.target, selectRoutes(scope)]))
  lines.push(
    '| Configured target | Flow | Role | Supported continuations |',
    '| --- | --- | --- | --- |',
  )
  for (const target of report.inventory) {
    const group = groups.get(target.implementation) ?? []
    group.push(target)
    groups.set(target.implementation, group)
    const role =
      target.id === report.entrypoint
        ? 'Project entrypoint'
        : target.id.startsWith('flow:')
          ? 'Direct Flow'
          : 'Binding'
    const routes = selections.get(target.id) ?? []
    const summaries = new Set<string>()
    for (const route of routes) {
      const terminal = route.at(-1)
      if (terminal?.kind !== 'end') continue
      const handoffs = route.flatMap((step) => (step.kind === 'call' ? [label(step)] : []))
      summaries.add((handoffs.length ? brief(handoffs) + ' → ' : '') + text(label(terminal)))
    }
    const continuation = [...summaries].slice(0, 2).join('<br>') || 'Unavailable'
    const hasAuthored = scopes.get(target.id)?.authoredHandoffs?.length
    lines.push(
      `| [${text(target.id)}](#${idFor('target', target.id)}) | [${text(target.implementation)}](#${idFor('flow', target.implementation)}) | ${role} | ${continuation}${summaries.size > 2 ? '<br>See more routes below.' : ''}${hasAuthored ? '<br>See authored handoffs below.' : ''} |`,
    )
  }
  lines.push('')
  // The graph and its expansions use the same selected routes for each configured target.
  for (const [implementation, configurations] of groups) {
    lines.push(
      '<a id="' + idFor('flow', implementation) + '"></a>',
      '## Flow ' + text(implementation),
      '',
    )
    const views = configurations.map((target) => {
      const scope = scopes.get(target.id)
      const routes = selections.get(target.id) ?? []
      const prefix = idFor('use', target.id).replace('-', '_') + '_'
      const body = routes.length ? diagramBody(routes, prefix, target.id) : []
      return { target, scope, routes, body }
    })
    const graph = views.flatMap((view) => view.body)
    if (graph.length) lines.push('```mermaid', 'flowchart TD', ...graph, '```', '')
    for (const { target, scope, routes, body } of views) {
      lines.push(
        '<a id="' + idFor('target', target.id) + '"></a>',
        '### ' + text(target.id),
        '',
        boundaryFacts(target),
        '',
        '[Application overview](#application-overview)',
        '',
      )
      if (!scope) {
        lines.push('This configured target exceeds the analysis limit. Inspect it directly.', '')
        continue
      }
      if (routes.length && !body.length)
        lines.push('This configured target exceeds the diagram limit.', '')
      const details = callDetails([...routes, ...scope.alternatives])
      lines.push(...contractChecks(scope))
      if (routes.length) lines.push(...consequences(scope, routes, details.shown))
      if (scope.routes.length > routes.length)
        lines.push(
          scope.routes.length -
            routes.length +
            ' additional analyzed variants omitted from the chart.',
          '',
        )
      lines.push(
        ...otherResults(scope.routes, routes),
        ...alternatives(scope),
        ...authoredHandoffs(scope, linkedTargets),
      )
      if (scope.gaps.length) {
        lines.push('#### Coverage gaps', '')
        for (const gap of scope.gaps)
          lines.push('- ' + text(gap.reason) + ' (' + text(site(gap)) + ')')
        lines.push('')
      }
      lines.push(...evidence(routes))
      lines.push(...renderCallDetails(report, details.shown, details.omitted, true))
    }
  }
  return lines
}

function brief(items: readonly string[]): string {
  return (
    items.slice(0, 8).map(text).join(', ') +
    (items.length > 8 ? `, plus ${items.length - 8} more` : '')
  )
}
