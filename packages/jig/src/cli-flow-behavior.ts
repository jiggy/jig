import { createHash } from 'node:crypto'
import type { DisplaySourceBehavior } from '@jigging/display-model'
import {
  type ConfiguredConnection,
  renderFlowOrientation,
  renderFlowPackageUses,
} from './cli-flow-orientation.js'
import type { ComparisonFact, compareFlowBehavior } from './internal/flow-behavior/comparison.js'
import {
  type BehaviorGuard,
  type BehaviorReport,
  type BehaviorReturn,
  type BehaviorStep,
  type BehaviorTarget,
  isFileOperation,
  type SourceSite,
  withoutReportingLocations,
} from './internal/flow-behavior/model.js'

type Route = BehaviorReport['scopes'][number]['routes'][number]
type Scope = BehaviorReport['scopes'][number]
type Call = Extract<BehaviorStep, { kind: 'call' }>
type CallCase = {
  call: Call
  after: readonly BehaviorStep[]
  sources: Set<number | undefined>
  representativeChecks?: true
}
type CallDetails = ReadonlyMap<string, ReadonlyMap<string, CallCase>>

/** The browser uses the same selected source paths as the plain Markdown view. */
export function projectSourceBehavior(
  report: BehaviorReport,
  nodes: ReadonlyMap<string, string>,
): readonly DisplaySourceBehavior[] {
  const packages = [...new Set(report.inventory.map((target) => target.implementation))].sort(
    (a, b) => b.length - a.length,
  )
  const packageSite = (location: SourceSite): string => {
    const owner = packages.find((path) => location.path.startsWith(path + '/'))
    const file =
      owner === undefined ? location.path.split('/').at(-1)! : location.path.slice(owner.length + 1)
    return file + ':' + location.line
  }
  const clip = (value: string) => {
    const chars = [...value]
    return chars.length <= 256 ? value : chars.slice(0, 255).join('') + '…'
  }
  return report.scopes.flatMap((scope) => {
    const nodeId = nodes.get(scope.target)
    if (nodeId === undefined) return []
    const choices = selectRoutes(scope)
    const cases = choices.slice(0, 4).map((route) => {
      const end = route.at(-1)
      const reported = progress(route, scope.target)
      return {
        result: clip(end?.kind === 'end' ? label(end) : 'Continuation unresolved'),
        calls: route
          .flatMap((step) =>
            step.kind === 'call' && step.caller === scope.target ? [clip(label(step))] : [],
          )
          .slice(0, 6),
        effects: [
          ...route.flatMap((step) =>
            step.kind === 'effect' && step.operation === 'writeFile' ? [clip(label(step))] : [],
          ),
          ...(reported === '—' ? [] : [clip('Requests ' + reported)]),
        ].slice(0, 6),
        checks: route
          .flatMap((step) =>
            (step.kind === 'condition' ? [step] : 'guards' in step ? (step.guards ?? []) : [])
              .filter((guard) => guard.unresolved)
              .map((guard) =>
                clip(
                  guard.code +
                    (guard.taken ? ' · true' : ' · false') +
                    ' · ' +
                    packageSite(guard.site),
                ),
              ),
          )
          .slice(-6),
      }
    })
    return [
      {
        nodeId,
        cases,
        gaps: [
          ...new Set(scope.gaps.map((gap) => clip(gap.reason + ' · ' + packageSite(gap)))),
        ].slice(0, 3),
        omitted: scope.routes.length - cases.length,
      },
    ]
  })
}

const directions = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu
const controls = /[\p{Cc}\u2028\u2029]/gu

