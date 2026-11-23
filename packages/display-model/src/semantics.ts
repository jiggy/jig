import type { Reference } from '@jigging/reporting'
import {
  DISPLAY_COMPARISON_CALL_ANCESTORS,
  DISPLAY_COMPARISON_CALL_BYTES,
  DISPLAY_COMPARISON_CALL_ROWS,
} from './types.js'
import type {
  DisplayCallPathComparison,
  DisplayProjectRunEvidence,
  DisplayReferenceRecord,
  DisplaySnapshot,
  RecordedViewRole,
} from './types.js'

export type DisplayDestination = {
  key: string
  title: string
  source: string
  icon: string
  group: 'run' | 'application' | 'recorded'
}
/** A view destination is disjoint from built-in surfaces; semantic IDs stay unchanged. */
export const displayViewKey = (id: string): string => JSON.stringify(['view', id])

/** Input keys are original semantic view IDs; output keys identify renderer destinations. */
export function displayDestinations(
  mode: DisplaySnapshot['mode'],
  views: readonly {
    key: string
    title: string
    source: string
    sourceId?: string | undefined
    role?: RecordedViewRole | undefined
  }[],
  rootSourceId?: string,
): DisplayDestination[] {
  const report = views.find((view) => view.role === 'recorded-report')
  const diagnostics = views.find((view) => view.role === 'recorded-diagnostics')
  if (mode === 'retained-views')
    return views.map((view) => ({
      ...view,
      key: displayViewKey(view.key),
      icon: '◈',
      group: 'application' as const,
    }))
  return mode === 'recorded-packet'
    ? [
        ...(report
          ? [
              {
                ...report,
                key: displayViewKey(report.key),
                title: 'Recorded result',
                source: '',
                icon: '◈',
                group: 'recorded' as const,
              },
            ]
          : []),
        { key: 'files', title: 'Captured files', source: '', icon: '▤', group: 'recorded' },
        ...(diagnostics
          ? [
              {
                ...diagnostics,
                key: displayViewKey(diagnostics.key),
                title: 'Diagnostics',
                source: '',
                icon: '!',
                group: 'recorded' as const,
              },
            ]
          : []),
        ...views
          .filter((view) => !view.role)
          .map((view) => ({
            ...view,
            key: displayViewKey(view.key),
            icon: '◈',
            group: 'recorded' as const,
          })),
      ]
    : [
        ...views
          .filter((view) => rootSourceId === undefined || view.sourceId === rootSourceId)
          .map((view) => ({
            ...view,
            key: displayViewKey(view.key),
            icon: '◈',
            group: 'application' as const,
          })),
        { key: 'overview', title: 'Execution', source: '', icon: '↳', group: 'run' },
        { key: 'activity', title: 'Activity', source: '', icon: '≡', group: 'run' },
        { key: 'files', title: 'Delivered files', source: '', icon: '▤', group: 'run' },
        ...views
          .filter((view) => rootSourceId !== undefined && view.sourceId !== rootSourceId)
          .map((view) => ({
            ...view,
            key: displayViewKey(view.key),
            icon: '◈',
            group: 'run' as const,
          })),
      ]
}

/** These intervals describe observations, never execution time or a verdict. */
export function callObservationSpans(
  calls: readonly { id: string; firstObservedAt: number; observedAt: number }[],
): {
  milliseconds: number
  spans: Map<string, { x: number; width: number; milliseconds: number }>
} {
  const valid = calls.filter(
    (call) =>
      Number.isFinite(call.firstObservedAt) &&
      Number.isFinite(call.observedAt) &&
      call.firstObservedAt >= 0 &&
      call.observedAt >= call.firstObservedAt,
  )
  const first = Math.min(...valid.map((call) => call.firstObservedAt))
  const last = Math.max(...valid.map((call) => call.observedAt))
  const milliseconds = valid.length ? last - first : 0
  const scale = Math.max(1, milliseconds)
  return {
    milliseconds,
    spans: new Map(
      valid.map((call) => [
        call.id,
        {
          x: ((call.firstObservedAt - first) / scale) * 1000,
          width: ((call.observedAt - call.firstObservedAt) / scale) * 1000,
          milliseconds: call.observedAt - call.firstObservedAt,
        },
      ]),
    ),
  }
}
export function displayDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`
  if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(1)}s`
  return `${Math.floor(milliseconds / 60000)}m ${Math.floor((milliseconds % 60000) / 1000)}s`
}

/** Typed reference identity includes every field, independently of display labels. */
export const referenceKey = (ref: Reference): string =>
  JSON.stringify(
    ref.kind === 'call'
      ? ['call', ref.operationId]
      : ref.kind === 'record'
        ? ['record', ref.viewId, ref.collectionId, ref.rowId]
        : [ref.kind, ref.attachment, ref.path],
  )

