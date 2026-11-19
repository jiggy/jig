import { canonicalJson, decodeJson1, type JsonValue } from '../../json.js'
import { validateProjectPath } from '../../project/paths.js'
import { privateDomainDigest } from '../identity.js'
import type { BehaviorGuard, BehaviorReport, SourceSite } from './model.js'

const format = 'jig.flow-behavior/1'
const digest = /^sha256:[a-f0-9]{64}$/

type Location = readonly [path: string, line: number]

export type ComparisonFact = readonly [
  kind: 'check' | 'call' | 'effect' | 'repeat' | 'exit' | 'gap',
  description: string,
  location: Location,
]
type Path = {
  readonly kind: 'source' | 'conditional' | 'authored'
  readonly facts: readonly ComparisonFact[]
}
type ComparedPath = readonly [kind: Path['kind'], facts: Path['facts']]
type Target = {
  readonly id: string
  readonly configuration: readonly string[]
  readonly settings: string
  readonly paths: readonly Path[]
  readonly coverage: readonly string[]
}
type Snapshot = {
  readonly format: typeof format
  readonly revision: string
  readonly entrypoint: string | null
  readonly targets: readonly Target[]
}

export class BehaviorComparisonError extends Error {}

function distinct<T>(values: readonly T[], key: (value: T) => string = JSON.stringify): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()]
}

function location(site: SourceSite): Location {
  return [site.path, site.line]
}

function factMeaning([kind, description]: ComparisonFact) {
  return [kind, description] as const
}

function pathMeaning([kind, facts]: ComparedPath): string {
  return JSON.stringify([kind, facts.map(factMeaning)])
}

function check(guard: BehaviorGuard): ComparisonFact {
  const numbers = guard.enteringNumbers?.map(([key, value]) => key + ' = ' + value)
  return [
    'check',
    (guard.unresolved ? 'Assume ' : 'Check ') +
      guard.code +
      ' is ' +
      guard.taken +
      (numbers?.length ? ' with ' + numbers.join(', ') : '') +
      ' (' +
      guard.site.path +
      ')',
    location(guard.site),
  ]
}

function addFacts(route: BehaviorReport['scopes'][number]['routes'][number]): ComparisonFact[] {
  const facts: ComparisonFact[] = []
  for (const step of route)
    switch (step.kind) {
      case 'condition':
        if (step.unresolved) facts.push(check(step))
        break
      case 'call':
        facts.push(...(step.guards ?? []).map(check))
        for (const assumption of step.assumptions ?? [])
          facts.push([
            'check',
            'Assume ' +
              assumption.slot +
              ' ' +
              assumption.detail +
              ' (' +
              assumption.site.path +
              ')',
            location(assumption.site),
          ])
        facts.push([
          'call',
          step.slot + ' → ' + step.target + ' · ' + step.result,
          location(step.site),
        ])
        break
      case 'effect':
        facts.push(...(step.guards ?? []).map(check))
        facts.push([
          'effect',
          step.operation + ' · ' + step.detail + ' (' + step.owner + ')',
          location(step.reportingCall ?? step.site),
        ])
        break
      case 'repeat':
        facts.push([
          'repeat',
          'Repeat over ' + step.collection + ' · ' + (step.count ?? 'unknown count'),
          location(step.site),
        ])
        break
      case 'gap':
        facts.push(['gap', step.detail + ' (' + step.site.path + ')', location(step.site)])
        break
      case 'end':
        facts.push(['exit', step.completion + ' · ' + step.detail, location(step.site)])
        break
    }
  return facts
}

function located(site: SourceSite): string {
  // Source edits can shift line numbers without changing behavior.
  return ' (' + site.path + ')'
}