export function renderFlowBehaviorComparison(
  report: ReturnType<typeof compareFlowBehavior>,
  all = false,
): string {
  const lines = [
    '# Behavior changes',
    '',
    'Baseline ' + text(report.before) + ' → current ' + text(report.after),
    '',
    'Comparison covers captured source evidence and modeled alternatives. Use Runs to verify actual effects.',
    '',
  ]
  if (report.entrypoint) {
    const [previous, current] = report.entrypoint
    lines.push('Entrypoint · ' + text(previous ?? 'none') + ' → ' + text(current ?? 'none'), '')
  }
  const changeCount = report.changes.length
  lines.push(
    changeCount +
      ' changed · ' +
      report.matched +
      ' with matching captured facts · ' +
      report.limited +
      ' with current coverage gaps',
    '',
  )
  for (const change of report.changes) {
    lines.push('## ' + text(change.id), '')
    if (change.coverageLimited) lines.push('Coverage is incomplete in at least one capture.', '')
    if (change.settingsChanged) lines.push('- Configured settings changed.')
    for (const [label, items] of [
      ['Before configuration', change.previousConfiguration],
      ['After configuration', change.currentConfiguration],
      ['Before coverage gap', change.previousGaps],
      ['After coverage gap', change.currentGaps],
    ] as const) {
      for (const item of all ? items : items.slice(0, 8))
        lines.push('- ' + label + ' · ' + text(item))
      if (!all && items.length > 8)
        lines.push('- ' + (items.length - 8) + ' additional ' + label.toLowerCase() + ' entries.')
    }
    if (all) {
      for (const [label, paths] of [
        ['Before', change.removedPaths],
        ['After', change.addedPaths],
      ] as const) {
        for (const [kind, facts] of paths)
          lines.push(
            '- **' +
              label +
              ' · ' +
              kind +
              '** · ' +
              facts.map((fact) => comparisonFact(fact, label === 'After', false)).join(' → '),
          )
      }
    } else {
      const { spans, unmatchedBefore, unmatchedAfter } = change.pathSummary
      for (const { first, second, paths, reversed } of change.callOrder.slice(0, 3))
        lines.push(
          '- Captured call order · ' +
            text(first.slot) +
            ' before ' +
            text(second.slot) +
            ' · ' +
            paths +
            (paths === 1 ? ' source path' : ' source paths') +
            (reversed
              ? ' · opposite order in baseline source paths'
              : ' · baseline order unresolved') +
            ' · ' +
            comparisonLocation(first.fact, true),
        )
      if (change.callOrder.length > 3)
        lines.push(
          '- ' + (change.callOrder.length - 3) + ' more captured order changes. See `--all`.',
        )
      const groups = new Map<string, { description: string; kind: string; count: number }>()
      for (const { kind, before, after } of spans) {
        const description = comparisonSpan(before, after)
        const key = JSON.stringify([kind, before, after])
        const group = groups.get(key)
        if (group) group.count++
        else groups.set(key, { description, kind, count: 1 })
      }
      for (const { description, kind, count } of [...groups.values()].slice(0, 6))
        lines.push(
          '- ' + description + ' · ' + count + ' ' + kind + (count === 1 ? ' path' : ' paths'),
        )
      if (groups.size > 6) lines.push('- ' + (groups.size - 6) + ' more changes. See `--all`.')
      for (const [label, facts, current] of [
        ['Baseline source paths only', change.beforeConsequences, false],
        ['Current source paths only', change.afterConsequences, true],
      ] as const) {
        for (const fact of facts.slice(0, 4))
          lines.push('- ' + label + ' · ' + comparisonFact(fact, current, true))
        if (facts.length > 4) lines.push('- ' + (facts.length - 4) + ' more. See `--all`.')
      }
      if (unmatchedBefore || unmatchedAfter)
        lines.push(
          '- Unmatched paths · ' +
            unmatchedBefore +
            ' before, ' +
            unmatchedAfter +
            ' after. See `--all` for their checks and consequences.',
        )
    }
    lines.push('')
  }
  if (!all && changeCount)
    lines.push('Add `--all` for the ordered checks, calls, and effects on every changed path.', '')
  return lines.join('\n') + '\n'
}

function comparisonLocation(fact: ComparisonFact, current: boolean): string {
  const [path, line] = fact[2]
  return current ? sourceLink({ path, line }) : text(site({ path, line }))
}

function sourceLink(location: SourceSite): string {
  const { path, line } = location
  const destination = path
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[()]/g, (ch) => (ch === '(' ? '%28' : '%29')))
    .join('/')
  return '[' + text(site(location)) + '](./' + destination + '#L' + line + ')'
}

function comparisonFact(fact: ComparisonFact, current: boolean, compact: boolean): string {
  const description = fact[1]
  const points = [...description]
  return (
    text(compact && points.length > 150 ? points.slice(0, 149).join('') + '…' : description) +
    ' · ' +
    comparisonLocation(fact, current)
  )
}

