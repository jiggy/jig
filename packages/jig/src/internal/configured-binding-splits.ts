import { asciiJsonString } from '../cli-usage.js'
import { flowSelector } from '../project/package-selector.js'

const MAX_SPLITS = 8
const MAX_RETAINED_SLOTS = 8

export type ConfiguredSelection = { target: string } | { resource: string }

export interface ConfiguredTarget {
  readonly packagePath: string | null
  readonly slots: ReadonlyMap<string, ConfiguredSelection>
}

interface CallerSlot {
  readonly caller: string
  readonly slot: string
}

interface RetainedSlots {
  readonly visible: CallerSlot[]
  omitted: number
}

interface BindingSplit extends CallerSlot {
  readonly original: string
  readonly added: string
  readonly direct?: string
  readonly retainedSlots: RetainedSlots
}

export interface BindingSplits {
  readonly visible: readonly BindingSplit[]
  readonly omitted: number
}

function selectedTarget(selection: ConfiguredSelection | undefined): string | undefined {
  return selection !== undefined && 'target' in selection ? selection.target : undefined
}

/** Compare selector and slot facts only, using the two already linked configurations. */
export function projectConfiguredBindingSplits(
  before: ReadonlyMap<string, ConfiguredTarget>,
  after: ReadonlyMap<string, ConfiguredTarget>,
): BindingSplits {
  const visible: BindingSplit[] = []
  let omitted = 0
  const retainedByOriginal = new Map<string, RetainedSlots>()
  const callers = [...after].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  for (const [caller, current] of callers) {
    const previous = before.get(caller)
    if (previous === undefined || previous.packagePath !== current.packagePath) continue
    for (const slot of [...current.slots.keys()].sort()) {
      const original = selectedTarget(previous.slots.get(slot))
      const added = selectedTarget(current.slots.get(slot))
      if (!original?.startsWith('binding:') || !added?.startsWith('binding:') || before.has(added))
        continue
      const packagePath = before.get(original)?.packagePath
      if (
        packagePath == null ||
        after.get(original)?.packagePath !== packagePath ||
        after.get(added)?.packagePath !== packagePath
      )
        continue
      if (visible.length === MAX_SPLITS) {
        omitted++
        continue
      }
      let retainedSlots = retainedByOriginal.get(original)
      if (retainedSlots === undefined) {
        retainedSlots = { visible: [], omitted: 0 }
        retainedByOriginal.set(original, retainedSlots)
      }
      const direct = flowSelector(packagePath)
      visible.push({
        caller,
        slot,
        original,
        added,
        ...(before.get(direct)?.packagePath === packagePath &&
        after.get(direct)?.packagePath === packagePath
          ? { direct }
          : {}),
        retainedSlots,
      })
    }
  }

  if (visible.length === 0) return { visible, omitted }
  for (const [caller, current] of callers) {
    const previous = before.get(caller)
    if (previous === undefined) continue
    for (const slot of [...current.slots.keys()].sort()) {
      const original = selectedTarget(current.slots.get(slot))
      if (original === undefined || original !== selectedTarget(previous.slots.get(slot))) continue
      const retained = retainedByOriginal.get(original)
      if (retained === undefined) continue
      if (retained.visible.length === MAX_RETAINED_SLOTS) retained.omitted++
      else retained.visible.push({ caller, slot })
    }
  }
  return { visible, omitted }
}

export function renderBindingSplitContext(split: BindingSplit): string[] {
  const quote = asciiJsonString
  const retained = split.retainedSlots.visible.map(
    ({ caller, slot }) =>
      `    Configured selection retained: ${quote(caller)} / ${quote(slot)} -> ${quote(split.original)}`,
  )
  if (split.retainedSlots.omitted > 0)
    retained.push(`    More retained caller slots omitted: ${split.retainedSlots.omitted}.`)
  retained.push(`    Original selector still configured: ${quote(split.original)}`)
  if (split.direct !== undefined)
    retained.push(`    Direct Flow selector still configured: ${quote(split.direct)}`)
  return retained
}

export function renderBindingSplitOmissions({ omitted }: BindingSplits): string[] {
  return omitted === 0 ? [] : [`  Context omitted for additional Binding split slots: ${omitted}.`]
}