export function flowBehaviorSnapshot(report: BehaviorReport): Snapshot {
  if (report.unavailable !== undefined)
    throw new BehaviorComparisonError(
      'The application exceeds the inspection limits for a behavior snapshot.',
    )
  const scopes = new Map(report.scopes.map((scope) => [scope.target, scope]))
  return {
    format,
    revision: report.revision,
    entrypoint: report.entrypoint ?? null,
    targets: report.inventory.map((target) => {
      const scope = scopes.get(target.id)
      const paths: Path[] = []
      if (scope) {
        for (const route of scope.routes) paths.push({ kind: 'source', facts: addFacts(route) })
        for (const route of scope.alternatives)
          paths.push({ kind: 'conditional', facts: addFacts(route) })
        for (const call of scope.authoredHandoffs ?? [])
          paths.push({
            kind: 'authored',
            facts: [
              ...call.guards.map(check),
              ...(call.priorExits ?? []).map(
                ({ condition, taken, statement }): ComparisonFact => [
                  'check',
                  'Earlier exit if ' + condition.code + ' is ' + taken + ' · ' + statement.code,
                  location(condition.site),
                ],
              ),
              ['call', call.slot + ' → ' + call.target + located(call.site), location(call.site)],
              ...call.exitChecks.map(
                (guard): ComparisonFact => [
                  'check',
                  guard.code + ' is ' + guard.taken + ' → ' + guard.exit + located(guard.site),
                  location(guard.site),
                ],
              ),
            ],
          })
        for (const write of scope.authoredFileWrites ?? [])
          paths.push({
            kind: 'authored',
            facts: [
              ...write.guards.map(check),
              [
                'effect',
                'Authored writeFile to ' + write.destination + located(write.site),
                location(write.site),
              ],
            ],
          })
      }
      const coverage = scope
        ? distinct(scope.gaps.map((gap) => gap.reason + located(gap)))
        : ['Target analysis unavailable.']
      if (scope?.authoredHandoffsOmitted !== undefined)
        coverage.push(scope.authoredHandoffsOmitted + ' authored handoffs omitted.')
      if (scope?.authoredPriorExitsOmitted !== undefined)
        coverage.push(scope.authoredPriorExitsOmitted + ' earlier authored exits omitted.')
      if (scope?.authoredFileWritesOmitted !== undefined)
        coverage.push(scope.authoredFileWritesOmitted + ' authored file writes omitted.')
      return {
        id: target.id,
        configuration: [
          'Flow ' + target.implementation,
          ...[...target.slots].sort().map(([slot, child]) => slot + ' → ' + child),
          'Declared outcomes ' + [...target.outcomes].sort().join(', '),
          ...Object.entries(target.attachments ?? {})
            .sort()
            .map(([name, mode]) => 'Attachment ' + name + ' · ' + mode),
          ...[...(target.artifactResults ?? [])].sort().map((name) => 'Artifact result ' + name),
        ],
        settings: privateDomainDigest('flow-behavior-settings/1', target.settings),
        paths: distinct(paths, ({ kind, facts }) => pathMeaning([kind, facts])),
        coverage,
      }
    }),
  }
}

export function encodeFlowBehaviorSnapshot(snapshot: Snapshot): string {
  try {
    return Buffer.from(canonicalJson(snapshot)).toString('utf8') + '\n'
  } catch {
    throw new BehaviorComparisonError('The behavior snapshot exceeds the JSON transport limits.')
  }
}

function object(value: JsonValue): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function strings(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function validLocation(value: JsonValue): value is Location {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'string' ||
    typeof value[1] !== 'number' ||
    !Number.isSafeInteger(value[1]) ||
    value[1] < 1
  )
    return false
  try {
    validateProjectPath(value[0], 'Behavior source location')
    return true
  } catch {
    return false
  }
}

function path(value: JsonValue): value is Path {
  return (
    object(value) &&
    Object.keys(value).length === 2 &&
    (value.kind === 'source' || value.kind === 'conditional' || value.kind === 'authored') &&
    Array.isArray(value.facts) &&
    value.facts.length > 0 &&
    value.facts.every(
      (fact) =>
        Array.isArray(fact) &&
        fact.length === 3 &&
        ['check', 'call', 'effect', 'repeat', 'exit', 'gap'].includes(fact[0]) &&
        typeof fact[1] === 'string' &&
        validLocation(fact[2]),
    )
  )
}

function target(value: JsonValue): value is Target {
  return (
    object(value) &&
    Object.keys(value).length === 5 &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    strings(value.configuration) &&
    typeof value.settings === 'string' &&
    digest.test(value.settings) &&
    strings(value.coverage) &&
    Array.isArray(value.paths) &&
    value.paths.every(path)
  )
}

