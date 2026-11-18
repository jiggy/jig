import { canonicalJson, decodeJson1, type JsonValue } from '../../json.js'
import { privateDomainDigest } from '../identity.js'
import type { BehaviorGuard, BehaviorReport, SourceSite } from './model.js'

const format = 'jig.flow-behavior/1'
const digest = /^sha256:[a-f0-9]{64}$/

type Fact = readonly [
  kind: 'check' | 'call' | 'effect' | 'repeat' | 'exit' | 'gap',
  description: string,
]
type Path = {
  readonly kind: 'source' | 'conditional' | 'authored'
  readonly facts: readonly Fact[]
}
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

function distinct<T>(values: readonly T[]): T[] {
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()]
}

function check(guard: BehaviorGuard): Fact {
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
  ]
}

function addFacts(route: BehaviorReport['scopes'][number]['routes'][number]): Fact[] {
  const facts: Fact[] = []
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
          ])
        facts.push(['call', step.slot + ' → ' + step.target + ' · ' + step.result])
        break
      case 'effect':
        facts.push(...(step.guards ?? []).map(check))
        facts.push(['effect', step.operation + ' · ' + step.detail + ' (' + step.owner + ')'])
        break
      case 'repeat':
        facts.push([
          'repeat',
          'Repeat over ' + step.collection + ' · ' + (step.count ?? 'unknown count'),
        ])
        break
      case 'gap':
        facts.push(['gap', step.detail + ' (' + step.site.path + ')'])
        break
      case 'end':
        facts.push(['exit', step.completion + ' · ' + step.detail])
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
              ['call', call.slot + ' → ' + call.target + located(call.site)],
              ...call.exitChecks.map(
                (guard): Fact => [
                  'check',
                  guard.code + ' is ' + guard.taken + ' → ' + guard.exit + located(guard.site),
                ],
              ),
            ],
          })
      }
      const coverage = scope
        ? distinct(scope.gaps.map((gap) => gap.reason + located(gap)))
        : ['Target analysis unavailable.']
      if (scope?.authoredHandoffsOmitted !== undefined)
        coverage.push(scope.authoredHandoffsOmitted + ' authored handoffs omitted.')
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
        paths: distinct(paths),
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
        fact.length === 2 &&
        ['check', 'call', 'effect', 'repeat', 'exit', 'gap'].includes(fact[0]) &&
        typeof fact[1] === 'string',
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

function difference<T>(before: readonly T[], after: readonly T[]): T[] {
  const remaining = new Set(after.map((item) => JSON.stringify(item)))
  return before.filter((item) => !remaining.has(JSON.stringify(item)))
}

export function compareFlowBehavior(before: Snapshot, after: Snapshot) {
  const previous = new Map(before.targets.map((current) => [current.id, current]))
  const current = new Map(after.targets.map((target) => [target.id, target]))
  const changes = []
  const pathKey = (path: Path) => [path.kind, path.facts] as const
  for (const id of new Set([...previous.keys(), ...current.keys()])) {
    const old = previous.get(id)
    const next = current.get(id)
    const removedPaths = difference(
      (old?.paths ?? []).map(pathKey),
      (next?.paths ?? []).map(pathKey),
    )
    const addedPaths = difference((next?.paths ?? []).map(pathKey), (old?.paths ?? []).map(pathKey))
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
    )
      changes.push({
        id,
        previousConfiguration,
        currentConfiguration,
        previousGaps,
        currentGaps,
        settingsChanged,
        removedPaths,
        addedPaths,
        coverageLimited: Boolean(old?.coverage.length || next?.coverage.length),
      })
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