function comparisonSpan(
  before: readonly ComparisonFact[],
  after: readonly ComparisonFact[],
): string {
  if (
    before.length === 1 &&
    after.length === 1 &&
    before[0]![0] === 'effect' &&
    after[0]![0] === 'effect'
  ) {
    const progress = /^view update · progress (.+) \(([^()]*)\)$/
    const oldValue = progress.exec(before[0]![1])
    const newValue = progress.exec(after[0]![1])
    if (oldValue && newValue && oldValue[2] === newValue[2])
      return (
        'Requested progress ' +
        text(oldValue[1]!) +
        ' → ' +
        text(newValue[1]!) +
        ' · ' +
        comparisonLocation(after[0]!, true)
      )
  }
  const side = (facts: readonly ComparisonFact[], current: boolean) =>
    facts
      .slice(0, 2)
      .map((fact) => comparisonFact(fact, current, true))
      .join(' → ') + (facts.length > 2 ? ' · ' + (facts.length - 2) + ' more steps' : '')
  if (!before.length) return 'Added · ' + side(after, true)
  if (!after.length) return 'Removed · ' + side(before, false)
  return 'Before · ' + side(before, false) + '  |  After · ' + side(after, true)
}

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

function conditionLabel(guard: BehaviorGuard): string {
  if (guard.validation) return guard.taken ? 'Validation rejects' : 'Validation passes'
  return 'When ' + guardLabel(guard) + ' is ' + guard.taken
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

function edgeLabels(guards: readonly (readonly BehaviorGuard[])[]): string[] {
  const edges = guards.map((checks) => ({
    checks: checks.map((guard) => diagramText(conditionLabel(guard) + ' · ' + site(guard.site))),
    shown: [] as string[],
  }))

  function distinguish(group: typeof edges, from: number): void {
    if (group.length < 2) return
    const limit = Math.max(...group.map((edge) => edge.checks.length))
    for (let index = from; index < limit; index++) {
      const byCheck = new Map<string | undefined, typeof edges>()
      for (const edge of group) {
        const check = edge.checks[index]
        const peers = byCheck.get(check) ?? []
        peers.push(edge)
        byCheck.set(check, peers)
      }
      if (byCheck.size === 1) continue
      // A later check can distinguish paths that passed the same earlier check.
      for (const [check, peers] of byCheck) {
        if (check !== undefined) for (const edge of peers) edge.shown.push(check)
        distinguish(peers, index + 1)
      }
      return
    }
  }

  distinguish(edges, 0)
  return edges.map(({ checks, shown }) => {
    const labels = shown.length ? shown : checks.slice(0, 1)
    const hidden = checks.length - labels.length
    return labels.join(' · ') + (hidden ? ` · +${hidden} checks` : '')
  })
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
    const labels = edgeLabels(links.map(({ guards }) => guards))
    for (const [index, { target }] of links.entries()) {
      const edge = labels[index]
      const arrow = edge ? '-->|"' + edge + '"|' : '-->'
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

function lastViewUpdate(route: Route, target: string) {
  for (let index = route.length - 1; index >= 0; index--) {
    const step = route[index]!
    if (step.kind === 'effect' && step.owner === target && step.operation === 'view update')
      return step
  }
}

function progress(route: Route, target: string): string {
  return lastViewUpdate(route, target)?.detail ?? '—'
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
  const byOutcome = new Map<string | undefined, Route>()
  const byConsequence = new Map<string, Route>()
  for (const route of returned) {
    const terminal = route.at(-1)!
    if (terminal.kind !== 'end') continue
    const outcome = terminal.returned?.outcome
    if (!byOutcome.has(outcome)) byOutcome.set(outcome, route)
    const consequence = JSON.stringify([
      terminal.returned,
      progress(route, scope.target),
      route.filter(isFileOperation).map(({ operation, detail }) => [operation, detail]),
    ])
    if (!byConsequence.has(consequence)) byConsequence.set(consequence, route)
  }
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
  const returns = [...new Set([...byOutcome.values(), ...byConsequence.values(), ...returned])]
  return [...returns.slice(0, 4), ...[...stops].slice(0, 2)]
}

function withoutChildPath(key: string, value: unknown): unknown {
  return key === 'childPath' || key === 'representativeChild'
    ? undefined
    : withoutReportingLocations(key, value)
}

function continuation(route: Route, at: number, call: Call): BehaviorStep[] {
  const after: BehaviorStep[] = []
  for (const step of route.slice(at + 1)) {
    if (step.kind === 'call' || step.kind === 'end') {
      after.push(step)
      break
    }
    if (step.kind === 'condition' || (isFileOperation(step) && step.owner === call.caller))
      after.push(step)
  }
  return after
}

function caseId(report: BehaviorReport, call: Call, after: readonly BehaviorStep[]): string {
  // A proved check explains this continuation but does not distinguish the case.
  const steps = after
    .filter((step) => step.kind !== 'condition' || step.unresolved)
    .map((step) => (step.kind === 'call' ? [callAnchor(step), step.target] : step))
  const child = call.childPath === undefined ? undefined : report.childPaths[call.childPath]
  // Cases with the same input, child effects and caller continuation can share
  // an anchor. Keep condition evidence in their representative child path.
  const facts = child?.steps.filter((step) => step.kind !== 'condition')
  const key = JSON.stringify(
    [call.target, call.completion, call.result, call.assumptions, child?.input, facts, steps],
    (name, value) =>
      name === 'line' || name === 'column' || name === 'guards'
        ? undefined
        : withoutChildPath(name, value),
  )
  return idFor(callAnchor(call) + '-path', key)
}

const callCaseLimit = 4

function callDetails(
  report: BehaviorReport,
  routes: readonly Route[],
): { shown: CallDetails; omitted: number } {
  const entries = new Map<string, Map<string, CallCase>>()
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
      const id = caseId(report, call, after)
      const existing = cases.get(id)
      if (existing) {
        existing.sources.add(call.childPath)
        if (JSON.stringify(existing.after) !== JSON.stringify(after))
          existing.representativeChecks = true
      } else cases.set(id, { call, after, sources: new Set([call.childPath]) })
    }
  return { shown: entries, omitted: omitted.size }
}

function consequences(
  report: BehaviorReport,
  scope: Scope,
  routes: readonly Route[],
  details?: CallDetails,
): string[] {
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
      if (cases) {
        const id = caseId(report, step, continuation(route, index, step))
        if ([...cases.keys()].slice(0, callCaseLimit).includes(id))
          return ['[' + title + '](#' + id + ')']
      }
      return [cases ? '[' + title + '](#' + anchor + ')' : title]
    })
    const fileOperations = hasReads
      ? route.filter(isFileOperation).map((step) => step.operation + ' · ' + step.detail)
      : route.filter(writesFile).map((step) => step.detail)
    const update = lastViewUpdate(route, scope.target)
    const origin = update?.reportingCall
    const values = [
      terminal && terminal.kind !== 'condition' ? text(label(terminal)) : 'Unknown',
      calls.join(' → ') || '—',
      update
        ? text(update.detail) +
          '<br>' +
          (origin ? `${text(origin.code)} (${sourceLink(origin)})` : sourceLink(update.site)) +
          (update.progressFields ?? [])
            .map(
              (field) =>
                '<br>' + text(field.field + ' = ' + field.code) + ' (' + sourceLink(field) + ')',
            )
            .join('')
        : '—',
      text(fileOperations.join(' → ')) || '—',
    ]
    summaries.add('| ' + values.join(' | ') + ' |')
  }
  return [...rows, ...summaries, '']
}