export function decodeFlowBehaviorSnapshot(bytes: Uint8Array): Snapshot {
  let value: JsonValue
  try {
    value = decodeJson1(bytes)
  } catch {
    throw new BehaviorComparisonError('The baseline is not a readable Jig behavior snapshot.')
  }
  if (
    object(value) &&
    Object.keys(value).length === 4 &&
    value.format === format &&
    typeof value.revision === 'string' &&
    digest.test(value.revision) &&
    (typeof value.entrypoint === 'string' || value.entrypoint === null) &&
    Array.isArray(value.targets) &&
    value.targets.every(target) &&
    new Set(value.targets.map((entry) => entry.id)).size === value.targets.length
  )
    return {
      format,
      revision: value.revision,
      entrypoint: value.entrypoint,
      targets: value.targets,
    }
  throw new BehaviorComparisonError('The baseline is not a Jig behavior snapshot of this format.')
}

function difference<T>(
  before: readonly T[],
  after: readonly T[],
  key: (value: T) => string = JSON.stringify,
): T[] {
  const remaining = new Set(after.map(key))
  return before.filter((item) => !remaining.has(key(item)))
}

function pathContexts(paths: readonly ComparedPath[]): Map<string, ComparedPath[]> {
  const contexts = new Map<string, ComparedPath[]>()
  for (const path of paths) {
    const [kind, facts] = path
    const key = pathMeaning([kind, facts.filter(([type]) => type === 'check')])
    const existing = contexts.get(key)
    if (existing) existing.push(path)
    else contexts.set(key, [path])
  }
  return contexts
}

function sameFact(a: ComparisonFact, b: ComparisonFact): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

function changedSpan(previous: Path['facts'], current: Path['facts']) {
  let start = 0
  let beforeEnd = previous.length
  let afterEnd = current.length
  while (start < beforeEnd && start < afterEnd && sameFact(previous[start]!, current[start]!))
    start++
  while (
    start < beforeEnd &&
    start < afterEnd &&
    sameFact(previous[beforeEnd - 1]!, current[afterEnd - 1]!)
  ) {
    beforeEnd--
    afterEnd--
  }
  return { before: previous.slice(start, beforeEnd), after: current.slice(start, afterEnd) }
}

function summarizePaths(removed: readonly ComparedPath[], added: readonly ComparedPath[]) {
  const previous = pathContexts(removed)
  const current = pathContexts(added)
  const spans = []
  let matched = 0
  for (const [context, before] of previous) {
    const after = current.get(context)
    // Ambiguous or changed checks do not establish route correspondence.
    if (before.length !== 1 || after?.length !== 1) continue
    const [kind, oldFacts] = before[0]!
    spans.push({ kind, ...changedSpan(oldFacts, after[0]![1]) })
    matched++
  }
  return {
    spans,
    unmatchedBefore: removed.length - matched,
    unmatchedAfter: added.length - matched,
  }
}

function representedConsequences(paths: readonly ComparedPath[], target: string): ComparisonFact[] {
  const writes: ComparisonFact[] = []
  const calls: ComparisonFact[] = []
  const progress: ComparisonFact[] = []
  for (const [kind, facts] of paths) {
    if (kind !== 'source') continue
    let lastProgress: ComparisonFact | undefined
    for (const fact of facts) {
      const [type, detail] = fact
      if (type === 'call') calls.push(fact)
      if (type !== 'effect') continue
      if (detail.startsWith('writeFile · ')) writes.push(fact)
      if (detail.startsWith('view update · progress ') && detail.endsWith(' (' + target + ')'))
        lastProgress = fact
    }
    if (lastProgress) progress.push(lastProgress)
  }
  return distinct([...writes, ...calls, ...progress], consequenceKey)
}

function consequenceKey(fact: ComparisonFact): string {
  return JSON.stringify(factMeaning(fact))
}

function callSites(facts: Path['facts']) {
  return facts.flatMap((fact) => {
    const separator = fact[1].indexOf(' → ')
    return fact[0] === 'call' && separator > 0 ? [{ slot: fact[1].slice(0, separator), fact }] : []
  })
}

function sourceCallPaths(paths: readonly ComparedPath[]) {
  return paths.flatMap(([kind, facts]) => {
    if (kind !== 'source') return []
    const calls = callSites(facts)
    const positions = new Map<string, number>()
    // A repeated slot has no single position on this captured path.
    for (const [index, { slot }] of calls.entries())
      positions.set(slot, positions.has(slot) ? -1 : index)
    return [{ calls, positions }]
  })
}