/** Includes hidden cells and supplied details without interpreting domain names. */
export function recordReferences(record: DisplayReferenceRecord | undefined): Reference[] {
  const result: Reference[] = []
  const seen = new Set<string>()
  const add = (ref: Reference) => {
    const identity = referenceKey(ref)
    if (!seen.has(identity)) {
      seen.add(identity)
      result.push(ref)
    }
  }
  const block = (value: NonNullable<DisplayReferenceRecord['block']>) => {
    if (value.kind === 'content') add(value.reference)
    if (value.kind === 'report') for (const ref of value.references ?? []) add(ref)
    if (value.kind === 'facts')
      for (const item of value.items)
        if (item.value !== null && typeof item.value === 'object') add(item.value)
  }
  if (record?.block) block(record.block)
  if (record?.row) {
    for (const value of Object.values(record.row.cells))
      if (value !== null && typeof value === 'object') add(value)
    for (const detail of record.row.details ?? []) block(detail)
  }
  if (record?.activity?.operationId) add({ kind: 'call', operationId: record.activity.operationId })
  return result
}

export function attentionImportance(priority: number): string {
  return priority >= 4
    ? 'host failure / unconfirmed cleanup'
    : priority === 3
      ? 'observation incomplete'
      : priority === 2
        ? 'Flow-reported error'
        : 'Flow-reported warning'
}

type Call = DisplayProjectRunEvidence['calls'][number]
type Step = Readonly<{ slot: string; target: string }>
type Variant = Pick<Call, 'state' | 'outcome'> & Readonly<{ target: string; count: number }>
type Group = {
  root: string
  caller: string
  slot: string
  ancestors: readonly Step[]
  variants: Map<string, Variant>
}

type ObservedCallTree = Readonly<{ root?: string | undefined; calls: readonly Call[] }>

function groupCalls({ root, calls }: ObservedCallTree) {
  const groups = new Map<string, Group>()
  const paths: (readonly Step[] | undefined)[] = []
  const unplaced: Call[] = []

  for (const call of calls) {
    const ancestors = call.parent === undefined ? [] : paths[call.parent - 1]
    if (
      root === undefined ||
      !ancestors ||
      call.caller !== (ancestors.at(-1)?.target ?? root) ||
      call.target === undefined
    ) {
      paths.push(undefined)
      unplaced.push(call)
      continue
    }

    const { caller, slot, target, state, outcome } = call
    paths.push([...ancestors, { slot, target }])
    const key = JSON.stringify([root, ancestors, caller, slot])
    let group = groups.get(key)
    if (!group) {
      group = { root, caller, slot, ancestors, variants: new Map() }
      groups.set(key, group)
    }
    const variant = JSON.stringify([target, state, outcome])
    group.variants.set(variant, {
      target,
      state,
      ...(outcome === undefined ? {} : { outcome }),
      count: (group.variants.get(variant)?.count ?? 0) + 1,
    })
  }
  return { groups, unplaced }
}

/** Compare retained observations at exact root, ancestor and caller paths. */
export function compareObservedCalls(earlier: ObservedCallTree, later: ObservedCallTree) {
  const before = groupCalls(earlier)
  const after = groupCalls(later)
  const groups = new Map([...before.groups, ...after.groups])
  const rows = [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => {
      const previous = before.groups.get(key)
      const current = after.groups.get(key)
      const matches =
        previous !== undefined &&
        current !== undefined &&
        previous.variants.size === current.variants.size &&
        [...previous.variants].every(
          ([id, value]) => current.variants.get(id)?.count === value.count,
        )
      return { key, previous, current, group, matches }
    })
  rows.sort((a, b) => Number(a.matches) - Number(b.matches))
  return { rows, beforeUnplaced: before.unplaced, afterUnplaced: after.unplaced }
}

/** One complete retained path with both sides' full variant counts. */
function displayCallPathComparison({
  group: { root, caller, slot, ancestors },
  previous,
  current,
  matches,
}: ReturnType<typeof compareObservedCalls>['rows'][number]): DisplayCallPathComparison {
  const variants = (group: Group | undefined) =>
    group === undefined
      ? []
      : [...group.variants].sort(([a], [b]) => a.localeCompare(b)).map(([, variant]) => variant)
  return {
    root,
    caller,
    slot,
    ancestors,
    earlier: variants(previous),
    later: variants(current),
    matches,
  }
}

const comparisonEncoder = new TextEncoder()

/** Bound whole rows after comparison. A rejected row contributes no partial counts. */
export function boundDisplayCallComparison(
  compared: ReturnType<typeof compareObservedCalls>['rows'],
) {
  const rows: DisplayCallPathComparison[] = []
  let bytes = 2 // List delimiters.
  let nonmatchingOmitted = 0
  for (const row of compared) {
    if (
      rows.length < DISPLAY_COMPARISON_CALL_ROWS &&
      row.group.ancestors.length <= DISPLAY_COMPARISON_CALL_ANCESTORS
    ) {
      const projected = displayCallPathComparison(row)
      const size =
        comparisonEncoder.encode(JSON.stringify(projected)).byteLength + (rows.length ? 1 : 0)
      if (bytes + size <= DISPLAY_COMPARISON_CALL_BYTES) {
        rows.push(projected)
        bytes += size
        continue
      }
    }
    if (!row.matches) nonmatchingOmitted += 1
  }
  return { rows, rowsOmitted: compared.length - rows.length, nonmatchingOmitted }
}
