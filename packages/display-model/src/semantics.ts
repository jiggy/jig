import type { Reference } from '@jigging/user-updates'
import type { DisplayReferenceRecord, RecordedViewRole } from './types.js'

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
  recorded: boolean,
  views: readonly {
    key: string
    title: string
    source: string
    role?: RecordedViewRole | undefined
  }[],
): DisplayDestination[] {
  const report = views.find((view) => view.role === 'recorded-report')
  const diagnostics = views.find((view) => view.role === 'recorded-diagnostics')
  return recorded
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
        { key: 'overview', title: 'Execution', source: '', icon: '↳', group: 'run' },
        { key: 'activity', title: 'Activity', source: '', icon: '≡', group: 'run' },
        { key: 'files', title: 'Delivered files', source: '', icon: '▤', group: 'run' },
        ...views.map((view) => ({
          ...view,
          key: displayViewKey(view.key),
          icon: '◈',
          group: 'application' as const,
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
        : ['artifact', ref.attachment, ref.path],
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