function detailLine(step: BehaviorStep): string {
  return text(
    (step.kind === 'condition'
      ? step.unresolved
        ? conditionLabel(step)
        : 'Check ' + guardLabel(step) + ' is ' + step.taken
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
    const cases = [...variants.entries()]
    const first = cases[0]?.[1]
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
    for (const [id, { call, after, sources, representativeChecks }] of cases.slice(
      0,
      callCaseLimit,
    )) {
      const path = call.childPath === undefined ? undefined : report.childPaths[call.childPath]
      lines.push('- <a id="' + id + '"></a>**' + text(label(call)) + '**')
      if (path) {
        lines.push('  - Input from this caller · ' + text(path.input))
        const reads = path.steps
          .filter(isFileOperation)
          .filter((step) => step.operation !== 'writeFile')
        if (reads.length)
          lines.push(
            '  - Read-only file attempts · ' +
              reads.slice(0, 6).map(detailLine).join(' → ') +
              (reads.length > 6 ? ' · ' + (reads.length - 6) + ' later operations omitted' : ''),
          )
        const steps = path.steps.filter(
          (step) =>
            step.kind !== 'effect' || step.operation === 'writeFile' || step.operation === 'notice',
        )
        const shown = steps.length > 6 ? [...steps.slice(0, 4), ...steps.slice(-2)] : steps
        if (steps.length)
          lines.push(
            (sources.size > 1 || call.representativeChild
              ? '  - Representative child path · '
              : '  - Child path · ') +
              shown.map(detailLine).join(' → ') +
              (shown.length < steps.length
                ? ' · ' + (steps.length - shown.length) + ' intermediate steps omitted'
                : ''),
          )
        else lines.push('  - Child path unavailable · ' + text(call.result))
      } else lines.push('  - Child path exceeds the retained analysis allowance.')
      if (after.length) {
        const first = after.slice(0, -1)
        const relevant = first.filter((step) => step.kind !== 'condition' || step.unresolved)
        const shown = new Set(
          [...relevant, ...first.filter((step) => !relevant.includes(step))].slice(0, 3),
        )
        lines.push(
          '  - Back in ' +
            text(call.caller) +
            (representativeChecks ? ' · Representative checks' : '') +
            ' · ' +
            after
              .filter((step, index) => index === after.length - 1 || shown.has(step))
              .map((step) =>
                step.kind === 'call'
                  ? text('Call ' + step.slot + ' → ' + step.target + ' (' + site(step.site) + ')')
                  : detailLine(step),
              )
              .join(' → ') +
            (first.length > shown.size
              ? ' · ' + (first.length - shown.size) + ' intermediate steps omitted'
              : ''),
        )
      }
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
  const checks = new Map<string, Set<'conditional' | boolean>>()
  const addCheck = (guard: BehaviorGuard) => {
    const key = text(guard.code + guardContext(guard)) + ' (' + text(site(guard.site)) + ')'
    const evaluations = checks.get(key) ?? new Set<'conditional' | boolean>()
    evaluations.add(guard.unresolved ? 'conditional' : guard.taken)
    checks.set(key, evaluations)
  }
  const effects = new Set<string>()
  const handoffs = new Set<string>()
  for (const route of routes)
    for (const step of route) {
      if (step.kind === 'condition') addCheck(step)
      if (step.kind === 'effect')
        effects.add(text(label(step)) + ' (' + text(site(step.site)) + ')')
      if (step.kind === 'call' || step.kind === 'effect')
        for (const guard of step.guards ?? []) addCheck(guard)
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
  const sourceChecks = new Set(
    [...checks].map(([code, evaluations]) => {
      const status =
        evaluations.size !== 1 || evaluations.has('conditional')
          ? 'Conditional'
          : evaluations.has(true)
            ? 'Evaluated true'
            : 'Evaluated false'
      return status + ' · ' + code
    }),
  )
  for (const [title, entries] of [
    ['Handoffs', handoffs],
    ['Source checks', sourceChecks],
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
  function outcome(route: Route): { key: string; title: string; source: SourceSite } | undefined {
    const end = route.at(-1)
    if (end?.kind !== 'end') return undefined
    const title = label(end)
    if (end.completion === 'return' && end.returned) return { key: title, title, source: end.site }
    if (end.completion !== 'throw' || end.detail === 'Throws') return undefined
    const check = route.find(
      (step) =>
        step.kind === 'condition' &&
        step.unresolved &&
        !step.taken &&
        step.site.path === end.site.path &&
        step.site.line === end.site.line &&
        step.site.column === end.site.column,
    )
    return {
      key: title + ' · ' + site(end.site),
      title:
        check?.kind === 'condition' ? title + ' when ' + guardLabel(check) + ' is false' : title,
      source: end.site,
    }
  }
  const displayed = new Set(shown.map((route) => outcome(route)?.key))
  const additional = new Map<string, { title: string; source: SourceSite }>()
  for (const route of routes) {
    const result = outcome(route)
    if (result && !displayed.has(result.key) && !additional.has(result.key))
      additional.set(result.key, result)
  }
  if (!additional.size) return []
  const lines = ['### Other analyzed results', '']
  for (const { title, source } of [...additional.values()].slice(0, 8))
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

function importBoundaryNotice(report: BehaviorReport): string[] {
  const boundary = report.importBoundary
  const selected = report.focus ?? report.entrypoint
  const selectedTarget = report.inventory.find((target) => target.id === selected)
  if (boundary === undefined) {
    if (!selectedTarget || report.packagePath !== undefined) return []
    if (![...selectedTarget.slots.values()].some((target) => /^(?:flow|binding):/.test(target)))
      return []
    return [
      'Each Flow has its own package. Use configured slots to call other Flows and declared dependencies to share code.',
      '',
    ]
  }
  const lines = [
    '**Flow package boundary**',
    '',
    text(`${boundary.sourcePackage}/${boundary.file}:${boundary.line}`) +
      ' imports ' +
      text(JSON.stringify(boundary.specifier)) +
      ', outside ' +
      text(boundary.sourcePackage) +
      '.',
  ]
  const targets = new Map(report.inventory.map((target) => [target.id, target.implementation]))
  const handoffs = report.inventory
    .filter(
      (target) =>
        target.implementation === boundary.sourcePackage &&
        (report.packagePath !== undefined || target.id === selected),
    )
    .flatMap(({ id, slots }) =>
      [...slots].flatMap(([slot, target]) =>
        boundary.targetPackage !== undefined && targets.get(target) === boundary.targetPackage
          ? [`${id} · ${slot} → ${target}`]
          : [],
      ),
    )
  if (handoffs.length) {
    lines.push('Configured calls to that package:')
    for (const handoff of handoffs.slice(0, 4)) lines.push('- ' + text(handoff))
    if (handoffs.length > 4) lines.push('- ' + (handoffs.length - 4) + ' more configured calls.')
    lines.push('')
  }
  lines.push(
    'Use the Flow call for delegation or a declared dependency for shared code. Review checks the files available to the Run.',
    '',
  )
  return lines
}

export function renderFlowBehavior(report: BehaviorReport): string {
  const lines = [
    report.packagePath === undefined ? '# Source behavior' : '# Flow package uses',
    '',
    'Captured working tree (unapproved). Revision ' + text(report.revision) + '.',
    '',
  ]
  if (report.unavailable !== undefined) return [...lines, text(report.unavailable), ''].join('\n')
  const { focus, inventory, scopes } = report
  if (report.packagePath !== undefined) {
    const uses = new Set(
      inventory
        .filter((target) => target.implementation === report.packagePath)
        .map((target) => target.id),
    )
    lines.push(
      ...renderFlowPackageUses(
        report.packagePath,
        inventory,
        configuredConnections(report, (_caller, target) => uses.has(target)),
        text,
      ),
      ...importBoundaryNotice(report),
      ...renderCallReferences(scopes, inventory, (caller) => {
        const slots = inventory.find((target) => target.id === caller)?.slots
        return new Set([...(slots ?? [])].flatMap(([slot, id]) => (uses.has(id) ? [slot] : [])))
      }),
    )
    return lines.join('\n')
  }
  lines.push('Standalone routes start with inputs that satisfy the captured contract.', '')
  if (focus === undefined) return [...lines, ...applicationMap(report)].join('\n') + '\n'
  lines.push(
    '## ' + text(focus),
    '',
    ...configuredOrientation(report, focus),
    ...importBoundaryNotice(report),
  )
  const selected = scopes.find((scope) => scope.target === focus)
  if (selected) {
    lines.push(
      ...renderCallSelections(selected, inventory.find((target) => target.id === focus)?.slots),
    )
    lines.push(...renderCallReferences([selected], inventory))
    lines.push(...contractChecks(selected))
    const routes = selectRoutes(selected)
    const details = callDetails(report, [...routes, ...selected.alternatives])
    if (routes.length) {
      lines.push(...consequences(report, selected, routes, details.shown))
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
        lines.push('### ' + text(caller.target), '', ...consequences(report, caller, routes))
      }
    }
  }
  lines.push('## Configured targets and declared boundaries', '')
  if (!inventory.length) lines.push('The captured project has no configured targets.', '')
  for (const target of inventory) {
    lines.push(
      '- ' + text(target.id + ' uses ' + target.implementation) + ' · ' + boundaryFacts(target),
    )
  }
  if (inventory.some((target) => target.id !== focus))
    lines.push('', 'Supply an exact target to inspect its behavior and callers.')
  return lines.join('\n') + '\n'
}

function renderCallSelections(
  scope: Scope,
  slots: ReadonlyMap<string, string> | undefined,
  heading = '### Caller decisions',
): string[] {
  const selections = scope.callSelections
  if (!selections || !slots) return []
  const lines = [
    heading,
    '',
    'The `intent` option of the `run.call` request sets the displayed call label.',
    '',
  ]
  const dispatches = new Set<string>()
  const shown = new Set<string>()
  for (const selection of selections.sites) {
    const { slot, dispatch, guards, requestMetadata, inputSite, inputChoices } = selection
    const target = slots.get(slot)
    if (target === undefined) continue
    const dispatchKey = dispatch && JSON.stringify([dispatch.path, dispatch.line, dispatch.column])
    if (dispatch && dispatchKey && !dispatches.has(dispatchKey)) {
      dispatches.add(dispatchKey)
      lines.push(
        `- Helper ${text(dispatch.helper)} (${text(site(dispatch.declaration))}) issues ${text(dispatch.request)} (${text(site(dispatch))}).`,
      )
      for (const { field, index, parameter } of dispatch.arguments)
        lines.push(`  - Argument ${index + 1} ${text(parameter)} → request field ${field}.`)
    }
    lines.push(
      `- ${text(slot)} → ${text(target)} · ${text(site(selection.site))}` +
        (dispatch ? ` · run.call in helper at ${text(site(dispatch))}` : ''),
    )
    for (const guard of guards)
      lines.push(
        `  - Inside ${text(guard.code)} · ${guard.taken ? 'true' : 'false'} branch (${text(site(guard.site))})`,
      )
    for (const field of requestMetadata)
      lines.push(
        `  - Request metadata ${text(field.field)} = ${text(field.code)} (${text(site(field.site))})`,
      )
    if (inputSite) lines.push(`  - Child input at ${text(site(inputSite))}`)
    for (const choice of inputChoices)
      lines.push(`    - ${text(choice.field)} = ${text(choice.code)} (${text(site(choice.site))})`)
    const related = selections.related.get(slot)
    if (related && !shown.has(slot)) {
      lines.push('  - Other slots using the same Flow')
      for (const call of related.calls)
        lines.push(`    - ${text(call.caller)} · ${text(call.slot)} → ${text(call.target)}`)
      if (related.omitted) lines.push(`    - ${related.omitted} more configured slots.`)
    }
    shown.add(slot)
  }
  if (selections.omitted) lines.push(`- ${selections.omitted} additional caller sites omitted.`)
  lines.push(
    '',
    'These locations describe authored choices. Reachability depends on the caller and its input.',
    '',
  )
  return lines
}

function renderCallReferences(
  scopes: readonly Scope[],
  inventory: readonly BehaviorTarget[],
  selectedSlots?: (caller: string) => ReadonlySet<string>,
  heading = '###',
): string[] {
  const lines: string[] = []
  const lookups = new Map<string, string[]>()
  let omitted = 0
  for (const scope of scopes) {
    const selected = selectedSlots?.(scope.target)
    if (selected?.size === 0) continue
    const configured = inventory.find((target) => target.id === scope.target)?.slots
    for (const reference of scope.callReferences ?? []) {
      if (reference.kind === 'literal' && selected && !selected.has(reference.slot)) continue
      const slot =
        reference.kind === 'literal'
          ? `slot ${reference.slot}`
          : `computed slot ${reference.expression}`
      if (lines.length < 12)
        lines.push(`- ${text(scope.target)} · ${text(slot)} (${text(site(reference.site))})`)
      else omitted++
      if (reference.kind === 'computed' && reference.selection) {
        const { lookup, table, key, member, rows, origins } = reference.selection
        if (selected && !rows.some((row) => selected.has(row.slot))) continue
        const identity = JSON.stringify([scope.target, lookup.site])
        if (lookups.has(identity) || lookups.size >= 4) continue
        lookups.set(identity, [
          `- ${text(scope.target)} · ${text(key)} matches ${text(member)} in ${text(table.code)} (${text(site(table.site))}) · lookup at ${text(site(lookup.site))}`,
          ...rows.map((row) => {
            const target = configured?.get(row.slot)
            return `  - ${text(row.key)} → ${text(row.slot)}${target === undefined ? ' (unconfigured)' : ' → ' + text(target)}`
          }),
          ...origins.flatMap((origin) => [
            `  - Key source ${text(origin.value.code)} (${text(site(origin.value.site))})`,
            ...(origin.enclosing
              ? [
                  `    - Inside ${text(origin.enclosing.condition.code)} · ${origin.enclosing.taken} branch (${text(site(origin.enclosing.condition.site))})`,
                ]
              : []),
            ...(origin.producer
              ? [
                  `    - Value from ${text(origin.producer.code)} (${text(site(origin.producer.site))})`,
                ]
              : []),
            ...(origin.inputSlot
              ? [
                  `    - Input from slot ${text(origin.inputSlot.name)} (${text(site(origin.inputSlot.site))})`,
                ]
              : []),
            ...(origin.guard
              ? [
                  `    - Before assigning this key, ${text(origin.guard.condition.code)} leads to ${text(origin.guard.exit.code)} (${text(site(origin.guard.exit.site))})`,
                ]
              : []),
          ]),
        ])
      }
    }
    omitted += scope.callReferencesOmitted ?? 0
  }
  if (!lines.length && !omitted) return []
  if (omitted) lines.push(`- ${omitted} additional source references omitted.`)
  return [
    heading + ' Caller source references',
    '',
    'These are authored call sites. Inspect computed slot expressions in source to determine which slot they select.',
    '',
    ...lines,
    '',
    ...(lookups.size
      ? [
          heading + ' Authored slot selection',
          '',
          'These lookup rows and key sources describe the authored decision. Selection depends on the caller input and conditions.',
          '',
          ...[...lookups.values()].flat(),
          '',
        ]
      : []),
  ]
}

function configuredOrientation(
  report: BehaviorReport,
  focus: string | undefined,
  linkedTargets?: ReadonlySet<string>,
): string[] {
  return renderFlowOrientation(
    report.inventory,
    configuredConnections(report, (caller, target) => caller === focus || target === focus),
    focus,
    {
      text,
      target: (id) =>
        linkedTargets?.has(id) ? `[${text(id)}](#${idFor('target', id)})` : text(id),
      includeCallers: linkedTargets === undefined,
    },
  )
}

function configuredConnections(
  report: BehaviorReport,
  relevant: (caller: string, target: string) => boolean,
): ConfiguredConnection[] {
  const sites = new Map<string, Set<string>>()
  const edgeKey = (caller: string, slot: string, target: string) =>
    JSON.stringify([caller, slot, target])
  const recordSite = (
    caller: string,
    handoff: { slot: string; target: string; site: SourceSite },
  ) => {
    if (!relevant(caller, handoff.target)) return
    const key = edgeKey(caller, handoff.slot, handoff.target)
    const found = sites.get(key) ?? new Set()
    found.add(site(handoff.site))
    sites.set(key, found)
  }
  for (const scope of report.scopes) {
    for (const route of [...scope.routes, ...scope.alternatives])
      for (const step of route)
        if (step.kind === 'call' && step.caller === scope.target) recordSite(scope.target, step)
    for (const handoff of scope.authoredHandoffs ?? []) recordSite(scope.target, handoff)
  }
  return report.inventory.flatMap((target) =>
    [...target.slots].map(([slot, to]) => ({
      from: target.id,
      slot,
      to,
      sites: sites.get(edgeKey(target.id, slot, to)),
    })),
  )
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
  const entry = report.inventory.find((target) => target.id === report.entrypoint)
  if (entry)
    lines.push(
      '### Project entrypoint',
      '',
      ...configuredOrientation(report, entry.id, linkedTargets),
      ...importBoundaryNotice(report),
    )
  lines.push(
    '| Configured target | Flow | Role | Supported continuations |',
    '| --- | --- | --- | --- |',
  )
  const ordered = entry
    ? [entry, ...report.inventory.filter((target) => target !== entry)]
    : report.inventory
  for (const target of ordered) {
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
    const scope = scopes.get(target.id)
    const hasAuthored =
      scope?.authoredHandoffs?.length ||
      scope?.callSelections?.sites.length ||
      scope?.callReferences?.length
    const continuation =
      [...summaries].slice(0, 2).join('<br>') ||
      (hasAuthored ? 'Authored calls only' : 'Unavailable')
    lines.push(
      `| [${text(target.id)}](#${idFor('target', target.id)}) | [${text(target.implementation)}](#${idFor('flow', target.implementation)}) | ${role} | ${continuation}${summaries.size > 2 ? '<br>See more routes below.' : ''}${summaries.size && hasAuthored ? '<br>See authored handoffs below.' : ''} |`,
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
      const details = callDetails(report, [...routes, ...scope.alternatives])
      lines.push(...renderCallSelections(scope, target.slots, '#### Caller decisions'))
      if (!routes.length) lines.push(...renderCallReferences([scope], [target], undefined, '####'))
      lines.push(...contractChecks(scope))
      if (routes.length) lines.push(...consequences(report, scope, routes, details.shown))
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
