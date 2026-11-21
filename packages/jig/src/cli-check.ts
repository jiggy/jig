import { asciiJsonString, usage } from './cli-usage.js'
import { configuredEntrypoint, list, record } from './internal/flow-inspection-scope.js'
import { canonicalJson, type JsonValue } from './json.js'

export function parseCheck(arguments_: readonly string[]): { diff: boolean; json: boolean } {
  const options = new Set(arguments_.slice(1))
  if (
    options.size !== arguments_.length - 1 ||
    [...options].some((option) => option !== '--diff' && option !== '--json')
  )
    usage('check', 'Use only --diff and --json, each at most once.')
  return { diff: options.has('--diff'), json: options.has('--json') }
}

type Selection = { target: string } | { resource: string }
type Change<T> = { before: T | null; after: T | null }

type RoutingDiff = {
  basis: 'approved'
  targets: ({ target: string } & Change<string>)[]
  slots: ({ caller: string; slot: string } & Change<Selection>)[]
  settingsChanged: string[]
  entrypoint?: Change<string>
}

function routes(target: Record<string, JsonValue> | undefined): Map<string, Selection> {
  const selections = new Map<string, Selection>()
  for (const route of list(record(target?.flow).routes).map(record)) {
    if (typeof route.slot !== 'string') continue
    if (typeof route.target === 'string') selections.set(route.slot, { target: route.target })
    else if (typeof route.resource === 'string')
      selections.set(route.slot, { resource: route.resource })
  }
  return selections
}

function orderedKeys<T>(before: ReadonlyMap<string, T>, after: ReadonlyMap<string, T>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].sort()
}

/** Compare only the fields shared by the two configured topology projections. */
export function compareConfiguredRouting(approved: JsonValue, working: JsonValue): RoutingDiff {
  const before = record(approved)
  const after = record(working)
  const beforeTargets = new Map(
    list(before.targets)
      .map(record)
      .map((row) => [String(row.target), row]),
  )
  const afterTargets = new Map(
    list(after.targets)
      .map(record)
      .map((row) => [String(row.target), row]),
  )
  const diff: RoutingDiff = { basis: 'approved', targets: [], slots: [], settingsChanged: [] }
  for (const target of orderedKeys(beforeTargets, afterTargets)) {
    const prior = beforeTargets.get(target)
    const current = afterTargets.get(target)
    const previousPackage = typeof prior?.package === 'string' ? prior.package : null
    const currentPackage = typeof current?.package === 'string' ? current.package : null
    if (previousPackage !== currentPackage)
      diff.targets.push({ target, before: previousPackage, after: currentPackage })

    const beforeSlots = routes(prior)
    const afterSlots = routes(current)
    for (const slot of orderedKeys(beforeSlots, afterSlots)) {
      const previous = beforeSlots.get(slot) ?? null
      const selected = afterSlots.get(slot) ?? null
      // Both forms hold one string. Keep native resource kinds distinct from targets.
      if (JSON.stringify(previous) !== JSON.stringify(selected))
        diff.slots.push({ caller: target, slot, before: previous, after: selected })
    }
    const beforeSettings = record(prior?.flow).settings
    const afterSettings = record(current?.flow).settings
    if (
      beforeSettings !== undefined &&
      afterSettings !== undefined &&
      !Buffer.from(canonicalJson(beforeSettings)).equals(canonicalJson(afterSettings))
    )
      diff.settingsChanged.push(target)
  }
  const previousEntry = configuredEntrypoint(before) ?? null
  const currentEntry = configuredEntrypoint(after) ?? null
  if (previousEntry !== currentEntry)
    diff.entrypoint = { before: previousEntry, after: currentEntry }
  return diff
}

export function renderCheck(json: boolean, diff?: RoutingDiff): string {
  if (json) {
    const result = {
      basis: 'working-tree',
      status: 'linked',
      ...(diff === undefined ? {} : { diff }),
    }
    return `${Buffer.from(canonicalJson(result)).toString('utf8')}\n`
  }
  const linked = 'Working configuration linked.\n'
  if (diff === undefined) return linked

  const label = (value: string | null) => (value === null ? '(absent)' : asciiJsonString(value))
  const selection = (value: Selection | null) =>
    value === null
      ? label(null)
      : 'target' in value
        ? label(value.target)
        : `resource ${label(value.resource)}`
  const lines = [
    ...diff.targets.map(
      ({ target, before, after }) =>
        `  Target ${label(target)}: ${label(before)} -> ${label(after)}`,
    ),
    ...diff.slots.map(
      ({ caller, slot, before, after }) =>
        `  Slot ${label(caller)} / ${label(slot)}: ${selection(before)} -> ${selection(after)}`,
    ),
    ...diff.settingsChanged.map((target) => `  Settings changed for ${label(target)}.`),
  ]
  if (diff.entrypoint !== undefined)
    lines.push(`  Entrypoint: ${label(diff.entrypoint.before)} -> ${label(diff.entrypoint.after)}`)
  return (
    linked +
    (lines.length === 0
      ? 'No changes in compared configuration since the retained approval.\n'
      : `Configured changes since the retained approval\n${lines.join('\n')}\n`)
  )
}