function orderedSourcePaths(
  paths: ReturnType<typeof sourceCallPaths>,
  earlier: string,
  later: string,
): number {
  return paths.filter(({ positions }) => {
    const first = positions.get(earlier) ?? -1
    const second = positions.get(later) ?? -1
    return first >= 0 && first < second
  }).length
}

function changedCallOrder(before: readonly ComparedPath[], after: readonly ComparedPath[]) {
  const previousSlots = new Set(
    before.flatMap(([kind, facts]) =>
      kind === 'conditional' ? [] : callSites(facts).map(({ slot }) => slot),
    ),
  )
  const previous = sourceCallPaths(before)
  const current = sourceCallPaths(after)
  const orders = []
  const seen = new Set<string>()
  for (const { calls, positions } of current) {
    for (let index = 1; index < calls.length; index++) {
      const first = calls[index - 1]!
      const second = calls[index]!
      if (
        positions.get(first.slot) === -1 ||
        positions.get(second.slot) === -1 ||
        !previousSlots.has(first.slot) ||
        !previousSlots.has(second.slot)
      )
        continue
      const key = JSON.stringify([first.slot, second.slot])
      if (seen.has(key)) continue
      seen.add(key)
      if (
        orderedSourcePaths(previous, first.slot, second.slot) ||
        orderedSourcePaths(current, second.slot, first.slot)
      )
        continue
      orders.push({
        first,
        second,
        paths: orderedSourcePaths(current, first.slot, second.slot),
        reversed: orderedSourcePaths(previous, second.slot, first.slot) > 0,
      })
    }
  }
  return orders
}

export function compareFlowBehavior(before: Snapshot, after: Snapshot) {
  const previous = new Map(before.targets.map((current) => [current.id, current]))
  const current = new Map(after.targets.map((target) => [target.id, target]))
  const changes = []
  const comparedPath = (path: Path) => [path.kind, path.facts] as const
  for (const id of new Set([...previous.keys(), ...current.keys()])) {
    const old = previous.get(id)
    const next = current.get(id)
    const oldPaths = (old?.paths ?? []).map(comparedPath)
    const newPaths = (next?.paths ?? []).map(comparedPath)
    const removedPaths = difference(oldPaths, newPaths, pathMeaning)
    const addedPaths = difference(newPaths, oldPaths, pathMeaning)
    const previousConfiguration = difference(old?.configuration ?? [], next?.configuration ?? [])
    const currentConfiguration = difference(next?.configuration ?? [], old?.configuration ?? [])
    const previousGaps = difference(old?.coverage ?? [], next?.coverage ?? [])
    const currentGaps = difference(next?.coverage ?? [], old?.coverage ?? [])
    const settingsChanged =
      old !== undefined && next !== undefined && old.settings !== next.settings
    if (
      !old ||
      !next ||
      settingsChanged ||
      removedPaths.length ||
      addedPaths.length ||
      previousConfiguration.length ||
      currentConfiguration.length ||
      previousGaps.length ||
      currentGaps.length
    ) {
      const pathSummary = summarizePaths(removedPaths, addedPaths)
      const partial = pathSummary.unmatchedBefore > 0 || pathSummary.unmatchedAfter > 0
      const oldConsequences = partial ? representedConsequences(oldPaths, id) : []
      const newConsequences = partial ? representedConsequences(newPaths, id) : []
      changes.push({
        id,
        previousConfiguration,
        currentConfiguration,
        previousGaps,
        currentGaps,
        settingsChanged,
        removedPaths,
        addedPaths,
        pathSummary,
        callOrder: partial ? changedCallOrder(oldPaths, newPaths) : [],
        beforeConsequences: difference(oldConsequences, newConsequences, consequenceKey),
        afterConsequences: difference(newConsequences, oldConsequences, consequenceKey),
        coverageLimited: Boolean(old?.coverage.length || next?.coverage.length),
      })
    }
  }
  return {
    before: before.revision,
    after: after.revision,
    entrypoint:
      before.entrypoint === after.entrypoint
        ? undefined
        : ([before.entrypoint, after.entrypoint] as const),
    changes,
    matched: current.size - changes.filter((change) => current.has(change.id)).length,
    limited: after.targets.filter((target) => target.coverage.length > 0).length,
  }
}
