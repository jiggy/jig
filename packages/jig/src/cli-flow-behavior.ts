import { createHash } from 'node:crypto'
import type { DisplaySourceBehavior } from '@jigging/display-model'
import {
  type ConfiguredConnection,
  renderFlowOrientation,
  renderFlowPackageUses,
} from './cli-flow-orientation.js'
import type { ComparisonFact, compareFlowBehavior } from './internal/flow-behavior/comparison.js'
import {
  type AuthoredPriorExit,
  type AuthoredRepeat,
  type AuthoredRepeatedCall,
  BEHAVIOR_LIMITS,
  type BehaviorGuard,
  type BehaviorReport,
  type BehaviorReturn,
  type BehaviorStep,
  type BehaviorTarget,
  isFileOperation,
  type SourceSite,
  varyingInputFields,
  withoutReportingLocations,
} from './internal/flow-behavior/model.js'
import { record } from './internal/flow-inspection-scope.js'

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
  return sourcePathLink(location.path, location.line)
}

function sourcePathLink(path: string, line?: number): string {
  const destination = path
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/[()]/g, (ch) => (ch === '(' ? '%28' : '%29')))
    .join('/')
  const location = line === undefined ? path : site({ path, line })
  return '[' + text(location) + '](./' + destination + (line === undefined ? '' : '#L' + line) + ')'
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
  return key === 'childPath' || key === 'representativeChild' || key === 'forwardedCall'
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
  target?: string,
): { shown: CallDetails; omitted: number } {
  const entries = new Map<string, Map<string, CallCase>>()
  const omitted = new Set<string>()
  for (const route of routes)
    for (const [index, call] of route.entries()) {
      if (call.kind !== 'call' || (target !== undefined && call.target !== target)) continue
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
    const authored = update?.authoredProgressFields ?? []
    const values = [
      terminal && terminal.kind !== 'condition' ? text(label(terminal)) : 'Unknown',
      calls.join(' → ') || '—',
      update
        ? text(update.detail) +
          '<br>' +
          (origin ? `${text(origin.code)} (${sourceLink(origin)})` : sourceLink(update.site)) +
          (authored.length ? '<br>Possible progress calculation' : '') +
          (update.progressFields ?? authored)
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

function stepDescription(step: BehaviorStep): string {
  if (step.kind === 'condition')
    return step.unresolved
      ? conditionLabel(step)
      : 'Check ' + guardLabel(step) + ' is ' + step.taken
  return step.kind === 'call' ? label(step) + ' · ' + step.target : label(step)
}

function detailLine(step: BehaviorStep): string {
  return text(stepDescription(step) + ' (' + site(step.site) + ')')
}

function linkedCheck(check: BehaviorGuard): string {
  const branch = (check.unresolved ? 'Assumes ' : 'Predicate is ') + check.taken
  const validation = check.validation ? ' · ' + conditionLabel(check) : ''
  return text(branch + validation + ' · ' + guardLabel(check)) + ' (' + sourceLink(check.site) + ')'
}

function nextSteps(after: readonly BehaviorStep[], linkSource = false): string {
  const first = after.slice(0, -1)
  const relevant = first.filter((step) => step.kind !== 'condition' || step.unresolved)
  const shown = new Set(
    [...relevant, ...first.filter((step) => !relevant.includes(step))].slice(0, 3),
  )
  return (
    after
      .filter((step, index) => index === after.length - 1 || shown.has(step))
      .map((step) => {
        if (linkSource && step.kind === 'condition') return linkedCheck(step)
        const description =
          step.kind === 'call' ? 'Call ' + step.slot + ' → ' + step.target : stepDescription(step)
        if (!linkSource) return text(description + ' (' + site(step.site) + ')')
        return text(description) + ' (' + sourceLink(step.site) + ')'
      })
      .join(' → ') +
    (first.length > shown.size
      ? ' · ' + (first.length - shown.size) + ' intermediate steps omitted'
      : '')
  )
}

function renderFirstWrites(report: BehaviorReport, scope: Scope, callers: CallDetails): string[] {
  type WritePath = {
    write: Extract<BehaviorStep, { kind: 'effect' }>
    checks: readonly BehaviorGuard[]
    after: readonly BehaviorStep[]
    entry: string
  }
  const sites = new Map<string, Map<string, WritePath>>()
  let limited = false
  function add(route: Route, key: string, entry: string, after?: readonly BehaviorStep[]) {
    const index = route.findIndex((step) => writesFile(step) && step.owner === scope.target)
    const write = route[index]
    if (write?.kind !== 'effect') return
    const id = JSON.stringify(write.site)
    let paths = sites.get(id)
    if (!paths) {
      if (sites.size >= 4) {
        limited = true
        return
      }
      paths = new Map()
      sites.set(id, paths)
    }
    if (!paths.has(key) && paths.size >= 8) {
      limited = true
      return
    }
    const tail =
      after ??
      route.slice(index + 1).filter((step) => step.kind === 'condition' || step.kind === 'end')
    const previous = paths.get(key)?.after.at(-1)
    const terminal = tail.at(-1)
    if (
      paths.has(key) &&
      (previous?.kind !== 'end' ||
        previous.completion !== 'unknown' ||
        (terminal?.kind === 'end' && terminal.completion === 'unknown'))
    )
      return
    const checks = route.slice(0, index).filter((step) => step.kind === 'condition')
    paths.set(key, {
      write,
      checks: [...checks, ...(write.guards ?? [])].slice(-2),
      after: tail,
      entry,
    })
  }
  for (const route of scope.routes)
    add(route, 'direct', 'Direct invocation of ' + text(scope.target))
  for (const [anchor, cases] of callers) {
    for (const { call, after } of cases.values()) {
      const child = report.childPaths[call.childPath ?? -1]
      if (!child) continue
      const qualifier =
        call.completion === 'if-returned'
          ? ' · conditional child return'
          : call.completion === 'if-failed'
            ? ' · child call fails'
            : ''
      add(
        child.steps,
        anchor + ':' + call.completion,
        text(call.caller + ' via ' + call.slot + qualifier) + ' (' + sourceLink(call.site) + ')',
        after,
      )
    }
  }
  if (!sites.size) return []
  const lines = [
    '### First writes in this Flow',
    '',
    'These examples link the first modeled write attempt in this Flow to how it was entered.',
    '',
  ]
  for (const paths of sites.values()) {
    const origin = paths.values().next().value!.write.site
    lines.push(
      '**Attempts writeFile** (' + sourceLink(origin) + ')',
      '',
      '| Entry | Checks before the write | Destination | Later checks or actions |',
      '| --- | --- | --- | --- |',
    )
    for (const { entry, checks, write, after } of paths.values())
      lines.push(
        '| ' +
          [
            entry,
            checks.map(linkedCheck).join(' → ') || '—',
            text(write.detail),
            nextSteps(after, true) || 'Unresolved',
          ].join(' | ') +
          ' |',
      )
    lines.push('')
  }
  if (limited) lines.push('Some write sites or caller paths exceed the display allowance.', '')
  return lines
}

/** Read both directions from the same caller-local case used by the call expansion. */
function renderCallContinuations(
  details: CallDetails,
  targets: ReadonlyMap<string, BehaviorTarget>,
  incoming: boolean,
  omitted = 0,
): string[] {
  const lines: string[] = []
  for (const cases of details.values()) {
    const returned = ([, { call, after }]: [string, CallCase]) =>
      call.returned !== undefined && after.length > 0
    const entries = [...cases]
    const distinct = new Map<string, [string, CallCase]>()
    if (incoming) {
      for (const entry of entries.filter(returned)) {
        const { call } = entry[1]
        const key = call.completion + ':' + call.returned!.outcome
        if (!distinct.has(key)) distinct.set(key, entry)
      }
    }
    const visible = [...new Set([...distinct.values(), ...entries])]
      .slice(0, callCaseLimit)
      .filter(returned)
    if (!visible.length) continue
    if (!incoming && new Set(visible.map(([, { call }]) => label(call))).size < 2) continue
    const { call } = visible[0]![1]
    lines.push(
      '**' +
        text(incoming ? call.caller + ' · ' + call.slot : call.slot + ' → ' + call.target) +
        '** (' +
        sourceLink(call.site) +
        ')',
      '',
      ...continuationContracts(
        call,
        targets,
        visible.map(([, { call: choice }]) => choice),
      ),
      '| Result from ' +
        text(call.target) +
        ' | Next in ' +
        text(call.caller) +
        ' | Conditions inside the child |',
      '| --- | --- | --- |',
    )
    const seen = new Set<string>()
    for (const [id, { call, after, representativeChecks }] of visible) {
      const title = text(label(call))
      const checks = (call.guards ?? []).filter((guard) => guard.unresolved)
      const childChecks = checks.slice(0, 2).map(linkedCheck)
      if (checks.length > 2) childChecks.push(checks.length - 2 + ' additional child checks')
      const steps =
        (representativeChecks ? 'Representative checks · ' : '') + nextSteps(after, true)
      const conditions = childChecks.join(' → ') || '—'
      const key = JSON.stringify([title, steps, conditions])
      if (seen.has(key)) continue
      seen.add(key)
      const result = incoming ? title : '[' + title + '](#' + id + ')'
      lines.push('| ' + result + ' | ' + steps + ' | ' + conditions + ' |')
    }
    lines.push('')
    if (cases.size > callCaseLimit)
      lines.push('- ' + (cases.size - callCaseLimit) + ' additional call paths omitted.', '')
  }
  if (!lines.length) return []
  if (omitted > 0)
    lines.push(omitted + ' additional call sites exceed the contextual detail limit.', '')
  return [incoming ? '### Caller continuations' : '### Child results and next steps', '', ...lines]
}

function resultContract(target: BehaviorTarget): string {
  const source =
    target.contractPath === undefined ? '' : sourcePathLink(target.contractPath) + ' · '
  return source + 'declared outcomes ' + brief(target.outcomes)
}

function continuationContracts(
  call: Call,
  targets: ReadonlyMap<string, BehaviorTarget>,
  cases: readonly Call[],
): string[] {
  const lines: string[] = []
  const child = targets.get(call.target)
  const caller = targets.get(call.caller)
  if (child) lines.push('- Child result contract · ' + resultContract(child))
  if (caller) {
    lines.push('- Caller’s own result contract · ' + resultContract(caller))
    const shown = new Set(cases.map((choice) => choice.returned?.outcome))
    const additional = (child?.outcomes ?? []).filter(
      (outcome) => shown.has(JSON.stringify(outcome)) && !caller.outcomes.includes(outcome),
    )
    if (additional.length)
      lines.push(
        '- To return ' +
          brief(additional.map((outcome) => JSON.stringify(outcome))) +
          ' from this caller, declare it in `outcomes` and check that `result` accepts the returned shape if a schema is present.',
      )
  }
  if (lines.length) lines.push('')
  return lines
}

type CallOnRoute = { call: Call; route: Route; index: number }

function renderNestedContinuations(
  report: BehaviorReport,
  focus: string,
  targets: ReadonlyMap<string, BehaviorTarget>,
): string[] {
  // Each retained child path references only previously retained paths. Reuse
  // suffixes while keeping the actual outer call and its selected child path.
  const paths: CallOnRoute[][][] = []
  let limited = false
  function* calls(route: Route) {
    for (const [index, call] of route.entries())
      if (call.kind === 'call' && call.returned !== undefined) yield { call, route, index }
  }
  for (const { steps } of report.childPaths) {
    const end = steps.at(-1)
    const inside: CallOnRoute[][] = []
    if (end?.kind === 'end' && end.completion === 'return') {
      for (const entry of calls(steps)) {
        const { call } = entry
        const nested = call.target === focus ? [[]] : (paths[call.childPath ?? -1] ?? [])
        for (const inner of nested) {
          if (inside.length < 8) inside.push([...inner, entry])
          else limited = true
        }
      }
    }
    paths.push(inside)
  }

  const groups = new Map<
    string,
    { call: Call; rows: Map<string, { outcome: string; call: Call; established: boolean }> }
  >()
  const resultLabel = (call: Call) =>
    text((call.completion === 'if-returned' ? 'if admitted ' : 'returns ') + result(call.returned!))
  for (const scope of report.scopes) {
    if (scope.target === focus) continue
    for (const route of [...scope.routes, ...scope.alternatives]) {
      for (const { call, index } of calls(route)) {
        const inner = paths[call.childPath ?? -1]
        if (!inner?.length || call.target === focus) continue
        const anchor = callAnchor(call)
        let group = groups.get(anchor)
        if (!group) {
          if (groups.size >= 8) {
            limited = true
            continue
          }
          group = { call, rows: new Map() }
          groups.set(anchor, group)
        }
        const after = continuation(route, index, call)
        const terminal = after.at(-1)
        const established =
          terminal?.kind === 'call' ||
          (terminal?.kind === 'end' && terminal.completion !== 'unknown')
        for (const chain of inner) {
          const first = chain[0]!.call
          const callers = chain.map(({ call: nested, route: steps, index: at }) => {
            const end = steps.at(-1)!
            const handoff = text(nested.slot) + ' (' + sourceLink(nested.site) + ')'
            if (end.kind === 'end' && end.forwardedCall === at)
              return (
                text(nested.caller + ' forwards this result') +
                ' (' +
                sourceLink(end.site) +
                ') from ' +
                handoff
              )
            const next = continuation(steps, at, nested)
            if (next.at(-1) !== end) next.push(end)
            return text(nested.caller) + ' · ' + handoff + ' → ' + nextSteps(next, true)
          })
          const row =
            '| ' +
            resultLabel(first) +
            ' (' +
            sourceLink(first.site) +
            ') | ' +
            callers.join(' → ') +
            ' | ' +
            resultLabel(call) +
            ' → ' +
            nextSteps(after, true) +
            ' |'
          if (group.rows.size < 32 || group.rows.has(row))
            group.rows.set(row, {
              outcome: first.completion + ':' + first.returned!.outcome,
              call,
              established,
            })
          else limited = true
        }
      }
    }
  }
  if (!groups.size) return []
  const lines = [
    '### Through intermediate callers',
    '',
    'These paths use the intermediate returns from the same modeled call evaluation.',
    '',
  ]
  for (const { call, rows } of groups.values()) {
    const distinct = new Map<string, string>()
    for (const [row, { outcome, established }] of rows) {
      const prior = distinct.get(outcome)
      if (prior === undefined || (established && !rows.get(prior)!.established))
        distinct.set(outcome, row)
    }
    const shown = [...new Set([...distinct.values(), ...rows.keys()])].slice(0, callCaseLimit)
    lines.push(
      '**' +
        text(call.caller + ' · ' + call.slot + ' → ' + call.target) +
        '** (' +
        sourceLink(call.site) +
        ')',
      '',
      ...continuationContracts(
        call,
        targets,
        shown.map((row) => rows.get(row)!.call),
      ),
      '| Result from ' +
        text(focus) +
        ' | Intermediate returns | Next in ' +
        text(call.caller) +
        ' |',
      '| --- | --- | --- |',
      ...shown,
      '',
    )
    if (rows.size > shown.length)
      lines.push('- ' + (rows.size - shown.length) + ' additional modeled paths omitted.', '')
  }
  if (limited) lines.push('Some nested caller paths exceed the display allowance.', '')
  return lines
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
      if (after.length)
        lines.push(
          '  - Back in ' +
            text(call.caller) +
            (representativeChecks ? ' · Representative checks' : '') +
            ' · ' +
            nextSteps(after),
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

function authoredFileWrites(scope: Scope): string[] {
  if (!scope.authoredFileWrites?.length) return []
  const lines = [
    '#### Authored file writes beyond analyzed routes',
    '',
    'Whether these writes are attempted depends on the unresolved continuation.',
    '',
  ]
  for (const write of scope.authoredFileWrites) {
    lines.push('- writeFile(' + text(write.destination) + ') (' + sourceLink(write.site) + ')')
    for (const guard of write.guards)
      lines.push(
        '  - Enclosing branch takes ' +
          text(guard.code) +
          ' as ' +
          guard.taken +
          ' (' +
          sourceLink(guard.site) +
          ')',
      )
  }
  if (scope.authoredFileWritesOmitted)
    lines.push('- ' + scope.authoredFileWritesOmitted + ' additional write sites omitted.')
  return [...lines, '']
}

function capturedSetting(target: BehaviorTarget | undefined, name: string): string {
  if (target?.declarationPath === undefined) return ''
  const settings = record(target.settings)
  const value = Object.hasOwn(settings, name) ? JSON.stringify(settings[name]) : 'unset'
  const detail = value.length > 100 ? name : name + ' = ' + value
  return ' · Captured setting ' + text(detail) + ' from ' + sourcePathLink(target.declarationPath)
}

function configuredChecks(scope: Scope, target: BehaviorTarget | undefined): string[] {
  if (target?.declarationPath === undefined) return []
  const checks = new Set<string>()
  for (const route of scope.routes) {
    for (const step of route) {
      if (step.kind === 'condition' && step.setting?.owner === target.id)
        checks.add('- ' + linkedCheck(step) + capturedSetting(target, step.setting.name))
    }
  }
  if (!checks.size) return []
  return [
    '### Checks that read Binding settings',
    '',
    ...[...checks].slice(0, 4),
    ...(checks.size > 4 ? ['- ' + (checks.size - 4) + ' additional checks in route details.'] : []),
    '',
  ]
}

function authoredHandoffs(
  scope: Scope,
  linkedTargets?: ReadonlySet<string>,
  target?: BehaviorTarget,
): string[] {
  if (!scope.authoredHandoffs?.length) return []
  const lines = [
    '#### Authored handoffs beyond analyzed routes',
    '',
    'These call sites use the configured slots below. Reachability, order, and results remain unresolved.',
    '',
  ]
  const priorExits = new Map<string, { exit: AuthoredPriorExit; slots: Set<string> }>()
  for (const handoff of scope.authoredHandoffs) {
    for (const exit of handoff.priorExits ?? []) {
      const key = JSON.stringify(exit)
      const entry = priorExits.get(key)
      if (entry) entry.slots.add(handoff.slot)
      else priorExits.set(key, { exit, slots: new Set([handoff.slot]) })
    }
  }
  if (priorExits.size) {
    lines.push('**Earlier exits before these call sites**', '')
    for (const { exit, slots } of priorExits.values()) {
      lines.push(
        '- If ' +
          text(exit.condition.code) +
          ' is ' +
          exit.taken +
          ' (' +
          sourceLink(exit.condition.site) +
          '), the branch ends with ' +
          text(exit.statement.code) +
          ' (' +
          sourceLink(exit.statement.site) +
          ') and bypasses the listed call sites for ' +
          brief([...slots]) +
          (exit.setting === undefined ? '.' : capturedSetting(target, exit.setting) + '.'),
      )
    }
    if (scope.authoredPriorExitsOmitted)
      lines.push(`- ${scope.authoredPriorExitsOmitted} earlier exits omitted.`)
    lines.push('')
  }
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

function authoredRepeats(scope: Scope, linkedTargets?: ReadonlySet<string>): string[] {
  if (!scope.authoredRepeats?.length) return []
  const loops = new Map<AuthoredRepeat, AuthoredRepeatedCall[]>()
  for (const repeat of scope.authoredRepeats) {
    const calls = loops.get(repeat.loop) ?? []
    calls.push(repeat)
    loops.set(repeat.loop, calls)
  }
  const lines = [
    '#### Repeated handoffs near coverage gaps',
    '',
    'Source locations for loop control. Reachability and iteration counts remain unresolved.',
    '',
  ]
  for (const [loop, calls] of loops) {
    lines.push('- ' + text(loop.header) + ' (' + sourceLink(loop.site) + ')')
    if (loop.control)
      lines.push(
        '  - Loop condition uses ' +
          text(loop.control.code) +
          ' (' +
          sourceLink(loop.control.site) +
          ')',
      )
    for (const call of calls) {
      const target = linkedTargets?.has(call.target)
        ? '[' + text(call.target) + '](#' + idFor('target', call.target) + ')'
        : text(call.target)
      lines.push('  - ' + text(call.slot) + ' → ' + target + ' (' + sourceLink(call.site) + ')')
    }
    for (const action of loop.actions) {
      const region = action.region
      const protectedStatement = region?.protectedStatement
      const where =
        region === undefined
          ? ''
          : ' · ' +
            region.kind +
            ' (' +
            sourceLink(region.site) +
            ')' +
            (protectedStatement === undefined
              ? ''
              : ' for ' +
                text(protectedStatement.code) +
                ' (' +
                sourceLink(protectedStatement.site) +
                ')')
      const checks = action.guards.map(
        (guard) => text(guard.code) + ' is ' + guard.taken + ' (' + sourceLink(guard.site) + ')',
      )
      lines.push(
        '  - ' +
          (checks.length ? 'When ' + checks.join(' and ') + ', ' : '') +
          text(action.statement.code) +
          ' (' +
          sourceLink(action.statement.site) +
          ')' +
          where,
      )
    }
    if (loop.omittedActions)
      lines.push('  - ' + loop.omittedActions + ' additional control statements omitted.')
    if (loop.following)
      lines.push(
        '  - Later in the same block, ' +
          text(loop.following.code) +
          ' (' +
          sourceLink(loop.following.site) +
          ')',
      )
  }
  if (scope.authoredRepeatsOmitted)
    lines.push('- ' + scope.authoredRepeatsOmitted + ' additional loop call sites omitted.')
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
  const targets = new Map(inventory.map((target) => [target.id, target]))
  const target = targets.get(focus)
  const independent = inventory.filter((item) => item.id.startsWith('flow:')).map((item) => item.id)
  lines.push(
    '## ' + text(focus),
    '',
    ...configuredOrientation(report, focus),
    ...requiredSlotFacts(target),
    ...(target ? ['**Own result contract** · ' + resultContract(target), ''] : []),
    ...(independent.length
      ? ['**Direct Flow targets in this scope** · ' + brief(independent), '']
      : []),
    ...importBoundaryNotice(report),
  )
  const selected = scopes.find((scope) => scope.target === focus)
  lines.push(...incomingCallDecisions(scopes, targets, focus))
  if (selected) {
    lines.push(...renderCallSelections(selected, target), ...configuredChecks(selected, target))
    lines.push(...renderCallReferences([selected], inventory))
    lines.push(...authoredRepeats(selected))
    lines.push(...authoredHandoffs(selected, undefined, target))
    lines.push(...contractChecks(selected))
    const routes = selectRoutes(selected)
    const details = callDetails(report, [...routes, ...selected.alternatives])
    const callers = callDetails(
      report,
      scopes
        .filter((scope) => scope.target !== focus)
        .flatMap((scope) => {
          const reachesFocus = (route: Route) =>
            route.some((step) => step.kind === 'call' && step.target === focus)
          return [
            ...selectRoutes({
              ...scope,
              routes: scope.routes.filter(reachesFocus),
            }),
            ...scope.alternatives.filter(reachesFocus),
          ]
        }),
      focus,
    )
    lines.push(
      ...renderFirstWrites(report, selected, callers.shown),
      ...renderCallContinuations(callers.shown, targets, true, callers.omitted),
      ...renderNestedContinuations(report, focus, targets),
      ...renderCallContinuations(details.shown, targets, false),
    )
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
      ...authoredFileWrites(selected),
    )
    if (selected.gaps.length) {
      lines.push('### Coverage gaps', '')
      for (const gap of selected.gaps)
        lines.push('- ' + text(gap.reason) + ' (' + text(site(gap)) + ')')
      lines.push('')
    }
    lines.push(...evidence(routes))
    lines.push(...renderCallDetails(report, details.shown, details.omitted))
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

function incomingCallDecisions(
  scopes: readonly Scope[],
  targets: ReadonlyMap<string, BehaviorTarget>,
  focus: string,
): string[] {
  const callers = scopes.filter((scope) => scope.target !== focus && scope.callSelections)
  if (!callers.length) return []
  const shown = callers.slice(0, BEHAVIOR_LIMITS.focusedRelatedCalls)
  const lines = ['### Incoming caller decisions', '']
  for (const caller of shown)
    lines.push(
      ...renderCallSelections(caller, targets.get(caller.target), `#### ${text(caller.target)}`),
    )
  if (callers.length > shown.length)
    lines.push(
      `- ${callers.length - shown.length} more callers with authored sites. Inspect each caller to see its decisions.`,
      '',
    )
  return lines
}

function renderCallSelections(
  scope: Scope,
  target: BehaviorTarget | undefined,
  heading = '### Caller decisions',
): string[] {
  const selections = scope.callSelections
  if (!selections || !target) return []
  const lines = [heading, '']
  const declarations = [
    target.slotDeclarationPath && 'Declared slots ' + sourcePathLink(target.slotDeclarationPath),
    target.declarationPath && 'Binding wiring ' + sourcePathLink(target.declarationPath),
  ].filter(Boolean)
  const groups = new Map<string, (typeof selections.sites)[number][]>()
  for (const selection of selections.sites) {
    const group = groups.get(selection.slot) ?? []
    group.push(selection)
    groups.set(selection.slot, group)
  }
  const sharesSlot = (slot: string, count: number) =>
    count + (selections.omittedBySlot.get(slot)?.count ?? 0) > 1
  if (declarations.length && ![...groups].some(([slot, group]) => sharesSlot(slot, group.length)))
    lines.push(declarations.join(' · '), '')

  const dispatches = new Set<string>()
  for (const selection of selections.sites) {
    const dispatch = selection.dispatch
    const key = dispatch && JSON.stringify([dispatch.path, dispatch.line, dispatch.column])
    if (!dispatch || !key || dispatches.has(key)) continue
    dispatches.add(key)
    lines.push(
      `- Helper ${text(dispatch.helper)} (${sourceLink(dispatch.declaration)}) issues ${text(dispatch.request)} (${sourceLink(dispatch)}).`,
    )
    for (const { field, index, parameter } of dispatch.arguments)
      lines.push(`  - Argument ${index + 1} ${text(parameter)} → request field ${field}.`)
    for (const field of selection.requestMetadata)
      lines.push(
        `  - Request metadata ${text(field.field)} = ${text(field.code)} (${text(site(field.site))})`,
      )
  }

  for (const [slot, group] of groups) {
    const destination = target.slots.get(slot)
    if (destination === undefined) continue
    lines.push('', `**${text(slot)} → ${text(destination)}**`, '')
    if (sharesSlot(slot, group.length))
      lines.push(
        ['One configured selection for all calls through this slot.', ...declarations].join(' '),
        '',
      )
    const varying = varyingInputFields(group)
    if (group.length > 1) lines.push('| Call site | Conditions and request |', '| --- | --- |')
    for (const selection of group) {
      const { dispatch, guards, requestMetadata, inputSite, inputFields } = selection
      const near = (location: SourceSite) =>
        location.path === selection.site.path ? `L${location.line}` : text(site(location))
      const call = sourceLink(selection.site) + (dispatch ? ` · helper ${near(dispatch)}` : '')
      const facts = guards.map(
        (guard) =>
          `${text(guard.code)} · ${guard.taken ? 'true' : 'false'} branch (${near(guard.site)})`,
      )
      if (!dispatch)
        for (const field of requestMetadata)
          facts.push(
            `Request metadata ${text(field.field)} = ${text(field.code)} (${near(field.site)})`,
          )
      if (
        inputSite &&
        (inputSite.path !== selection.site.path || inputSite.line !== selection.site.line)
      )
        facts.push(`Child input at ${sourceLink(inputSite)}`)
      for (const field of inputFields) {
        if (field.kind === 'literal' && !field.guard && !varying.has(field.field)) continue
        const guard = field.guard
          ? ` · when ${text(field.guard.code)} is ${field.guard.taken} (${near(field.guard.site)})`
          : ''
        const override = field.possibleOverride
          ? ` · later property may override (${near(field.possibleOverride)})`
          : ''
        facts.push(
          `${text(field.field)} = ${text(field.code)} (${near(field.site)})${guard}${override}`,
        )
      }
      if (group.length > 1) lines.push(`| ${call} | ${facts.join('<br>') || '—'} |`)
      else lines.push(`- ${call}` + (facts.length ? ` · ${facts.join(' · ')}` : ''))
    }
  }
  for (const { slots, calls, omitted } of selections.related) {
    const lead = calls.length
      ? 'Other slots using the same Flow as '
      : 'Slots sharing the same Flow · '
    lines.push('', `**${lead}${text(slots.join(', '))}**`, '')
    for (const call of calls)
      lines.push(`- ${text(call.caller)} · ${text(call.slot)} → ${text(call.target)}`)
    if (omitted) lines.push(`- ${omitted} more configured slots.`)
  }
  for (const [slot, omitted] of selections.omittedBySlot) {
    const locations = omitted.locations.map(sourceLink)
    const remaining = omitted.count - locations.length
    if (remaining > 0) locations.push(`${remaining} more`)
    lines.push(
      '',
      `- Additional call sites for ${text(slot)} (${omitted.count}) · ${locations.join(' · ')}`,
    )
  }
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
      declarationLink: sourcePathLink,
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

function requiredSlotFacts(target: BehaviorTarget | undefined): string[] {
  if (!target?.requiredSlots?.length) return []
  const source = target.slotDeclarationPath
    ? ' · ' + sourcePathLink(target.slotDeclarationPath)
    : ''
  return [
    '**Required slots** · ' + brief(target.requiredSlots) + source,
    'These slots require resolved wiring even on routes that skip their calls.',
    '',
  ]
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
      scope?.authoredRepeats?.length ||
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
        ...requiredSlotFacts(target),
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
      lines.push(...renderCallSelections(scope, target, '#### Caller decisions'))
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
        ...authoredRepeats(scope, linkedTargets),
        ...authoredHandoffs(scope, linkedTargets),
        ...authoredFileWrites(scope),
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
