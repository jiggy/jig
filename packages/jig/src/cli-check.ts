import { asciiJsonString, usage } from './cli-usage.js'
import {
  type ConfiguredSelection,
  type ConfiguredTarget,
  projectConfiguredBindingSplits,
  renderBindingSplitContext,
  renderBindingSplitOmissions,
} from './internal/configured-binding-splits.js'
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

type Change<T> = { before: T | null; after: T | null }

type RoutingDiff = {
  basis: 'approved'
  targets: ({ target: string } & Change<string>)[]
  slots: ({ caller: string; slot: string } & Change<ConfiguredSelection>)[]
  settingsChanged: string[]
  entrypoint?: Change<string>
}

function configuredTargets(topology: Record<string, JsonValue>) {
  const targets = new Map<string, ConfiguredTarget & { settings?: JsonValue }>()
  for (const target of list(topology.targets).map(record)) {
    if (typeof target.target !== 'string') continue
    const flow = record(target.flow)
    const slots = new Map<string, ConfiguredSelection>()
    for (const route of list(flow.routes).map(record)) {
      if (typeof route.slot !== 'string') continue
      if (typeof route.target === 'string') slots.set(route.slot, { target: route.target })
      else if (typeof route.resource === 'string')
        slots.set(route.slot, { resource: route.resource })
    }
    targets.set(target.target, {
      packagePath: typeof target.package === 'string' ? target.package : null,
      slots,
      ...(flow.settings === undefined ? {} : { settings: flow.settings }),
    })
  }
  return targets
}

function orderedKeys(
  before: ReadonlyMap<string, unknown> | undefined,
  after: ReadonlyMap<string, unknown> | undefined,
) {
  return [...new Set([...(before?.keys() ?? []), ...(after?.keys() ?? [])])].sort()
}

/** Compare only the fields shared by the two configured topology projections. */
export function compareConfiguredRouting(approved: JsonValue, working: JsonValue) {
  const before = record(approved)
  const after = record(working)
  const beforeTargets = configuredTargets(before)
  const afterTargets = configuredTargets(after)
  const diff: RoutingDiff = { basis: 'approved', targets: [], slots: [], settingsChanged: [] }
  for (const target of orderedKeys(beforeTargets, afterTargets)) {
    const prior = beforeTargets.get(target)
    const current = afterTargets.get(target)
    const previousPackage = prior?.packagePath ?? null
    const currentPackage = current?.packagePath ?? null
    if (previousPackage !== currentPackage)
      diff.targets.push({ target, before: previousPackage, after: currentPackage })

    const beforeSlots = prior?.slots
    const afterSlots = current?.slots
    for (const slot of orderedKeys(beforeSlots, afterSlots)) {
      const previous = beforeSlots?.get(slot) ?? null
      const selected = afterSlots?.get(slot) ?? null
      // Both forms hold one string. Keep native resource kinds distinct from targets.
      if (JSON.stringify(previous) !== JSON.stringify(selected))
        diff.slots.push({ caller: target, slot, before: previous, after: selected })
    }
    const beforeSettings = prior?.settings
    const afterSettings = current?.settings
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
  return { diff, bindingSplits: projectConfiguredBindingSplits(beforeTargets, afterTargets) }
}

export function renderCheck(
  json: boolean,
  comparison?: ReturnType<typeof compareConfiguredRouting>,
): string {
  if (json) {
    const result = {
      basis: 'working-tree',
      status: 'linked',
      ...(comparison === undefined ? {} : { diff: comparison.diff }),
    }
    return `${Buffer.from(canonicalJson(result)).toString('utf8')}\n`
  }
  const linked = 'Working configuration linked.\n'
  if (comparison === undefined) return linked
  const { diff, bindingSplits } = comparison

  const label = (value: string | null) => (value === null ? '(absent)' : asciiJsonString(value))
  const selection = (value: ConfiguredSelection | null) =>
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
    ...diff.slots.flatMap(({ caller, slot, before, after }) => {
      const split = bindingSplits.visible.find((row) => row.caller === caller && row.slot === slot)
      return [
        `  Slot ${label(caller)} / ${label(slot)}: ${selection(before)} -> ${selection(after)}`,
        ...(split === undefined ? [] : renderBindingSplitContext(split)),
      ]
    }),
    ...renderBindingSplitOmissions(bindingSplits),
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
